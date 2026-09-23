import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

function getCfg() {
  const cfg = get('SELECT * FROM freezer_config WHERE id = 1');
  if (!cfg) throw new Error('冷藏箱未配置');
  cfg.boxesPerFreezer = cfg.shelf_per_freezer * cfg.drawer_per_shelf * cfg.box_per_drawer;
  cfg.ranges = cfg.box_ranges_json ? JSON.parse(cfg.box_ranges_json) : [];
  return cfg;
}

function deriveBoxLocation(cfg, boxNo) {
  const bpf = cfg.boxesPerFreezer;
  const freezer = Math.floor((boxNo - 1) / bpf) + 1;
  const local = (boxNo - 1) % bpf;
  const perShelf = cfg.drawer_per_shelf * cfg.box_per_drawer;
  const shelf = Math.floor(local / perShelf) + 1;
  const inShelf = local % perShelf;
  const drawer = Math.floor(inShelf / cfg.box_per_drawer) + 1;
  return { freezer_no: freezer, shelf_no: shelf, drawer_no: drawer };
}

function posLabel(p, cfg) {
  const row = Math.ceil(p / cfg.col_count);
  const col = ((p - 1) % cfg.col_count) + 1;
  return String.fromCharCode(64 + row) + col;
}

function locCode(cfg, freezer, shelf, drawer, boxNo, pos) {
  return `C${freezer}-${shelf}-${drawer}-${boxNo}-${posLabel(pos, cfg)}`;
}

async function ensureBox(cfg, boxNo) {
  const bn = parseInt(boxNo);
  if (Number.isNaN(bn) || bn < 1) return null;
  let box = get('SELECT * FROM freezer_box WHERE box_no = ?', [bn]);
  if (!box) {
    const loc = deriveBoxLocation(cfg, bn);
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO freezer_box (id, box_no, freezer_no, shelf_no, drawer_no, qr) VALUES (?,?,?,?,?,?)',
      [id, bn, loc.freezer_no, loc.shelf_no, loc.drawer_no, String(bn)]);
    box = get('SELECT * FROM freezer_box WHERE box_no = ?', [bn]);
  }
  return box;
}

async function buildGrid(cfg, box) {
  const total = cfg.row_count * cfg.col_count;
  const samples = all('SELECT * FROM freezer_sample WHERE box_id = ?', [box.id]);
  const sampleMap = {};
  for (const s of samples) sampleMap[s.position_no] = s;
  const grid = [];
  for (let p = 1; p <= total; p++) {
    grid.push({ position: p, label: posLabel(p, cfg), sample: sampleMap[p] ? { ...sampleMap[p] } : null });
  }
  return grid;
}

function audit(table, recordId, action, before, after, req) {
  run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
    [table, recordId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, req.user?.id || '', req.user?.username || '']);
}

export default async function freezerRoutes(fastify) {
  // ---- 容量配置（可自定义） ----
  fastify.get('/api/freezer/config', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const used = get('SELECT COUNT(*) as c FROM freezer_box');
    const samples = get('SELECT COUNT(*) as c FROM freezer_sample');
    return {
      config: {
        freezerCount: cfg.freezer_count,
        shelfPerFreezer: cfg.shelf_per_freezer,
        drawerPerShelf: cfg.drawer_per_shelf,
        boxPerDrawer: cfg.box_per_drawer,
        rowCount: cfg.row_count,
        colCount: cfg.col_count,
        boxesPerFreezer: cfg.boxesPerFreezer,
        ranges: cfg.ranges,
      },
      usedBoxes: used ? used.c : 0,
      totalSamples: samples ? samples.c : 0,
    };
  });

  fastify.put('/api/freezer/config', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { freezerCount, shelfPerFreezer, drawerPerShelf, boxPerDrawer, rowCount, colCount } = request.body || {};
    const fc = Math.min(Math.max(parseInt(freezerCount) || 3, 1), 99);
    const sf = Math.min(Math.max(parseInt(shelfPerFreezer) || 4, 1), 99);
    const ds = Math.min(Math.max(parseInt(drawerPerShelf) || 35, 1), 999);
    const bd = Math.min(Math.max(parseInt(boxPerDrawer) || 5, 1), 99);
    const rc = Math.min(Math.max(parseInt(rowCount) || 9, 1), 50);
    const cc = Math.min(Math.max(parseInt(colCount) || 9, 1), 50);
    const bpf = sf * ds * bd;
    const ranges = [];
    for (let f = 1; f <= fc; f++) ranges.push([(f - 1) * bpf + 1, f * bpf]);
    run('UPDATE freezer_config SET freezer_count=?, shelf_per_freezer=?, drawer_per_shelf=?, box_per_drawer=?, row_count=?, col_count=?, box_ranges_json=? WHERE id=1',
      [fc, sf, ds, bd, rc, cc, JSON.stringify(ranges)]);
    return { success: true, boxesPerFreezer: bpf, ranges };
  });

  // ---- 位置网格 ----
  fastify.get('/api/freezer/box/:boxNo', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const box = await ensureBox(cfg, request.params.boxNo);
    if (!box) return reply.status(400).send({ error: '无效的盒子编号' });
    const grid = await buildGrid(cfg, box);
    return { box: { boxNo: box.box_no, freezerNo: box.freezer_no, shelfNo: box.shelf_no, drawerNo: box.drawer_no, qr: box.qr }, grid };
  });

  // 抽屉内盒子列表（下钻）
  fastify.get('/api/freezer/boxes', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const { freezer, shelf, drawer } = request.query;
    const f = parseInt(freezer) || 1;
    const s = parseInt(shelf) || 1;
    const d = parseInt(drawer) || 1;
    const globalDrawer = (s - 1) * cfg.drawer_per_shelf + d;
    const baseLocal = (globalDrawer - 1) * cfg.box_per_drawer + 1;
    const result = [];
    for (let k = 0; k < cfg.box_per_drawer; k++) {
      const boxNo = (f - 1) * cfg.boxesPerFreezer + baseLocal + k;
      const box = await ensureBox(cfg, boxNo);
      const occ = get('SELECT COUNT(*) as c FROM freezer_sample WHERE box_id = ?', [box.id]);
      result.push({ boxNo: box.box_no, qr: String(box.box_no), occupied: occ ? occ.c : 0, positions: cfg.row_count * cfg.col_count });
    }
    return { boxes: result, config: { rowCount: cfg.row_count, colCount: cfg.col_count } };
  });

  // 扫码定位（qr = 盒子编号字符串）
  fastify.get('/api/freezer/scan', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const qr = String(request.query.qr || '').trim();
    const m = qr.match(/(\d+)/);
    if (!m) return reply.status(400).send({ error: '无法识别二维码内容' });
    const box = await ensureBox(cfg, parseInt(m[1]));
    if (!box) return reply.status(400).send({ error: '无效的盒子编号' });
    const grid = await buildGrid(cfg, box);
    return { box: { boxNo: box.box_no, freezerNo: box.freezer_no, shelfNo: box.shelf_no, drawerNo: box.drawer_no, qr: box.qr }, grid };
  });

  // ---- 操作 ----
  // 入库：指定位置或自动首个空位
  fastify.post('/api/freezer/checkin', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const { boxNo, position, sampleCode, accessionId, quantity, operator } = request.body || {};
    if (!boxNo) return reply.status(400).send({ error: '盒子编号必填' });
    if (!sampleCode) return reply.status(400).send({ error: '样品编号必填' });
    const box = await ensureBox(cfg, boxNo);
    if (!box) return reply.status(400).send({ error: '无效的盒子编号' });
    const total = cfg.row_count * cfg.col_count;
    let pos = position != null && position !== '' ? parseInt(position) : null;
    if (pos != null && (pos < 1 || pos > total)) return reply.status(400).send({ error: '位置无效' });
    if (pos == null) {
      const occupied = new Set(all('SELECT position_no FROM freezer_sample WHERE box_id = ?', [box.id]).map(r => r.position_no));
      for (let p = 1; p <= total; p++) { if (!occupied.has(p)) { pos = p; break; } }
      if (pos == null) return reply.status(400).send({ error: '该盒子已满，请选择其他盒子' });
    } else {
      const dup = get('SELECT id FROM freezer_sample WHERE box_id = ? AND position_no = ?', [box.id, pos]);
      if (dup) return reply.status(400).send({ error: `位置 ${posLabel(pos, cfg)} 已被占用` });
    }
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO freezer_sample (id, box_id, position_no, accession_id, sample_code, quantity) VALUES (?,?,?,?,?,?)',
      [id, box.id, pos, accessionId || null, sampleCode, quantity != null ? Number(quantity) : 1]);
    const toLoc = locCode(cfg, box.freezer_no, box.shelf_no, box.drawer_no, box.box_no, pos);
    run('INSERT INTO freezer_movement (id, box_id, sample_id, action, from_loc, to_loc, operator, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), box.id, id, 'IN', null, toLoc, operator || request.user?.username || '', request.user?.id || '']);
    audit('freezer_sample', id, 'CHECKIN', null, { boxNo: box.box_no, position: pos, sampleCode, accessionId, quantity }, request);
    return { success: true, id, location: toLoc };
  });

  // 移位
  fastify.post('/api/freezer/move', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const { sampleId, targetBoxNo, targetPosition, reason, operator } = request.body || {};
    if (!sampleId || !targetBoxNo || targetPosition == null) return reply.status(400).send({ error: '样品、目标盒子与位置必填' });
    const sample = get('SELECT * FROM freezer_sample WHERE id = ?', [sampleId]);
    if (!sample) return reply.status(404).send({ error: '未找到样品' });
    const oldBox = get('SELECT * FROM freezer_box WHERE id = ?', [sample.box_id]);
    const targetBox = await ensureBox(cfg, targetBoxNo);
    if (!targetBox) return reply.status(400).send({ error: '无效的目标盒子编号' });
    const tp = parseInt(targetPosition);
    const total = cfg.row_count * cfg.col_count;
    if (tp < 1 || tp > total) return reply.status(400).send({ error: '目标位置无效' });
    const dup = get('SELECT id FROM freezer_sample WHERE box_id = ? AND position_no = ? AND id != ?', [targetBox.id, tp, sampleId]);
    if (dup) return reply.status(400).send({ error: '目标位置已被占用' });
    const fromLoc = oldBox ? locCode(cfg, oldBox.freezer_no, oldBox.shelf_no, oldBox.drawer_no, oldBox.box_no, sample.position_no) : '';
    const toLoc = locCode(cfg, targetBox.freezer_no, targetBox.shelf_no, targetBox.drawer_no, targetBox.box_no, tp);
    run('UPDATE freezer_sample SET box_id = ?, position_no = ?, updated_at = datetime(\'now\') WHERE id = ?', [targetBox.id, tp, sampleId]);
    const { v4: uuidv4 } = await import('uuid');
    run('INSERT INTO freezer_movement (id, box_id, sample_id, action, from_loc, to_loc, operator, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), targetBox.id, sampleId, 'MOVE', fromLoc, toLoc, operator || request.user?.username || '', request.user?.id || '']);
    audit('freezer_sample', sampleId, 'MOVE', { from: fromLoc, reason: reason || '' }, { to: toLoc }, request);
    return { success: true, from: fromLoc, to: toLoc };
  });

  // 出库
  fastify.post('/api/freezer/checkout', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const { sampleId, quantity, destination, operator } = request.body || {};
    if (!sampleId) return reply.status(400).send({ error: '样品必填' });
    const sample = get('SELECT * FROM freezer_sample WHERE id = ?', [sampleId]);
    if (!sample) return reply.status(404).send({ error: '未找到样品' });
    const box = get('SELECT * FROM freezer_box WHERE id = ?', [sample.box_id]);
    const fromLoc = box ? locCode(cfg, box.freezer_no, box.shelf_no, box.drawer_no, box.box_no, sample.position_no) : '';
    run('DELETE FROM freezer_sample WHERE id = ?', [sampleId]);
    const { v4: uuidv4 } = await import('uuid');
    run('INSERT INTO freezer_movement (id, box_id, sample_id, action, from_loc, to_loc, operator, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), box?.id || null, sampleId, 'OUT', fromLoc, null, operator || request.user?.username || '', request.user?.id || '']);
    audit('freezer_sample', sampleId, 'CHECKOUT', { quantity, destination: destination || '' }, null, request);
    return { success: true, from: fromLoc };
  });

  // 盘点
  fastify.post('/api/freezer/count', { preHandler: [authMiddleware] }, async (request, reply) => {
    const cfg = getCfg();
    const { boxNo, results, operator } = request.body || {};
    if (!boxNo) return reply.status(400).send({ error: '盒子编号必填' });
    const box = await ensureBox(cfg, boxNo);
    if (!box) return reply.status(400).send({ error: '无效的盒子编号' });
    const total = cfg.row_count * cfg.col_count;
    const actualMap = {};
    for (const s of all('SELECT * FROM freezer_sample WHERE box_id = ?', [box.id])) actualMap[s.position_no] = s.sample_code;
    const expectedMap = {};
    for (const r of results || []) if (r.position != null) expectedMap[parseInt(r.position)] = r.expected || '';
    const differences = [];
    for (let p = 1; p <= total; p++) {
      const a = actualMap[p] || '';
      const e = expectedMap[p] || '';
      if (a !== e) differences.push({ position: p, label: posLabel(p, cfg), expected: e, actual: a });
    }
    const note = differences.length === 0 ? '盘点正常' : `盘点点差 ${differences.length} 处`;
    const { v4: uuidv4 } = await import('uuid');
    run('INSERT INTO freezer_movement (id, box_id, sample_id, action, from_loc, to_loc, operator, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), box.id, null, 'CHECK', `C${box.freezer_no}-${box.shelf_no}-${box.drawer_no}-${box.box_no}`, null, operator || request.user?.username || '', request.user?.id || '']);
    audit('freezer_box', String(box.box_no), 'COUNT', null, { differences: differences.length, note }, request);
    return { success: true, normal: differences.length === 0, differences, note };
  });

  // ---- 留痕查询 ----
  fastify.get('/api/freezer/movements', { preHandler: [authMiddleware] }, async (request, reply) => {
    const pageNum = parseInt(request.query.page) || 1;
    const pageSize = Math.min(parseInt(request.query.limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    const conds = [];
    const params = [];
    if (request.query.action) { conds.push('action = ?'); params.push(request.query.action); }
    if (request.query.boxNo) { conds.push('box_id IN (SELECT id FROM freezer_box WHERE box_no = ?)'); params.push(parseInt(request.query.boxNo)); }
    if (request.query.sampleId) { conds.push('sample_id = ?'); params.push(request.query.sampleId); }
    if (request.user.role !== 'admin') { conds.push('operator = ?'); params.push(request.user.username); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM freezer_movement ${where}`, params);
    const rows = all(`SELECT * FROM freezer_movement ${where} ORDER BY event_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { movements: rows, total: total ? total.c : 0, page: pageNum };
  });
}
