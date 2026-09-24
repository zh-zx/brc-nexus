import { getDb, run, get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { getSetting } from '../db/settings.js';
import { writeAudit } from '../lib/audit.js';
import crypto from 'crypto';

// v2.19 P0 安全：打印代理通道鉴权。/api/print/update 与 /ws/print-agent 是代理专用通道，
// 未鉴权时任意 LAN 主机都能把打印任务翻成 completed、或抢先冒充代理截获标签内容。
// 共享密钥 print.agent_token（admin 在设置里配置）：配置后强制校验；未配置则放行但告警
// （单位内网 fail-open，避免无令牌客户端直接失效——部署投产前应设置该令牌）。
let warnedUnsecured = false;
export function checkPrintAgentToken(token) {
  const expected = getSetting('print.agent_token', '');
  if (!expected) {
    if (!warnedUnsecured) {
      warnedUnsecured = true;
      console.warn('[print] 未配置 print.agent_token，打印代理通道无鉴权（内网可临时运行，投产前请在设置中配置令牌）。');
    }
    return { ok: true, unsecured: true };
  }
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(expected);
  return { ok: a.length === b.length && crypto.timingSafeEqual(a, b) };
}

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

    // v2.19 P0 审计（接通立项痛点）：谁在何时用哪台打印机打了哪些种质的签。
    writeAudit({
      table: 'print_job',
      recordId: jobId,
      action: 'PRINT',
      req: request,
      after: {
        printerName: printerName || '',
        templateId: templateId || '',
        medium: medium || '',
        copies: copies || 1,
        operator: operator || '',
        count: items.length,
        accessions: items.map(i => i.primaryId || i.id || 'unknown').slice(0, 200),
      },
    });

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
    // 打印代理回调鉴权（见文件头 checkPrintAgentToken）
    const header = String(request.headers.authorization || '');
    const tok = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!checkPrintAgentToken(tok).ok) {
      return reply.status(401).send({ error: '打印代理未授权' });
    }
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
