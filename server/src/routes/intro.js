import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { canApprove, readOnlyGuard } from '../middleware/permissions.js';
import { getSettingInt } from '../db/settings.js';
import { pushMessage } from '../lib/messages.js';

function genReqNo(prefix) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${d}-${rnd}`;
}

function getFlow(module) {
  return all('SELECT * FROM approval_flow WHERE module = ? ORDER BY stage_no, sort_order', [module]);
}

function mapReq(r) {
  return {
    id: r.id,
    reqNo: r.req_no,
    applicantOrg: r.applicant_org,
    contact: r.contact,
    resourceType: r.resource_type,
    qty: r.qty,
    origin: r.origin,
    traitDescription: r.trait_description,
    riskLevel: r.risk_level,
    docsJson: r.docs_json ? JSON.parse(r.docs_json) : [],
    status: r.status,
    currentStage: r.current_stage,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    qualificationNo: r.qualification_no,
    qualificationExpiry: r.qualification_expiry,
  };
}

function mapQ(r) {
  return {
    id: r.id,
    requestId: r.request_id,
    batchNo: r.batch_no,
    baseName: r.base_name,
    startDate: r.start_date,
    endDate: r.end_date,
    monitorJson: r.monitor_json ? JSON.parse(r.monitor_json) : [],
    reportDocsJson: r.report_docs_json ? JSON.parse(r.report_docs_json) : [],
    conclusion: r.conclusion,
    status: r.status,
    reminderDue: r.reminder_due,
  };
}

export default async function introRoutes(fastify) {
  // ---- 审批流配置（可自定义） ----
  fastify.get('/api/intro/approval-flow', { preHandler: [authMiddleware] }, async (request, reply) => {
    return { stages: getFlow('intro') };
  });
  fastify.put('/api/intro/approval-flow', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { stages } = request.body || {};
    if (!Array.isArray(stages)) return reply.status(400).send({ error: 'stages 必须为数组' });
    run('DELETE FROM approval_flow WHERE module = ?', ['intro']);
    const { v4: uuidv4 } = await import('uuid');
    stages.forEach((s, i) => {
      run('INSERT INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), 'intro', i + 1, s.title || `环节${i + 1}`, s.titleEn || '', JSON.stringify(s.requiredDocs || []), i + 1]);
    });
    return { success: true };
  });

  // ---- 申请 CRUD ----
  fastify.get('/api/intro/requests', { preHandler: [authMiddleware] }, async (request, reply) => {
    const pageNum = parseInt(request.query.page) || 1;
    const pageSize = Math.min(parseInt(request.query.limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    const conds = [];
    const params = [];
    if (request.query.status) { conds.push('status = ?'); params.push(request.query.status); }
    if (request.query.q) { conds.push('(applicant_org LIKE ? OR req_no LIKE ? OR resource_type LIKE ?)'); params.push(`%${request.query.q}%`, `%${request.query.q}%`, `%${request.query.q}%`); }
    // admin 与监管方可见全部；其余仅本人创建的申请
    if (request.user.role !== 'admin' && request.user.user_type !== 'regulator') { conds.push('created_by = ?'); params.push(request.user.username); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM intro_request ${where}`, params);
    const rows = all(`SELECT * FROM intro_request ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { requests: rows.map(mapReq), total: total ? total.c : 0, page: pageNum };
  });

  fastify.get('/api/intro/requests/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const req = get('SELECT * FROM intro_request WHERE id = ?', [request.params.id]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    const approvals = all('SELECT * FROM intro_approval WHERE request_id = ? ORDER BY stage, created_at', [req.id]);
    const quarantine = all('SELECT * FROM quarantine_record WHERE request_id = ? ORDER BY created_at DESC', [req.id]);
    const uploads = all('SELECT * FROM upload_file WHERE ref_table = ? AND ref_id = ? ORDER BY created_at DESC', ['intro_request', req.id]);
    return {
      ...mapReq(req),
      approvals: approvals.map(a => ({ id: a.id, stage: a.stage, approver: a.approver, comment: a.comment, decision: a.decision, createdAt: a.created_at })),
      quarantine: quarantine.map(mapQ),
      uploads: uploads.map(u => ({ id: u.id, originalName: u.original_name, storedName: u.stored_name, uploadedBy: u.uploaded_by, createdAt: u.created_at })),
      flow: getFlow('intro').map(s => ({ stageNo: s.stage_no, title: s.title, titleEn: s.title_en, requiredDocs: JSON.parse(s.required_docs_json || '[]') })),
    };
  });

  fastify.post('/api/intro/requests', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    if (!b.applicantOrg) return reply.status(400).send({ error: '引进单位必填' });
    if (!b.resourceType) return reply.status(400).send({ error: '种质类型必填' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    const reqNo = genReqNo('IN');
    run('INSERT INTO intro_request (id, req_no, applicant_org, contact, resource_type, qty, origin, trait_description, risk_level, docs_json, status, current_stage, created_by, qualification_no, qualification_expiry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, reqNo, b.applicantOrg, b.contact || '', b.resourceType, b.qty != null ? Number(b.qty) : null, b.origin || '', b.traitDescription || '', b.riskLevel || '', JSON.stringify(b.docs || []), 'pending', 1, request.user?.username || '', b.qualificationNo || '', b.qualificationExpiry || '']);
    return { success: true, id, reqNo };
  });

  fastify.put('/api/intro/requests/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const req = get('SELECT * FROM intro_request WHERE id = ?', [request.params.id]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    if (req.status !== 'pending' && request.user.role !== 'admin') {
      return reply.status(400).send({ error: '仅待审批状态的申请可编辑' });
    }
    const b = request.body || {};
    run('UPDATE intro_request SET applicant_org=?, contact=?, resource_type=?, qty=?, origin=?, trait_description=?, risk_level=?, docs_json=?, qualification_no=?, qualification_expiry=?, updated_at=datetime(\'now\') WHERE id=?',
      [b.applicantOrg || req.applicant_org, b.contact ?? req.contact, b.resourceType || req.resource_type, b.qty != null ? Number(b.qty) : req.qty, b.origin ?? req.origin, b.traitDescription ?? req.trait_description, b.riskLevel ?? req.risk_level, JSON.stringify(b.docs || (req.docs_json ? JSON.parse(req.docs_json) : [])), b.qualificationNo ?? req.qualification_no, b.qualificationExpiry ?? req.qualification_expiry, req.id]);
    return { success: true };
  });

  fastify.delete('/api/intro/requests/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM intro_request WHERE id = ?', [request.params.id]);
    run('DELETE FROM intro_approval WHERE request_id = ?', [request.params.id]);
    run('DELETE FROM quarantine_record WHERE request_id = ?', [request.params.id]);
    return { success: true };
  });

  // ---- 审批（状态机防跳步；管理员或审批人员可审） ----
  fastify.post('/api/intro/requests/:id/approve', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!canApprove(request.user)) return reply.status(403).send({ error: '无审批权限' });
    const req = get('SELECT * FROM intro_request WHERE id = ?', [request.params.id]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    if (req.status === 'rejected' || req.status === 'approved') return reply.status(400).send({ error: '该申请已处于终态' });
    const { stage, comment, decision } = request.body || {};
    const stages = getFlow('intro');
    if (!stages.length) return reply.status(400).send({ error: '未配置审批流' });
    if (parseInt(stage) !== req.current_stage) {
      return reply.status(400).send({ error: `当前处于第 ${req.current_stage} 环节，不能审批第 ${stage} 环节` });
    }
    const isReject = decision === 'reject';
    const { v4: uuidv4 } = await import('uuid');
    run('INSERT INTO intro_approval (id, request_id, stage, approver, comment, decision) VALUES (?,?,?,?,?,?)',
      [uuidv4(), req.id, parseInt(stage), request.user.username, comment || '', isReject ? 'reject' : 'approve']);
    if (isReject) {
      run('UPDATE intro_request SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['rejected', req.id]);
    } else if (req.current_stage >= stages.length) {
      run('UPDATE intro_request SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['approved', req.id]);
    } else {
      run('UPDATE intro_request SET status = ?, current_stage = ?, updated_at = datetime(\'now\') WHERE id = ?', ['in_review', req.current_stage + 1, req.id]);
    }
    // 审批进度通知：申请人 + 管理员
    const stageTitle = stages.find(s => s.stage_no === req.current_stage)?.title || `第${req.current_stage}环节`;
    const actor = request.user.username;
    pushMessage({
      user_id: req.created_by ? (get('SELECT id FROM user WHERE username = ?', [req.created_by])?.id || null) : null,
      type: 'intro_approval', title: '引进审批进度更新', title_en: 'Intro Approval Update',
      body: `申请 ${req.req_no} 由 ${actor} 完成「${stageTitle}」环节（${isReject ? '拒绝' : '通过'}）`,
      body_en: `Request ${req.req_no}: ${actor} ${isReject ? 'rejected' : 'approved'} stage "${stageTitle}"`,
      ref_table: 'intro_request', ref_id: req.id,
    });
    pushMessage({ role: 'admin', type: 'intro_approval', title: '引进审批进度更新', title_en: 'Intro Approval Update', body: `申请 ${req.req_no} 由 ${actor} 完成「${stageTitle}」环节`, body_en: `Request ${req.req_no} stage "${stageTitle}" done by ${actor}`, ref_table: 'intro_request', ref_id: req.id });
    return { success: true };
  });

  // ---- 隔离检疫 ----
  fastify.post('/api/intro/quarantine', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { requestId, batchNo, baseName, startDate, endDate } = request.body || {};
    if (!requestId || !batchNo) return reply.status(400).send({ error: '申请ID与隔离批次必填' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO quarantine_record (id, request_id, batch_no, base_name, start_date, end_date, monitor_json, status, reminder_due, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, requestId, batchNo, baseName || '', startDate || '', endDate || '', '[]', 'quarantining', endDate || '', new Date().toISOString()]);
    return { success: true, id };
  });

  fastify.post('/api/intro/quarantine/:id/result', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const row = get('SELECT * FROM quarantine_record WHERE id = ?', [request.params.id]);
    if (!row) return reply.status(404).send({ error: '未找到检疫记录' });
    const { conclusion, monitor, reportDocs, passed } = request.body || {};
    run('UPDATE quarantine_record SET conclusion=?, monitor_json=?, report_docs_json=?, status=? WHERE id=?',
      [conclusion || row.conclusion, JSON.stringify(monitor || (row.monitor_json ? JSON.parse(row.monitor_json) : [])), JSON.stringify(reportDocs || (row.report_docs_json ? JSON.parse(row.report_docs_json) : [])), passed === false ? 'failed' : 'completed', row.id]);
    return { success: true };
  });

  // 隔离到期提醒（结束日期在配置窗口内且未完成）——窗口可配置（intro.quarantine_reminder_days）
  fastify.get('/api/intro/quarantine/reminders', { preHandler: [authMiddleware] }, async (request, reply) => {
    const days = getSettingInt('intro.quarantine_reminder_days', 7);
    const rows = all(`SELECT * FROM quarantine_record WHERE status = 'quarantining' AND end_date != '' AND date(end_date) <= date('now', '+' || ? || ' day') ORDER BY end_date ASC`, [days]);
    for (const row of rows) {
      pushMessage({ role: 'admin', type: 'quarantine_expiry', title: '隔离检疫即将到期', title_en: 'Quarantine Expiring', body: `隔离批次 ${row.batch_no} 将于 ${row.end_date} 到期`, body_en: `Quarantine ${row.batch_no} ends ${row.end_date}`, ref_table: 'quarantine_record', ref_id: row.id });
    }
    return { reminders: rows.map(mapQ) };
  });

  // 主体资质到期提醒（intro.qualification_expiry_days 窗口内即将到期）
  fastify.get('/api/intro/qualification/reminders', { preHandler: [authMiddleware] }, async (request, reply) => {
    const days = getSettingInt('intro.qualification_expiry_days', 30);
    const rows = all(
      `SELECT * FROM intro_request WHERE qualification_expiry != '' AND qualification_expiry IS NOT NULL
       AND status NOT IN ('rejected','approved')
       AND date(qualification_expiry) >= date('now')
       AND date(qualification_expiry) <= date('now', '+' || ? || ' day') ORDER BY qualification_expiry ASC`,
      [days],
    );
    for (const row of rows) {
      pushMessage({ role: 'admin', type: 'qualification_expiry', title: '引进主体资质即将到期', title_en: 'Qualification Expiring', body: `${row.applicant_org}（${row.req_no}）资质将于 ${row.qualification_expiry} 到期`, body_en: `${row.applicant_org} (${row.req_no}) qualification expires ${row.qualification_expiry}`, ref_table: 'intro_request', ref_id: row.id });
    }
    return { reminders: rows.map(mapReq) };
  });
}
