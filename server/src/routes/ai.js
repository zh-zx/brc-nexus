import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { readOnlyGuard } from '../middleware/permissions.js';
import { validateTraitCode, buildConditionClause } from './query.js';
import crypto from 'crypto';

// v2.7: 角色化 AI Token（MCP/Skill 权限隔离）
// 每个 token 绑定一个角色，只能调用该角色作用域内的工具。服务端是最终裁决者——
// 即使客户端（MCP/Skill）伪造工具列表，越权调用也会被这里拒绝。

const ROLES = ['admin', 'approver', 'operator', 'regulator', 'external'];

// 全员基础只读工具（所有角色）
const BASE_TOOLS = ['search_accessions', 'get_accession', 'query_traits', 'get_trait_definitions', 'get_stats', 'get_inventory', 'get_freezer_status'];

// 工具-角色矩阵：role → 允许的工具集
const ROLE_SCOPES = {
  external: BASE_TOOLS,
  operator: [...BASE_TOOLS, 'get_operation_records', 'get_cryo_records'],
  regulator: [...BASE_TOOLS, 'get_operation_records', 'get_cryo_records'],
  approver: [...BASE_TOOLS, 'get_operation_records', 'get_cryo_records', 'export_accessions'],
  admin: [...BASE_TOOLS, 'get_operation_records', 'get_cryo_records', 'export_accessions', 'get_login_log', 'get_messages'],
};

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// 常量时间字符串比较（长度不等直接 false，避免 timingSafeEqual 抛错/侧信道）
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// v2.19 P0 安全：令牌属主（created_by=username）账号若已删除，令牌必须即刻失效。
function ownerActive(username) {
  if (!username) return true; // 无属主列（旧数据）不额外拦截
  return !!get('SELECT id FROM user WHERE username = ?', [username]);
}

// 旧版单 token（app_setting.ai_api_token）视为 admin 兼容
function getLegacyAiToken() {
  const row = get("SELECT value FROM app_setting WHERE key = 'ai_api_token'");
  return row?.value || '';
}

// AI 专用鉴权：Bearer token → 角色（注入 request.aiScope），未命中返回 401
async function aiAuth(request, reply) {
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return reply.status(401).send({ error: '需要 AI Token' });
  const hash = sha256(token);
  const row = get('SELECT id, role, enabled, created_by FROM ai_token WHERE token_hash = ?', [hash]);
  if (row) {
    if (!row.enabled) return reply.status(401).send({ error: '无效的 AI Token' });
    if (!ownerActive(row.created_by)) return reply.status(401).send({ error: '令牌属主账号已删除，令牌失效' });
    request.aiScope = { tokenId: row.id, role: row.role };
    run('UPDATE ai_token SET last_used_at = datetime(\'now\') WHERE id = ?', [row.id]);
    return;
  }
  // 兼容旧 token（未迁移到角色表的 admin token）
  const legacy = getLegacyAiToken();
  if (legacy && timingSafeEqualStr(token, legacy)) {
    request.aiScope = { tokenId: null, role: 'admin', legacy: true };
    return;
  }
  return reply.status(401).send({ error: '无效的 AI Token' });
}

function allowedTools(role) {
  return ROLE_SCOPES[role] || BASE_TOOLS;
}

function mapAccession(r) {
  return {
    ...JSON.parse(r.data_json),
    id: r.id,
    primaryId: r.primary_id,
    displayName: r.display_name,
    species: r.species,
    origin: r.origin,
  };
}

// ---- 工具实现（只读） ----
const tools = {
  async search_accessions({ q, scope, exact, page, limit }) {
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    let where = '';
    let params = [];
    if (q && q.trim()) {
      const term = q.trim();
      if (scope && scope !== 'all' && /^[A-Za-z0-9_]+$/.test(scope)) {
        where = exact ? `WHERE json_extract(data_json, '$."${scope}"') = ?` : `WHERE json_extract(data_json, '$."${scope}"') LIKE ?`;
        params.push(exact ? term : `%${term}%`);
      } else if (exact) {
        where = 'WHERE primary_id = ? OR display_name = ?';
        params.push(term, term);
      } else {
        where = 'WHERE primary_id LIKE ? OR display_name LIKE ? OR species LIKE ?';
        params.push(`%${term}%`, `%${term}%`, `%${term}%`);
      }
    }
    const total = get(`SELECT COUNT(*) as c FROM accession ${where}`, params);
    const rows = all(`SELECT * FROM accession ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { accessions: rows.map(mapAccession), total: total ? total.c : 0, page: pageNum };
  },

  async query_traits({ conditions, page, limit }) {
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    if (!Array.isArray(conditions) || conditions.length === 0) return { error: '至少需要一个性状条件' };
    const wheres = [];
    const params = [];
    for (const cond of conditions) {
      const trait = cond?.traitCode ? validateTraitCode(cond.traitCode) : null;
      if (!trait) return { error: `未知性状代码: ${cond?.traitCode}` };
      const clause = buildConditionClause(trait, cond, params);
      if (!clause) return { error: `无效的查询条件: ${trait.code} / ${cond?.op}` };
      wheres.push(clause);
    }
    const where = `WHERE ${wheres.join(' AND ')}`;
    const total = get(`SELECT COUNT(*) as c FROM accession ${where}`, params);
    const rows = all(`SELECT * FROM accession ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { accessions: rows.map(mapAccession), total: total ? total.c : 0, page: pageNum };
  },

  async get_accession({ id }) {
    // 优先按内部 id，其次按 primary_id（种质编号，如 CIP-101）
    let row = get('SELECT * FROM accession WHERE id = ?', [id]);
    if (!row) row = get('SELECT * FROM accession WHERE primary_id = ?', [id]);
    if (!row) return { error: '未找到该种质' };
    return mapAccession(row);
  },

  async get_inventory() {
    const rooms = all('SELECT * FROM room ORDER BY name ASC');
    const items = all('SELECT * FROM inventory');
    return {
      totalRooms: rooms.length,
      totalItems: items.length,
      rooms: rooms.map(r => ({
        id: r.id,
        name: r.name,
        items: items.filter(i => i.room_id === r.id).map(i => ({
          id: i.id,
          accessionId: i.accession_id,
          germplasmName: i.germplasm_name,
          quantity: i.quantity,
          form: i.form,
          barcode: i.barcode,
          updatedAt: i.updated_at,
        })),
      })),
    };
  },

  async get_operation_records({ module, step, operator, from, to, batch, page, limit }) {
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 100, 500);
    const offset = (pageNum - 1) * pageSize;
    const conds = [];
    const params = [];
    if (module) { conds.push('module = ?'); params.push(module); }
    if (step) { conds.push('step_code = ?'); params.push(step); }
    if (operator) { conds.push('operator LIKE ?'); params.push(`%${operator}%`); }
    if (batch) { conds.push('batch_id LIKE ?'); params.push(`%${batch}%`); }
    if (from) { conds.push('event_at >= ?'); params.push(from); }
    if (to) { conds.push('event_at <= ?'); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM operation_record ${where}`, params);
    const rows = all(`SELECT * FROM operation_record ${where} ORDER BY event_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { records: rows.map(r => ({ ...r, content: JSON.parse(r.content_json || '{}') })), total: total ? total.c : 0, page: pageNum };
  },

  async get_trait_definitions() {
    const traits = all('SELECT * FROM trait_def ORDER BY category, sort_order, code');
    const categories = all('SELECT DISTINCT category FROM trait_def ORDER BY category');
    return {
      traits: traits.map(r => ({
        id: r.id,
        code: r.code,
        nameEn: r.name_en,
        nameZh: r.name_zh,
        category: r.category,
        valueType: r.value_type,
        unit: r.unit,
        scale: r.scale_json ? JSON.parse(r.scale_json) : null,
        isSystem: r.is_system,
      })),
      categories: categories.map(c => c.category),
    };
  },

  async export_accessions({ format = 'json', limit }) {
    const cap = parseInt(limit) || 5000;
    const rows = all('SELECT * FROM accession ORDER BY created_at DESC LIMIT ?', [cap]);
    const accessions = rows.map(mapAccession);
    if (format === 'json') return { accessions, count: accessions.length, format };
    return { error: '暂仅支持 format=json' };
  },

  async get_freezer_status() {
    const cfg = get('SELECT * FROM freezer_config WHERE id = 1');
    if (!cfg) return { error: '冷藏箱未配置' };
    const boxesPerFreezer = cfg.shelf_per_freezer * cfg.drawer_per_shelf * cfg.box_per_drawer;
    const freezers = [];
    for (let f = 1; f <= cfg.freezer_count; f++) {
      const boxIds = all('SELECT id FROM freezer_box WHERE freezer_no = ?', [f]);
      const sampleCount = boxIds.length ? all(`SELECT COUNT(*) as c FROM freezer_sample WHERE box_id IN (${boxIds.map(() => '?').join(',')})`, boxIds.map(b => b.id))[0].c : 0;
      freezers.push({ freezer: f, boxes: boxIds.length, occupiedPositions: sampleCount });
    }
    const samples = get('SELECT COUNT(*) as c FROM freezer_sample');
    return {
      config: {
        freezerCount: cfg.freezer_count,
        shelfPerFreezer: cfg.shelf_per_freezer,
        drawerPerShelf: cfg.drawer_per_shelf,
        boxPerDrawer: cfg.box_per_drawer,
        rowCount: cfg.row_count,
        colCount: cfg.col_count,
        boxesPerFreezer,
        positionsPerBox: cfg.row_count * cfg.col_count,
      },
      freezers,
      totalSamples: samples ? samples.c : 0,
    };
  },

  async get_stats() {
    const acc = get('SELECT COUNT(*) as c FROM accession');
    const inv = get('SELECT COALESCE(SUM(quantity),0) as c FROM inventory');
    const rooms = get('SELECT COUNT(*) as c FROM room');
    return {
      accessions: acc ? acc.c : 0,
      inventoryQuantity: inv ? inv.c : 0,
      rooms: rooms ? rooms.c : 0,
    };
  },

  async get_cryo_records({ device, from, to, operator, eventType, page, limit }) {
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 100, 500);
    const offset = (pageNum - 1) * pageSize;
    const conds = [];
    const params = [];
    if (device) { conds.push('device_id = ?'); params.push(device); }
    if (eventType) { conds.push('event_type = ?'); params.push(eventType); }
    if (operator) { conds.push('operator LIKE ?'); params.push(`%${operator}%`); }
    if (from) { conds.push('occurred_at >= ?'); params.push(from); }
    if (to) { conds.push('occurred_at <= ?'); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM cryo_record ${where}`, params)?.c || 0;
    const rows = all(`SELECT * FROM cryo_record ${where} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    const devices = Object.fromEntries(all('SELECT id, name FROM cryo_device').map(d => [d.id, d.name]));
    return {
      records: rows.map(r => ({ ...r, deviceName: devices[r.device_id] || r.device_id, detail: JSON.parse(r.detail_json || '{}') })),
      total, page: pageNum,
    };
  },

  async get_login_log({ from, to, action, user, page, limit }) {
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 100, 500);
    const offset = (pageNum - 1) * pageSize;
    const conds = [];
    const params = [];
    if (action) { conds.push('action = ?'); params.push(action); }
    if (user) { conds.push('username LIKE ?'); params.push(`%${user}%`); }
    if (from) { conds.push('created_at >= ?'); params.push(from); }
    if (to) { conds.push('created_at <= ?'); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM login_log ${where}`, params)?.c || 0;
    const rows = all(`SELECT * FROM login_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { logs: rows, total, page: pageNum };
  },

  async get_messages({ unread, page, limit }) {
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 100, 500);
    const offset = (pageNum - 1) * pageSize;
    let where = '';
    const params = [];
    if (unread === '1' || unread === 'true') { where = 'WHERE is_read = 0'; }
    const total = get(`SELECT COUNT(*) as c FROM sys_message ${where}`, params)?.c || 0;
    const rows = all(`SELECT * FROM sys_message ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { messages: rows, total, page: pageNum };
  },
};

export default async function aiRoutes(fastify) {
  // 列出当前 token 作用域内可用的工具（供 MCP/Skill 按作用域注册）
  fastify.get('/api/ai/tools', { preHandler: [aiAuth] }, async (request, reply) => {
    const scope = allowedTools(request.aiScope.role);
    return {
      scope: request.aiScope.role,
      tools: scope.map(name => ({ name, description: `${name} tool` })),
    };
  });

  // AI 统一查询入口（角色化 AI Token 鉴权；服务端按角色矩阵强制校验）
  fastify.post('/api/ai/query', { preHandler: [aiAuth] }, async (request, reply) => {
    const { tool, params } = request.body || {};
    if (!tool || !tools[tool]) {
      return reply.status(400).send({ error: `未知工具，可用: ${allowedTools(request.aiScope.role).join(', ')}` });
    }
    // 权限隔离核心：token 角色不在此工具作用域 → 403，且不泄露细节
    if (!allowedTools(request.aiScope.role).includes(tool)) {
      return reply.status(403).send({ ok: false, error: '该 token 无此工具权限' });
    }
    try {
      const result = await tools[tool](params || {});
      if (result && result.error) {
        return reply.status(400).send({ ok: false, error: result.error });
      }
      return { ok: true, tool, result };
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // ---- 管理员：作用域令牌管理（v2.7） ----

  // 列表（token 只返回前 8 位便于识别）
  fastify.get('/api/ai/tokens', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const rows = all('SELECT id, name, role, enabled, created_by, created_at, last_used_at, token_hash FROM ai_token ORDER BY created_at ASC');
    return {
      tokens: rows.map(r => ({
        id: r.id,
        name: r.name,
        role: r.role,
        enabled: !!r.enabled,
        createdBy: r.created_by,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        tokenPrefix: r.token_hash ? String(r.token_hash).slice(0, 8) : '',
      })),
    };
  });

  // 新建作用域令牌（明文仅返回一次）
  fastify.post('/api/ai/tokens', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    const role = ROLES.includes(b.role) ? b.role : null;
    if (!role) return reply.status(400).send({ error: `角色必须是: ${ROLES.join('/')}` });
    const name = String(b.name || '').trim() || `${role} 令牌`;
    const token = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomUUID();
    run('INSERT INTO ai_token (id, token_hash, name, role, enabled, created_by) VALUES (?,?,?,?,1,?)',
      [id, sha256(token), name, role, request.user.username]);
    return { success: true, id, name, role, token };
  });

  // 启用/吊销
  fastify.post('/api/ai/tokens/:id/status', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const row = get('SELECT * FROM ai_token WHERE id = ?', [request.params.id]);
    if (!row) return reply.status(404).send({ error: '令牌不存在' });
    const enabled = request.body?.enabled ? 1 : 0;
    run('UPDATE ai_token SET enabled = ?, last_used_at = last_used_at WHERE id = ?', [enabled, request.params.id]);
    return { success: true, enabled: !!enabled };
  });

  // ---- 管理员：默认 AI Token（兼容旧界面/脚本；轮换时同步 ai_token 表） ----
  fastify.get('/api/ai/token', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    return { token: getLegacyAiToken() };
  });

  fastify.post('/api/ai/token', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const token = crypto.randomBytes(32).toString('hex');
    run('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['ai_api_token', token]);
    // 同步默认管理员令牌行（存在则更新 hash，保证旧 token 立即失效）
    const existing = get("SELECT id FROM ai_token WHERE name = '默认管理员令牌'");
    if (existing) {
      run('UPDATE ai_token SET token_hash = ? WHERE id = ?', [sha256(token), existing.id]);
    } else {
      run('INSERT INTO ai_token (id, token_hash, name, role, enabled, created_by) VALUES (?,?,?,?,1,?)',
        [crypto.randomUUID(), sha256(token), '默认管理员令牌', 'admin', request.user.username]);
    }
    return { token };
  });
}
