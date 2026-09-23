import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { readOnlyGuard } from '../middleware/permissions.js';
import { v4 as uuidv4 } from 'uuid';
import { getSettingInt } from '../db/settings.js';
import { pushMessage } from '../lib/messages.js';
import * as XLSX from 'xlsx';

const EVENT_TYPES = ['lid_open', 'lid_close', 'ln2_add_start', 'ln2_add_end', 'sample_access', 'other'];
const EVENT_LABELS = {
  lid_open: '开盖', lid_close: '关盖', ln2_add_start: '液氮添加开始',
  ln2_add_end: '液氮添加结束', sample_access: '样品取放', other: '其他',
};

function canViewAll(user) {
  return user.role === 'admin' || user.user_type === 'regulator';
}

export default async function cryoRoutes(fastify) {
  // ---- 设备管理（admin 增删改；全员可读） ----
  fastify.get('/api/cryo/devices', { preHandler: [authMiddleware] }, async (request, reply) => {
    const devices = all('SELECT * FROM cryo_device ORDER BY created_at ASC');
    return { devices: devices.map(d => ({ ...d, eventTypes: EVENT_TYPES })) };
  });

  fastify.post('/api/cryo/devices', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { name, nameEn, location, capacity, note } = request.body || {};
    if (!name) return reply.status(400).send({ error: '设备名称必填' });
    const id = uuidv4();
    run('INSERT INTO cryo_device (id, name, name_en, location, capacity, note) VALUES (?,?,?,?,?,?)',
      [id, name, nameEn || '', location || '', capacity || '', note || '']);
    return { success: true, id };
  });

  fastify.put('/api/cryo/devices/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { name, nameEn, location, capacity, note } = request.body || {};
    run('UPDATE cryo_device SET name=?, name_en=?, location=?, capacity=?, note=? WHERE id=?',
      [name || '', nameEn || '', location || '', capacity || '', note || '', request.params.id]);
    return { success: true };
  });

  fastify.delete('/api/cryo/devices/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM cryo_device WHERE id = ?', [request.params.id]);
    return { success: true };
  });

  // ---- 操作留痕（创建即不可篡改） ----
  fastify.post('/api/cryo/records', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const { deviceId, eventType, detail, temp, level, occurredAt } = request.body || {};
    if (!deviceId) return reply.status(400).send({ error: '设备必选' });
    if (!EVENT_TYPES.includes(eventType)) return reply.status(400).send({ error: '无效的操作类型' });
    const device = get('SELECT * FROM cryo_device WHERE id = ?', [deviceId]);
    if (!device) return reply.status(404).send({ error: '设备不存在' });
    const detailObj = detail && typeof detail === 'object' ? detail : { text: detail || '' };
    const id = uuidv4();
    run('INSERT INTO cryo_record (id, device_id, event_type, operator, detail_json, device_temp, device_level, occurred_at, immutable, user_id) VALUES (?,?,?,?,?,?,?,?,1,?)',
      [id, deviceId, eventType, request.user.username, JSON.stringify(detailObj), temp != null ? Number(temp) : null, level != null ? Number(level) : null, occurredAt || new Date().toISOString(), request.user.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['cryo_record', id, 'CREATE', null, JSON.stringify({ deviceId, eventType, detailObj, temp, level }), request.user.id, request.user.username]);
    return { success: true, id };
  });

  fastify.get('/api/cryo/records', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { device, from, to, operator, eventType, page = 1, pageSize = 50 } = request.query;
    const conds = [];
    const params = [];
    if (device) { conds.push('device_id = ?'); params.push(device); }
    if (eventType) { conds.push('event_type = ?'); params.push(eventType); }
    if (!canViewAll(request.user)) { conds.push('operator = ?'); params.push(request.user.username); }
    if (operator) { conds.push('operator = ?'); params.push(operator); }
    if (from) { conds.push('occurred_at >= ?'); params.push(from); }
    if (to) { conds.push('occurred_at <= ?'); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) as c FROM cryo_record ${where}`, params)?.c || 0;
    const limit = Math.min(Math.max(parseInt(pageSize) || 50, 1), 200);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
    const records = all(`SELECT * FROM cryo_record ${where} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return {
      records: records.map(r => ({ ...r, detail: JSON.parse(r.detail_json || '{}') })),
      total, page: parseInt(page) || 1, pageSize: limit,
    };
  });

  // 时间修正（留痕，同 operations）
  fastify.post('/api/cryo/records/:id/correct-time', { preHandler: [authMiddleware] }, async (request, reply) => {
    const r = get('SELECT * FROM cryo_record WHERE id = ?', [request.params.id]);
    if (!r) return reply.status(404).send({ error: '记录不存在' });
    if (!canViewAll(request.user) && r.operator !== request.user.username) {
      return reply.status(403).send({ error: '无权修改该记录' });
    }
    const { occurredAt } = request.body || {};
    if (!occurredAt) return reply.status(400).send({ error: '新时间必填' });
    run('INSERT INTO record_time_correction (id, ref_table, ref_id, old_at, new_at, corrected_by) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'cryo_record', request.params.id, r.occurred_at, occurredAt, request.user.username]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['cryo_record', request.params.id, 'CORRECT_TIME', JSON.stringify({ occurred_at: r.occurred_at }), JSON.stringify({ occurred_at: occurredAt }), request.user.id, request.user.username]);
    run('UPDATE cryo_record SET occurred_at = ? WHERE id = ?', [occurredAt, request.params.id]);
    return { success: true };
  });

  // ---- 报警与处理 ----
  fastify.get('/api/cryo/alarms', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { status, device } = request.query;
    const conds = [];
    const params = [];
    if (status) { conds.push('status = ?'); params.push(status); }
    if (device) { conds.push('device_id = ?'); params.push(device); }
    if (!canViewAll(request.user)) { conds.push('user_id = ?'); params.push(request.user.id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const alarms = all(`SELECT * FROM cryo_alarm ${where} ORDER BY triggered_at DESC`, params);
    return { alarms };
  });

  fastify.post('/api/cryo/alarms', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const { deviceId, alarmType, severity } = request.body || {};
    if (!deviceId || !alarmType) return reply.status(400).send({ error: '设备与报警类型必填' });
    const id = uuidv4();
    run('INSERT INTO cryo_alarm (id, device_id, alarm_type, severity, status, user_id) VALUES (?,?,?,?,?,?)',
      [id, deviceId, alarmType, severity || 'medium', 'open', request.user.id]);
    const device = get('SELECT name FROM cryo_device WHERE id = ?', [deviceId]);
    pushMessage({
      role: 'admin', type: 'cryo_alarm', title: '超低温设备报警', title_en: 'Cryo Device Alarm',
      body: `设备「${device?.name || deviceId}」报警：${alarmType}`, body_en: `Device "${device?.name || deviceId}" alarm: ${alarmType}`,
      ref_table: 'cryo_alarm', ref_id: id,
    });
    return { success: true, id };
  });

  fastify.post('/api/cryo/alarms/:id/resolve', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (readOnlyGuard(request.user, reply)) return;
    const { resolveNotes } = request.body || {};
    const alarm = get('SELECT * FROM cryo_alarm WHERE id = ?', [request.params.id]);
    if (!alarm) return reply.status(404).send({ error: '报警不存在' });
    if (alarm.status !== 'open') return reply.status(400).send({ error: '该报警已处理' });
    run('UPDATE cryo_alarm SET status=?, resolve_notes=?, resolved_by=?, resolved_at=datetime(\'now\') WHERE id=?',
      ['resolved', resolveNotes || '', request.user.username, request.params.id]);
    return { success: true };
  });

  // ---- 导出 Excel（按日/周/月范围） ----
  fastify.get('/api/cryo/export', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { device, from, to, operator } = request.query;
    const conds = [];
    const params = [];
    if (device) { conds.push('device_id = ?'); params.push(device); }
    if (!canViewAll(request.user)) { conds.push('operator = ?'); params.push(request.user.username); }
    if (operator) { conds.push('operator = ?'); params.push(operator); }
    if (from) { conds.push('occurred_at >= ?'); params.push(from); }
    if (to) { conds.push('occurred_at <= ?'); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = all(`SELECT * FROM cryo_record ${where} ORDER BY occurred_at DESC`, params);
    const devices = Object.fromEntries(all('SELECT id, name FROM cryo_device').map(d => [d.id, d.name]));
    const aoa = rows.map(r => {
      let detail = {};
      try { detail = JSON.parse(r.detail_json || '{}'); } catch (e) {}
      return {
        设备: devices[r.device_id] || r.device_id,
        操作类型: EVENT_LABELS[r.event_type] || r.event_type,
        操作人: r.operator,
        操作详情: JSON.stringify(detail),
        温度: r.device_temp,
        液位: r.device_level,
        操作时间: r.occurred_at,
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'cryo_records');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    reply.header('Content-Disposition', 'attachment; filename="cryo_records.xlsx"');
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return reply.send(buf);
  });

  // 便捷：当前设备状态摘要（供快速操作页）
  fastify.get('/api/cryo/status', { preHandler: [authMiddleware] }, async (request, reply) => {
    const devices = all('SELECT * FROM cryo_device ORDER BY created_at ASC');
    return {
      devices: devices.map(d => {
        const last = get('SELECT * FROM cryo_record WHERE device_id = ? ORDER BY occurred_at DESC LIMIT 1', [d.id]);
        const openAlarms = get('SELECT COUNT(*) as c FROM cryo_alarm WHERE device_id = ? AND status = \'open\'', [d.id])?.c || 0;
        return { ...d, lastRecord: last || null, openAlarms };
      }),
      eventTypes: EVENT_TYPES,
      eventLabels: EVENT_LABELS,
    };
  });
}
