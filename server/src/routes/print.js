import { getDb, run, get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

export default async function printRoutes(fastify) {
  fastify.post('/api/print', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { items, templateId, printerName, operator, medium, copies, labelsHtml } = request.body;
    if (!items || items.length === 0) return reply.status(400).send({ error: '没有要打印的项目' });

    const { v4: uuidv4 } = await import('uuid');
    const jobId = uuidv4();
    run(`INSERT INTO print_job (id, status, template_id, items_json, printer_name, html, created_at) VALUES (?, 'pending', ?, ?, ?, ?, datetime('now'))`,
      [jobId, templateId || '', JSON.stringify(items), printerName || '', labelsHtml || '']);

    const insertEvent = run;
    for (const item of items) {
      run(`INSERT INTO subculture_event (id, scanned_id, operator, medium, copies, template_id, user_id, event_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uuidv4(), item.primaryId || item.id || 'unknown', operator || '', medium || '', copies || 1, templateId || '', request.user?.id || '']);
    }

    if (fastify.printAgent) {
      fastify.printAgent.send(JSON.stringify({
        type: 'print', jobId, items, templateId, printerName, operator, medium, copies: copies || 1, labelsHtml: labelsHtml || ''
      }));
    }

    return { success: true, jobId, message: '打印任务已提交' };
  });

  fastify.get('/api/print/status/:jobId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const job = get('SELECT * FROM print_job WHERE id = ?', [request.params.jobId]);
    if (!job) return reply.status(404).send({ error: '打印任务未找到' });
    return job;
  });

  fastify.get('/api/print/queue', { preHandler: [authMiddleware] }, async (request, reply) => {
    const jobs = all("SELECT * FROM print_job WHERE status = 'pending' ORDER BY created_at ASC");
    return { jobs };
  });

  fastify.post('/api/print/update', async (request, reply) => {
    const { jobId, status, error } = request.body;
    if (!jobId) return reply.status(400).send({ error: '缺少 jobId' });

    if (status === 'completed') {
      run("UPDATE print_job SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [jobId]);
    } else if (status === 'error') {
      run("UPDATE print_job SET status = 'error', error = ?, completed_at = datetime('now') WHERE id = ?", [error || 'Unknown error', jobId]);
    }
    return { success: true };
  });

  fastify.get('/api/subculture-events', { preHandler: [authMiddleware] }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 20, 100);
    const events = all('SELECT * FROM subculture_event ORDER BY event_at DESC LIMIT ?', [limit]);
    return { events };
  });
}
