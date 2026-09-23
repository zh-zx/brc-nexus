import { all, get } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

// 统计报表（引进/分发/操作/超低温），按时间范围过滤
export default async function statsRoutes(fastify) {
  fastify.get('/api/stats/overview', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { from, to } = request.query;
    const conds = [];
    const params = [];
    if (from) { conds.push('created_at >= ?'); params.push(from); }
    if (to) { conds.push('created_at <= ?'); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // 引进统计
    const introByStatus = all(`SELECT status, COUNT(*) as c FROM intro_request ${where} GROUP BY status`, params);
    const introByType = all(`SELECT resource_type, COUNT(*) as c FROM intro_request ${where} GROUP BY resource_type ORDER BY c DESC LIMIT 15`, params);
    const introTotal = introByStatus.reduce((s, x) => s + x.c, 0);
    const introApproved = introByStatus.find(x => x.status === 'approved')?.c || 0;
    const introRejected = introByStatus.find(x => x.status === 'rejected')?.c || 0;
    const introMonthly = all(
      `SELECT strftime('%Y-%m', created_at) as ym, COUNT(*) as c FROM intro_request ${where} GROUP BY ym ORDER BY ym`,
      params,
    );

    // 分发统计
    const distByStatus = all(`SELECT status, COUNT(*) as c FROM dist_request ${where} GROUP BY status`, params);
    const distTotal = distByStatus.reduce((s, x) => s + x.c, 0);
    const distAvgDuration = get(`SELECT AVG(duration_days) as a FROM dist_request WHERE duration_days IS NOT NULL ${conds.length ? 'AND ' + conds.join(' AND ') : ''}`, params);
    const distMonthly = all(`SELECT strftime('%Y-%m', created_at) as ym, COUNT(*) as c FROM dist_request ${where} GROUP BY ym ORDER BY ym`, params);

    // 操作记录：按人员 / 按步骤 / 超时率
    const opsCond = [];
    const opsParams = [];
    if (from) { opsCond.push('event_at >= ?'); opsParams.push(from); }
    if (to) { opsCond.push('event_at <= ?'); opsParams.push(to); }
    const opsWhere = opsCond.length ? `WHERE ${opsCond.join(' AND ')}` : '';
    const opsByOperator = all(`SELECT operator, COUNT(*) as c FROM operation_record ${opsWhere} GROUP BY operator ORDER BY c DESC`, opsParams);
    const opsByStep = all(`SELECT step_code, COUNT(*) as c FROM operation_record ${opsWhere} GROUP BY step_code ORDER BY c DESC`, opsParams);
    const opsTotal = opsByStep.reduce((s, x) => s + x.c, 0);
    const overdue = get('SELECT COUNT(*) as c FROM operation_record')?.c || 0; // 占位：超时率由客户端调 /api/operations/overdue 计算

    // 超低温：按操作类型
    const cryoCond = [];
    const cryoParams = [];
    if (from) { cryoCond.push('occurred_at >= ?'); cryoParams.push(from); }
    if (to) { cryoCond.push('occurred_at <= ?'); cryoParams.push(to); }
    const cryoWhere = cryoCond.length ? `WHERE ${cryoCond.join(' AND ')}` : '';
    const cryoByType = all(`SELECT event_type, COUNT(*) as c FROM cryo_record ${cryoWhere} GROUP BY event_type ORDER BY c DESC`, cryoParams);
    const cryoTotal = cryoByType.reduce((s, x) => s + x.c, 0);
    const cryoMonthly = all(`SELECT strftime('%Y-%m', occurred_at) as ym, COUNT(*) as c FROM cryo_record ${cryoWhere} GROUP BY ym ORDER BY ym`, cryoParams);

    return {
      intro: {
        total: introTotal, approved: introApproved, rejected: introRejected,
        successRate: introTotal ? Math.round((introApproved / introTotal) * 1000) / 10 : 0,
        byStatus: introByStatus, byType: introByType, monthly: introMonthly,
      },
      dist: {
        total: distTotal, byStatus: distByStatus, monthly: distMonthly,
        avgDurationDays: distAvgDuration?.a ? Math.round(distAvgDuration.a * 10) / 10 : null,
      },
      ops: {
        total: opsTotal, byOperator: opsByOperator, byStep: opsByStep,
      },
      cryo: {
        total: cryoTotal, byType: cryoByType, monthly: cryoMonthly,
      },
    };
  });
}
