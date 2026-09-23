import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, saveDb, backupDb } from './db/connection.js';
import { runMigrations } from './db/schema.js';
import { getSettingBool, getSettingInt } from './db/settings.js';
import authRoutes from './routes/auth.js';
import accessionRoutes from './routes/accessions.js';
import excelRoutes from './routes/excel.js';
import printRoutes from './routes/print.js';
import settingsRoutes from './routes/settings.js';
import traitRoutes from './routes/traits.js';
import queryRoutes from './routes/query.js';
import aiRoutes from './routes/ai.js';
import operationRoutes from './routes/operations.js';
import freezerRoutes from './routes/freezer.js';
import introRoutes from './routes/intro.js';
import distRoutes from './routes/dist.js';
import uploadRoutes from './routes/uploads.js';
import usersRoutes from './routes/users.js';
import messagesRoutes from './routes/messages.js';
import cryoRoutes from './routes/cryo.js';
import statsRoutes from './routes/stats.js';
import workOrderRoutes, { checkWorkOrderOverdue, checkWorkOrderStepReminder } from './routes/workorders.js';
import inspectionRoutes, { checkInspectionRenewal } from './routes/inspections.js';
import mySettingsRoutes from './routes/mySettings.js';
import dbAdminRoutes, { runIntegrityCheck } from './routes/dbadmin.js';
import mcpRoutes from './routes/mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.BRC_PORT || '7800');

// 自动备份：每 60s 检查一次开关与间隔，到期则备份并清理超期旧备份
function startAutoBackup() {
  let lastBackup = Date.now();
  setInterval(() => {
    try {
      if (!getSettingBool('backup.enabled', false)) return;
      const intervalHours = Math.max(1, getSettingInt('backup.interval_hours', 24));
      if (Date.now() - lastBackup < intervalHours * 3600000) return;
      lastBackup = Date.now();
      const backupDir = path.join(__dirname, '../data/backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const filename = `brc-backup-${Date.now()}.db`;
      backupDb(path.join(backupDir, filename));
      // 清理超过保留天数的旧备份
      const retentionDays = Math.max(1, getSettingInt('backup.retention_days', 30));
      const cutoff = Date.now() - retentionDays * 86400000;
      for (const f of fs.readdirSync(backupDir)) {
        if (!f.endsWith('.db')) continue;
        const mtime = fs.statSync(path.join(backupDir, f)).mtimeMs;
        if (mtime < cutoff) {
          try { fs.unlinkSync(path.join(backupDir, f)); } catch (e) { /* ignore */ }
        }
      }
      console.log(`[auto-backup] created ${filename}`);
    } catch (e) {
      console.error('[auto-backup] error:', e.message);
    }
  }, 60000);
}

async function main() {
  // Initialize database (node:sqlite 原生 SQLite，WAL 即时落盘)
  await initDb();
  // Run database migrations
  runMigrations();
  // 启动自检：完整性 + 孤儿记录（异常写入日志并附加到 /api/health 告警字段）
  let integrityWarnings = null;
  try {
    const check = runIntegrityCheck();
    if (!check.ok) {
      integrityWarnings = {
        integrity: check.integrity,
        orphans: check.orphans,
      };
      console.warn('[startup-check] 数据库完整性异常:', JSON.stringify(integrityWarnings));
    } else {
      console.log('[startup-check] 数据库完整性检查通过');
    }
  } catch (e) {
    integrityWarnings = { error: e.message };
    console.error('[startup-check] 完整性检查失败:', e.message);
  }
  // Start auto-backup checker (60s tick, configurable via backup.* settings)
  startAutoBackup();
  // 工单逾期扫描（60s tick，宽限天数 work.overdue_reminder_days）
  setInterval(() => {
    try { checkWorkOrderOverdue(); } catch (e) { console.error('[work-order-overdue] error:', e.message); }
  }, 60000);
  // 工单步骤链提醒扫描（60s tick，提前天数 work.step_reminder_lead_days）
  setInterval(() => {
    try { checkWorkOrderStepReminder(); } catch (e) { console.error('[work-order-step-reminder] error:', e.message); }
  }, 60000);
  // 巡检周期续接扫描（60s tick，闹钟式：完成一轮自动生成下一轮）
  setInterval(() => {
    try { checkInspectionRenewal(); } catch (e) { console.error('[inspection-renewal] error:', e.message); }
  }, 60000);

  const fastify = Fastify({
    logger: {
      level: 'info'
    }
  });

  // 全局错误处理器：统一 500 JSON（不泄露堆栈），服务不崩
  fastify.setErrorHandler((err, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      request.log.error({ err, url: request.url }, 'unhandled error');
    }
    const payload = { error: status >= 500 ? '服务器内部错误，请稍后重试' : (err.message || '请求错误') };
    if (status >= 500 && process.env.BRC_DEBUG) payload.detail = err.message;
    return reply.status(status).send(payload);
  });

  // CORS - allow all origins for LAN access
  await fastify.register(cors, {
    origin: true,
    credentials: true
  });

  // Multipart for file uploads（大小上限可配置：upload.max_mb）
  const maxMb = Math.max(1, getSettingInt('upload.max_mb', 30));
  await fastify.register(multipart, {
    limits: {
      fileSize: maxMb * 1024 * 1024
    }
  });

  // WebSocket for print agent communication
  await fastify.register(websocket);

  // WebSocket endpoint for print agents
  fastify.register(async function (fastify) {
    fastify.get('/ws/print-agent', { websocket: true }, (socket, req) => {
      fastify.printAgent = socket;

      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'register') {
            fastify.log.info(`Print agent registered: ${msg.printers?.join(', ') || 'unknown'}`);
            socket.printers = msg.printers || [];
          }
        } catch (e) {
          fastify.log.error('Invalid message from print agent');
        }
      });

      socket.on('close', () => {
        fastify.log.info('Print agent disconnected');
        fastify.printAgent = null;
      });
    });
  });

  // Register routes
  await fastify.register(authRoutes);
  await fastify.register(accessionRoutes);
  await fastify.register(excelRoutes);
  await fastify.register(printRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(traitRoutes);
  await fastify.register(queryRoutes);
  await fastify.register(mcpRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(operationRoutes);
  await fastify.register(freezerRoutes);
  await fastify.register(introRoutes);
  await fastify.register(distRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(messagesRoutes);
  await fastify.register(cryoRoutes);
  await fastify.register(statsRoutes);
  await fastify.register(workOrderRoutes);
  await fastify.register(inspectionRoutes);
  await fastify.register(mySettingsRoutes);
  await fastify.register(dbAdminRoutes);

  // Health check（附启动自检告警）
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      version: '2.18',
      timestamp: new Date().toISOString(),
      ...(integrityWarnings ? { warnings: { integrity: integrityWarnings } } : {}),
    };
  });

  // Serve uploaded files (MUST be registered before the client static wildcard below)
  const uploadsDir = path.join(__dirname, '../data/uploads');
  if (fs.existsSync(uploadsDir)) {
    await fastify.register(fastifyStatic, {
      root: uploadsDir,
      prefix: '/uploads/',
      decorateReply: false, // 避免与客户端静态注册重复添加 sendFile 装饰器
    });
  }

  // Serve static client files in production
  const clientDist = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    await fastify.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: true // 按请求实时读磁盘，客户端重新构建（哈希文件名变化）后无需重启服务器
    });
    // SPA fallback
    fastify.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api/') && !request.url.startsWith('/ws/')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'Not found' });
    });
  }

  // Start server
  try {
    const host = '0.0.0.0'; // Listen on all interfaces for LAN access
    await fastify.listen({ port: PORT, host });
    console.log(`\n========================================`);
    console.log(`  BRC Nexus v2 Server`);
    console.log(`  Local:    http://localhost:${PORT}`);
    console.log(`  LAN:      http://<your-ip>:${PORT}`);
    console.log(`  API Docs: http://localhost:${PORT}/api/health`);
    console.log(`========================================\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
