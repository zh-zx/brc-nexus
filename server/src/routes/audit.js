import { get, all } from '../db/connection.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

// v2.19 P0 审计可见（W3-9）：audit_log 此前「只写不读」，无任何查看入口——BRC 实物问责的核心链路断裂。
// 本路由提供分页 + 过滤（表/动作/用户/日期/关键字）的只读台账查询，仅 admin。复用 login-log 的分页范式。

const MAX_JSON = 2000; // 明细截断，避免列表响应膨胀；完整数据可在「数据库管理台」用 SQL 查
function trunc(v) {
  if (typeof v !== 'string' || v.length <= MAX_JSON) return v;
  return v.slice(0, MAX_JSON) + '…';
}

export default async function auditRoutes(fastify) {
  fastify.get('/api/audit-log', { preHandler: [authMiddleware, adminMiddleware] }, async (request) => {
    const { table, action, user, from, to, q, page = 1, pageSize = 50 } = request.query;
    const conds = [];
    const params = [];
    if (table) { conds.push('table_name = ?'); params.push(String(table)); }
    if (action) { conds.push('action = ?'); params.push(String(action)); }
    if (user) { conds.push('username = ?'); params.push(String(user)); }
    if (from) { conds.push('timestamp >= ?'); params.push(String(from)); }
    if (to) { conds.push('timestamp <= ?'); params.push(String(to)); }
    if (q) {
      conds.push('(record_id LIKE ? OR action LIKE ? OR username LIKE ? OR table_name LIKE ?)');
      const like = `%${String(q)}%`;
      params.push(like, like, like, like);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = Number(get(`SELECT COUNT(*) AS c FROM audit_log ${where}`, params)?.c || 0);
    const limit = Math.min(Math.max(parseInt(pageSize) || 50, 1), 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
    const rows = all(
      `SELECT id, table_name, record_id, action, before_json, after_json, user_id, username, ip_address, timestamp
       FROM audit_log ${where} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const logs = rows.map(r => ({ ...r, before_json: trunc(r.before_json), after_json: trunc(r.after_json) }));
    // 供前端「表 / 动作」筛选下拉：列出已存在的维度值（有界、去重）
    const facets = {
      tables: all('SELECT DISTINCT table_name AS v FROM audit_log WHERE table_name IS NOT NULL ORDER BY v').map(x => x.v),
      actions: all('SELECT DISTINCT action AS v FROM audit_log WHERE action IS NOT NULL ORDER BY v').map(x => x.v),
    };
    return { logs, total, page: parseInt(page) || 1, pageSize: limit, facets };
  });
}
