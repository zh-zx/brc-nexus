// 跨表引用关系的单一事实源（v2.19 P0 生产就绪）。
// 取代旧 dbadmin.js 内的 FK_CHECKS 常量：完整性扫描、级联/拦截、孤儿对账全部 import 本模块。
// 采用「应用层级联/拦截」而非 SQLite 外键重建（用户决策），策略语义：
//   block   = 父记录被子表（承载实物/凭证）引用时禁止删除，须先处理子记录
//   cascade = 删父记录时一并删除子记录（从属明细/报表）
//   revoke  = 删父（用户）时撤销子令牌（置 enabled=0），不物理删，保留台账
//   audit   = 子记录为历史留痕，父删除后有意保留为悬空引用（不计入孤儿告警，不级联）

import { get, all, tx } from './connection.js';

// parentKey 默认 'id'；ai_token.created_by 存的是 username，故指向 user.username。
// orphanScope：可选 SQL 谓词（引用别名 x），限定「哪些子行算作孤儿」。
//   ai_token 采用 revoke 策略：删除/禁用属主时置 enabled=0 而非物理删除（保留台账）。
//   一旦令牌被撤销（enabled=0）即为惰性——ai.js/mcp.js 已拒绝它，不再有越权风险，
//   故只把 enabled=1 的悬空令牌计为孤儿；撤销留档的历史令牌不再触发完整性告警。
export const FK_REFS = [
  { child: 'inventory', col: 'accession_id', parent: 'accession', strategy: 'block' },
  { child: 'inventory', col: 'room_id', parent: 'room', strategy: 'block' },
  { child: 'subculture_event', col: 'accession_id', parent: 'accession', strategy: 'audit' },
  { child: 'freezer_sample', col: 'accession_id', parent: 'accession', strategy: 'block' },
  { child: 'freezer_movement', col: 'sample_id', parent: 'freezer_sample', strategy: 'audit' },
  { child: 'freezer_movement', col: 'box_id', parent: 'freezer_box', strategy: 'audit' },
  { child: 'operation_record', col: 'user_id', parent: 'user', strategy: 'audit' },
  { child: 'work_order_feedback', col: 'user_id', parent: 'user', strategy: 'audit' },
  { child: 'work_order_feedback', col: 'work_order_id', parent: 'work_order', strategy: 'cascade' },
  { child: 'work_daily_report', col: 'work_order_id', parent: 'work_order', strategy: 'cascade' },
  { child: 'ai_token', col: 'created_by', parent: 'user', parentKey: 'username', strategy: 'revoke', orphanScope: 'x.enabled = 1' },
];

function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

const _colCache = new Map();
export function hasColumn(table, col) {
  const k = table + '.' + col;
  if (_colCache.has(k)) return _colCache.get(k);
  let ok = false;
  try { ok = all(`PRAGMA table_info(${quoteIdent(table)})`).some(c => c.name === col); } catch (_) { ok = false; }
  _colCache.set(k, ok);
  return ok;
}

// 某父表的直接子引用（不含 audit 策略：它们不计入拦截，仅作历史留痕）
export function enforcedRefsFor(parent) {
  return FK_REFS.filter(r => r.parent === parent && r.strategy !== 'audit' && hasColumn(r.child, r.col));
}

// 统计指向 parentKey=值 的子记录数（按策略），返回 [{child,col,count,strategy}]
export function referrers(parent, keyValue) {
  const out = [];
  for (const r of FK_REFS) {
    if (r.parent !== parent) continue;
    const pk = r.parentKey || 'id';
    if (!hasColumn(r.child, r.col) || !hasColumn(parent, pk)) continue;
    const row = get(`SELECT COUNT(*) AS c FROM ${quoteIdent(r.child)} WHERE ${quoteIdent(r.col)} = ?`, [keyValue]);
    const c = Number(row?.c || 0);
    if (c > 0) out.push({ child: r.child, col: r.col, count: c, strategy: r.strategy });
    }
  return out;
}

// 在事务句柄 t 内，按策略处理 parent 被删/撤销时对子记录的影响。
// 返回 { blocked:[{child,col,count}] }；调用方若 blocked 非空应放弃删除。
// revoke 需要额外传入 ownerUsername（user 删除时其 username）。
export function applyCascadeDelete(t, parent, keyValue, ctx = {}) {
  const blocked = [];
  for (const r of FK_REFS) {
    if (r.parent !== parent) continue;
    const pk = r.parentKey || 'id';
    if (!hasColumn(r.child, r.col) || !hasColumn(parent, pk)) continue;
    if (r.strategy === 'cascade') {
      t.run(`DELETE FROM ${quoteIdent(r.child)} WHERE ${quoteIdent(r.col)} = ?`, [keyValue]);
    } else if (r.strategy === 'revoke') {
      // ai_token.created_by = username；按 username 撤销该用户全部令牌
      const owner = ctx.ownerUsername;
      if (owner) t.run(`UPDATE ai_token SET enabled = 0 WHERE created_by = ? AND enabled = 1`, [owner]);
    } else if (r.strategy === 'block') {
      const row = t.get(`SELECT COUNT(*) AS c FROM ${quoteIdent(r.child)} WHERE ${quoteIdent(r.col)} = ?`, [keyValue]);
      const c = Number(row?.c || 0);
      if (c > 0) blocked.push({ child: r.child, col: r.col, count: c });
    }
    // audit：不动子记录，留作历史悬空引用（不计入孤儿）
  }
  return { blocked };
}

// 孤儿扫描（供 runIntegrityCheck 与对账脚本共用）。audit 策略跳过（有意保留）。
// 返回 [{child,col,parent,count}]
export function scanOrphans() {
  const orphans = [];
  for (const r of FK_REFS) {
    if (r.strategy === 'audit') continue;
    const pk = r.parentKey || 'id';
    if (!hasColumn(r.child, r.col) || !hasColumn(r.parent, pk)) continue;
    const scope = r.orphanScope ? ` AND (${r.orphanScope})` : '';
    const c = get(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(r.child)} x WHERE x.${quoteIdent(r.col)} IS NOT NULL AND x.${quoteIdent(r.col)} != ''${scope} AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(r.parent)} p WHERE p.${quoteIdent(pk)} = x.${quoteIdent(r.col)})`
    );
    const count = Number(c?.c || 0);
    if (count > 0) orphans.push({ child: r.child, col: r.col, parent: r.parent, count });
  }
  return orphans;
}

// 组合删除（供各业务删除 handler 复用，与 dbadmin 行为一致）：
//   1) block 策略存在活跃子引用 → 返回 {blocked:[{child,col,count}]}，不删（调用方据此拒绝）。
//   2) 否则事务内按策略处理子引用（cascade 删明细 / revoke 撤令牌）后删本体，返回 {ok:true, changes}。
// parentKey 恒为本表主键（room/accession/work_order 均为 id）。ctx.ownerUsername 仅 user 需要。
export function guardedDelete(parent, keyValue, ctx = {}) {
  const blocked = referrers(parent, keyValue).filter(r => r.strategy === 'block');
  if (blocked.length) return { blocked };
  const changes = tx((h) => {
    applyCascadeDelete(h, parent, keyValue, ctx);
    const r = h.run(`DELETE FROM ${quoteIdent(parent)} WHERE ${quoteIdent('id')} = ?`, [keyValue]);
    return Number(r?.changes || 0);
  });
  return { ok: true, changes };
}
