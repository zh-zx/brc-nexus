// 巡检功能（v2.6）
// 针对 组培苗库存(inventory) / 冷藏箱(freezer) / 超低温(cryo) 的工厂式巡检：
// 管理员安排巡检任务（手动截止 + 闹钟式周期重复），指派组培操作员执行；
// 操作员逐项上报状态（正常/异常/报修），管理员实时知情；完成一轮自动生成下一轮。
import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { readOnlyGuard } from '../middleware/permissions.js';
import { pushMessage } from '../lib/messages.js';
import { v4 as uuidv4 } from 'uuid';

function pad(n) { return String(n).padStart(2, '0'); }
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dateAdd(dateStr, mode, interval) {
  const d = new Date(dateStr + 'T00:00:00');
  const i = Math.max(1, interval || 1);
  if (mode === 'daily') d.setDate(d.getDate() + i);
  else if (mode === 'weekly') d.setDate(d.getDate() + i * 7);
  else if (mode === 'monthly') d.setMonth(d.getMonth() + i);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mapTask(t, recordsCount) {
  return {
    id: t.id,
    title: t.title,
    scopeType: t.scope_type,
    targetType: t.target_type,
    targetRef: t.target_ref,
    dueDate: t.due_date,
    repeatMode: t.repeat_mode,
    repeatInterval: t.repeat_interval,
    assignees: JSON.parse(t.assignee_ids_json || '[]'),
    status: t.status,
    renewed: !!t.renewed,
    createdBy: t.created_by,
    finishedAt: t.finished_at,
    createdAt: t.created_at,
    records: recordsCount || 0,
  };
}

// 任务应检清单（按 target_type 拉取；scope=order/accessions 时按种质过滤）
export function buildChecklist(task) {
  let ids = null;
  if (task.scope_type === 'order' && task.target_ref && task.target_ref !== 'all') {
    const order = get('SELECT accessions_json FROM work_order WHERE id = ?', [task.target_ref]);
    try { ids = new Set((JSON.parse(order?.accessions_json || '[]') || []).map(a => String(a.id))); } catch { ids = null; }
  } else if (task.scope_type === 'accessions' && task.target_ref && task.target_ref !== 'all') {
    try { ids = new Set((JSON.parse(task.target_ref) || []).map(a => String(a.id))); } catch { ids = null; }
  }
  if (task.target_type === 'inventory') {
    const rows = all(`SELECT i.*, r.name as room_name FROM inventory i LEFT JOIN room r ON r.id = i.room_id ORDER BY r.name, i.germplasm_name`);
    return rows
      .filter(r => !ids || (r.accession_id && ids.has(String(r.accession_id))))
      .map(r => ({ ref: 'inventory:' + r.id, label: r.germplasm_name || r.barcode || r.id, sub: `${r.room_name || ''} · ${r.form || ''} ×${r.quantity ?? 0}` }));
  }
  if (task.target_type === 'freezer') {
    const rows = all(`SELECT fs.id, fs.box_id, fs.position_no, fs.sample_code, fs.quantity, fs.accession_id, b.box_no
      FROM freezer_sample fs JOIN freezer_box b ON b.id = fs.box_id ORDER BY b.box_no, fs.position_no`);
    return rows
      .filter(r => !ids || (r.accession_id && ids.has(String(r.accession_id))))
      .map(r => ({ ref: 'freezer:' + r.id, label: r.sample_code || r.id, sub: `盒 ${r.box_no} · 位 ${r.position_no}` }));
  }
  if (task.target_type === 'cryo') {
    const rows = all('SELECT * FROM cryo_device ORDER BY created_at ASC');
    return rows.map(r => ({ ref: 'cryo:' + r.id, label: r.name, sub: `${r.location || ''} · ${r.capacity || ''}` }));
  }
  return [];
}

// 完成任务时生成下一轮（闹钟式周期）。返回新任务或 null
export function renewInspection(task) {
  if (!task || task.repeat_mode === 'none' || task.repeat_mode === '') return null;
  const due = task.due_date || todayLocal();
  const nextDue = dateAdd(due, task.repeat_mode, task.repeat_interval || 1);
  if (nextDue <= todayLocal()) return null; // 下一轮还没到点，不提前生成
  run('UPDATE inspection_task SET renewed = 1, updated_at = datetime(\'now\') WHERE id = ?', [task.id]);
  const id = uuidv4();
  run(`INSERT INTO inspection_task (id, title, scope_type, target_type, target_ref, due_date, repeat_mode, repeat_interval, assignee_ids_json, status, renewed, created_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'pending', 0, ?, datetime('now'))`,
    [id, task.title, task.scope_type, task.target_type, task.target_ref, nextDue, task.repeat_mode, task.repeat_interval || 1, task.assignee_ids_json, task.created_by]);
  const zh = `巡检「${task.title}」已完成一轮，下一轮已排至 ${nextDue}`;
  const en = `Inspection "${task.title}" round done, next round scheduled for ${nextDue}`;
  for (const uid of JSON.parse(task.assignee_ids_json || '[]')) {
    pushMessage({ user_id: uid, type: 'inspection_due', title: '下一轮巡检已排', title_en: 'Next Inspection Scheduled',
      body: zh, body_en: en, ref_table: 'inspection_task', ref_id: id });
  }
  pushMessage({ role: 'admin', type: 'inspection_due', title: '下一轮巡检已排', title_en: 'Next Inspection Scheduled',
    body: zh, body_en: en, ref_table: 'inspection_task', ref_id: id });
  return id;
}

// 60s 兜底扫描：漏生成的（如记录直写）补齐下一轮
export function checkInspectionRenewal() {
  const done = all("SELECT * FROM inspection_task WHERE status = 'done' AND renewed = 0 AND repeat_mode != 'none'");
  let n = 0;
  for (const t of done) { if (renewInspection(t)) n++; }
  return n;
}

export default async function inspectionRoutes(fastify) {
  // ---- 任务列表 ----
  fastify.get('/api/inspections', { preHandler: [authMiddleware] }, async (request, reply) => {
    const u = request.user;
    const { status, targetType, mine } = request.query;
    const conds = [];
    const params = [];
    // 注意：sql.js 不支持相关子查询中的 json_each（会返回空结果），
    // 故「指派给我」过滤放在 JS 侧完成。
    const onlyMine = (u.role === 'admin' || u.user_type === 'regulator')
      ? (mine === '1' || mine === 'true')
      : true; // 非管理员仅可见指派给自己的任务
    if (status) { conds.push('status = ?'); params.push(status); }
    if (targetType) { conds.push('target_type = ?'); params.push(targetType); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = all(`SELECT * FROM inspection_task ${where} ORDER BY due_date ASC, created_at DESC`);
    const list = onlyMine
      ? rows.filter(t => (JSON.parse(t.assignee_ids_json || '[]') || []).includes(String(u.id)))
      : rows;
    return {
      inspections: list.map(t => {
        const c = get('SELECT COUNT(*) as c FROM inspection_record WHERE task_id = ?', [t.id]);
        return mapTask(t, c ? c.c : 0);
      }),
    };
  });

  // ---- 新建巡检（管理员） ----
  fastify.post('/api/inspections', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    if (!b.title || !String(b.title).trim()) return reply.status(400).send({ error: '巡检标题必填' });
    if (!['inventory', 'freezer', 'cryo'].includes(b.targetType)) return reply.status(400).send({ error: '无效的巡检类型' });
    if (!['all', 'order', 'accessions'].includes(b.scopeType)) b.scopeType = 'all';
    const assigneeIds = Array.isArray(b.assigneeIds) ? [...new Set(b.assigneeIds.map(String))] : [];
    for (const uid of assigneeIds) {
      const u = get('SELECT id, user_type, status FROM user WHERE id = ?', [uid]);
      if (!u || u.user_type !== 'operator' || u.status !== 'active') {
        return reply.status(400).send({ error: '指派对象必须是启用状态的操作员' });
      }
    }
    const id = uuidv4();
    run(`INSERT INTO inspection_task (id, title, scope_type, target_type, target_ref, due_date, repeat_mode, repeat_interval, assignee_ids_json, status, created_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?, datetime('now'))`,
      [id, String(b.title).trim(), b.scopeType, b.targetType, b.targetRef || 'all', b.dueDate || '',
       b.repeatMode || 'none', Number(b.repeatInterval) || 1, JSON.stringify(assigneeIds), request.user.username]);
    const zh = `新巡检「${b.title}」已指派给你${b.dueDate ? `，截止 ${b.dueDate}` : ''}`;
    const en = `New inspection "${b.title}" assigned to you${b.dueDate ? `, due ${b.dueDate}` : ''}`;
    for (const uid of assigneeIds) {
      pushMessage({ user_id: uid, type: 'inspection_assigned', title: '新巡检指派', title_en: 'New Inspection Assigned',
        body: zh, body_en: en, ref_table: 'inspection_task', ref_id: id });
    }
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['inspection_task', id, 'CREATE', null, JSON.stringify({ title: b.title, targetType: b.targetType, dueDate: b.dueDate, repeat: b.repeatMode, assigneeIds }), request.user.id, request.user.username]);
    return { success: true, id };
  });

  // ---- 编辑巡检（管理员；已完成/已取消不可改） ----
  fastify.put('/api/inspections/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const t = get('SELECT * FROM inspection_task WHERE id = ?', [request.params.id]);
    if (!t) return reply.status(404).send({ error: '巡检任务不存在' });
    if (t.status === 'done' || t.status === 'cancelled') return reply.status(400).send({ error: '已完成或已取消的巡检不可编辑' });
    const b = request.body || {};
    const assigneeIds = Array.isArray(b.assigneeIds) ? [...new Set(b.assigneeIds.map(String))] : JSON.parse(t.assignee_ids_json || '[]');
    run('UPDATE inspection_task SET title=?, scope_type=?, target_type=?, target_ref=?, due_date=?, repeat_mode=?, repeat_interval=?, assignee_ids_json=?, updated_at=datetime(\'now\') WHERE id=?',
      [b.title ?? t.title, b.scopeType ?? t.scope_type, b.targetType ?? t.target_type, b.targetRef ?? t.target_ref,
       b.dueDate ?? t.due_date, b.repeatMode ?? t.repeat_mode, Number(b.repeatInterval) || t.repeat_interval,
       JSON.stringify(assigneeIds), t.id]);
    return { success: true };
  });

  // ---- 状态转移（管理员；done 由记录端点自动触发） ----
  fastify.post('/api/inspections/:id/status', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (readOnlyGuard(request.user, reply)) return;
    const t = get('SELECT * FROM inspection_task WHERE id = ?', [request.params.id]);
    if (!t) return reply.status(404).send({ error: '巡检任务不存在' });
    const to = request.body?.status;
    if (!['pending', 'in_progress', 'done', 'cancelled'].includes(to)) return reply.status(400).send({ error: '无效状态' });
    run('UPDATE inspection_task SET status=?, finished_at=CASE WHEN ?=\'done\' THEN datetime(\'now\') ELSE finished_at END, updated_at=datetime(\'now\') WHERE id=?', [to, to, t.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['inspection_task', t.id, 'STATUS_CHANGE', JSON.stringify({ status: t.status }), JSON.stringify({ status: to }), request.user.id, request.user.username]);
    if (to === 'done') renewInspection(t);
    return { success: true };
  });

  // ---- 提交巡检记录（被指派者/管理员；完成任务时自动生成下一轮） ----
  fastify.post('/api/inspections/:id/records', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const t = get('SELECT * FROM inspection_task WHERE id = ?', [request.params.id]);
    if (!t) return reply.status(404).send({ error: '巡检任务不存在' });
    const assigneeIds = JSON.parse(t.assignee_ids_json || '[]');
    const mine = request.user.role === 'admin' || assigneeIds.includes(String(request.user.id));
    if (!mine) return reply.status(403).send({ error: '仅被指派的巡检人或管理员可提交' });
    if (t.status === 'done' || t.status === 'cancelled') return reply.status(400).send({ error: '该巡检已结束' });
    const b = request.body || {};
    if (!b.targetRef) return reply.status(400).send({ error: '缺少巡检对象' });
    if (!['normal', 'warning', 'error'].includes(b.status)) return reply.status(400).send({ error: '无效的巡检状态' });
    const id = uuidv4();
    run('INSERT INTO inspection_record (id, task_id, user_id, username, target_ref, status, note, photo_json) VALUES (?,?,?,?,?,?,?,?)',
      [id, t.id, request.user.id, request.user.username, b.targetRef, b.status, b.note || '',
       JSON.stringify(Array.isArray(b.photoIds) ? b.photoIds : [])]);
    if (t.status !== 'in_progress') {
      run('UPDATE inspection_task SET status = \'in_progress\', updated_at = datetime(\'now\') WHERE id = ?', [t.id]);
    }
    // 全部检查项完成后自动 done + 生成下一轮
    const total = buildChecklist(t).length;
    const done = get('SELECT COUNT(*) as c FROM inspection_record WHERE task_id = ?', [t.id])?.c || 0;
    let finished = false;
    if (total > 0 && done >= total) {
      run('UPDATE inspection_task SET status = \'done\', finished_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?', [t.id]);
      run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
        ['inspection_task', t.id, 'STATUS_CHANGE', JSON.stringify({ status: 'in_progress' }), JSON.stringify({ status: 'done' }), request.user.id, request.user.username]);
      renewInspection(t);
      finished = true;
      pushMessage({ role: 'admin', type: 'inspection_done', title: '巡检已完成', title_en: 'Inspection Done',
        body: `巡检「${t.title}」已由 ${request.user.username} 完成`, body_en: `Inspection "${t.title}" completed by ${request.user.username}`,
        ref_table: 'inspection_task', ref_id: t.id });
    }
    const bad = b.status !== 'normal';
    if (bad) {
      const zhSt = b.status === 'warning' ? '异常' : '报修';
      pushMessage({ role: 'admin', type: 'inspection_issue', title: '巡检发现问题', title_en: 'Inspection Issue',
        body: `巡检「${t.title}」${request.user.username} 上报${zhSt}：${b.targetRef}${b.note ? ` · ${b.note}` : ''}`,
        body_en: `Inspection "${t.title}": ${request.user.username} reported ${zhSt} at ${b.targetRef}`,
        ref_table: 'inspection_task', ref_id: t.id });
    }
    return { success: true, id, done, total, finished };
  });

  // ---- 记录列表 ----
  fastify.get('/api/inspections/:id/records', { preHandler: [authMiddleware] }, async (request, reply) => {
    const t = get('SELECT * FROM inspection_task WHERE id = ?', [request.params.id]);
    if (!t) return reply.status(404).send({ error: '巡检任务不存在' });
    const assigneeIds = JSON.parse(t.assignee_ids_json || '[]');
    if (request.user.role !== 'admin' && request.user.user_type !== 'regulator' && !assigneeIds.includes(String(request.user.id))) {
      return reply.status(403).send({ error: '无权查看' });
    }
    const rows = all('SELECT * FROM inspection_record WHERE task_id = ? ORDER BY created_at ASC', [t.id]);
    return { records: rows };
  });

  // ---- 应检清单（供执行端拉取） ----
  fastify.get('/api/inspections/:id/checklist', { preHandler: [authMiddleware] }, async (request, reply) => {
    const t = get('SELECT * FROM inspection_task WHERE id = ?', [request.params.id]);
    if (!t) return reply.status(404).send({ error: '巡检任务不存在' });
    const assigneeIds = JSON.parse(t.assignee_ids_json || '[]');
    if (request.user.role !== 'admin' && request.user.user_type !== 'regulator' && !assigneeIds.includes(String(request.user.id))) {
      return reply.status(403).send({ error: '无权查看' });
    }
    const checklist = buildChecklist(t);
    const records = all('SELECT * FROM inspection_record WHERE task_id = ?', [t.id]);
    const byRef = new Map(records.map(r => [r.target_ref, r]));
    return {
      task: mapTask(t, records.length),
      checklist: checklist.map(c => ({ ...c, record: byRef.get(c.ref) || null })),
    };
  });
}
