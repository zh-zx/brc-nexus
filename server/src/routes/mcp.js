import { get, all, run } from '../db/connection.js';
import { getSettingInt, getSettingJson } from '../db/settings.js';
import { validateTraitCode, buildConditionClause } from './query.js';
import crypto from 'crypto';

// v2.11：MCP (Model Context Protocol) 服务 —— 让申请者自己的 AI agent 通过自然语言检索/申请种质。
// 传输：streamable HTTP（无状态，请求/响应均为 JSON-RPC，响应 application/json，不开 SSE）。
// 鉴权：复用 ai_token 体系（Bearer token → sha256 → ai_token 表）；限流：mcp.rate_limit_per_min。
// 安全：字段白名单（只出护照+性状+库存，绝不出 data_json 原文/敏感列）；每次 tools/call 审计；
//       提交申请走与向导/手工相同的 35 上限与黑名单检查；来源标记 source='mcp'。

const SERVER_NAME = 'cccap-brc';
const SERVER_VERSION = '2.18';
const SUPPORTED_PROTOCOLS = new Set(['2025-03-26', '2024-11-05']);
const PROTOCOL_DEFAULT = '2025-03-26';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ---- 限流（内存滑动窗口，按令牌） ----
const rateBuckets = new Map();
function checkRateLimit(tokenId) {
  const limit = getSettingInt('mcp.rate_limit_per_min', 120);
  const now = Date.now();
  const b = rateBuckets.get(tokenId);
  if (!b || now > b.resetAt) {
    rateBuckets.set(tokenId, { count: 1, resetAt: now + 60000 });
    return { ok: true };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true };
}
// 定期清理过期桶，防内存膨胀
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
}, 300000).unref();

// ---- 工具实现（全部白名单输出） ----
const STOCK_SELECT = `
  SELECT a.*,
    (SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i WHERE i.accession_id = a.id) AS stock_total,
    (SELECT COALESCE(GROUP_CONCAT(i.form || ':' || CAST(i.quantity AS INTEGER)), '') FROM inventory i WHERE i.accession_id = a.id AND i.quantity > 0) AS stock_forms
  FROM accession a`;

function cleanRow(r) {
  const data = (() => { try { return JSON.parse(r.data_json || '{}'); } catch { return {}; } })();
  const traits = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && v !== undefined && v !== '') traits[k] = v;
  }
  return {
    id: r.id,
    primaryId: r.primary_id,
    displayName: r.display_name,
    species: r.species,
    origin: r.origin,
    stockTotal: Number(r.stock_total || 0),
    stockForms: r.stock_forms ? String(r.stock_forms).split(',') : [],
    traits,
  };
}

function toolSearchGermplasm(args) {
  const conditions = Array.isArray(args?.conditions) ? args.conditions : [];
  const pageNum = Math.max(1, parseInt(args?.page) || 1);
  const pageSize = Math.min(parseInt(args?.pageSize) || 20, 50);
  const offset = (pageNum - 1) * pageSize;

  const wheres = [];
  const params = [];
  for (const cond of conditions) {
    const trait = cond?.traitCode ? validateTraitCode(cond.traitCode) : null;
    if (!trait) throw new Error(`未知性状代码: ${cond?.traitCode}`);
    const clause = buildConditionClause(trait, cond, params);
    if (!clause) throw new Error(`无效的查询条件: ${trait.code} / ${cond?.op}`);
    wheres.push(clause);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) as c FROM accession a ${where}`, params);
  const rows = all(`${STOCK_SELECT} ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return {
    total: total ? total.c : 0,
    page: pageNum,
    pageSize,
    accessions: rows.map(cleanRow),
  };
}

function toolGetAccession(args) {
  const pid = String(args?.primaryId || '').trim();
  if (!pid) throw new Error('primaryId 必填');
  const r = get(`${STOCK_SELECT} WHERE a.primary_id = ?`, [pid]);
  if (!r) throw new Error(`未找到种质: ${pid}`);
  const omics = all('SELECT category, title, ref, url, notes FROM accession_omics WHERE accession_id = ? ORDER BY created_at DESC', [r.id]);
  return { ...cleanRow(r), omics };
}

function toolSubmitDistributionRequest(request, args) {
  const applicant = String(args?.applicant || '').trim();
  const resourceType = String(args?.resourceType || '').trim();
  if (!applicant) throw new Error('applicant（申请方）必填');
  if (!resourceType) throw new Error('resourceType（所需种质类型）必填');
  const rawList = Array.isArray(args?.accessions) ? args.accessions : [];
  if (!rawList.length) throw new Error('accessions（种质编号列表）不能为空');

  // 归一化为 primaryId 字符串
  const pids = [...new Set(rawList.map(a => String(typeof a === 'object' ? (a?.primaryId ?? a?.code ?? a?.id ?? '') : a).trim()).filter(Boolean))];
  const maxAcc = getSettingInt('dist.max_accessions', 35);
  if (pids.length > maxAcc) throw new Error(`选中种质数超过上限（${maxAcc}）。请精简所选，或分多次申请。`);

  // 解析为库内记录
  const found = [];
  const missing = [];
  for (const pid of pids) {
    const row = get('SELECT id, primary_id, display_name FROM accession WHERE primary_id = ?', [pid]);
    if (row) found.push({ id: row.id, code: row.primary_id, name: row.display_name || '' });
    else missing.push(pid);
  }
  if (missing.length) throw new Error(`以下种质编号未找到: ${missing.join(', ')}`);

  // 黑名单检查（与手工/向导申请一致）
  const blacklist = getSettingJson('dist.blacklist_json', []);
  const org = String(args?.applicantOrg || applicant || '').trim().toLowerCase();
  const inBlacklist = blacklist.some(x => String(x).toLowerCase() === org);
  const warnings = [];
  if (inBlacklist) warnings.push('申请方在黑名单中，请注意审核');

  const id = crypto.randomUUID();
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  const reqNo = `DS-${d}-${rnd}`;
  run('INSERT INTO dist_request (id, req_no, applicant, applicant_org, purpose, resource_type, qty, duration_days, qualification_docs_json, accessions_json, source, status, current_stage, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, reqNo, applicant, String(args?.applicantOrg || ''), String(args?.purpose || ''), resourceType, found.length,
      args?.durationDays != null ? parseInt(args.durationDays) || null : null,
      '[]', JSON.stringify(found), 'mcp', 'pending', 1, request.mcpToken?.name || 'mcp']);
  return {
    submitted: true,
    reqNo,
    status: 'pending',
    count: found.length,
    note: '已进入审批流，等待管理员审核。可用 get_my_requests 查询进度。',
    ...(warnings.length ? { warnings } : {}),
  };
}

function toolGetMyRequests(request) {
  const rows = all('SELECT req_no, status, current_stage, qty, resource_type, created_at, updated_at FROM dist_request WHERE created_by = ? ORDER BY created_at DESC LIMIT 20',
    [request.mcpToken?.name || 'mcp']);
  return { requests: rows.map(r => ({ reqNo: r.req_no, status: r.status, currentStage: r.current_stage, qty: r.qty, resourceType: r.resource_type, createdAt: r.created_at, updatedAt: r.updated_at })) };
}

// ---- 工具清单（JSON Schema） ----
const TOOLS = [
  {
    name: 'search_germplasm',
    description: '按性状条件检索种质资源（马铃薯/甘薯）。conditions 为可选的 AND 过滤条件；不传则返回全部种质（分页）。每条含护照信息、性状值 traits、库存 stockTotal。',
    inputSchema: {
      type: 'object',
      properties: {
        conditions: {
          type: 'array',
          description: '性状过滤条件（AND 连接），可省略',
          items: {
            type: 'object',
            properties: {
              traitCode: { type: 'string', description: '性状代码，如 LB_RR、VITC' },
              op: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'empty', 'notempty'], description: '数字用 gt/gte/lt/lte/eq/neq；文本用 contains/eq/neq；等级用 eq' },
              value: { type: 'string', description: '比较值（empty/notempty 可省略）' },
            },
            required: ['traitCode', 'op'],
          },
        },
        page: { type: 'integer', minimum: 1, description: '页码，默认 1' },
        pageSize: { type: 'integer', minimum: 1, maximum: 50, description: '每页数量，默认 20，上限 50' },
      },
    },
  },
  {
    name: 'get_accession',
    description: '获取单个种质的完整信息：护照数据、全部性状值、库存（stockTotal/stockForms）、基因组学记录 omics。',
    inputSchema: {
      type: 'object',
      properties: { primaryId: { type: 'string', description: '种质编号，如 CIP-001' } },
      required: ['primaryId'],
    },
  },
  {
    name: 'submit_distribution_request',
    description: '代表用户提交种质分发申请（一次最多 35 个编号，超限会被拒绝）。提交后进入管理员审批流，用 get_my_requests 跟踪进度。提交前必须先向用户确认清单。',
    inputSchema: {
      type: 'object',
      properties: {
        applicant: { type: 'string', description: '申请方（必填）' },
        applicantOrg: { type: 'string', description: '申请单位' },
        purpose: { type: 'string', description: '用途说明' },
        resourceType: { type: 'string', description: '所需种质类型（必填），如 试管苗' },
        durationDays: { type: 'integer', description: '使用期限（天）' },
        accessions: {
          type: 'array',
          items: { type: 'string' },
          description: '种质编号（primaryId）数组，如 ["CIP-001","CIP-002"]',
        },
      },
      required: ['applicant', 'resourceType', 'accessions'],
    },
  },
  {
    name: 'get_my_requests',
    description: '查询本令牌提交的分发申请及审批进度（最新 20 条）。',
    inputSchema: { type: 'object', properties: {} },
  },
];

function callTool(request, name, args) {
  switch (name) {
    case 'search_germplasm': return toolSearchGermplasm(args);
    case 'get_accession': return toolGetAccession(args);
    case 'submit_distribution_request': return toolSubmitDistributionRequest(request, args);
    case 'get_my_requests': return toolGetMyRequests(request);
    default: return undefined;
  }
}

// ---- JSON-RPC 处理 ----
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleRpc(request, body) {
  const { id, method, params } = body || {};

  if (method === 'initialize') {
    const requested = String(params?.protocolVersion || '');
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_DEFAULT,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }
  if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) {
    return { status: 202, body: null };
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    const name = String(params?.name || '');
    const args = params?.arguments || {};
    if (!TOOLS.some(t => t.name === name)) {
      return rpcError(id, -32601, `未知工具: ${name}`);
    }
    // 审计：每次工具调用（参数截断存储）
    const auditArgs = JSON.stringify(args || {});
    try {
      run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        ['mcp', request.mcpToken?.name || '', 'MCP_CALL', `${name}:${auditArgs.slice(0, 500)}`, '', request.mcpToken?.name || '']);
    } catch { /* 审计失败不阻断 */ }
    try {
      const result = callTool(request, name, args);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
    } catch (e) {
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message || '工具执行失败' }], isError: true } };
    }
  }
  return rpcError(id, -32601, `未知方法: ${method}`);
}

export default async function mcpRoutes(fastify) {
  fastify.post('/mcp', async (request, reply) => {
    // 鉴权：Bearer token → sha256 → ai_token（enabled）
    const header = String(request.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return reply.status(401).send(rpcError(null, -32000, '缺少 Bearer 令牌（向管理员索取 API 令牌）'));
    const row = get('SELECT id, name, role, enabled FROM ai_token WHERE token_hash = ?', [sha256(token)]);
    if (!row || !row.enabled) return reply.status(401).send(rpcError(null, -32000, '令牌无效或已停用'));
    // 限流
    const rl = checkRateLimit(row.id);
    if (!rl.ok) {
      reply.header('Retry-After', String(rl.retryAfter || 60));
      return reply.status(429).send(rpcError(null, -32000, `请求过于频繁（限流 ${getSettingInt('mcp.rate_limit_per_min', 120)}/分钟），请 ${rl.retryAfter}s 后重试`));
    }
    request.mcpToken = { id: row.id, name: row.name, role: row.role };
    try {
      run('UPDATE ai_token SET last_used_at = datetime(\'now\') WHERE id = ?', [row.id]);
    } catch { /* 非关键 */ }

    // JSON-RPC 分发
    let body = request.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return reply.status(400).send(rpcError(null, -32700, 'JSON 解析失败')); }
    }
    if (!body || typeof body.method !== 'string') {
      return reply.status(400).send(rpcError(body?.id ?? null, -32600, '无效的 JSON-RPC 请求'));
    }
    const res = await handleRpc(request, body);
    if (res.status === 202) return reply.status(202).send();
    return reply.send(res);
  });

  // MCP streamable HTTP 允许服务器拒绝 GET（无服务器主动推送需求）
  fastify.get('/mcp', async (_request, reply) => {
    return reply.status(405).send({ error: 'Method Not Allowed. 使用 POST 发送 JSON-RPC 请求。' });
  });
}
