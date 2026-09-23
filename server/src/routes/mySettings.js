// 用户级个性化设置（v2.6+）
// 与全局 app_setting 分离：每个用户存自己的键值（工作台模块显隐、侧边栏折叠/排序等）
import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { readOnlyGuard } from '../middleware/permissions.js';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_KEYS = new Set(['wb.modules', 'ui.sidebar', 'ui.navOrder', 'ui.theme']);

export default async function mySettingsRoutes(fastify) {
  // 读取当前用户的全部设置（{ key: value }）
  fastify.get('/api/my/settings', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rows = all('SELECT key, value_json FROM user_setting WHERE user_id = ?', [request.user.id]);
    const out = {};
    for (const r of rows) {
      try { out[r.key] = JSON.parse(r.value_json); } catch { out[r.key] = r.value_json; }
    }
    return out;
  });

  // 写入/更新当前用户的某个设置（key 白名单）
  fastify.put('/api/my/settings', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const { key, value } = request.body || {};
    if (!ALLOWED_KEYS.has(String(key))) {
      return reply.status(400).send({ error: '不允许的设置项' });
    }
    const existing = get('SELECT id FROM user_setting WHERE user_id = ? AND key = ?', [request.user.id, key]);
    const val = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    if (existing) {
      run('UPDATE user_setting SET value_json = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND key = ?',
        [val, request.user.id, key]);
    } else {
      run('INSERT INTO user_setting (id, user_id, key, value_json) VALUES (?,?,?,?)',
        [uuidv4(), request.user.id, key, val]);
    }
    return { success: true };
  });
}
