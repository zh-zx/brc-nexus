import { get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

export function validateTraitCode(code) {
  if (!code || !/^[A-Za-z0-9_]+$/.test(code)) return null;
  return get('SELECT * FROM trait_def WHERE code = ?', [code]);
}

// Build a single WHERE clause fragment for one trait condition.
// Values are always bound params; the trait code is validated against trait_def
// so the interpolated json_extract key is safe.
export function buildConditionClause(trait, cond, params) {
  const expr = `json_extract(data_json, '$."${trait.code}"')`;
  const op = cond?.op || 'eq';

  if (op === 'empty') return `(${expr} IS NULL OR ${expr} = '')`;
  if (op === 'notempty') return `(${expr} IS NOT NULL AND ${expr} != '')`;

  const value = String(cond?.value ?? '').trim();
  if (value === '') return null;

  if (trait.value_type === 'number') {
    const ops = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!=' };
    if (!ops[op]) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    params.push(num);
    return `CAST(${expr} AS REAL) ${ops[op]} ?`;
  }

  if (op === 'eq') { params.push(value); return `${expr} = ?`; }
  if (op === 'neq') { params.push(value); return `(${expr} != ? OR ${expr} IS NULL)`; }
  // text: contains by default; scale uses eq only (client offers scale keys)
  params.push(`%${value}%`);
  return `${expr} LIKE ?`;
}

export function mapRow(r) {
  return {
    ...JSON.parse(r.data_json),
    id: r.id,
    primaryId: r.primary_id,
    displayName: r.display_name,
    species: r.species,
    origin: r.origin,
    _id: r.id,
    // v2.10：库存可用性（向导/结果矩阵展示）
    stockTotal: Number(r.stock_total || 0),
    stockForms: r.stock_forms ? String(r.stock_forms).split(',') : [],
  };
}

// ---- v2.15：多维表格（Bitable）查询辅助 ----
// 基础字段 → 真实列（与列表接口别名一致，恒随行输出）
const BASE_FIELD_COLUMNS = {
  primaryId: 'a.primary_id', primary_id: 'a.primary_id',
  displayName: 'a.display_name', display_name: 'a.display_name',
  species: 'a.species', origin: 'a.origin', id: 'a.id',
};

// 不可作为 data_json 键解析的服务端管理列/内部列
const RESERVED_JSON_KEYS = new Set([
  'id', '_id', 'data_json', 'created_at', 'primary_id', 'display_name',
  'source_upload_id', 'last_modified_at', 'last_modified_by',
  'lastSubcultureDate', 'sourceUploadId', 'lastModifiedBy', 'lastModifiedAt',
]);

export const STOCK_TOTAL_EXPR = '(SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i WHERE i.accession_id = a.id)';
export const STOCK_FORMS_EXPR = "(SELECT COALESCE(GROUP_CONCAT(i.form || ':' || CAST(i.quantity AS INTEGER)), '') FROM inventory i WHERE i.accession_id = a.id AND i.quantity > 0)";

// 解析 bitable 字段名 → { expr, type, trait?, stock? }；非法/保留键返回 null。
// 字段名先经 /^[A-Za-z0-9_]+$/ 白名单才允许进 json_extract 插值（同既有 scope 校验思路）。
export function resolveBitableField(field, fieldTypes = {}) {
  const f = String(field || '').trim();
  if (!f || f.length > 64 || !/^[A-Za-z0-9_]+$/.test(f)) return null;
  if (BASE_FIELD_COLUMNS[f]) return { expr: BASE_FIELD_COLUMNS[f], type: 'text' };
  if (f === 'stockTotal') return { expr: STOCK_TOTAL_EXPR, type: 'number', stock: true };
  if (f === 'stockForms') return { expr: STOCK_FORMS_EXPR, type: 'text', stock: true };
  if (RESERVED_JSON_KEYS.has(f)) return null;
  const trait = get('SELECT * FROM trait_def WHERE code = ?', [f]);
  if (trait) return { expr: `json_extract(a.data_json, '$."${trait.code}"')`, type: trait.value_type, trait };
  // 未注册键：默认文本；客户端可随查询传 fieldTypes 提示（如自定义数值键）
  const hint = fieldTypes && fieldTypes[f] === 'number' ? 'number' : 'text';
  return { expr: `json_extract(a.data_json, '$."${f}"')`, type: hint };
}

// bitable 筛选单条件：{field,op,value} 或 {op:'anyempty'|'notanyempty',fields:[…≤12]}
export function buildBitableFilterClause(cond, fieldTypes, params) {
  const op = cond?.op || 'eq';
  if (op === 'anyempty' || op === 'notanyempty') {
    const list = Array.isArray(cond.fields) ? cond.fields.slice(0, 12) : [];
    const exprs = [];
    for (const f of list) {
      const fr = resolveBitableField(f, fieldTypes);
      if (fr) exprs.push(fr.expr);
    }
    if (!exprs.length) return null;
    if (op === 'anyempty') return `(${exprs.map(e => `(${e} IS NULL OR ${e} = '')`).join(' OR ')})`;
    return `(${exprs.map(e => `(${e} IS NOT NULL AND ${e} != '')`).join(' AND ')})`;
  }
  const fr = resolveBitableField(cond?.field, fieldTypes);
  if (!fr) return null;
  const expr = fr.expr;
  if (op === 'empty') return `(${expr} IS NULL OR ${expr} = '')`;
  if (op === 'notempty') return `(${expr} IS NOT NULL AND ${expr} != '')`;
  const value = String(cond?.value ?? '').trim();
  if (value === '') return null;
  if (op === 'in') {
    // v2.15：id 集合查询（导出所选等场景），值=逗号分隔，上限 500 项
    const parts = value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 500);
    if (!parts.length) return null;
    for (const p of parts) params.push(p);
    return `${expr} IN (${parts.map(() => '?').join(',')})`;
  }
  if (fr.type === 'number') {
    const cmp = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!=' };
    if (!cmp[op]) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    params.push(num);
    return `CAST(${expr} AS REAL) ${cmp[op]} ?`;
  }
  if (op === 'eq') { params.push(value); return `${expr} = ?`; }
  if (op === 'neq') { params.push(value); return `(${expr} != ? OR ${expr} IS NULL)`; }
  if (op === 'contains') { params.push(`%${value}%`); return `${expr} LIKE ?`; }
  if (op === 'notcontains') { params.push(`%${value}%`); return `(${expr} NOT LIKE ? OR ${expr} IS NULL)`; }
  return null;
}

export default async function queryRoutes(fastify) {
  // Multi-trait AND query across accessions
  fastify.post('/api/accessions/query', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { conditions, page, limit } = request.body || {};
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;

    // v2.10：允许空 conditions（向导"仅展示所选性状"模式）；Accessions UI 仍保证 ≥1 条件
    if (!Array.isArray(conditions)) {
      return reply.status(400).send({ error: '至少需要一个性状条件' });
    }

    const wheres = [];
    const params = [];
    for (const cond of conditions) {
      const trait = cond?.traitCode ? validateTraitCode(cond.traitCode) : null;
      if (!trait) {
        return reply.status(400).send({ error: `未知性状代码: ${cond?.traitCode}` });
      }
      const clause = buildConditionClause(trait, cond, params);
      if (!clause) {
        return reply.status(400).send({ error: `无效的查询条件: ${trait.code} / ${cond?.op}` });
      }
      wheres.push(clause);
    }

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    // v2.10：附带库存可用性（stock_total 汇总 + stock_forms "形态:数量" 列表）
    const total = get(`SELECT COUNT(*) as c FROM accession a ${where}`, params);
    const rows = all(
      `SELECT a.*,
        (SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i WHERE i.accession_id = a.id) AS stock_total,
        (SELECT COALESCE(GROUP_CONCAT(i.form || ':' || CAST(i.quantity AS INTEGER)), '') FROM inventory i WHERE i.accession_id = a.id AND i.quantity > 0) AS stock_forms
       FROM accession a ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return {
      accessions: rows.map(mapRow),
      total: total ? total.c : 0,
      page: pageNum,
      pageSize
    };
  });

  // v2.15：多维表格查询 —— 筛选(AND ≤20)/排序(≤3 级)/分组/列选择/关键字/分页。
  // 只输出基础 4 列 + 请求列（万行×千性状规模下 payload 可控）；写路径仍走 batch-update。
  fastify.post('/api/accessions/bitable-query', { preHandler: [authMiddleware] }, async (request, reply) => {
    const b = request.body || {};
    const pageNum = Math.max(1, parseInt(b.page) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(b.limit) || 100), 500);

    const filters = Array.isArray(b.filters) ? b.filters : [];
    const sort = Array.isArray(b.sort) ? b.sort : [];
    const columns = Array.isArray(b.columns) ? b.columns : [];
    const fieldTypes = (b.fieldTypes && typeof b.fieldTypes === 'object') ? b.fieldTypes : {};
    if (filters.length > 20) return reply.status(400).send({ error: '筛选条件过多（上限 20）' });
    if (sort.length > 3) return reply.status(400).send({ error: '排序层级过多（上限 3）' });
    if (columns.length > 60) return reply.status(400).send({ error: '请求列过多（上限 60）' });

    const wheres = [];
    const params = [];
    const kw = String(b.keyword || '').trim();
    if (kw) {
      wheres.push('(a.primary_id LIKE ? OR a.display_name LIKE ? OR a.species LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    for (let i = 0; i < filters.length; i++) {
      const clause = buildBitableFilterClause(filters[i], fieldTypes, params);
      if (!clause) return reply.status(400).send({ error: `无效的筛选条件 #${i + 1}` });
      wheres.push(clause);
    }
    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    // 排序：每级先按「空值排最后」，再按值（数字 CAST / 文本 NOCASE）；created_at+id 稳定 tiebreak
    const orderParts = [];
    for (let i = 0; i < sort.length; i++) {
      const fr = resolveBitableField(sort[i]?.field, fieldTypes);
      if (!fr) return reply.status(400).send({ error: `无效的排序字段 #${i + 1}` });
      const dir = sort[i]?.dir === 'desc' ? 'DESC' : 'ASC';
      orderParts.push(`(${fr.expr} IS NULL OR ${fr.expr} = '') ASC`);
      orderParts.push(fr.type === 'number' ? `CAST(${fr.expr} AS REAL) ${dir}` : `${fr.expr} COLLATE NOCASE ${dir}`);
    }
    orderParts.push('a.created_at DESC', 'a.id DESC');
    const orderBy = `ORDER BY ${orderParts.join(', ')}`;

    // 列选择：正则白名单 + trait/伪字段解析；基础字段恒定输出，不重复
    const colSet = new Set();
    const fieldMeta = [];
    for (const c of columns) {
      const name = String(c || '').trim();
      if (!name || name.length > 64 || colSet.has(name) || BASE_FIELD_COLUMNS[name]) continue;
      const fr = resolveBitableField(name, fieldTypes);
      if (!fr) continue;
      colSet.add(name);
      let scale = null;
      if (fr.trait?.scale_json) { try { scale = JSON.parse(fr.trait.scale_json); } catch (e) { scale = null; } }
      fieldMeta.push({ field: name, type: fr.type, ...(scale ? { scale } : {}), ...(fr.stock ? { group: 'stock', readonly: true } : {}) });
    }
    const cols = [...colSet];
    const selectExtra = cols.map(c => `${resolveBitableField(c, fieldTypes).expr} AS "${c}"`).join(', ');

    const total = get(`SELECT COUNT(*) AS c FROM accession a ${where}`, params);

    // 分组（可选）：值 + 组内计数；空值组恒排最后；上限 500 组
    let groups;
    if (b.groupBy) {
      const gFr = resolveBitableField(b.groupBy, fieldTypes);
      if (!gFr) return reply.status(400).send({ error: '无效的分组字段' });
      const gRows = all(
        `SELECT ${gFr.expr} AS v, COUNT(*) AS c FROM accession a ${where} GROUP BY v ORDER BY (v IS NULL OR v = '') ASC, ${gFr.type === 'number' ? 'CAST(v AS REAL)' : 'v COLLATE NOCASE'} ASC LIMIT 501`,
        params,
      );
      groups = {
        field: String(b.groupBy),
        truncated: gRows.length > 500,
        items: gRows.slice(0, 500).map(r => ({ value: r.v === null ? null : String(r.v), count: r.c })),
      };
    }

    const offset = (pageNum - 1) * pageSize;
    const rows = all(
      `SELECT a.id, a.primary_id, a.display_name, a.species, a.origin${selectExtra ? `, ${selectExtra}` : ''} FROM accession a ${where} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return {
      rows: rows.map(r => {
        const out = { id: r.id, primaryId: r.primary_id, displayName: r.display_name, species: r.species, origin: r.origin };
        for (const c of cols) out[c] = r[c];
        return out;
      }),
      total: total ? total.c : 0,
      page: pageNum,
      pageSize,
      fieldMeta,
      ...(groups ? { groups } : {}),
    };
  });

  // Distinct values for a trait across accessions (for query dropdowns)
  fastify.get('/api/accessions/trait-values', { preHandler: [authMiddleware] }, async (request, reply) => {
    const code = request.query.code || '';
    if (!/^[A-Za-z0-9_]+$/.test(code)) return reply.status(400).send({ error: '无效的性状代码' });
    const trait = get('SELECT * FROM trait_def WHERE code = ?', [code]);
    if (!trait) return reply.status(400).send({ error: '未知性状' });

    const expr = `json_extract(data_json, '$."${code}"')`;
    const rows = all(
      `SELECT ${expr} AS v, COUNT(*) AS c FROM accession WHERE ${expr} IS NOT NULL AND ${expr} != '' GROUP BY v`
    );
    let scale = null;
    if (trait.value_type === 'scale' && trait.scale_json) {
      try { scale = JSON.parse(trait.scale_json); } catch (e) { scale = null; }
    }
    const values = rows.map(r => {
      const value = String(r.v);
      let label = value;
      if (scale && scale[value]) label = `${value} · ${scale[value]}`;
      return { value, label, count: r.c };
    });
    return { code, valueType: trait.value_type, scale, values };
  });
}
