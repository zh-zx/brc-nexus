import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSettingInt } from '../db/settings.js';
import { get } from '../db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, '../../data/.jwt-secret');
const DEFAULT_SECRET = 'brc-helper-v2-secret-key-change-in-production';

// v2.19 P0 安全：拒绝以硬编码默认密钥运行（可伪造会话）。
// 优先 env JWT_SECRET；否则读/生成随机密钥并持久化到 gitignore 的 data/.jwt-secret。
function resolveJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== DEFAULT_SECRET) {
    return process.env.JWT_SECRET;
  }
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (saved && saved !== DEFAULT_SECRET) return saved;
    }
  } catch (e) { console.warn('[auth] 读取 .jwt-secret 失败，改为生成新密钥:', e.message); }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated, { encoding: 'utf8', mode: 0o600 });
  } catch (e) { console.warn('[auth] 无法持久化 .jwt-secret（重启后会话失效）:', e.message); }
  if (process.env.JWT_SECRET === DEFAULT_SECRET) {
    console.warn('[auth] 检测到 env JWT_SECRET 为默认值，已忽略并改用随机密钥。生产请设置强随机 JWT_SECRET。');
  }
  return generated;
}

const JWT_SECRET = resolveJwtSecret();

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
  // v2.19 P0：verify 通过不等于账号仍有效——删除/停用的用户应在其 JWT 到期前即刻失效。
  // 回查 user 行：不存在，或 status 为 disabled/pending → 401（active/NULL 放行，兼容历史行）。
  const acct = payload.id ? get('SELECT status FROM user WHERE id = ?', [payload.id]) : null;
  if (!acct || acct.status === 'disabled' || acct.status === 'pending') {
    return reply.status(401).send({ error: '账号不存在或已被禁用，请重新登录' });
  }
  request.user = payload;
}

export async function adminMiddleware(request, reply) {
  if (request.user?.role !== 'admin') {
    return reply.status(403).send({ error: '需要管理员权限' });
  }
}
