import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { readOnlyGuard } from '../middleware/permissions.js';
import { getSettingInt } from '../db/settings.js';
import { pushMessage } from '../lib/messages.js';
import * as XLSX from 'xlsx';

function stepRow(r) {
  return {
    id: r.id,
    module: r.module,
    code: r.code,
    stepNo: r.step_no,
    title: r.title,
    titleEn: r.title_en,
    requiredFields: JSON.parse(r.required_fields_json || '[]'),
    sortOrder: r.sort_order,
    isSystem: r.is_system,
    dueDays: r.due_days || 0,
    purpose: r.purpose || '',
  };
}

// 可见性：admin 与监管方(regulator)可看全部；其余仅本人
function canViewAll(user) {
  return user.role === 'admin' || user.user_type === 'regulator';
}

function buildRecordFilter(query, user) {
  const conds = [];
  const params = [];
  const { module, step, operator, from, to, batch, purpose } = query;
  if (module) { conds.push('module = ?'); params.push(module); }
  if (step) { conds.push('step_code = ?'); params.push(step); }
  let opFilter = operator;
  if (!canViewAll(user)) opFilter = user.username;
  if (opFilter) { conds.push('operator = ?'); params.push(opFilter); }
  if (batch) { conds.push('batch_id LIKE ?'); params.push(`%${batch}%`); }
  if (from) { conds.push('event_at >= ?'); params.push(from); }
  if (to) { conds.push('event_at <= ?'); params.push(to); }
  if (purpose) {
    conds.push('step_code IN (SELECT code FROM operation_step_def WHERE module = ? AND purpose = ?)');
    params.push(module || 'tissue_culture', purpose);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// 超时检查：每批次按时间排序，上一步完成后 due_days + 宽限 内未做下一步 → 提醒
function checkOverdue() {
  const grace = getSettingInt('op.overdue_reminder_days', 1);
  const rows = all('SELECT * FROM operation_record ORDER BY module, batch_id, event_at');
  const byBatch = {};
  for (const r of rows) {
    if (!r.batch_id) continue;
    const key = `${r.module}::${r.batch_id}`;
    (byBatch[key] = byBatch[key] || []).push(r);
  }
  const overdue = [];
  for (const list of Object.values(byBatch)) {
    list.sort((a, b) => String(a.event_at).localeCompare(String(b.event_at)));
    const last = list[list.length - 1];
    const step = get('SELECT * FROM operation_step_def WHERE module = ? AND code = ?', [last.module, last.step_code]);
    if (!step) continue;
    const dueDays = step.due_days || 0;
    const dueAt = new Date(new Date(last.event_at).getTime() + (dueDays + grace) * 86400000);
    if (Date.now() > dueAt.getTime() && step.due_days > 0) {
      overdue.push({
        module: last.module, batchId: last.batch_id, lastStep: last.step_code,
        lastEventAt: last.event_at, dueAt: dueAt.toISOString(), operator: last.operator,
      });
      const zh = `批次 ${last.batch_id} 的「${step.title}」已完成 ${dueDays} 天仍未进行下一步操作（宽限 ${grace} 天），请尽快处理`;
      const en = `Batch ${last.batch_id}: "${step.title}" finished ${dueDays} days ago with no next step (grace ${grace}d). Please process.`;
      pushMessage({ user_id: last.user_id, type: 'op_overdue', title: '操作步骤超时', title_en: 'Operation Overdue', body: zh, body_en: en, ref_table: 'operation_record', ref_id: last.id });
      pushMessage({ role: 'admin', type: 'op_overdue', title: '操作步骤超时', title_en: 'Operation Overdue', body: zh, body_en: en, ref_table: 'operation_record', ref_id: last.id });
    }
  }
  return overdue;
}

export default async function operationRoutes(fastify) {
  // ---- 流程步骤配置（管理员可自定义；含继代分型 purpose 与计划间隔 dueDays） ----
  fastify.get('/api/operation-steps', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { module, purpose } = request.query;
    let conds = [];
    const params = [];
    if (module) { conds.push('module = ?'); params.push(module); }
    if (purpose) { conds.push('purpose = ?'); params.push(purpose); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = all(`SELECT * FROM operation_step_def ${where} ORDER BY module, purpose, sort_order, step_no`, params);
    const modules = all('SELECT DISTINCT module FROM operation_step_def ORDER BY module').map(r => r.module);
    const purposes = all('SELECT DISTINCT purpose FROM operation_step_def WHERE purpose != \'\' ORDER BY purpose').map(r => r.purpose);
    return { steps: rows.map(stepRow), modules, purposes };
  });

  fastify.post('/api/operation-steps', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { module, code, title, titleEn, requiredFields, stepNo, sortOrder, dueDays, purpose } = request.body || {};
    if (!module || !title) return reply.status(400).send({ error: '模块与标题必填' });
    const stepCode = (code || '').trim() || title;
    const dup = get('SELECT id FROM operation_step_def WHERE module = ? AND code = ?', [module, stepCode]);
    if (dup) return reply.status(409).send({ error: '该模块下已存在此步骤代码' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system, due_days, purpose) VALUES (?,?,?,?,?,?,?,?,0,?,?)',
      [id, module, stepCode, stepNo || 0, title, titleEn || '', JSON.stringify(Array.isArray(requiredFields) ? requiredFields : []), sortOrder || 0, parseInt(dueDays) || 0, purpose || '']);
    return { success: true, id };
  });

  fastify.put('/api/operation-steps/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { title, titleEn, requiredFields, stepNo, sortOrder, dueDays, purpose } = request.body || {};
    run('UPDATE operation_step_def SET title=?, title_en=?, step_no=?, required_fields_json=?, sort_order=?, due_days=?, purpose=? WHERE id=?',
      [title || '', titleEn || '', stepNo || 0, JSON.stringify(Array.isArray(requiredFields) ? requiredFields : []), sortOrder || 0, parseInt(dueDays) || 0, purpose || '', request.params.id]);
    return { success: true };
  });

  fastify.delete('/api/operation-steps/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM operation_step_def WHERE id = ?', [request.params.id]);
    return { success: true };
  });

  // ---- 操作记录（创建即不可篡改） ----
  fastify.post('/api/operations', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const { module, batchId, stepCode, title, content, notes, eventAt } = request.body || {};
    if (!module) return reply.status(400).send({ error: '模块必填' });
    if (!stepCode) return reply.status(400).send({ error: '步骤必填' });

    const step = get('SELECT * FROM operation_step_def WHERE module = ? AND code = ?', [module, stepCode]);
    const contentObj = content && typeof content === 'object' ? content : {};
    let required = [];
    if (step) {
      try { required = JSON.parse(step.required_fields_json || '[]'); } catch (e) { required = []; }
    }
    const missing = required.filter(f => contentObj[f] === undefined || contentObj[f] === null || String(contentObj[f]).trim() === '');
    if (missing.length) return reply.status(400).send({ error: `缺少必填字段: ${missing.join(', ')}` });

    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    const operator = request.body.operator || request.user?.username || '';
    run('INSERT INTO operation_record (id, module, batch_id, step_code, title, operator, content_json, notes, event_at, immutable, user_id) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
      [id, module, batchId || '', stepCode, step?.title || title || stepCode, operator, JSON.stringify(contentObj), notes || '', eventAt || new Date().toISOString(), request.user?.id || '']);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['operation_record', id, 'CREATE', null, JSON.stringify({ module, batchId, stepCode, operator, contentObj, notes }), request.user?.id || '', request.user?.username || '']);
    return { success: true, id };
  });

  fastify.get('/api/operations', { preHandler: [authMiddleware] }, async (request, reply) => {
    const pageNum = parseInt(request.query.page) || 1;
    const pageSize = Math.min(parseInt(request.query.limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    const { where, params } = buildRecordFilter(request.query, request.user);
    const total = get(`SELECT COUNT(*) as c FROM operation_record ${where}`, params);
    const rows = all(`SELECT * FROM operation_record ${where} ORDER BY event_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return {
      records: rows.map(r => ({ ...r, content: JSON.parse(r.content_json || '{}') })),
      total: total ? total.c : 0,
      page: pageNum,
    };
  });

  // 单条详情：含审核意见 / 时间修正留痕 / 附件照片
  fastify.get('/api/operations/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const r = get('SELECT * FROM operation_record WHERE id = ?', [request.params.id]);
    if (!r) return reply.status(404).send({ error: '记录不存在' });
    if (!canViewAll(request.user) && r.operator !== request.user.username) {
      return reply.status(403).send({ error: '无权查看该记录' });
    }
    const reviews = all('SELECT * FROM operation_record_review WHERE record_id = ? ORDER BY created_at ASC', [request.params.id]);
    const corrections = all('SELECT * FROM record_time_correction WHERE ref_table = ? AND ref_id = ? ORDER BY created_at ASC', ['operation_record', request.params.id]);
    const photos = all('SELECT * FROM upload_file WHERE ref_table = ? AND ref_id = ? ORDER BY created_at ASC', ['operation_record', request.params.id]);
    return { record: { ...r, content: JSON.parse(r.content_json || '{}') }, reviews, corrections, photos };
  });

  // 管理员审核意见（原始记录仍锁定）
  fastify.post('/api/operations/:id/review', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { comment } = request.body || {};
    if (!comment || !String(comment).trim()) return reply.status(400).send({ error: '审核意见不能为空' });
    if (!get('SELECT id FROM operation_record WHERE id = ?', [request.params.id])) {
      return reply.status(404).send({ error: '记录不存在' });
    }
    const { v4: uuidv4 } = await import('uuid');
    run('INSERT INTO operation_record_review (id, record_id, reviewer, comment) VALUES (?,?,?,?)',
      [uuidv4(), request.params.id, request.user.username, String(comment)]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['operation_record_review', request.params.id, 'REVIEW', null, JSON.stringify({ comment }), request.user.id, request.user.username]);
    return { success: true };
  });

  // 完成时间手动修正（留痕；op.time_correct_audit=false 时仅改时间不写修正表）
  fastify.post('/api/operations/:id/correct-time', { preHandler: [authMiddleware] }, async (request, reply) => {
    const r = get('SELECT * FROM operation_record WHERE id = ?', [request.params.id]);
    if (!r) return reply.status(404).send({ error: '记录不存在' });
    if (!canViewAll(request.user) && r.operator !== request.user.username) {
      return reply.status(403).send({ error: '无权修改该记录' });
    }
    const { eventAt } = request.body || {};
    if (!eventAt) return reply.status(400).send({ error: '新时间必填' });
    const audit = getSettingInt('op.time_correct_audit', 1) === 1;
    if (audit) {
      run('INSERT INTO record_time_correction (id, ref_table, ref_id, old_at, new_at, corrected_by) VALUES (?,?,?,?,?,?)',
        [cryptoRandomId(), 'operation_record', request.params.id, r.event_at, eventAt, request.user.username]);
      run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
        ['operation_record', request.params.id, 'CORRECT_TIME', JSON.stringify({ event_at: r.event_at }), JSON.stringify({ event_at: eventAt }), request.user.id, request.user.username]);
    }
    run('UPDATE operation_record SET event_at = ? WHERE id = ?', [eventAt, request.params.id]);
    return { success: true };
  });

  // 超时提醒扫描（页面调用 → 返回逾期列表 + 生成消息）
  fastify.get('/api/operations/overdue', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!canViewAll(request.user) && request.user.role !== 'admin') {
      return reply.status(403).send({ error: '无权查看' });
    }
    const overdue = checkOverdue();
    return { overdue };
  });

  // 导出 Excel（按同样过滤条件）
  fastify.get('/api/operations/export', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { where, params } = buildRecordFilter(request.query, request.user);
    const rows = all(`SELECT * FROM operation_record ${where} ORDER BY event_at DESC`, params);
    const aoa = rows.map(r => {
      let contentObj = {};
      try { contentObj = JSON.parse(r.content_json || '{}'); } catch (e) {}
      const contentStr = Object.entries(contentObj).map(([k, v]) => `${k}:${v}`).join('；');
      return {
        模块: r.module,
        批次: r.batch_id,
        步骤: r.step_code,
        操作人: r.operator,
        操作内容: contentStr,
        异常备注: r.notes,
        完成时间: r.event_at,
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'records');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    reply.header('Content-Disposition', 'attachment; filename="operations.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return reply.send(buf);
  });
}

function cryptoRandomId() {
  // 简单 uuid（避免顶层 async import 样板）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
