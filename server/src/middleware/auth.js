import jwt from 'jsonwebtoken';
import { getSettingInt } from '../db/settings.js';

const JWT_SECRET = process.env.JWT_SECRET || 'brc-helper-v2-secret-key-change-in-production';

export function signToken(user) {
  // 会话时长可配置（auth.session_hours，默认 24h）
  const hours = Math.max(1, getSettingInt('auth.session_hours', 24));
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      user_type: user.user_type || 'operator',
      display_name: user.display_name || user.username,
      avatar: user.avatar || null,
    },
    JWT_SECRET,
    { expiresIn: `${hours}h` }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export async function authMiddleware(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: '未登录，请先登录' });
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) {
    return reply.status(401).send({ error: '登录已过期，请重新登录' });
  }
  request.user = payload;
}

export async function adminMiddleware(request, reply) {
  if (request.user?.role !== 'admin') {
    return reply.status(403).send({ error: '需要管理员权限' });
  }
}
