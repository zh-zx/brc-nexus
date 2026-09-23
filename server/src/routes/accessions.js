import { getDb, run, get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { canApprove, readOnlyGuard } from '../middleware/permissions.js';
import * as XLSX from 'xlsx';

// v2.8：批量修改表头解析——trait_def 的 code/name_zh/name_en 均识别为对应性状；
// 模板表头格式「code（中文名）」也能回读（剥离括号后缀匹配 code）。
const BASIC_KEYS = new Set(['primaryId', 'primary_id', 'displayName', 'display_name', 'name', 'species', 'speciesName', 'origin', 'status', 'notes', 'remark']);

// v2.15：bitable 自由键（allowCustomKeys）放行时仍禁止写入的服务端保留键
const RESERVED_CUSTOM_KEYS = new Set(['id', '_id', 'data_json', 'created_at', 'last_modified_at', 'last_modified_by', 'source_upload_id', 'primary_id', 'display_name']);

function buildHeaderResolver() {
  const traits = all('SELECT code, name_zh, name_en FROM trait_def');
  const byCode = new Map();
  const byZh = new Map();
  const byEn = new Map();
  for (const tr of traits) {
    byCode.set(tr.code, tr.code);
    if (tr.name_zh) byZh.set(String(tr.name_zh).trim(), tr.code);
    if (tr.name_en) byEn.set(String(tr.name_en).trim(), tr.code);
  }
  return function resolveHeader(h) {
    const hh = String(h).trim();
    if (!hh) return null;
    if (byCode.has(hh)) return hh;
    const clean = hh.replace(/[（(].*[）)]$/, '').trim(); // 剥离「code（中文名）」后缀
    if (byCode.has(clean)) return clean;
    if (byZh.has(hh)) return byZh.get(hh);
    if (byEn.has(hh)) return byEn.get(hh);
    if (BASIC_KEYS.has(hh)) return hh;
    if (BASIC_KEYS.has(clean)) return clean;
    return null;
  };
}

export default async function accessionRoutes(fastify) {
  fastify.get('/api/accessions/search', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { q, scope, exact, page, limit } = request.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;

    let where = '';
    let params = [];

    if (q && q.trim()) {
      const term = q.trim();
      if (scope && scope !== 'all') {
        // Whitelist scope to avoid SQL injection via interpolated key
        if (!/^[A-Za-z0-9_]+$/.test(scope)) {
          return reply.status(400).send({ error: '无效的检索范围 (scope)' });
        }
        if (exact === 'true') {
          where = `WHERE json_extract(data_json, '$."${scope}"') = ?`;
          params.push(term);
        } else {
          where = `WHERE json_extract(data_json, '$."${scope}"') LIKE ?`;
          params.push(`%${term}%`);
        }
      } else {
        if (exact === 'true') {
          where = `WHERE primary_id = ? OR display_name = ?`;
          params.push(term, term);
        } else {
          where = `WHERE primary_id LIKE ? OR display_name LIKE ? OR species LIKE ?`;
          params.push(`%${term}%`, `%${term}%`, `%${term}%`);
        }
      }
    }

    const total = get(`SELECT COUNT(*) as c FROM accession ${where}`, params);
    const rows = all(`SELECT * FROM accession ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);

    return {
      accessions: rows.map(r => ({
        ...JSON.parse(r.data_json),
        id: r.id,
        primaryId: r.primary_id,
        displayName: r.display_name,
        species: r.species,
        origin: r.origin,
        _id: r.id
      })),
      total: total ? total.c : 0,
      page: pageNum,
      pageSize
    };
  });

  fastify.get('/api/accessions/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const row = get('SELECT * FROM accession WHERE id = ?', [request.params.id]);
    if (!row) return reply.status(404).send({ error: '未找到' });
    return {
      ...JSON.parse(row.data_json),
      id: row.id,
      primaryId: row.primary_id,
      displayName: row.display_name,
      species: row.species,
      origin: row.origin,
      stockId: row.stock_id || null
    };
  });

  // ---- v2.11：基因组学预留块（链接+元数据模式，不存 VCF 本体） ----
  const OMICS_CATEGORIES = new Set(['marker', 'snp', 'indel', 'assembly', 'gbs', 'publication', 'link']);

  fastify.get('/api/accessions/:id/omics', { preHandler: [authMiddleware] }, async (request, reply) => {
    const acc = get('SELECT id FROM accession WHERE id = ?', [request.params.id]);
    if (!acc) return reply.status(404).send({ error: '未找到种质' });
    const entries = all('SELECT * FROM accession_omics WHERE accession_id = ? ORDER BY created_at DESC', [request.params.id]);
    return { entries };
  });

  fastify.post('/api/accessions/:id/omics', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user?.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const acc = get('SELECT id FROM accession WHERE id = ?', [request.params.id]);
    if (!acc) return reply.status(404).send({ error: '未找到种质' });
    const b = request.body || {};
    if (!OMICS_CATEGORIES.has(b.category)) return reply.status(400).send({ error: '无效的类别', allowed: [...OMICS_CATEGORIES] });
    if (!b.title || !String(b.title).trim()) return reply.status(400).send({ error: '标题必填' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO accession_omics (id, accession_id, category, title, ref, url, notes, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, request.params.id, b.category, String(b.title).trim(), b.ref ? String(b.ref) : null, b.url ? String(b.url) : null, b.notes ? String(b.notes) : null, request.user?.username || '']);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?, ?, ?, NULL, ?, ?, ?)',
      ['accession_omics', request.params.id, 'OMICS_ADD', JSON.stringify({ omicsId: id, category: b.category, title: b.title }), request.user?.id || '', request.user?.username || '']);
    return { success: true, id };
  });

  fastify.delete('/api/omics/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user?.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const old = get('SELECT * FROM accession_omics WHERE id = ?', [request.params.id]);
    if (!old) return reply.status(404).send({ error: '未找到记录' });
    run('DELETE FROM accession_omics WHERE id = ?', [request.params.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?, ?, ?, ?, NULL, ?, ?)',
      ['accession_omics', old.accession_id, 'OMICS_DEL', JSON.stringify(old), request.user?.id || '', request.user?.username || '']);
    return { success: true };
  });

  fastify.get('/api/accessions', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { page, limit } = request.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 100, 500);
    const offset = (pageNum - 1) * pageSize;

    const total = get('SELECT COUNT(*) as c FROM accession');
    const rows = all('SELECT * FROM accession ORDER BY created_at DESC LIMIT ? OFFSET ?', [pageSize, offset]);

    return {
      accessions: rows.map(r => ({
        ...JSON.parse(r.data_json),
        id: r.id,
        primaryId: r.primary_id,
        displayName: r.display_name,
        species: r.species,
        origin: r.origin,
        sourceUploadId: r.source_upload_id,
        lastModifiedBy: r.last_modified_by,
        lastModifiedAt: r.last_modified_at
      })),
      total: total ? total.c : 0,
      page: pageNum,
      pageSize
    };
  });

  fastify.get('/api/accessions/count', { preHandler: [authMiddleware] }, async (request, reply) => {
    const count = get('SELECT COUNT(*) as c FROM accession');
    return { count: count ? count.c : 0 };
  });

  fastify.post('/api/accessions', { preHandler: [authMiddleware] }, async (request, reply) => {
    const data = request.body;
    if (!data) return reply.status(400).send({ error: '请求体不能为空' });
    const primaryId = data.primaryId || data.primary_id || '';
    if (!primaryId) return reply.status(400).send({ error: '种质编号 (primaryId) 不能为空' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    const displayName = data.displayName || data.display_name || primaryId;
    const species = data.species || '';
    const origin = data.origin || '';
    run('INSERT INTO accession (id, data_json, primary_id, display_name, species, origin, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
      [id, JSON.stringify(data), primaryId, displayName, species, origin, request.user?.username || '']);
    const row = get('SELECT * FROM accession WHERE id = ?', [id]);
    return {
      ...JSON.parse(row.data_json),
      id: row.id,
      primaryId: row.primary_id,
      displayName: row.display_name,
      species: row.species,
      origin: row.origin,
      _id: row.id
    };
  });

  fastify.put('/api/accessions/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const oldRow = get('SELECT * FROM accession WHERE id = ?', [request.params.id]);
    if (!oldRow) return reply.status(404).send({ error: '未找到' });
    const data = request.body;
    if (!data) return reply.status(400).send({ error: '请求体不能为空' });
    const primaryId = data.primaryId || data.primary_id || oldRow.primary_id || '';
    const displayName = data.displayName || data.display_name || primaryId;
    const species = data.species || '';
    const origin = data.origin || '';
    run('UPDATE accession SET data_json = ?, primary_id = ?, display_name = ?, species = ?, origin = ?, last_modified_by = ?, last_modified_at = datetime(\'now\') WHERE id = ?',
      [JSON.stringify(data), primaryId, displayName, species, origin, request.user?.username || '', request.params.id]);
    // Audit log
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['accession', request.params.id, 'UPDATE', JSON.stringify(oldRow), JSON.stringify(data), request.user?.id || '', request.user?.username || '']);
    const row = get('SELECT * FROM accession WHERE id = ?', [request.params.id]);
    return {
      ...JSON.parse(row.data_json),
      id: row.id,
      primaryId: row.primary_id,
      displayName: row.display_name,
      species: row.species,
      origin: row.origin,
      _id: row.id
    };
  });

  fastify.get('/api/accessions/fields', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rows = all("SELECT data_json FROM accession LIMIT 1000");
    const fieldSet = new Set();
    const fieldCount = {};
    for (const row of rows) {
      try {
        const obj = JSON.parse(row.data_json);
        for (const key of Object.keys(obj)) {
          fieldSet.add(key);
          fieldCount[key] = (fieldCount[key] || 0) + 1;
        }
      } catch (e) { /* skip parse errors */ }
    }
    // Sort by frequency descending so most common fields appear first
    const fields = Array.from(fieldSet).sort((a, b) => (fieldCount[b] || 0) - (fieldCount[a] || 0));
    return { fields };
  });

  fastify.delete('/api/accessions/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM accession WHERE id = ?', [request.params.id]);
    return { success: true };
  });

  // ---- v2.6 批量修改（管理员 + 审批员） ----
  fastify.post('/api/accessions/batch-update', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!canApprove(request.user)) return reply.status(403).send({ error: '需要管理员或审批员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const mode = b.mode === 'merge' ? 'merge' : 'replace';
    // v2.15：多维表格自由键——显式置位时未知表头按自定义键写入 data_json（Excel 批量修改默认拦截不变）
    const allowCustomKeys = b.allowCustomKeys === true;
    if (!rows.length) return reply.status(400).send({ error: '没有要修改的数据' });
    const resolveHeader = buildHeaderResolver();
    const results = { updated: [], notFound: [], failed: [], unknownHeaders: [] };
    const seenUnknown = new Set();
    const acceptedCustom = new Set();
    for (const row of rows) {
      const primaryId = String(row.primaryId || '').trim();
      const rawUpdates = row.updates && typeof row.updates === 'object' ? row.updates : {};
      if (!primaryId) { results.failed.push({ primaryId, reason: '缺少种质编号' }); continue; }
      // v2.8：表头解析（trait code / 中文名 / 英文名 / 基础字段），未识别表头跳过并提示
      // v2.9：值 '' → 跳过（Excel 空单元格兼容）；值 null → 显式清空（删除 data_json 键）
      const updates = {};
      const cleared = [];
      for (const [k, v] of Object.entries(rawUpdates)) {
        if (v === '') continue;
        let canon = resolveHeader(k);
        if (!canon && allowCustomKeys && /^[A-Za-z0-9_]{1,64}$/.test(k) && !RESERVED_CUSTOM_KEYS.has(k)) {
          canon = k;
          acceptedCustom.add(k);
        }
        if (!canon) {
          if (!seenUnknown.has(k)) { seenUnknown.add(k); results.unknownHeaders.push(k); }
          continue;
        }
        if (v == null) {
          if (canon === 'primaryId' || canon === 'primary_id') {
            results.failed.push({ primaryId, reason: '种质编号不可清空' });
            continue;
          }
          cleared.push(canon);
          continue;
        }
        updates[canon] = v;
      }
      if (!Object.keys(updates).length && !cleared.length) { results.failed.push({ primaryId, reason: '没有可识别的字段列' }); continue; }
      const acc = get('SELECT * FROM accession WHERE primary_id = ?', [primaryId]);
      if (!acc) { results.notFound.push(primaryId); continue; }
      try {
        const data = JSON.parse(acc.data_json || '{}');
        if (mode === 'replace') {
          for (const [k, v] of Object.entries(updates)) data[k] = v;
        } else {
          for (const [k, v] of Object.entries(updates)) {
            if (data[k] === undefined || data[k] === null || data[k] === '') data[k] = v;
          }
        }
        // v2.9：显式清空（删除 data_json 键）
        for (const k of cleared) delete data[k];
        const displayName = data.displayName || data.display_name || data.name || primaryId;
        const species = data.species || data.speciesName || '';
        const origin = data.origin || '';
        run('UPDATE accession SET data_json = ?, primary_id = ?, display_name = ?, species = ?, origin = ?, last_modified_by = ?, last_modified_at = datetime(\'now\') WHERE id = ?',
          [JSON.stringify(data), primaryId, displayName, species, origin, request.user.username, acc.id]);
        run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
          ['accession', acc.id, 'BATCH_UPDATE', JSON.stringify({ primaryId, updates, ...(cleared.length ? { cleared } : {}) }), JSON.stringify({ primaryId }), request.user.id, request.user.username]);
        results.updated.push(primaryId);
      } catch (e) {
        results.failed.push({ primaryId, reason: e.message });
      }
    }
    return { success: true, ...results, ...(acceptedCustom.size ? { customKeys: [...acceptedCustom] } : {}) };
  });

  // 下载批量修改模板（基础字段 + trait_def 全部性状，表头「code（中文名）」可回读）
  fastify.get('/api/accessions/template', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!canApprove(request.user)) return reply.status(403).send({ error: '需要管理员或审批员权限' });
    const traits = all('SELECT code, name_zh, name_en FROM trait_def ORDER BY sort_order, code');
    const basic = ['primaryId', 'displayName', 'species', 'origin', 'status'];
    const headers = [
      ...basic,
      ...traits.map(tr => (tr.name_zh ? `${tr.code}（${tr.name_zh}）` : tr.code)),
    ];
    const sample = get('SELECT primary_id, display_name, species, origin FROM accession ORDER BY created_at LIMIT 1');
    const exampleRow = headers.map(h => {
      if (h === 'primaryId') return sample?.primary_id || '';
      if (h === 'displayName') return sample?.display_name || '';
      if (h === 'species') return sample?.species || '';
      if (h === 'origin') return sample?.origin || '';
      return '';
    });
    const aoa = [headers, exampleRow];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, '批量修改模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="accessions-batch-template.xlsx"');
    return reply.send(buf);
  });
}
