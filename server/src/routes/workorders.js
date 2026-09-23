import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { readOnlyGuard } from '../middleware/permissions.js';
import { getSettingInt } from '../db/settings.js';
import { pushMessage } from '../lib/messages.js';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isOverdue(r) {
  return !!(r.due_date && ['pending', 'in_progress'].includes(r.status) && String(r.due_date) < todayLocal());
}

function mapOrder(r) {
  return {
    id: r.id,
    woNo: r.wo_no,
    title: r.title,
    description: r.description,
    purpose: r.purpose,
    accessions: JSON.parse(r.accessions_json || '[]'),
    targetQty: r.target_qty,
    doneQty: r.done_qty,
    progress: r.progress,
    progressMode: r.progress_mode || '',
    priority: r.priority,
    dueDate: r.due_date,
    status: r.status,
    createdBy: r.created_by,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    overdue: isOverdue(r),
  };
}

function getAssignees(orderId) {
  return all(
    `SELECT a.user_id, u.username, u.display_name
     FROM work_order_assignee a LEFT JOIN user u ON u.id = a.user_id
     WHERE a.work_order_id = ?`, [orderId],
  ).map(x => ({ userId: x.user_id, username: x.username, displayName: x.display_name || x.username }));
}

// ---- 步骤链（purpose 模板）+ 当前步骤推导（v2.6） ----
function getStepSchedule(order) {
  if (!order.purpose) return { steps: [], currentStep: null, doneSteps: new Set(), doneCount: 0 };
  const steps = all('SELECT * FROM operation_step_def WHERE module = ? AND purpose = ? ORDER BY step_no ASC', ['tissue_culture', order.purpose]);
  const doneSteps = new Set();
  for (const r of all("SELECT DISTINCT step_code FROM operation_record WHERE work_order_id = ? AND step_code IS NOT NULL AND step_code != ''", [order.id])) doneSteps.add(r.step_code);
  for (const r of all("SELECT DISTINCT step_code FROM work_order_feedback WHERE work_order_id = ? AND step_code IS NOT NULL AND step_code != ''", [order.id])) doneSteps.add(r.step_code);
  const current = steps.find(s => !doneSteps.has(s.code)) || null;
  return { steps, currentStep: current, doneSteps, doneCount: doneSteps.size };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 某步骤的计划完成日 = 工单开始日 + 到该步累计 due_days
function stepDueDate(order, steps, idx) {
  let days = 0;
  for (let i = 0; i <= idx; i++) days += Number(steps[i].due_days || 0);
  const start = order.started_at ? String(order.started_at).slice(0, 10) : todayLocal();
  return addDays(start, days);
}

// 可见性：admin/regulator 全量；assignee 仅本人；其余（external/approver）无工单
function canView(user) {
  return user.role === 'admin' || user.user_type === 'regulator';
}
function isAssignee(user, orderId) {
  return !!get('SELECT id FROM work_order_assignee WHERE work_order_id = ? AND user_id = ?', [orderId, user.id]);
}

function checkOverdueDays() {
  return getSettingInt('work.overdue_reminder_days', 1);
}

// 生成工单号 WO-YYYYMMDD-XXX（取当日最大序号+1，避免 COUNT 法在删除/断号后撞号；UNIQUE 兜底重试）
function genWoNo() {
  const prefix = `WO-${todayLocal().replace(/-/g, '')}-`;
  const row = get('SELECT MAX(CAST(SUBSTR(wo_no, LENGTH(?) + 1) AS INTEGER)) as m FROM work_order WHERE wo_no LIKE ?', [prefix, `${prefix}%`]);
  const seq = (row?.m || 0) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// 校验转态合法性（返回 false 表示不允许）
function canTransition(order, to, user) {
  const from = order.status;
  if (user.role === 'admin') return true;
  if (to === 'in_progress') return from === 'pending' || from === 'blocked';
  if (to === 'done') return from === 'in_progress' || from === 'blocked';
  if (to === 'blocked') return from === 'pending' || from === 'in_progress';
  return false; // cancelled 仅 admin
}

function applyStatus(order, to, user) {
  const before = order.status;
  run('UPDATE work_order SET status = ?, updated_at = ?' +
    (to === 'in_progress' && !order.started_at ? ', started_at = ?' : '') +
    (to === 'done' ? ', finished_at = ?' : '') +
    ' WHERE id = ?',
    to === 'in_progress' && !order.started_at
      ? [to, new Date().toISOString(), new Date().toISOString(), order.id]
      : to === 'done'
        ? [to, new Date().toISOString(), new Date().toISOString(), order.id]
        : [to, new Date().toISOString(), order.id]);
  run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
    ['work_order', order.id, 'STATUS_CHANGE', JSON.stringify({ status: before }), JSON.stringify({ status: to }), user.id, user.username]);
  if (to === 'done') {
    pushMessage({ role: 'admin', type: 'wo_done', title: '工单已完成', title_en: 'Work Order Done',
      body: `工单 ${order.wo_no}「${order.title}」已完成`, body_en: `WO ${order.wo_no} "${order.title}" is done`,
      ref_table: 'work_order', ref_id: order.id });
  } else if (to === 'cancelled') {
    for (const a of getAssignees(order.id)) {
      pushMessage({ user_id: a.userId, type: 'wo_cancelled', title: '工单已取消', title_en: 'Work Order Cancelled',
        body: `工单 ${order.wo_no}「${order.title}」已取消`, body_en: `WO ${order.wo_no} "${order.title}" was cancelled`,
        ref_table: 'work_order', ref_id: order.id });
    }
  }
}

// 重新推导 done_qty / progress（报工、日报提交时调用）
// v2.8：auto 模式 = 报工 qty + 日报 qty 之和；manual 模式跳过自动计算（进度来自手动值）
function recomputeProgress(orderId, woNo, purpose) {
  const order = get('SELECT * FROM work_order WHERE id = ?', [orderId]);
  if (!order) return { doneQty: 0, progress: 0 };
  if (order.progress_mode === 'manual') {
    return { doneQty: order.done_qty || 0, progress: order.progress || 0 };
  }
  const feedbackQty = get(`SELECT COALESCE(SUM(qty),0) as s FROM work_order_feedback WHERE work_order_id = ? AND kind IN ('progress','done')`, [orderId]);
  const dailyQty = get('SELECT COALESCE(SUM(qty),0) as s FROM work_daily_report WHERE work_order_id = ?', [orderId]);
  const doneQty = (feedbackQty?.s || 0) + (dailyQty?.s || 0);
  let progress = 0;
  if (Number(order.target_qty) > 0) {
    progress = Math.min(100, Math.round((doneQty / Number(order.target_qty)) * 100));
  } else if (purpose) {
    const total = get('SELECT COUNT(*) as c FROM operation_step_def WHERE module = ? AND purpose = ?', ['tissue_culture', purpose])?.c || 0;
    const done = get('SELECT COUNT(DISTINCT step_code) as c FROM operation_record WHERE work_order_id = ?', [orderId])?.c || 0;
    progress = total > 0 ? Math.round((done / total) * 100) : 0;
  }
  run('UPDATE work_order SET done_qty = ?, progress = ?, updated_at = ? WHERE id = ?', [doneQty, progress, new Date().toISOString(), orderId]);
  return { doneQty, progress };
}

export default async function workOrderRoutes(fastify) {
  // ---- 工单列表 ----
  fastify.get('/api/workorders', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.user_type === 'external' && request.user.role !== 'admin') {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { status, priority, purpose, q, mine, page, limit } = request.query;
    const conds = [];
    const params = [];
    const visible = canView(request.user);
    if (!visible) {
      conds.push('id IN (SELECT work_order_id FROM work_order_assignee WHERE user_id = ?)');
      params.push(request.user.id);
    } else if (mine === '1' || mine === 'true') {
      conds.push('id IN (SELECT work_order_id FROM work_order_assignee WHERE user_id = ?)');
      params.push(request.user.id);
    }
    if (status) { conds.push('status = ?'); params.push(status); }
    if (priority) { conds.push('priority = ?'); params.push(priority); }
    if (purpose) { conds.push('purpose = ?'); params.push(purpose); }
    if (q) { conds.push('(title LIKE ? OR wo_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    const total = get(`SELECT COUNT(*) as c FROM work_order ${where}`, params);
    const rows = all(`SELECT * FROM work_order ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return {
      orders: rows.map(r => ({ ...mapOrder(r), assignees: getAssignees(r.id) })),
      total: total ? total.c : 0,
      page: pageNum,
    };
  });

  // ---- 新建工单（管理员派单） ----
  fastify.post('/api/workorders', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    if (!b.title || !String(b.title).trim()) return reply.status(400).send({ error: '工单标题必填' });
    const assigneeIds = Array.isArray(b.assigneeIds) ? [...new Set(b.assigneeIds.map(String))] : [];
    if (!assigneeIds.length) return reply.status(400).send({ error: '请至少指派一名操作员' });
    for (const uid of assigneeIds) {
      const u = get('SELECT id, user_type, status FROM user WHERE id = ?', [uid]);
      if (!u || u.user_type !== 'operator' || u.status !== 'active') {
        return reply.status(400).send({ error: '指派对象必须是启用状态的操作员' });
      }
    }
    const accessions = Array.isArray(b.accessions) ? b.accessions : [];
    const id = uuidv4();
    let woNo = genWoNo();
    let tries = 0;
    while (get('SELECT id FROM work_order WHERE wo_no = ?', [woNo]) && tries < 5) { woNo = genWoNo(); tries++; }
    run(`INSERT INTO work_order (id, wo_no, title, description, purpose, accessions_json, target_qty, priority, due_date, status, created_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
      [id, woNo, String(b.title).trim(), b.description || '', b.purpose || '', JSON.stringify(accessions),
       Number(b.targetQty) || 0, b.priority || 'normal', b.dueDate || '', request.user.username, new Date().toISOString()]);
    for (const uid of assigneeIds) {
      run('INSERT INTO work_order_assignee (id, work_order_id, user_id, assigned_by) VALUES (?,?,?,?)',
        [uuidv4(), id, uid, request.user.username]);
      const u = get('SELECT display_name FROM user WHERE id = ?', [uid]);
      pushMessage({ user_id: uid, type: 'wo_assigned', title: '新工单指派', title_en: 'New Work Order',
        body: `工单 ${woNo}「${b.title}」已指派给你${b.dueDate ? `，截止 ${b.dueDate}` : ''}`,
        body_en: `WO ${woNo} "${b.title}" assigned to you${b.dueDate ? `, due ${b.dueDate}` : ''}`,
        ref_table: 'work_order', ref_id: id });
    }
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['work_order', id, 'CREATE', null, JSON.stringify({ woNo, title: b.title, assigneeIds, accessions }), request.user.id, request.user.username]);
    return { success: true, id, woNo };
  });

  // ---- 解析附件里的种质编号（管理员；ids 直传 或 fileData=base64 的 xlsx/csv） ----
  fastify.post('/api/workorders/parse-accessions', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const b = request.body || {};
    let ids = [];
    if (Array.isArray(b.ids)) {
      ids = b.ids.map(String).map(s => s.trim()).filter(Boolean);
    } else if (b.fileData) {
      try {
        const buf = Buffer.from(String(b.fileData), 'base64');
        const wb = XLSX.read(buf, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const headers = rows.length ? Object.keys(rows[0]) : [];
        const col = headers.find(h => /(primaryid|cccap|编号|种质编号)/i.test(String(h)));
        ids = rows.map(r => String(col ? r[col] : (Object.values(r)[0] || ''))).map(s => s.trim()).filter(Boolean);
      } catch (e) {
        return reply.status(400).send({ error: '文件解析失败：' + e.message });
      }
    }
    if (!ids.length) return reply.status(400).send({ error: '未能从文件中识别到种质编号列' });
    ids = [...new Set(ids)];
    const out = [];
    for (const pid of ids) {
      const acc = get('SELECT * FROM accession WHERE primary_id = ?', [pid]);
      if (acc) out.push({ id: acc.id, primaryId: acc.primary_id, displayName: acc.display_name, species: acc.species });
      else out.push({ primaryId: pid, displayName: pid, species: '', notFound: true });
    }
    return { accessions: out, notFound: out.filter(a => a.notFound).map(a => a.primaryId) };
  });

  // ---- 工单详情（含报工时间线 + 关联执行记录 + 照片） ----
  fastify.get('/api/workorders/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权查看该工单' });
    }
    const feedback = all('SELECT * FROM work_order_feedback WHERE work_order_id = ? ORDER BY created_at ASC', [order.id]);
    const records = all('SELECT * FROM operation_record WHERE work_order_id = ? ORDER BY event_at DESC', [order.id]);
    const photos = all("SELECT * FROM upload_file WHERE ref_table = 'work_order_feedback' AND ref_id = ? ORDER BY created_at ASC", [order.id]);
    // 步骤链 + 当前步骤（v2.6）
    const { steps, currentStep, doneSteps } = getStepSchedule(order);
    const stepList = steps.map((s, i) => ({
      code: s.code, title: s.title, titleEn: s.title_en, stepNo: s.step_no,
      dueDays: s.due_days, reminderLeadDays: s.reminder_lead_days,
      dueDate: stepDueDate(order, steps, i),
      isDone: doneSteps.has(s.code),
      isCurrent: currentStep ? s.code === currentStep.code : false,
    }));
    return {
      order: mapOrder(order),
      assignees: getAssignees(order.id),
      feedback,
      records: records.map(r => ({ ...r, content: JSON.parse(r.content_json || '{}') })),
      photos,
      steps: stepList,
      currentStep: currentStep ? { code: currentStep.code, title: currentStep.title, titleEn: currentStep.title_en } : null,
    };
  });

  // ---- 编辑工单（管理员；已完成/已取消不可改） ----
  fastify.put('/api/workorders/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (order.status === 'done' || order.status === 'cancelled') {
      return reply.status(400).send({ error: '已完成或已取消的工单不可编辑' });
    }
    const b = request.body || {};
    run('UPDATE work_order SET title = ?, description = ?, purpose = ?, accessions_json = ?, target_qty = ?, priority = ?, due_date = ?, updated_at = ? WHERE id = ?',
      [b.title ?? order.title, b.description ?? order.description, b.purpose ?? order.purpose,
       JSON.stringify(Array.isArray(b.accessions) ? b.accessions : JSON.parse(order.accessions_json || '[]')),
       b.targetQty != null ? Number(b.targetQty) : order.target_qty,
       b.priority ?? order.priority, b.dueDate ?? order.due_date, new Date().toISOString(), order.id]);
    return { success: true };
  });

  // ---- 状态转移 ----
  fastify.post('/api/workorders/:id/status', { preHandler: [authMiddleware] }, async (request, reply) => {
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权操作该工单' });
    }
    const to = request.body?.status;
    if (!['pending', 'in_progress', 'done', 'blocked', 'cancelled'].includes(to)) {
      return reply.status(400).send({ error: '无效状态' });
    }
    if (!canTransition(order, to, request.user)) {
      return reply.status(403).send({ error: '不允许该状态转移' });
    }
    applyStatus(order, to, request.user);
    return { success: true };
  });

  // ---- 报工反馈（progress / issue / done） ----
  fastify.post('/api/workorders/:id/feedback', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权操作该工单' });
    }
    const b = request.body || {};
    const kind = b.kind;
    if (!['progress', 'issue', 'done'].includes(kind)) return reply.status(400).send({ error: '反馈类型无效' });
    const id = uuidv4();
    run('INSERT INTO work_order_feedback (id, work_order_id, user_id, username, kind, qty, content, step_code, photo_json) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, order.id, request.user.id, request.user.username, kind, Number(b.qty) || 0, b.content || '',
       b.stepCode || '', JSON.stringify(Array.isArray(b.photoIds) ? b.photoIds : [])]);

    // 可选：同写一条不可变操作记录作为执行留痕
    if (b.stepCode) {
      const step = get('SELECT * FROM operation_step_def WHERE module = ? AND code = ?', ['tissue_culture', b.stepCode]);
      run('INSERT INTO operation_record (id, module, batch_id, step_code, title, operator, content_json, notes, event_at, immutable, user_id, work_order_id) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',
        [uuidv4(), 'tissue_culture', order.wo_no, b.stepCode, step?.title || b.stepCode, request.user.username,
         JSON.stringify({ qty: Number(b.qty) || 0, work_order: order.wo_no }), b.content || '',
         new Date().toISOString(), request.user.id, order.id]);
    }

    // 推导进度
    const { doneQty, progress } = recomputeProgress(order.id, order.wo_no, order.purpose);

    // 自动状态流转
    let newStatus = order.status;
    if (kind === 'done' && !['done', 'cancelled'].includes(order.status)) {
      newStatus = 'done';
      run('UPDATE work_order SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?', [newStatus, new Date().toISOString(), new Date().toISOString(), order.id]);
      run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
        ['work_order', order.id, 'STATUS_CHANGE', JSON.stringify({ status: order.status }), JSON.stringify({ status: 'done' }), request.user.id, request.user.username]);
    } else if (kind === 'issue' && ['pending', 'in_progress'].includes(order.status)) {
      newStatus = 'blocked';
      run('UPDATE work_order SET status = ?, updated_at = ? WHERE id = ?', [newStatus, new Date().toISOString(), order.id]);
      run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
        ['work_order', order.id, 'STATUS_CHANGE', JSON.stringify({ status: order.status }), JSON.stringify({ status: 'blocked' }), request.user.id, request.user.username]);
    }

    const kindZh = { progress: '进度', issue: '受阻', done: '完成' }[kind] || kind;
    pushMessage({ role: 'admin', type: 'wo_feedback', title: '工单报工', title_en: 'Work Order Feedback',
      body: `${order.wo_no}「${order.title}」${request.user.username} 报工：${kindZh}${b.qty ? `，数量 ${b.qty}` : ''}${b.content ? `，${b.content}` : ''}`,
      body_en: `${order.wo_no} "${order.title}": ${request.user.username} reported ${kind}${b.qty ? ` qty ${b.qty}` : ''}`,
      ref_table: 'work_order', ref_id: order.id });
    return { success: true, id, doneQty, progress, status: newStatus };
  });

  // ---- v2.8: 日报提交（订单→工序→日报，一对多；同人同工序同日覆盖） ----
  fastify.post('/api/workorders/:id/daily-report', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权操作该工单' });
    }
    const b = request.body || {};
    const stepCode = String(b.stepCode || '').trim();
    const reportDate = String(b.reportDate || '').trim();
    if (!stepCode) return reply.status(400).send({ error: '请选择工序' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return reply.status(400).send({ error: '日期格式应为 YYYY-MM-DD' });
    const qty = Math.max(0, Number(b.qty) || 0);
    const content = String(b.content || '').trim();
    const photoIds = Array.isArray(b.photoIds) ? b.photoIds.map(String) : [];
    const step = get('SELECT * FROM operation_step_def WHERE module = ? AND code = ?', ['tissue_culture', stepCode]);
    const existing = get('SELECT id FROM work_daily_report WHERE work_order_id = ? AND step_code = ? AND user_id = ? AND report_date = ?',
      [order.id, stepCode, request.user.id, reportDate]);
    const upserted = !!existing;
    if (existing) {
      run('UPDATE work_daily_report SET qty = ?, content = ?, photo_json = ?, updated_at = ? WHERE id = ?',
        [qty, content, JSON.stringify(photoIds), new Date().toISOString(), existing.id]);
    } else {
      run('INSERT INTO work_daily_report (id, work_order_id, step_code, report_date, user_id, username, qty, content, photo_json) VALUES (?,?,?,?,?,?,?,?,?)',
        [uuidv4(), order.id, stepCode, reportDate, request.user.id, request.user.username, qty, content, JSON.stringify(photoIds)]);
    }
    // 工作留痕：同步写不可变 operation_record（event_at = 当天）
    run('INSERT INTO operation_record (id, module, batch_id, step_code, title, operator, content_json, notes, event_at, immutable, user_id, work_order_id) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',
      [uuidv4(), 'tissue_culture', order.wo_no, stepCode, step?.title || stepCode, request.user.username,
       JSON.stringify({ qty, work_order: order.wo_no, daily_report: true }), content,
       `${reportDate}T00:00:00`, request.user.id, order.id]);
    const { doneQty, progress } = recomputeProgress(order.id, order.wo_no, order.purpose);
    pushMessage({ role: 'admin', type: 'wo_daily_report', title: '工单日报', title_en: 'Work Order Daily Report',
      body: `${order.wo_no}「${order.title}」${request.user.username} 提交 ${reportDate} ${step?.title || stepCode} 日报${qty ? `，数量 ${qty}` : ''}${content ? `，${content}` : ''}`,
      body_en: `${order.wo_no} "${order.title}": ${request.user.username} filed daily report for ${stepCode} on ${reportDate}${qty ? `, qty ${qty}` : ''}`,
      ref_table: 'work_order', ref_id: order.id });
    return { success: true, upserted, doneQty, progress };
  });

  // ---- v2.8: 日报台账（按日期倒序） ----
  fastify.get('/api/workorders/:id/daily-reports', { preHandler: [authMiddleware] }, async (request, reply) => {
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权查看该工单' });
    }
    const reports = all('SELECT * FROM work_daily_report WHERE work_order_id = ? ORDER BY report_date DESC, created_at DESC', [order.id]);
    // 附带日报照片
    const photos = all("SELECT * FROM upload_file WHERE ref_table = 'work_daily_report' AND ref_id = ?", [order.id]);
    const photoById = {};
    for (const p of photos) photoById[p.id] = p;
    return {
      reports: reports.map(r => ({
        id: r.id, workOrderId: r.work_order_id, stepCode: r.step_code, reportDate: r.report_date,
        userId: r.user_id, username: r.username, qty: r.qty, content: r.content,
        photoIds: JSON.parse(r.photo_json || '[]'),
        createdAt: r.created_at, updatedAt: r.updated_at,
        photos: JSON.parse(r.photo_json || '[]').map(pid => photoById[pid]).filter(Boolean),
      })),
    };
  });

  // ---- v2.8: 手动设置进度（仅 manual 模式；写审计） ----
  fastify.put('/api/workorders/:id/progress', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权操作该工单' });
    }
    if (order.progress_mode !== 'manual') return reply.status(400).send({ error: '该工单为自动进度模式，请先切换为手动' });
    const b = request.body || {};
    const progress = Math.max(0, Math.min(100, Number(b.progress) || 0));
    const doneQty = Number(b.doneQty) || 0;
    const before = { progress: order.progress, doneQty: order.done_qty };
    run('UPDATE work_order SET progress = ?, done_qty = ?, updated_at = ? WHERE id = ?', [progress, doneQty, new Date().toISOString(), order.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['work_order', order.id, 'MANUAL_PROGRESS', JSON.stringify(before), JSON.stringify({ progress, doneQty }), request.user.id, request.user.username]);
    return { success: true, progress, doneQty };
  });

  // ---- v2.8: 切换进度模式 auto / manual（写审计） ----
  fastify.put('/api/workorders/:id/progress-mode', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (!canView(request.user) && !isAssignee(request.user, order.id)) {
      return reply.status(403).send({ error: '无权操作该工单' });
    }
    const mode = request.body?.mode === 'manual' ? 'manual' : '';
    run('UPDATE work_order SET progress_mode = ?, updated_at = ? WHERE id = ?', [mode, new Date().toISOString(), order.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['work_order', order.id, 'PROGRESS_MODE', JSON.stringify({ progressMode: order.progress_mode || '' }), JSON.stringify({ progressMode: mode }), request.user.id, request.user.username]);
    if (!mode) recomputeProgress(order.id, order.wo_no, order.purpose); // 切回自动立即重算
    return { success: true, progressMode: mode };
  });

  // ---- 删除工单（管理员，仅待处理） ----
  fastify.delete('/api/workorders/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const order = get('SELECT * FROM work_order WHERE id = ?', [request.params.id]);
    if (!order) return reply.status(404).send({ error: '工单不存在' });
    if (order.status !== 'pending') return reply.status(400).send({ error: '仅待处理工单可删除，其他状态请使用取消' });
    run('DELETE FROM work_order_feedback WHERE work_order_id = ?', [order.id]);
    run('DELETE FROM work_order_assignee WHERE work_order_id = ?', [order.id]);
    run('DELETE FROM work_order WHERE id = ?', [order.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['work_order', order.id, 'DELETE', null, JSON.stringify({ woNo: order.wo_no }), request.user.id, request.user.username]);
    return { success: true };
  });

  // ---- 个人待办清单 ----
  fastify.get('/api/todos', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rows = all('SELECT * FROM todo WHERE user_id = ? ORDER BY is_done ASC, due_date ASC, created_at DESC', [request.user.id]);
    return { todos: rows };
  });

  fastify.post('/api/todos', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    if (!b.title || !String(b.title).trim()) return reply.status(400).send({ error: '清单标题必填' });
    const id = uuidv4();
    run('INSERT INTO todo (id, user_id, title, notes, due_date, priority, is_done, color) VALUES (?,?,?,?,?,?,0,?)',
      [id, request.user.id, String(b.title).trim(), b.notes || '', b.dueDate || '', b.priority || 'normal', b.color || 'yellow']);
    return { success: true, id };
  });

  fastify.put('/api/todos/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const todo = get('SELECT * FROM todo WHERE id = ? AND user_id = ?', [request.params.id, request.user.id]);
    if (!todo) return reply.status(404).send({ error: '清单不存在' });
    const b = request.body || {};
    run('UPDATE todo SET title = ?, notes = ?, due_date = ?, priority = ?, is_done = ?, color = ?, updated_at = ? WHERE id = ?',
      [b.title ?? todo.title, b.notes ?? todo.notes, b.dueDate ?? todo.due_date, b.priority ?? todo.priority,
       b.isDone != null ? (b.isDone ? 1 : 0) : todo.is_done, b.color ?? todo.color,
       new Date().toISOString(), todo.id]);
    return { success: true };
  });

  fastify.delete('/api/todos/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const todo = get('SELECT * FROM todo WHERE id = ? AND user_id = ?', [request.params.id, request.user.id]);
    if (!todo) return reply.status(404).send({ error: '清单不存在' });
    run('DELETE FROM todo WHERE id = ?', [todo.id]);
    return { success: true };
  });

  // ---- 角色化工作台聚合 ----
  fastify.get('/api/workbench', { preHandler: [authMiddleware] }, async (request, reply) => {
    const u = request.user;
    const ut = u.user_type === 'regulator' || u.role === 'admin' ? u.user_type : u.user_type || 'operator';
    const myTodos = all('SELECT * FROM todo WHERE user_id = ? AND is_done = 0 ORDER BY due_date ASC, created_at DESC', [u.id]);

    // 操作员/管理员共用：我的在途工单（排序：逾期 → 优先级 → 截止日）
    const myRows = all(`SELECT wo.* FROM work_order wo
      WHERE wo.id IN (SELECT work_order_id FROM work_order_assignee WHERE user_id = ?)
        AND wo.status IN ('pending','in_progress')
      ORDER BY (wo.due_date IS NOT NULL AND wo.due_date < ?) DESC,
               CASE wo.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               wo.due_date ASC, wo.created_at ASC`,
      [u.id, todayLocal()]);

    if (ut === 'regulator' && u.role !== 'admin') {
      const counts = all('SELECT status, COUNT(*) as c FROM work_order GROUP BY status');
      const board = { pending: 0, in_progress: 0, done: 0, blocked: 0, cancelled: 0, overdue: 0 };
      for (const c of counts) board[c.status] = c.c;
      const recent = all('SELECT * FROM work_order ORDER BY created_at DESC LIMIT 5');
      return { user: { id: u.id, username: u.username, role: u.role, userType: ut },
        readOnlyOverview: { board, recentOrders: recent.map(mapOrder) } };
    }

    if (ut === 'external') {
      const myDist = all('SELECT id, req_no, resource_type, qty, status, current_stage, created_at FROM dist_request WHERE created_by = ? ORDER BY created_at DESC LIMIT 10', [u.username]);
      return { user: { id: u.id, username: u.username, role: u.role, userType: ut }, myDistRequests: myDist, myTodos };
    }

    if (ut === 'approver') {
      const introPending = get("SELECT COUNT(*) as c FROM intro_request WHERE status IN ('pending','in_review')")?.c || 0;
      const distPending = get("SELECT COUNT(*) as c FROM dist_request WHERE status IN ('pending','in_review')")?.c || 0;
      const introList = all("SELECT id, req_no, applicant_org, resource_type, qty, status, current_stage FROM intro_request WHERE status IN ('pending','in_review') ORDER BY created_at DESC LIMIT 10");
      const distList = all("SELECT id, req_no, applicant, resource_type, qty, status, current_stage FROM dist_request WHERE status IN ('pending','in_review') ORDER BY created_at DESC LIMIT 10");
      return { user: { id: u.id, username: u.username, role: u.role, userType: ut },
        approvalQueue: { introPending, distPending, introList, distList }, myTodos };
    }

    // admin 与 operator 共用基础：在途工单 + 我的清单
    if (u.role === 'admin') {
      const counts = all('SELECT status, COUNT(*) as c FROM work_order GROUP BY status');
      const board = { pending: 0, in_progress: 0, done: 0, blocked: 0, cancelled: 0, overdue: 0 };
      for (const c of counts) board[c.status] = c.c;
      board.overdue = all("SELECT COUNT(*) as c FROM work_order WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL AND due_date < ?", [todayLocal()])[0].c;
      const today = all("SELECT COUNT(*) as c FROM work_order WHERE due_date = ?", [todayLocal()])[0].c;
      const team = all(`SELECT u.id, u.display_name, u.username,
        (SELECT COUNT(*) FROM work_order_assignee a JOIN work_order w ON w.id = a.work_order_id
          WHERE a.user_id = u.id AND w.status IN ('pending','in_progress')) as active_count,
        (SELECT COUNT(*) FROM work_order_assignee a JOIN work_order w ON w.id = a.work_order_id
          WHERE a.user_id = u.id AND w.status IN ('pending','in_progress') AND w.due_date IS NOT NULL AND w.due_date < ?) as overdue_count
        FROM user u WHERE u.user_type = 'operator' AND u.status = 'active' ORDER BY active_count DESC`, [todayLocal()]);
      const recentFeedback = all(`SELECT f.*, wo.wo_no, wo.title as order_title FROM work_order_feedback f
        JOIN work_order wo ON wo.id = f.work_order_id ORDER BY f.created_at DESC LIMIT 10`);
      // v2.17 控制室：7 日活跃度直方图。created_at 存 UTC（datetime('now')），
      // 需按服务器本地时区归一（与 todayLocal 口径一致），否则晚间反馈会漂到前一日。
      // 偏移用分钟数动态计算，兼容非整点时区；缺失日在下方服务端零填充。
      const tzMin = -new Date().getTimezoneOffset();
      const tzMod = `${tzMin >= 0 ? '+' : '-'}${Math.abs(tzMin)} minutes`;
      const actRaw = all(`SELECT date(created_at, ?) AS d, COUNT(*) AS c FROM work_order_feedback
        WHERE date(created_at, ?) >= date('now', ?, '-6 day') GROUP BY d`, [tzMod, tzMod, tzMod]);
      const byDay = Object.fromEntries(actRaw.map(r => [r.d, r.c]));
      const activity7d = [];
      for (let i = 6; i >= 0; i--) {
        const dt = new Date(Date.now() - i * 86400000);
        const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        activity7d.push({ d: ds, c: byDay[ds] || 0 });
      }
      const introPending = get("SELECT COUNT(*) as c FROM intro_request WHERE status IN ('pending','in_review')")?.c || 0;
      const distPending = get("SELECT COUNT(*) as c FROM dist_request WHERE status IN ('pending','in_review')")?.c || 0;
      return { user: { id: u.id, username: u.username, role: u.role, userType: ut },
        productionBoard: board, todayCount: today,
        teamLoad: team.map(x => ({ userId: x.id, displayName: x.display_name || x.username, activeCount: x.active_count, overdueCount: x.overdue_count })),
        pendingApprovals: { introPending, distPending },
        recentFeedback, activity7d, myTodos };
    }

    // operator（或未分类 user）
    const myToday = myRows.map(r => {
      const m = mapOrder(r);
      const { steps, currentStep } = getStepSchedule(r);
      if (currentStep) {
        m.currentStep = { code: currentStep.code, title: currentStep.title, titleEn: currentStep.title_en };
        const idx = steps.findIndex(s => s.code === currentStep.code);
        m.currentStepDue = stepDueDate(r, steps, idx);
      }
      return m;
    });
    return { user: { id: u.id, username: u.username, role: u.role, userType: ut },
      myToday, myTodos };
  });
}

// 工单步骤链提醒扫描（v2.6，index.js 定时调用）：
// 对进行中且带步骤链的工单，当前步骤计划完成日前 N 天提醒 assignee + admin
// N = min(步骤自身 reminder_lead_days 若>0, 全局 work.step_reminder_lead_days)
export function checkWorkOrderStepReminder() {
  const globalLead = getSettingInt('work.step_reminder_lead_days', 1);
  const today = todayLocal();
  const rows = all("SELECT * FROM work_order WHERE status = 'in_progress' AND purpose != '' AND purpose IS NOT NULL");
  let count = 0;
  for (const order of rows) {
    const { steps, currentStep } = getStepSchedule(order);
    if (!currentStep) continue;
    const idx = steps.findIndex(s => s.code === currentStep.code);
    if (idx < 0) continue;
    const stepDue = stepDueDate(order, steps, idx);
    const ownLead = Number(currentStep.reminder_lead_days) || 0;
    const lead = Math.min(ownLead > 0 ? ownLead : globalLead, globalLead);
    const remindOn = addDays(stepDue, -lead);
    if (remindOn > today || order.reminded_step === currentStep.code) continue;
    run("UPDATE work_order SET reminded_step = ?, updated_at = datetime('now') WHERE id = ?", [currentStep.code, order.id]);
    const zh = `工单 ${order.wo_no}「${order.title}」当前步骤「${currentStep.title}」${lead > 0 ? `将于 ${stepDue} 到期` : `今日（${stepDue}）到期`}，请及时完成`;
    const en = `WO ${order.wo_no} "${order.title}": step "${currentStep.title}" due ${stepDue}. Please complete.`;
    pushMessage({ role: 'admin', type: 'wo_step_reminder', title: '工单步骤提醒', title_en: 'Work Order Step Reminder', body: zh, body_en: en, ref_table: 'work_order', ref_id: order.id });
    for (const a of getAssignees(order.id)) {
      pushMessage({ user_id: a.userId, type: 'wo_step_reminder', title: '工单步骤提醒', title_en: 'Work Order Step Reminder', body: zh, body_en: en, ref_table: 'work_order', ref_id: order.id });
    }
    count++;
  }
  return count;
}

// 工单逾期扫描（index.js 定时调用）：逾期未完成 → 提醒 admin + 指派操作员
export function checkWorkOrderOverdue() {
  const grace = checkOverdueDays();
  const threshold = new Date(Date.now() - grace * 86400000);
  const th = `${threshold.getFullYear()}-${String(threshold.getMonth() + 1).padStart(2, '0')}-${String(threshold.getDate()).padStart(2, '0')}`;
  const rows = all("SELECT * FROM work_order WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL AND due_date < ?", [th]);
  for (const order of rows) {
    const zh = `工单 ${order.wo_no}「${order.title}」已逾期（截止 ${order.due_date}），请及时处理`;
    const en = `WO ${order.wo_no} "${order.title}" is overdue (due ${order.due_date}). Please handle.`;
    pushMessage({ role: 'admin', type: 'wo_overdue', title: '工单逾期', title_en: 'Work Order Overdue', body: zh, body_en: en, ref_table: 'work_order', ref_id: order.id });
    for (const a of getAssignees(order.id)) {
      pushMessage({ user_id: a.userId, type: 'wo_overdue', title: '工单逾期', title_en: 'Work Order Overdue', body: zh, body_en: en, ref_table: 'work_order', ref_id: order.id });
    }
  }
  return rows.length;
}
