import { getDb, run, get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { parseExcel, detectColumns, importExcel } from '../services/excel-import.js';

export default async function excelRoutes(fastify) {
  fastify.post('/api/excel/upload', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    try {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: '请上传文件' });

      const buffer = await data.toBuffer();
      const rows = parseExcel(buffer);
      if (rows.length === 0) return reply.status(400).send({ error: 'Excel 中没有数据' });

      const headers = Object.keys(rows[0]);
      const detected = detectColumns(headers);
      // rows 必须整包回传：前端 excelRows 依赖它提交 /api/excel/import，缺了会导致 IMPORT 静默无效
      return { totalRows: rows.length, headers, preview: rows.slice(0, 5), detected, rows };
    } catch (err) {
      return reply.status(400).send({ error: '解析 Excel 失败：' + err.message });
    }
  });

  fastify.post('/api/excel/import', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    try {
      const { rows, mapping, mode } = request.body;
      if (!rows || !Array.isArray(rows) || rows.length === 0) return reply.status(400).send({ error: '没有数据可导入' });
      const results = importExcel(rows, mapping, mode || 'replace', request.user?.username);
      return { success: true, ...results, totalRows: rows.length };
    } catch (err) {
      return reply.status(500).send({ error: '导入失败：' + err.message });
    }
  });

  fastify.get('/api/excel/uploads', { preHandler: [authMiddleware] }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: '需要管理员权限' });
    const uploads = all('SELECT id, filename, uploaded_at, uploaded_by, row_count, import_mode FROM excel_upload ORDER BY uploaded_at DESC LIMIT 20');
    return { uploads };
  });
}
