import { get, all, run } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { getSettingInt } from '../db/settings.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../data/uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export default async function uploadRoutes(fastify) {
  // 上传附件（文件存 data/uploads/，元数据存 upload_file 表）
  fastify.post('/api/uploads', { preHandler: [authMiddleware] }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: '请选择文件' });
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    const ext = path.extname(data.filename || '');
    const storedName = id + ext;
    const buffer = await data.toBuffer();
    const maxMb = Math.max(1, getSettingInt('upload.max_mb', 30));
    if (buffer.length > maxMb * 1024 * 1024) return reply.status(400).send({ error: `文件过大（>${maxMb}MB）` });
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
    const refTable = request.query.refTable || '';
    const refId = request.query.refId || '';
    run('INSERT INTO upload_file (id, original_name, stored_name, mime, size, uploaded_by, ref_table, ref_id) VALUES (?,?,?,?,?,?,?,?)',
      [id, data.filename, storedName, data.mimetype || '', buffer.length, request.user?.username || '', refTable, refId]);
    return { success: true, file: { id, originalName: data.filename, storedName, mime: data.mimetype, size: buffer.length, refTable, refId, uploadedBy: request.user?.username || '' } };
  });

  fastify.get('/api/uploads', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { refTable, refId } = request.query;
    let rows;
    if (refTable) {
      rows = all('SELECT * FROM upload_file WHERE ref_table = ? AND ref_id = ? ORDER BY created_at DESC', [refTable, refId]);
    } else {
      rows = all('SELECT * FROM upload_file ORDER BY created_at DESC LIMIT 200');
    }
    return {
      files: rows.map(r => ({
        id: r.id,
        originalName: r.original_name,
        storedName: r.stored_name,
        mime: r.mime,
        size: r.size,
        uploadedBy: r.uploaded_by,
        refTable: r.ref_table,
        refId: r.ref_id,
        createdAt: r.created_at,
      })),
    };
  });

  fastify.delete('/api/uploads/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const row = get('SELECT * FROM upload_file WHERE id = ?', [request.params.id]);
    if (!row) return reply.status(404).send({ error: '未找到文件' });
    if (request.user.role !== 'admin' && row.uploaded_by !== request.user.username) {
      return reply.status(403).send({ error: '无权删除该文件' });
    }
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.stored_name)); } catch (e) { /* ignore */ }
    run('DELETE FROM upload_file WHERE id = ?', [request.params.id]);
    return { success: true };
  });
}
