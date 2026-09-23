import { getDb, all, get, run, exec, saveDb, backupDb } from '../db/connection.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

// v2.8：数据库可视化管理台（仅 admin）——可执行只读 SQL；写操作需二次确认并记入审计日志。
// 安全边界：单语句、拒绝 DDL/DANGEROUS PRAGMA/ATTACH 等、敏感列打码、写操作审计。
// v2.9：行级增删改（/api/dbadmin/row）——全部参数化、二次确认、FK 反向删除保护、敏感列不可写、审计。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '../../data/brc.db');

const SENSITIVE_COLUMNS = new Set(['token_hash', 'password_hash', 'api_token']);
const DANGEROUS_PRAGMA = /journal_mode|wal_checkpoint|locking_mode|synchronous|foreign_keys|busy_timeout|temp_store|integrity_check/i;
const REJECT_PREFIX = /^\s*(CREATE|ALTER|DROP|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX)\b/i;
const WRITE_PREFIX = /^\s*(INSERT|REPLACE|UPDATE|DELETE)\b/i;
const MAX_RESULT_ROWS = 500;
const MAX_SQL_LEN = 20000;

// 行级增删改：禁止直接写的表（账号/密钥/审计等）
const DENY_CRUD = new Set(['user', 'ai_token', 'login_log', 'audit_log', 'login_lock']);
// accession 直列（其余键进 data_json 性状）
const ACCESSION_DIRECT = new Set(['primary_id', 'display_name', 'species', 'origin']);
const ACCESSION_SYSTEM = new Set(['id', 'data_json', 'source_upload_id', 'last_modified_by', 'last_modified_at', 'created_at']);
const MAX_ROW_KEYS = 200;

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function normalizeValue(v) {
  if (typeof v === 'bigint') return Number(v);
  return v;
}

function maskRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    o[k] = SENSITIVE_COLUMNS.has(k) && typeof v === 'string' && v ? `${v.slice(0, 4)}****` : normalizeValue(v);
  }
  return o;
}

function assertSingleStatement(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL 不能为空');
  if (sql.trim().length > MAX_SQL_LEN) throw new Error('SQL 过长（上限 20000 字符）');
  // 先剔除字符串字面量再按分号拆分，避免分号在字符串里被误判
  const stripped = sql.replace(/'([^']|'')*'/g, "''").replace(/"([^"]|"")*"/g, '""');
  const parts = stripped.split(';').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) throw new Error('一次只允许执行一条语句');
}

function classify(sql) {
  const t = sql.trim();
  if (/^\s*(SELECT|EXPLAIN)\b/i.test(t)) return 'read';
  if (/^\s*PRAGMA\b/i.test(t)) {
    if (DANGEROUS_PRAGMA.test(t)) throw new Error('不允许执行该 PRAGMA');
    return 'read';
  }
  if (REJECT_PREFIX.test(t)) throw new Error('不允许执行 DDL/系统语句，请通过系统界面操作');
  if (WRITE_PREFIX.test(t)) return 'write';
  throw new Error('仅支持 SELECT / PRAGMA / INSERT / UPDATE / DELETE');
}

// 有外键关系的表（完整性检查用）：[子表, 外键列, 父表]
const FK_CHECKS = [
  ['inventory', 'accession_id', 'accession'],
  ['inventory', 'room_id', 'room'],
  ['subculture_event', 'user_id', 'user'],
  ['subculture_event', 'accession_id', 'accession'],
  ['cryo_record', 'accession_id', 'accession'],
  ['freezer_sample', 'accession_id', 'accession'],
  ['freezer_movement', 'sample_id', 'freezer_sample'],
  ['freezer_movement', 'box_id', 'freezer_box'],
  ['operation_record', 'user_id', 'user'],
  ['work_order_feedback', 'user_id', 'user'],
  ['work_order_feedback', 'work_order_id', 'work_order'],
  ['work_daily_report', 'work_order_id', 'work_order'],
  ['ai_token', 'created_by', 'user'],
];

function audit(request, action, detail) {
  try {
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['dbadmin', null, action, null, JSON.stringify(detail), request.user?.id || '', request.user?.username || '']);
  } catch (e) { /* audit failure must not break the request */ }
}

// 完整性检查（启动自检 + dbadmin 共用）：PRAGMA integrity_check + 孤儿记录扫描
export function runIntegrityCheck() {
  const integrity = all('PRAGMA integrity_check').map(r => Object.values(r)[0]);
  const orphans = [];
  for (const [child, col, parent] of FK_CHECKS) {
    const cols = all(`PRAGMA table_info(${quoteIdent(child)})`);
    if (!cols.some(c => c.name === col)) continue;
    const res = all(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(child)} x WHERE x.${quoteIdent(col)} IS NOT NULL AND x.${quoteIdent(col)} != '' AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(parent)} p WHERE p.id = x.${quoteIdent(col)})`,
    );
    const c = normalizeValue(res[0]?.c) || 0;
    if (c > 0) orphans.push({ child, col, parent, count: c });
  }
  const ok = integrity.length === 1 && integrity[0] === 'ok' && orphans.length === 0;
  return { ok, integrity, orphans };
}

// v2.9：行级增删改（仅 admin）。校验链：mode → 表存在 → 非 DENY_CRUD → 键数上限 → confirm
// → 敏感列/未知列 → 键列有效。全部参数化，表/列名经 quoteIdent。
async function rowCrud(request, reply) {
  const b = request.body || {};
  const { table, mode, row, key, confirm } = b;
  const t = String(table || '');
  if (!['insert', 'update', 'delete'].includes(mode)) {
    return reply.status(400).send({ error: 'INVALID_MODE', message: 'mode 必须为 insert / update / delete' });
  }
  const meta = get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [t]);
  if (!meta) return reply.status(404).send({ error: 'TABLE_NOT_FOUND', message: '表不存在' });
  if (DENY_CRUD.has(t)) return reply.status(403).send({ error: 'TABLE_DENIED', message: '该表不允许在管理台直接增删改' });
  const rowObj = (row && typeof row === 'object' && !Array.isArray(row)) ? row : {};
  if (Object.keys(rowObj).length > MAX_ROW_KEYS) {
    return reply.status(400).send({ error: 'TOO_MANY_KEYS', message: `字段数量超限（上限 ${MAX_ROW_KEYS}）` });
  }
  if (confirm !== true) return reply.status(400).send({ error: 'WRITE_CONFIRM_REQUIRED', message: '该操作会修改数据，请二次确认' });

  const cols = all(`PRAGMA table_info(${quoteIdent(t)})`);
  const colNames = new Set(cols.map(c => c.name));

  // 敏感列一律不可写；通用表未知列拒绝（accession 其余键进 data_json 性状）
  for (const k of Object.keys(rowObj)) {
    if (SENSITIVE_COLUMNS.has(k)) {
      return reply.status(400).send({ error: 'SENSITIVE_COLUMN', column: k, message: '敏感字段不允许写入' });
    }
    if (t !== 'accession' && !colNames.has(k)) {
      return reply.status(400).send({ error: 'UNKNOWN_COLUMN', column: k, message: `未知字段：${k}` });
    }
  }

  // 键解析（update/delete 必需）
  let keyCol = null, keyValue = null;
  if (mode !== 'insert') {
    keyCol = key && key.col != null ? String(key.col) : null;
    keyValue = key ? key.value : undefined;
    if (!keyCol || !colNames.has(keyCol)) return reply.status(400).send({ error: 'INVALID_KEY', message: '键列无效' });
    if (keyValue === undefined || keyValue === null) return reply.status(400).send({ error: 'INVALID_KEY', message: '键值不能为空' });
  }

  try {
    if (mode === 'insert') {
      let recordId;
      if (t === 'accession') {
        const data = {};
        const direct = {};
        for (const [k, v] of Object.entries(rowObj)) {
          if (k === 'data_json' && v && typeof v === 'object') { Object.assign(data, v); continue; }
          if (ACCESSION_DIRECT.has(k)) { if (v != null) direct[k] = v; continue; }
          if (ACCESSION_SYSTEM.has(k)) continue;
          if (v != null) data[k] = v;
        }
        recordId = rowObj.id || uuidv4();
        const primaryId = direct.primary_id || data.primaryId || data.primary_id || data.name || recordId;
        const displayName = direct.display_name || data.displayName || data.display_name || data.name || primaryId;
        const species = direct.species || data.species || data.speciesName || '';
        const origin = direct.origin || data.origin || '';
        run('INSERT INTO accession (id, data_json, primary_id, display_name, species, origin, last_modified_by) VALUES (?,?,?,?,?,?,?)',
          [recordId, JSON.stringify(data), primaryId, displayName, species, origin, request.user.username]);
      } else {
        const insertRow = {};
        for (const [k, v] of Object.entries(rowObj)) {
          if (v === undefined) continue;
          insertRow[k] = v;
        }
        if (colNames.has('id') && insertRow.id == null) insertRow.id = uuidv4();
        const keys = Object.keys(insertRow);
        const vals = keys.map(k => (insertRow[k] === undefined ? null : insertRow[k]));
        run(`INSERT INTO ${quoteIdent(t)} (${keys.map(quoteIdent).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, vals);
        recordId = insertRow.id != null ? String(insertRow.id) : null;
      }
      const lookupCol = colNames.has('id') ? 'id' : (cols.length ? cols[0].name : null);
      const afterRow = recordId && lookupCol ? get(`SELECT * FROM ${quoteIdent(t)} WHERE ${quoteIdent(lookupCol)} = ?`, [recordId]) : null;
      audit(request, 'ROW_INSERT', { table: t, recordId, after: maskRow(afterRow || {}) });
      return { success: true, mode, table: t, recordId, changes: 1 };
    }

    // update / delete：先按键取旧行
    const oldRows = all(`SELECT * FROM ${quoteIdent(t)} WHERE ${quoteIdent(keyCol)} = ?`, [keyValue]);
    if (!oldRows.length) return reply.status(404).send({ error: 'ROW_NOT_FOUND', message: '未找到匹配记录' });
    if (oldRows.length > 1) return reply.status(400).send({ error: 'NON_UNIQUE_KEY', message: '键值不唯一，无法定位单条记录' });
    const oldRow = oldRows[0];

    if (mode === 'update') {
      if (Object.prototype.hasOwnProperty.call(rowObj, keyCol)) {
        return reply.status(400).send({ error: 'CANNOT_MODIFY_KEY', message: '不允许修改键列' });
      }
      if (t === 'accession') {
        const data = JSON.parse(oldRow.data_json || '{}');
        const direct = {};
        for (const [k, v] of Object.entries(rowObj)) {
          if (k === 'data_json' && v && typeof v === 'object') { Object.assign(data, v); continue; }
          if (k === 'primary_id') { if (v != null) direct.primary_id = v; continue; }
          if (k === 'display_name') { if (v != null) direct.display_name = v; continue; }
          if (k === 'species') { if (v != null) direct.species = v; continue; }
          if (k === 'origin') { if (v != null) direct.origin = v; continue; }
          if (ACCESSION_SYSTEM.has(k)) continue; // id / 时间戳等系统列不可改
          if (v == null) delete data[k];
          else data[k] = v;
        }
        const primaryId = direct.primary_id != null ? direct.primary_id : oldRow.primary_id;
        const displayName = direct.display_name || data.displayName || data.display_name || data.name || primaryId;
        const species = direct.species || data.species || data.speciesName || '';
        const origin = direct.origin || data.origin || '';
        run('UPDATE accession SET data_json = ?, primary_id = ?, display_name = ?, species = ?, origin = ?, last_modified_by = ?, last_modified_at = datetime(\'now\') WHERE id = ?',
          [JSON.stringify(data), primaryId, displayName, species, origin, request.user.username, oldRow.id]);
      } else {
        const setCols = {};
        for (const [k, v] of Object.entries(rowObj)) {
          if (k === keyCol) return reply.status(400).send({ error: 'CANNOT_MODIFY_KEY', message: '不允许修改键列' });
          if (v === undefined) continue;
          setCols[k] = v;
        }
        if (Object.keys(setCols).length) {
          const sets = Object.keys(setCols).map(k => `${quoteIdent(k)} = ?`).join(', ');
          run(`UPDATE ${quoteIdent(t)} SET ${sets} WHERE ${quoteIdent(keyCol)} = ?`, [...Object.values(setCols), keyValue]);
        }
      }
      const afterRow = get(`SELECT * FROM ${quoteIdent(t)} WHERE ${quoteIdent(keyCol)} = ?`, [keyValue]);
      audit(request, 'ROW_UPDATE', { table: t, recordId: String(keyValue), before: maskRow(oldRow), after: maskRow(afterRow || {}) });
      return { success: true, mode, table: t, recordId: String(keyValue), changes: 1 };
    }

    // delete：FK 反向扫描（FK_CHECKS 中 parent === 本表，用旧行 id 扫子表）
    const refs = [];
    for (const [child, col, parent] of FK_CHECKS) {
      if (parent !== t) continue;
      const childCols = all(`PRAGMA table_info(${quoteIdent(child)})`).map(c => c.name);
      if (!childCols.includes(col)) continue;
      const c = normalizeValue(get(`SELECT COUNT(*) AS c FROM ${quoteIdent(child)} WHERE ${quoteIdent(col)} = ?`, [oldRow.id])?.c) || 0;
      if (c > 0) refs.push({ child, col, count: c });
    }
    if (refs.length) {
      return reply.status(400).send({ error: 'FK_BLOCKED', message: '存在引用该记录的子表数据，禁止删除', references: refs });
    }
    const r = run(`DELETE FROM ${quoteIdent(t)} WHERE ${quoteIdent(keyCol)} = ?`, [keyValue]);
    audit(request, 'ROW_DELETE', { table: t, recordId: String(keyValue), before: maskRow(oldRow) });
    return { success: true, mode, table: t, recordId: String(keyValue), changes: Number(r.changes || 0) };
  } catch (e) {
    return reply.status(400).send({ error: e.message || '操作失败' });
  }
}

export default async function dbAdminRoutes(fastify) {
  const pre = { preHandler: [authMiddleware, adminMiddleware] };

  // 表清单 + 行数 + 库文件大小
  fastify.get('/api/dbadmin/tables', pre, async () => {
    const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const list = tables.map(t => {
      const c = get(`SELECT COUNT(*) AS c FROM ${quoteIdent(t.name)}`);
      return { name: t.name, rows: normalizeValue(c?.c) || 0 };
    });
    let size = 0;
    try { size = fs.statSync(DB_FILE).size; } catch (e) { /* ignore */ }
    return { tables: list, size };
  });

  // 表预览（前 100 行，敏感列打码）
  fastify.get('/api/dbadmin/tables/:table', pre, async (request, reply) => {
    const table = String(request.params.table || '');
    const exists = get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
    if (!exists) return reply.status(404).send({ error: '表不存在' });
    const cols = all(`PRAGMA table_info(${quoteIdent(table)})`).map(c => c.name);
    const rows = all(`SELECT * FROM ${quoteIdent(table)} LIMIT 100`).map(maskRow);
    return { columns: cols, rows, total: normalizeValue(get(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`)?.c) || 0 };
  });

  // SQL 执行：只读直接放行；写操作需 confirm 并审计
  fastify.post('/api/dbadmin/query', pre, async (request, reply) => {
    const { sql, confirm } = request.body || {};
    try {
      assertSingleStatement(sql);
      const kind = classify(sql);
      if (kind === 'write' && confirm !== true) {
        return reply.status(400).send({ error: 'WRITE_CONFIRM_REQUIRED', message: '该语句会修改数据，请二次确认' });
      }
      const stmt = getDb().prepare(sql);
      if (kind === 'read') {
        const rows = stmt.all().slice(0, MAX_RESULT_ROWS).map(maskRow);
        return { kind, rows, count: rows.length };
      }
      const r = stmt.run();
      const changes = Number(r.changes || 0);
      audit(request, 'EXEC_SQL', { sql: sql.slice(0, 2000), changes });
      return { kind, changes, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
    } catch (e) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // 整库导出（VACUUM INTO 一致性快照）
  fastify.get('/api/dbadmin/export', pre, async (request, reply) => {
    const dir = path.join(__dirname, '../../data/backups');
    const tmp = path.join(dir, `export-${Date.now()}.db`);
    backupDb(tmp);
    audit(request, 'EXPORT', {});
    const stream = fs.createReadStream(tmp);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="brc-export-${Date.now()}.db"`);
    stream.on('close', () => { try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } });
    return reply.send(stream);
  });

  // 手动备份
  fastify.post('/api/dbadmin/backup', pre, async (request) => {
    const dir = path.join(__dirname, '../../data/backups');
    const filename = `brc-backup-manual-${Date.now()}.db`;
    backupDb(path.join(dir, filename));
    audit(request, 'BACKUP', { filename });
    return { success: true, filename };
  });

  // 维护：ANALYZE + WAL checkpoint
  fastify.post('/api/dbadmin/maintenance', pre, async (request) => {
    exec('ANALYZE');
    saveDb();
    audit(request, 'MAINTENANCE', {});
    return { success: true };
  });

  // 完整性检查：PRAGMA integrity_check + 孤儿记录扫描
  fastify.get('/api/dbadmin/integrity', pre, async () => {
    return runIntegrityCheck();
  });

  // v2.9：行级增删改（可视化模式）——参数化 + 二次确认 + 审计
  fastify.post('/api/dbadmin/row', pre, rowCrud);
}
