import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { canApprove, readOnlyGuard } from '../middleware/permissions.js';
import { getSettingInt, getSettingJson } from '../db/settings.js';
import { pushMessage } from '../lib/messages.js';
import { writeAudit } from '../lib/audit.js';

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
    applicant: r.applicant,
    applicantOrg: r.applicant_org,
    purpose: r.purpose,
    resourceType: r.resource_type,
    qty: r.qty,
    durationDays: r.duration_days,
    qualificationDocsJson: r.qualification_docs_json ? JSON.parse(r.qualification_docs_json) : [],
    // v2.10：向导/agent 选中的种质清单 + 来源（manual/wizard）
    accessionsJson: r.accessions_json ? JSON.parse(r.accessions_json) : [],
    source: r.source || 'manual',
    status: r.status,
    currentStage: r.current_stage,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export default async function distRoutes(fastify) {
  // ---- 审批流配置（可自定义） ----
  fastify.get('/api/dist/approval-flow', { preHandler: [authMiddleware] }, async (request, reply) => {
    return { stages: getFlow('dist') };
  });
  fastify.put('/api/dist/approval-flow', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { stages } = request.body || {};
    if (!Array.isArray(stages)) return reply.status(400).send({ error: 'stages 必须为数组' });
    run('DELETE FROM approval_flow WHERE module = ?', ['dist']);
    const { v4: uuidv4 } = await import('uuid');
    stages.forEach((s, i) => {
      run('INSERT INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), 'dist', i + 1, s.title || `环节${i + 1}`, s.titleEn || '', JSON.stringify(s.requiredDocs || []), i + 1]);
    });
    return { success: true };
  });

  // ---- 申请 CRUD ----
  fastify.get('/api/dist/requests', { preHandler: [authMiddleware] }, async (request, reply) => {
    const pageNum = parseInt(request.query.page) || 1;
    const pageSize = Math.min(parseInt(request.query.limit) || 50, 200);
    const offset = (pageNum - 1) * pageSize;
    const conds = [];
    const params = [];
    if (request.query.status) { conds.push('status = ?'); params.push(request.query.status); }
    if (request.query.q) { conds.push('(applicant LIKE ? OR req_no LIKE ? OR resource_type LIKE ? OR applicant_org LIKE ?)'); params.push(`%${request.query.q}%`, `%${request.query.q}%`, `%${request.query.q}%`, `%${request.query.q}%`); }
    // admin 与监管方可见全部；外部用户/操作员仅本人创建的申请
    if (request.user.role !== 'admin' && request.user.user_type !== 'regulator') { conds.push('created_by = ?'); params.push(request.user.username); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM dist_request ${where}`, params);
    const rows = all(`SELECT * FROM dist_request ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { requests: rows.map(mapReq), total: total ? total.c : 0, page: pageNum };
  });

  fastify.get('/api/dist/requests/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const req = get('SELECT * FROM dist_request WHERE id = ?', [request.params.id]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    const approvals = all('SELECT * FROM dist_approval WHERE request_id = ? ORDER BY stage, created_at', [req.id]);
    const orders = all('SELECT * FROM dist_order WHERE request_id = ? ORDER BY created_at', [req.id]);
    const tracking = all('SELECT * FROM dist_tracking WHERE request_id = ? ORDER BY report_at DESC', [req.id]);
    const uploads = all('SELECT * FROM upload_file WHERE ref_table = ? AND ref_id = ? ORDER BY created_at DESC', ['dist_request', req.id]);
    return {
      ...mapReq(req),
      approvals: approvals.map(a => ({ id: a.id, stage: a.stage, approver: a.approver, comment: a.comment, decision: a.decision, createdAt: a.created_at })),
      orders: orders.map(o => ({ id: o.id, pickupMethod: o.pickup_method, logisticsNo: o.logistics_no, handler: o.handler, itemsJson: o.items_json ? JSON.parse(o.items_json) : [], shippedAt: o.shipped_at, status: o.status })),
      tracking: tracking.map(t => ({ id: t.id, orderId: t.order_id, reportNo: t.report_no, consumedQty: t.consumed_qty, remainderHandle: t.remainder_handle, note: t.note, reportAt: t.report_at, user: t.user_id })),
      uploads: uploads.map(u => ({ id: u.id, originalName: u.original_name, storedName: u.stored_name, uploadedBy: u.uploaded_by, createdAt: u.created_at })),
      flow: getFlow('dist').map(s => ({ stageNo: s.stage_no, title: s.title, titleEn: s.title_en, requiredDocs: JSON.parse(s.required_docs_json || '[]') })),
    };
  });

  fastify.post('/api/dist/requests', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const b = request.body || {};
    if (!b.applicant) return reply.status(400).send({ error: '申请方必填' });
    if (!b.resourceType) return reply.status(400).send({ error: '所需种质类型必填' });
    if (b.qty == null) return reply.status(400).send({ error: '申请数量必填' });
    // 自动资质校验：资质证明非空 + 黑名单命中 → verifyWarning
    const docs = Array.isArray(b.docs) ? b.docs : [];
    const blacklist = getSettingJson('dist.blacklist_json', []);
    const org = String(b.applicantOrg || b.applicant || '').trim().toLowerCase();
    const inBlacklist = blacklist.some(x => String(x).toLowerCase() === org);
    const verifyWarning = [];
    if (!docs.length) verifyWarning.push('未上传资质证明');
    if (inBlacklist) verifyWarning.push('申请方在黑名单中，请注意审核');
    // v2.10：选中种质清单 + 服务端强制 35 上限（dist.max_accessions 参数）
    const accs = Array.isArray(b.accessions) ? b.accessions.slice(0, 500) : [];
    const maxAcc = getSettingInt('dist.max_accessions', 35);
    if (accs.length > maxAcc) {
      return reply.status(400).send({ error: 'TOO_MANY_ACCESSIONS', max: maxAcc, message: `选中种质数超过上限（${maxAcc}）` });
    }
    const accJson = JSON.stringify(
      accs.map(a => ({ id: String(a?.id ?? a), code: String(a?.code ?? ''), name: String(a?.name ?? '') })).slice(0, maxAcc),
    );
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    const reqNo = genReqNo('DS');
    run('INSERT INTO dist_request (id, req_no, applicant, applicant_org, purpose, resource_type, qty, duration_days, qualification_docs_json, accessions_json, source, status, current_stage, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, reqNo, b.applicant, b.applicantOrg || '', b.purpose || '', b.resourceType, Number(b.qty), b.durationDays != null ? parseInt(b.durationDays) : null, JSON.stringify(docs), accJson, ['wizard', 'mcp'].includes(b.source) ? b.source : 'manual', 'pending', 1, request.user?.username || '']);
    return { success: true, id, reqNo, verifyWarning };
  });

  fastify.put('/api/dist/requests/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const req = get('SELECT * FROM dist_request WHERE id = ?', [request.params.id]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    if (req.status !== 'pending' && request.user.role !== 'admin') {
      return reply.status(400).send({ error: '仅待审批状态的申请可编辑' });
    }
    const b = request.body || {};
    // v2.10：清单/来源可编辑（仅 pending 且非 admin 限制同上）
    let accJson = req.accessions_json;
    let newSource = req.source;
    if (b.accessions !== undefined) {
      const accs = Array.isArray(b.accessions) ? b.accessions.slice(0, 500) : [];
      const maxAcc = getSettingInt('dist.max_accessions', 35);
      if (accs.length > maxAcc) {
        return reply.status(400).send({ error: 'TOO_MANY_ACCESSIONS', max: maxAcc, message: `选中种质数超过上限（${maxAcc}）` });
      }
      accJson = JSON.stringify(accs.map(a => ({ id: String(a?.id ?? a), code: String(a?.code ?? ''), name: String(a?.name ?? '') })).slice(0, maxAcc));
    }
    if (b.source !== undefined) newSource = ['wizard', 'mcp'].includes(b.source) ? b.source : 'manual';
    run('UPDATE dist_request SET applicant=?, applicant_org=?, purpose=?, resource_type=?, qty=?, duration_days=?, qualification_docs_json=?, accessions_json=?, source=?, updated_at=datetime(\'now\') WHERE id=?',
      [b.applicant || req.applicant, b.applicantOrg ?? req.applicant_org, b.purpose ?? req.purpose, b.resourceType || req.resource_type, b.qty != null ? Number(b.qty) : req.qty, b.durationDays != null ? parseInt(b.durationDays) : req.duration_days, JSON.stringify(b.docs || (req.qualification_docs_json ? JSON.parse(req.qualification_docs_json) : [])), accJson, newSource || 'manual', req.id]);
    return { success: true };
  });

  fastify.delete('/api/dist/requests/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM dist_request WHERE id = ?', [request.params.id]);
    run('DELETE FROM dist_approval WHERE request_id = ?', [request.params.id]);
    run('DELETE FROM dist_order WHERE request_id = ?', [request.params.id]);
    run('DELETE FROM dist_tracking WHERE request_id = ?', [request.params.id]);
    return { success: true };
  });

  // ---- 审批（管理员或审批人员） ----
  fastify.post('/api/dist/requests/:id/approve', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!canApprove(request.user)) return reply.status(403).send({ error: '无审批权限' });
    const req = get('SELECT * FROM dist_request WHERE id = ?', [request.params.id]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    if (req.status === 'rejected' || req.status === 'approved') return reply.status(400).send({ error: '该申请已处于终态' });
    const { stage, comment, decision } = request.body || {};
    const stages = getFlow('dist');
    if (!stages.length) return reply.status(400).send({ error: '未配置审批流' });
    if (parseInt(stage) !== req.current_stage) {
      return reply.status(400).send({ error: `当前处于第 ${req.current_stage} 环节，不能审批第 ${stage} 环节` });
    }
    const isReject = decision === 'reject';
    const { v4: uuidv4 } = await import('uuid');
    run('INSERT INTO dist_approval (id, request_id, stage, approver, comment, decision) VALUES (?,?,?,?,?,?)',
      [uuidv4(), req.id, parseInt(stage), request.user.username, comment || '', isReject ? 'reject' : 'approve']);
    if (isReject) {
      run('UPDATE dist_request SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['rejected', req.id]);
    } else if (req.current_stage >= stages.length) {
      run('UPDATE dist_request SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['approved', req.id]);
    } else {
      run('UPDATE dist_request SET status = ?, current_stage = ?, updated_at = datetime(\'now\') WHERE id = ?', ['in_review', req.current_stage + 1, req.id]);
    }
    const stageTitle = stages.find(s => s.stage_no === req.current_stage)?.title || `第${req.current_stage}环节`;
    const actor = request.user.username;
    pushMessage({
      user_id: req.created_by ? (get('SELECT id FROM user WHERE username = ?', [req.created_by])?.id || null) : null,
      type: 'dist_approval', title: '分发审批进度更新', title_en: 'Distribution Approval Update',
      body: `申请 ${req.req_no} 由 ${actor} 完成「${stageTitle}」环节（${isReject ? '拒绝' : '通过'}）`,
      body_en: `Request ${req.req_no}: ${actor} ${isReject ? 'rejected' : 'approved'} stage "${stageTitle}"`,
      ref_table: 'dist_request', ref_id: req.id,
    });
    pushMessage({ role: 'admin', type: 'dist_approval', title: '分发审批进度更新', title_en: 'Distribution Approval Update', body: `申请 ${req.req_no} 由 ${actor} 完成「${stageTitle}」环节`, body_en: `Request ${req.req_no} stage "${stageTitle}" done by ${actor}`, ref_table: 'dist_request', ref_id: req.id });
    return { success: true };
  });

  // ---- 库存匹配（与现有库存联动；支持按性状/来源地匹配，返回保存期限） ----
  fastify.post('/api/dist/check-inventory', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { resourceType, qty, traitCode, traitValue, op, origin } = request.body || {};
    // 若带性状条件，先解析该性状的取值类型
    let traitDef = null;
    if (traitCode) traitDef = get('SELECT * FROM trait_def WHERE code = ?', [traitCode]);
    const items = all('SELECT i.*, r.name AS room_name, a.data_json, a.origin AS acc_origin FROM inventory i LEFT JOIN room r ON r.id = i.room_id LEFT JOIN accession a ON a.id = i.accession_id');
    const kw = String(resourceType || '').trim().toLowerCase();
    const matched = items.filter(i => {
      if (kw) {
        const name = (i.germplasm_name || '').toLowerCase();
        if (!name.includes(kw)) return false;
      }
      if (origin) {
        const accOrg = String(i.acc_origin || i.origin || '').toLowerCase();
        if (!accOrg.includes(String(origin).toLowerCase())) return false;
      }
      if (traitCode && traitDef) {
        let data = null;
        try { data = i.data_json ? JSON.parse(i.data_json) : null; } catch (e) {}
        if (!data) return false;
        const val = data[traitCode];
        if (val === undefined || val === null) return false;
        const valueType = traitDef.value_type || 'text';
        const want = traitValue;
        if (valueType === 'number') {
          const nv = Number(val);
          const nw = Number(want);
          if (!Number.isFinite(nv) || !Number.isFinite(nw)) return false;
          switch (op || 'eq') {
            case 'gt': return nv > nw;
            case 'gte': return nv >= nw;
            case 'lt': return nv < nw;
            case 'lte': return nv <= nw;
            case 'neq': return nv !== nw;
            default: return nv === nw;
          }
        }
        if (valueType === 'scale') return String(val) === String(want);
        // 文本：包含
        return String(val).toLowerCase().includes(String(want || '').toLowerCase());
      }
      return true;
    });
    const available = matched.reduce((s, i) => s + (i.quantity || 0), 0);
    const requested = qty != null ? Number(qty) : 0;
    const rooms = [];
    const roomMap = {};
    for (const i of matched) {
      const rn = i.room_name || '未分类';
      if (!roomMap[rn]) { roomMap[rn] = { room: rn, count: 0, items: [] }; rooms.push(roomMap[rn]); }
      roomMap[rn].count += (i.quantity || 0);
      roomMap[rn].items.push({ germplasmName: i.germplasm_name, quantity: i.quantity, form: i.form, barcode: i.barcode, expiryDate: i.expiry_date || null });
    }
    return {
      resourceType,
      requested,
      available,
      sufficient: available >= requested,
      shortfall: Math.max(0, requested - available),
      rooms,
      traitMatched: traitCode ? { code: traitCode, value: traitValue, op: op || 'eq' } : null,
    };
  });

  // ---- 分发任务单 ----
  fastify.post('/api/dist/orders', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { requestId, pickupMethod, logisticsNo, handler, items } = request.body || {};
    if (!requestId) return reply.status(400).send({ error: '申请ID必填' });
    const req = get('SELECT * FROM dist_request WHERE id = ?', [requestId]);
    if (!req) return reply.status(404).send({ error: '未找到申请' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO dist_order (id, request_id, pickup_method, logistics_no, handler, items_json, shipped_at, status, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'),?,?)',
      [id, requestId, pickupMethod || 'self', logisticsNo || '', handler || '', JSON.stringify(Array.isArray(items) ? items : []), 'issued', new Date().toISOString()]);
    // v2.19 P0 审计：分发实物发放（出库）事件——种质/数量/物流/经办，实物问责链关键环。
    writeAudit({
      table: 'dist_order',
      recordId: id,
      action: 'DIST_ORDER',
      req: request,
      after: {
        requestId, reqNo: req.req_no, pickupMethod: pickupMethod || 'self',
        logisticsNo: logisticsNo || '', handler: handler || '',
        items: (Array.isArray(items) ? items : []).slice(0, 200),
      },
    });
    pushMessage({ user_id: req.created_by ? (get('SELECT id FROM user WHERE username = ?', [req.created_by])?.id || null) : null, type: 'dist_order', title: '分发任务单已生成', title_en: 'Distribution Order Created', body: `申请 ${req.req_no} 已生成分发任务单`, body_en: `Order created for ${req.req_no}`, ref_table: 'dist_request', ref_id: requestId });
    return { success: true, id };
  });

  // ---- 使用跟踪（接收方定期回传） ----
  fastify.post('/api/dist/tracking', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const { requestId, orderId, reportNo, consumedQty, remainderHandle, note } = request.body || {};
    if (!requestId) return reply.status(400).send({ error: '申请ID必填' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO dist_tracking (id, request_id, order_id, report_no, consumed_qty, remainder_handle, note, user_id) VALUES (?,?,?,?,?,?,?,?)',
      [id, requestId, orderId || '', reportNo || '', consumedQty != null ? Number(consumedQty) : null, remainderHandle || '', note || '', request.user?.username || '']);
    return { success: true, id };
  });

  // ---- 一键追溯 ----
  fastify.get('/api/dist/trace/:reqNo', { preHandler: [authMiddleware] }, async (request, reply) => {
    const req = get('SELECT * FROM dist_request WHERE req_no = ?', [request.params.reqNo]);
    if (!req) return reply.status(404).send({ error: '未找到该分发编号' });
    const timeline = [];
    timeline.push({ at: req.created_at, type: 'submit', title: '提交申请', detail: `${req.applicant} · ${req.resource_type} × ${req.qty}` });
    for (const a of all('SELECT * FROM dist_approval WHERE request_id = ? ORDER BY stage, created_at', [req.id])) {
      timeline.push({ at: a.created_at, type: a.decision === 'reject' ? 'reject' : 'approve', title: `第${a.stage}环节审批`, detail: `${a.approver} · ${a.comment || ''}` });
    }
    for (const o of all('SELECT * FROM dist_order WHERE request_id = ? ORDER BY created_at', [req.id])) {
      timeline.push({ at: o.shipped_at, type: 'order', title: `分发任务单（${o.pickup_method === 'logistics' ? '物流' : '自取'}）`, detail: `物流单号: ${o.logistics_no || '-'} · 经办: ${o.handler || '-'}` });
    }
    for (const t of all('SELECT * FROM dist_tracking WHERE request_id = ? ORDER BY report_at DESC', [req.id])) {
      timeline.push({ at: t.report_at, type: 'track', title: `使用进度回传 #${t.report_no || '-'}`, detail: `已消耗 ${t.consumed_qty ?? '-'} · 剩余处理: ${t.remainder_handle || '-'} · ${t.note || ''}` });
    }
    return { request: mapReq(req), timeline };
  });

  // ---- 超期提醒（已批准但长期无回传；宽限天数可配置 dist.tracking_grace_days） ----
  fastify.get('/api/dist/reminders', { preHandler: [authMiddleware] }, async (request, reply) => {
    const grace = getSettingInt('dist.tracking_grace_days', 7);
    const rows = all("SELECT * FROM dist_request WHERE status = 'approved'");
    const reminders = [];
    for (const r of rows) {
      const last = get('SELECT MAX(report_at) as m FROM dist_tracking WHERE request_id = ?', [r.id]);
      let overdue = true;
      if (r.duration_days && last?.m) {
        const days = (Date.now() - new Date(last.m).getTime()) / 86400000;
        overdue = days > (r.duration_days + grace);
      } else if (!r.duration_days && last?.m) {
        overdue = false;
      }
      if (overdue) {
        reminders.push({ ...mapReq(r), lastReportAt: last?.m || null });
        pushMessage({
          role: 'admin', type: 'dist_overdue', title: '分发使用进度超期', title_en: 'Distribution Overdue',
          body: `申请 ${r.req_no}（${r.applicant}）超过约定使用周期${grace ? `宽限 ${grace} 天` : ''}未回传使用进度`,
          body_en: `Request ${r.req_no} (${r.applicant}) has not reported usage${grace ? ` after ${grace}-day grace` : ''}`,
          ref_table: 'dist_request', ref_id: r.id,
        });
      }
    }
    return { reminders };
  });
}
