import { getDb, run, get, all } from '../db/connection.js';
import { guardedDelete } from '../db/refs.js';
import { writeAudit } from '../lib/audit.js';
import { authMiddleware } from '../middleware/auth.js';
import { saveDb, backupDb } from '../db/connection.js';
import { clearSettingsCache } from '../db/settings.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function settingsRoutes(fastify) {
  fastify.get('/api/settings', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rows = all('SELECT key, value FROM app_setting');
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return settings;
  });

  fastify.put('/api/settings', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    for (const [key, value] of Object.entries(request.body)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        run('INSERT OR REPLACE INTO app_setting (key, value) VALUES (?, ?)', [key, String(value)]);
      }
    }
    clearSettingsCache();
    return { success: true };
  });

  // 备份列表（自动/手动备份产生的文件）
  fastify.get('/api/backups', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const backupDir = path.join(__dirname, '../../data/backups');
    let files = [];
    try {
      files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const st = fs.statSync(path.join(backupDir, f));
          return { filename: f, size: st.size, mtime: st.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
    } catch (e) { /* 目录不存在则空 */ }
    return { backups: files, dir: backupDir };
  });

  // Rooms
  fastify.get('/api/rooms', { preHandler: [authMiddleware] }, async (request, reply) => {
    const rooms = all('SELECT * FROM room ORDER BY name ASC');
    const enriched = rooms.map(room => {
      // 转为 camelCase，与前端字段命名一致
      const items = all('SELECT * FROM inventory WHERE room_id = ?', [room.id])
        .map(i => ({
          id: i.id, accessionId: i.accession_id, roomId: i.room_id,
          germplasmName: i.germplasm_name, quantity: i.quantity, form: i.form,
          barcode: i.barcode, updatedAt: i.updated_at,
        }));
      return { ...room, items };
    });
    return { rooms: enriched };
  });

  fastify.post('/api/rooms', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { name } = request.body;
    if (!name) return reply.status(400).send({ error: '房间名称不能为空' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO room (id, name) VALUES (?, ?)', [id, name]);
    return { success: true, id, name };
  });

  fastify.put('/api/rooms/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const room = request.body;
    run('UPDATE room SET name = ? WHERE id = ?', [room.name, request.params.id]);
    if (Array.isArray(room.items)) {
      // v2.19 P0 审计：库存批量替换是「整房间清空重灌」，可静默改动实物数量/种质归属——记录前后快照。
      const before = all('SELECT germplasm_name, accession_id, quantity, form FROM inventory WHERE room_id = ?', [request.params.id])
        .map(r => ({ name: r.germplasm_name, accessionId: r.accession_id, qty: r.quantity, form: r.form }));
      run('DELETE FROM inventory WHERE room_id = ?', [request.params.id]);
      const { v4: uuidv4 } = await import('uuid');
      const after = [];
      for (const item of room.items) {
        // 兼容 camelCase（前端新物品）与 snake_case（历史负载）两种字段名，undefined 统一兜底
        const name = item.germplasmName ?? item.germplasm_name ?? null;
        const accId = item.accessionId ?? item.accession_id ?? null;
        const qty = item.quantity ?? 0;
        const form = item.form ?? 'Glass Tube';
        if (!name) continue; // 无名称的空物品直接跳过
        run('INSERT INTO inventory (id, accession_id, room_id, germplasm_name, quantity, form, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))',
          [item.id || uuidv4(), accId, request.params.id, name, qty, form]);
        after.push({ name, accessionId: accId, qty, form });
      }
      writeAudit({
        table: 'inventory',
        recordId: request.params.id,
        action: 'INVENTORY_REPLACE',
        req: request,
        before: { roomId: request.params.id, count: before.length, items: before.slice(0, 200) },
        after: { roomId: request.params.id, count: after.length, items: after.slice(0, 200) },
      });
    }
    return { success: true };
  });

  fastify.delete('/api/rooms/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    // v2.19 P0：仍有库存（inventory.room_id）归属该房间 → 拦截，禁止静默销毁实物定位。
    const before = get('SELECT id, name FROM room WHERE id = ?', [request.params.id]);
    if (!before) return reply.status(404).send({ error: '房间不存在' });
    const res = guardedDelete('room', request.params.id);
    if (res.blocked) return reply.status(400).send({ error: 'FK_BLOCKED', message: '该房间仍有库存物品，无法删除', references: res.blocked });
    writeAudit({ table: 'room', recordId: before.id, action: 'ROOM_DELETE', req: request, before: { name: before.name } });
    return { success: true, changes: res.changes };
  });

  // Operators
  fastify.get('/api/operators', { preHandler: [authMiddleware] }, async (request, reply) => {
    return { operators: all('SELECT * FROM operator ORDER BY name ASC') };
  });

  fastify.post('/api/operators', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { name } = request.body;
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO operator (id, name) VALUES (?, ?)', [id, name]);
    return { success: true, id, name };
  });

  fastify.delete('/api/operators/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM operator WHERE id = ?', [request.params.id]);
    return { success: true };
  });

  // Media types
  fastify.get('/api/media-types', { preHandler: [authMiddleware] }, async (request, reply) => {
    return { mediaTypes: all('SELECT * FROM media_type ORDER BY name ASC') };
  });

  fastify.post('/api/media-types', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const { name } = request.body;
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run('INSERT INTO media_type (id, name) VALUES (?, ?)', [id, name]);
    return { success: true, id, name };
  });

  fastify.delete('/api/media-types/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    run('DELETE FROM media_type WHERE id = ?', [request.params.id]);
    return { success: true };
  });

  // Label templates
  fastify.get('/api/templates', { preHandler: [authMiddleware] }, async (request, reply) => {
    const templates = all('SELECT * FROM label_template ORDER BY name ASC');
    return {
      templates: templates.map(t => ({
        ...t,
        elements: t.elements_json ? JSON.parse(t.elements_json) : [],
        layout: t.layout_json ? JSON.parse(t.layout_json) : { mode: 'roll' }
      }))
    };
  });

  fastify.post('/api/templates', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id, name, width, height, elements, layout } = request.body;
    if (!id) {
      const { v4: uuidv4 } = await import('uuid');
      const newId = uuidv4();
      run('INSERT INTO label_template (id, name, width, height, elements_json, layout_json) VALUES (?, ?, ?, ?, ?, ?)',
        [newId, name, width || 50, height || 30, JSON.stringify(elements || []), JSON.stringify(layout || { mode: 'roll' })]);
      return { success: true, id: newId };
    } else {
      run('UPDATE label_template SET name = ?, width = ?, height = ?, elements_json = ?, layout_json = ? WHERE id = ?',
        [name, width, height, JSON.stringify(elements || []), JSON.stringify(layout || { mode: 'roll' }), id]);
      return { success: true, id };
    }
  });

  fastify.delete('/api/templates/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    run('DELETE FROM label_template WHERE id = ?', [request.params.id]);
    return { success: true };
  });

  // Code values
  fastify.get('/api/code-values', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { group } = request.query;
    let rows;
    if (group) {
      rows = all('SELECT * FROM code_value WHERE group_code = ? ORDER BY sort_order ASC', [group]);
    } else {
      rows = all('SELECT * FROM code_value ORDER BY group_code, sort_order ASC');
    }
    return { codeValues: rows };
  });

  // Dashboard stats
  fastify.get('/api/dashboard/stats', { preHandler: [authMiddleware] }, async (request, reply) => {
    const totalAccessions = get('SELECT COUNT(*) as c FROM accession');
    const totalRooms = get('SELECT COUNT(*) as c FROM room');
    const totalInventory = get('SELECT COALESCE(SUM(quantity), 0) as c FROM inventory');
    const recentEvents = all('SELECT * FROM subculture_event ORDER BY event_at DESC LIMIT 10');

    const potatoCount = get("SELECT COUNT(*) as c FROM accession WHERE species LIKE '%potato%' OR species LIKE '%solanum%' OR species LIKE '%马铃薯%'");
    const sweetPotatoCount = get("SELECT COUNT(*) as c FROM accession WHERE species LIKE '%sweet%' OR species LIKE '%ipomoea%' OR species LIKE '%甘薯%'");
    const unknownSpecies = Math.max(0, (totalAccessions?.c || 0) - (potatoCount?.c || 0) - (sweetPotatoCount?.c || 0));

    return {
      totalAccessions: totalAccessions?.c || 0,
      totalInventory: totalInventory?.c || 0,
      totalRooms: totalRooms?.c || 0,
      potatoCount: potatoCount?.c || 0,
      sweetPotatoCount: sweetPotatoCount?.c || 0,
      unknownSpecies,
      recentEvents: recentEvents || []
    };
  });

  // Backup
  fastify.post('/api/backup', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const backupDir = path.join(__dirname, '../../data/backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const filename = `brc-backup-${Date.now()}.db`;
    const backupPath = path.join(backupDir, filename);
    backupDb(backupPath);
    return { success: true, path: backupPath, filename };
  });

  // Export all data
  fastify.get('/api/export', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const data = {
      accessions: all('SELECT * FROM accession'),
      rooms: all('SELECT * FROM room'),
      inventory: all('SELECT * FROM inventory'),
      templates: all('SELECT * FROM label_template'),
      operators: all('SELECT * FROM operator'),
      mediaTypes: all('SELECT * FROM media_type'),
      settings: all('SELECT key, value FROM app_setting'),
      subcultureEvents: all('SELECT * FROM subculture_event'),
      exportedAt: new Date().toISOString()
    };
    return data;
  });
}
