import { getDb, run, get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

// 消息中心：admin 见全局+本人；普通用户仅本人。
// v2.12：per-user 已读——sys_message_read 表记录"谁读了哪条"，广播消息一人已读不再影响他人；
//        输出/过滤的 is_read = 旧全局 is_read OR read 表命中（旧数据语义平滑兼容）。
export default async function messagesRoutes(fastify) {
  // 可见性 SQL 片段 + 参数（admin：全局广播 + role=admin + 本人；其他：仅本人）
  const visScope = (request) => request.user.role === 'admin'
    ? { cond: '(user_id IS NULL OR user_id = ? OR role = ?)', params: [request.user.id, 'admin'] }
    : { cond: 'user_id = ?', params: [request.user.id] };

  // 未读判定片段：全局未读 且 本人未在 read 表标记
  const unreadExpr = "(m.is_read = 0 AND NOT EXISTS (SELECT 1 FROM sys_message_read r WHERE r.user_id = ? AND r.message_id = m.id))";

  fastify.get('/api/messages', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { unread, page = 1, pageSize = 50 } = request.query;
    const scope = visScope(request);
    const conds = [scope.cond];
    const params = [...scope.params];
    if (unread === '1' || unread === 'true') {
      conds.push(unreadExpr);
      params.push(request.user.id);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const total = get(`SELECT COUNT(*) as c FROM sys_message m ${where}`, params)?.c || 0;
    const limit = Math.min(Math.max(parseInt(pageSize) || 50, 1), 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
    const messages = all(
      `SELECT m.*, CASE WHEN m.is_read = 1 OR EXISTS (SELECT 1 FROM sys_message_read r WHERE r.user_id = ? AND r.message_id = m.id) THEN 1 ELSE 0 END AS is_read
       FROM sys_message m ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [request.user.id, ...params, limit, offset],
    );
    return { messages, total, page: parseInt(page) || 1, pageSize: limit };
  });

  fastify.get('/api/messages/unread-count', { preHandler: [authMiddleware] }, async (request, reply) => {
    const scope = visScope(request);
    const row = get(
      `SELECT COUNT(*) as c FROM sys_message m WHERE ${unreadExpr} AND ${scope.cond}`,
      [request.user.id, ...scope.params],
    );
    return { unread: row?.c || 0 };
  });

  fastify.post('/api/messages/:id/read', { preHandler: [authMiddleware] }, async (request, reply) => {
    const msg = get('SELECT * FROM sys_message WHERE id = ?', [request.params.id]);
    if (!msg) return reply.status(404).send({ error: '消息不存在' });
    const isAdmin = request.user.role === 'admin';
    const visible = isAdmin
      ? (msg.user_id === request.user.id || msg.user_id === null || msg.role === 'admin')
      : (msg.user_id === request.user.id);
    if (!visible) return reply.status(403).send({ error: '无权操作该消息' });
    // v2.12：只标记自己已读（不再全局 UPDATE is_read）
    run('INSERT OR IGNORE INTO sys_message_read (user_id, message_id) VALUES (?, ?)', [request.user.id, request.params.id]);
    return { success: true };
  });

  fastify.post('/api/messages/read-all', { preHandler: [authMiddleware] }, async (request, reply) => {
    const scope = visScope(request);
    run(
      `INSERT OR IGNORE INTO sys_message_read (user_id, message_id)
       SELECT ?, m.id FROM sys_message m WHERE ${unreadExpr} AND ${scope.cond}`,
      [request.user.id, request.user.id, ...scope.params],
    );
    return { success: true };
  });

  fastify.delete('/api/messages/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM sys_message WHERE id = ?', [request.params.id]);
    run('DELETE FROM sys_message_read WHERE message_id = ?', [request.params.id]);
    return { success: true };
  });
}
