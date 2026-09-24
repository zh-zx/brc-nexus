import { getDb, run, get, all, tx } from '../db/connection.js';
import { applyCascadeDelete } from '../db/refs.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { getSettingJson } from '../db/settings.js';

// 用户管理（admin）：列表 / 审核 / 类型分类 / 停用 / 重置密码 / 建号 / 删除
export default async function usersRoutes(fastify) {
  // 用户类型字典（可自定义）
  fastify.get('/api/user-types', { preHandler: [authMiddleware] }, async (request, reply) => {
    return { types: getSettingJson('auth.user_types_json', []) };
  });

  // 用户列表（admin；监管方不需要用户管理）
  fastify.get('/api/users', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { type, status, q } = request.query;
    const conds = [];
    const params = [];
    if (type) { conds.push('user_type = ?'); params.push(type); }
    if (status) { conds.push('status = ?'); params.push(status); }
    if (q) { conds.push('(username LIKE ? OR display_name LIKE ? OR org LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const users = all(`SELECT id, username, role, display_name, user_type, status, org, email, created_at, last_login_at, approved_at, approved_by FROM user ${where} ORDER BY created_at DESC`, params);
    return { users };
  });

  // 新建用户（admin）
  fastify.post('/api/users', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { username, password, role, displayName, userType, org, email } = request.body;
    if (!username || !password) return reply.status(400).send({ error: '用户名和密码不能为空' });
    if (password.length < 6) return reply.status(400).send({ error: '密码至少6位' });
    if (get('SELECT id FROM user WHERE username = ?', [username])) {
      return reply.status(400).send({ error: '用户名已存在' });
    }
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    run('INSERT INTO user (id, username, password_hash, role, display_name, user_type, status, org, email, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'), ?)',
      [id, username, hash, role || 'user', displayName || username, userType || 'operator', 'active', org || '', email || '', request.user.username]);
    return { success: true, id };
  });

  // 更新用户（admin）：审核通过/拒绝、改类型/角色/状态/单位/邮箱/显示名
  fastify.put('/api/users/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { id } = request.params;
    const user = get('SELECT * FROM user WHERE id = ?', [id]);
    if (!user) return reply.status(404).send({ error: '用户不存在' });
    if (id === request.user.id && (request.body.status === 'disabled' || request.body.role === 'user')) {
      return reply.status(400).send({ error: '不能停用自己或取消自己的管理员角色' });
    }
    if (request.body.role === 'user' && user.role === 'admin') {
      const admins = get("SELECT COUNT(*) as c FROM user WHERE role = 'admin'");
      if ((admins?.c || 0) <= 1) return reply.status(400).send({ error: '系统至少保留一名管理员' });
    }
    const { userType, role, status, org, email, displayName } = request.body;
    const now = new Date().toISOString();
    const approvedAt = status === 'active' && user.status !== 'active' ? now : user.approved_at;
    const approvedBy = status === 'active' && user.status !== 'active' ? request.user.username : user.approved_by;
    run('UPDATE user SET user_type = ?, role = ?, status = ?, org = ?, email = ?, display_name = ?, approved_at = ?, approved_by = ? WHERE id = ?',
      [userType ?? user.user_type, role ?? user.role, status ?? user.status, org ?? user.org, email ?? user.email, displayName ?? user.display_name, approvedAt, approvedBy, id]);
    return { success: true };
  });

  // 重置密码（admin）
  fastify.post('/api/users/:id/reset-password', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { id } = request.params;
    const { password } = request.body;
    if (!password || password.length < 6) return reply.status(400).send({ error: '密码至少6位' });
    if (!get('SELECT id FROM user WHERE id = ?', [id])) return reply.status(404).send({ error: '用户不存在' });
    const hash = await bcrypt.hash(password, 10);
    run('UPDATE user SET password_hash = ? WHERE id = ?', [hash, id]);
    return { success: true };
  });

  // 删除用户（admin，不能删自己/最后一名管理员）
  fastify.delete('/api/users/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { id } = request.params;
    if (id === request.user.id) return reply.status(400).send({ error: '不能删除自己' });
    const user = get('SELECT * FROM user WHERE id = ?', [id]);
    if (!user) return reply.status(404).send({ error: '用户不存在' });
    if (user.role === 'admin') {
      const admins = get("SELECT COUNT(*) as c FROM user WHERE role = 'admin'");
      if ((admins?.c || 0) <= 1) return reply.status(400).send({ error: '系统至少保留一名管理员' });
    }
    // v2.19 P0：删用户在事务内按策略处理子引用——撤销其 ai_token（enabled=0，保留台账），
    // operation_record/work_order_feedback 为 audit 策略保留为历史留痕；审计/登录日志一律不删。
    tx((h) => {
      applyCascadeDelete(h, 'user', id, { ownerUsername: user.username });
      h.run('DELETE FROM user WHERE id = ?', [id]);
    });
    return { success: true };
  });

  // 登录日志（admin）
  fastify.get('/api/login-log', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { from, to, action, user, page = 1, pageSize = 50 } = request.query;
    const conds = [];
    const params = [];
    if (from) { conds.push('created_at >= ?'); params.push(from); }
    if (to) { conds.push('created_at <= ?'); params.push(to); }
    if (action) { conds.push('action = ?'); params.push(action); }
    if (user) { conds.push('username = ?'); params.push(user); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM login_log ${where}`, params)?.c || 0;
    const limit = Math.min(Math.max(parseInt(pageSize) || 50, 1), 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
    const rows = all(`SELECT * FROM login_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { logs: rows, total, page: parseInt(page) || 1, pageSize: limit };
  });
}
