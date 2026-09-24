import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// v2.7: 从 sql.js（内存库+5s整库写盘）迁移到 node:sqlite（原生 SQLite + WAL）
// 真实 SQLite 即时落盘、支持 WAL 与索引，满足大数据量（大量附件）下的稳定与检索性能。
// 现有 server/data/brc.db 是标准 SQLite 文件，node:sqlite 直接打开，无需数据迁移。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.BRC_DB_PATH || path.join(DATA_DIR, 'brc.db');

let db = null;

export function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');   // WAL + NORMAL：性能与崩溃安全兼顾
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// 与 sql.js 兼容：参数中 undefined 归一为 null（node:sqlite 对 undefined 绑定会抛错）
function bindParams(params) {
  return (params || []).map(p => (p === undefined ? null : p));
}

// 与 sql.js 兼容：返回 { changes, lastInsertRowid }（node:sqlite 语句自动回收，无需 finalize）
export function run(sql, params = []) {
  const d = getDb();
  return d.prepare(sql).run(...bindParams(params));
}

export function get(sql, params = []) {
  const d = getDb();
  const row = d.prepare(sql).get(...bindParams(params));
  return row === undefined ? undefined : row;
}

export function all(sql, params = []) {
  const d = getDb();
  return d.prepare(sql).all(...bindParams(params));
}

export function exec(sql) {
  const d = getDb();
  d.exec(sql);
}

// 事务包装：fn 收到一个 {run,get,all} 句柄，抛错自动回滚。node:sqlite 为单连接串行，直接 BEGIN/COMMIT 安全。
export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const r = fn({ run: (sql, params = []) => d.prepare(sql).run(...bindParams(params)), get: (sql, params = []) => d.prepare(sql).get(...bindParams(params)), all: (sql, params = []) => d.prepare(sql).all(...bindParams(params)) });
    d.exec('COMMIT');
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

// WAL 下数据即时落盘，无需定时整库导出；保留此函数仅供旧调用方兼容
export function saveDb() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ }
}

// WAL 下 copyFileSync 不安全，改用 VACUUM INTO 生成一致性快照
export function backupDb(targetPath) {
  const d = getDb();
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  d.exec(`VACUUM INTO '${String(targetPath).replace(/'/g, "''")}'`);
  return targetPath;
}

export function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}

// 兼容旧调用（真实 SQLite 已即时落盘，无需定时保存）
let saveInterval = null;
export function startAutoSave(intervalMs = 5000) {
  if (saveInterval) clearInterval(saveInterval);
  // no-op：WAL 下写事务即时持久化
}

export function stopAutoSave() {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
}
