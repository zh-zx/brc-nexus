// v2.19 P0 后端集成测试（Verify-1）：node:test + fastify.inject，不引重型依赖。
// 覆盖计划 W1-W3 的验证契约：
//   默认密钥守卫；删用户后其 JWT/孤儿 ai_token 认证失败；禁用/待审核用户被 authMiddleware 拒；
//   登录 IP 限流 429；room/accession 有实物 BLOCK、空可删；删工单级联清从属；打印写审计；
//   /api/audit-log 可取回且仅 admin；孤儿口径 enabled=1 悬空令牌 + 撤销后 orphans:[] / integrity ok。
//
// 运行：cd server && node --test test/p0.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 环境必须在任何引用 connection.js 的模块 import 之前设置 ----
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brc-p0-'));
process.env.BRC_DB_PATH = path.join(tmpDir, 'brc.db');
process.env.BRC_LOG_LEVEL = 'silent';
process.env.BRC_PORT = '0';

const { initDb, run, get, all, closeDb } = await import('../src/db/connection.js');
const { runMigrations } = await import('../src/db/schema.js');
const { scanOrphans } = await import('../src/db/refs.js');
const { clearSettingsCache } = await import('../src/db/settings.js');
const { signToken, verifyToken } = await import('../src/middleware/auth.js');
const { loginIpReset } = await import('../src/middleware/ipLimit.js');
const { buildApp } = await import('../src/index.js');

const DEFAULT_SECRET = 'brc-helper-v2-secret-key-change-in-production';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

let app;
let adminToken;

const bearer = (t) => ({ authorization: `Bearer ${t}` });
const adminHeaders = () => ({ 'content-type': 'application/json', authorization: `Bearer ${adminToken}` });

before(async () => {
  initDb();
  runMigrations();
  // 收紧登录限流以便 IP 测试（必须发生在首个 loginIpCheck 构建限速器之前）
  run("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('auth.login_ip_max', '2')");
  run("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('auth.login_ip_window_min', '30')");
  clearSettingsCache();
  app = await buildApp({});
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'admin', password: 'admin123', displayName: 'Admin' },
  });
  assert.equal(res.statusCode, 200, `管理员初始化失败: ${res.body}`);
  adminToken = res.json().token;
});

after(() => {
  try { if (app) app.close(); } catch { /* ignore */ }
  try { closeDb(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------- W1 安全 ----------

test('W1-1 默认 JWT 密钥守卫：伪造默认密钥令牌无法校验，.jwt-secret 非默认', async () => {
  const secretFile = path.join(__dirname, '../data/.jwt-secret');
  const saved = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : '';
  assert.ok(saved.length > 0, '.jwt-secret 应已生成');
  assert.notEqual(saved, DEFAULT_SECRET, '.jwt-secret 不应等于硬编码默认值');

  const { default: jwt } = await import('jsonwebtoken');
  const forged = jwt.sign({ id: 'x', username: 'u', role: 'admin' }, DEFAULT_SECRET, { expiresIn: '1h' });
  assert.equal(verifyToken(forged), null, '用默认密钥伪造的令牌必须校验失败');

  // 子进程：env JWT_SECRET==默认值时也必须忽略（模块独立解析，证明不是巧合）
  const probe = `
    import jwt from 'jsonwebtoken';
    import { verifyToken } from '${pathToFileURL(path.join(__dirname, '../src/middleware/auth.js')).href}';
    const forged = jwt.sign({ id: 'x', username: 'u', role: 'admin' }, process.env.JWT_SECRET);
    process.stdout.write(String(verifyToken(forged) === null));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, JWT_SECRET: DEFAULT_SECRET },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `子进程失败: ${r.stderr}`);
  assert.equal(r.stdout.trim(), 'true', 'JWT_SECRET 显式设为默认值时应忽略并用随机密钥');
});

test('W1-2 删用户：其 JWT 立即失效（authMiddleware 回查主键）', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/users', headers: adminHeaders(), payload: { username: 'bob', password: 'bob12345', role: 'user' } });
  assert.equal(created.statusCode, 200, created.body);
  const bobId = created.json().id;
  const bobToken = signToken({ id: bobId, username: 'bob', role: 'user', user_type: 'operator' });

  const me1 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(bobToken) });
  assert.equal(me1.statusCode, 200, '删除前 JWT 应可用');

  const del = await app.inject({ method: 'DELETE', url: `/api/users/${bobId}`, headers: adminHeaders() });
  assert.equal(del.statusCode, 200, del.body);

  const me2 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(bobToken) });
  assert.equal(me2.statusCode, 401, '已删用户的 JWT 必须被拒');
});

test('W1-2 删用户：其 AI 令牌被级联撤销（enabled=0）且立即认证失败', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/users', headers: adminHeaders(), payload: { username: 'carol', password: 'carol12345', role: 'user' } });
  assert.equal(created.statusCode, 200, created.body);
  const carolId = created.json().id;
  run("INSERT INTO ai_token (id, token_hash, name, role, enabled, created_by) VALUES (?,?,?,?,1,?)",
    [crypto.randomUUID(), sha256('carol-token'), 'carol-tok', 'operator', 'carol']);

  const ok1 = await app.inject({ method: 'GET', url: '/api/ai/tools', headers: bearer('carol-token') });
  assert.equal(ok1.statusCode, 200, '删除前令牌应可用');

  const del = await app.inject({ method: 'DELETE', url: `/api/users/${carolId}`, headers: adminHeaders() });
  assert.equal(del.statusCode, 200, del.body);

  const row = get("SELECT enabled FROM ai_token WHERE created_by='carol'");
  assert.equal(row?.enabled, 0, '删除用户时应撤销其令牌（保留台账不物理删）');

  const ok2 = await app.inject({ method: 'GET', url: '/api/ai/tools', headers: bearer('carol-token') });
  assert.equal(ok2.statusCode, 401, '撤销后的令牌必须认证失败');
});

test('W1-1 authMiddleware 回查：禁用/待审核用户 JWT 被拒', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/users', headers: adminHeaders(), payload: { username: 'dave', password: 'dave12345', role: 'user' } });
  assert.equal(created.statusCode, 200, created.body);
  const daveId = created.json().id;
  const daveToken = signToken({ id: daveId, username: 'dave', role: 'user', user_type: 'operator' });

  const me1 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(daveToken) });
  assert.equal(me1.statusCode, 200);

  const dis = await app.inject({ method: 'PUT', url: `/api/users/${daveId}`, headers: adminHeaders(), payload: { status: 'disabled' } });
  assert.equal(dis.statusCode, 200, dis.body);
  const me2 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(daveToken) });
  assert.equal(me2.statusCode, 401, '禁用用户的 JWT 必须被拒');

  // 待审核（注册需审核，status=pending）
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'erin', password: 'erin12345' } });
  assert.equal(reg.statusCode, 200, reg.body);
  assert.equal(reg.json().pending, true);
  const erinId = get("SELECT id FROM user WHERE username='erin'").id;
  const erinToken = signToken({ id: erinId, username: 'erin', role: 'user', user_type: 'operator' });
  const me3 = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(erinToken) });
  assert.equal(me3.statusCode, 401, '待审核用户的 JWT 必须被拒');
});

test('W1-4 登录 IP 限流：超过 auth.login_ip_max 后返回 429 与 Retry-After', async () => {
  const doLogin = (u, p) => app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: { username: u, password: p } });
  const r1 = await doLogin('nobody', 'wrong1');
  const r2 = await doLogin('nobody', 'wrong2');
  assert.equal(r1.statusCode, 401);
  assert.equal(r2.statusCode, 401);
  const r3 = await doLogin('admin', 'admin123'); // 正确凭据也被限流（维止同 IP 撞库）
  assert.equal(r3.statusCode, 429, '超过失败上限应触发 IP 维度限流');
  assert.ok(r3.headers['retry-after'], '应返回 Retry-After');
  loginIpReset('127.0.0.1'); // 复位，避免影响后续用例
});

// ---------- W2 数据完整性（应用层级联/拦截） ----------

test('W2 级联：有库存 room 删除被 BLOCK，空 room 可删', async () => {
  const roomA = (await app.inject({ method: 'POST', url: '/api/rooms', headers: adminHeaders(), payload: { name: 'Room-A' } })).json().id;
  run("INSERT INTO inventory (id, accession_id, room_id, germplasm_name, quantity, form, updated_at) VALUES (?, NULL, ?, ?, 10, 'Glass Tube', datetime('now'))",
    [crypto.randomUUID(), roomA, 'CIP-001-Test']);
  const delA = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomA}`, headers: adminHeaders() });
  assert.equal(delA.statusCode, 400, '有库存的房间删除必须被拦截');
  assert.match(delA.body, /FK_BLOCKED/);

  const roomB = (await app.inject({ method: 'POST', url: '/api/rooms', headers: adminHeaders(), payload: { name: 'Room-B' } })).json().id;
  const delB = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomB}`, headers: adminHeaders() });
  assert.equal(delB.statusCode, 200, delB.body);
  assert.equal(get('SELECT COUNT(*) AS c FROM room WHERE id = ?', [roomB]).c, 0, '空房间应删除成功');
});

test('W2 级联：有库存/冻存样本 accession 删除被 BLOCK，空 accession 可删', async () => {
  run("INSERT INTO accession (id, data_json, primary_id, display_name, species, origin, created_at) VALUES ('acc-block', '{}', 'P-BLOCK', 'Block Me', 'Solanum', 'IP', datetime('now'))");
  run("INSERT INTO room (id, name) VALUES ('room-acc', 'RoomAcc')");
  run("INSERT INTO inventory (id, accession_id, room_id, germplasm_name, quantity, form, updated_at) VALUES ('inv-block', 'acc-block', 'room-acc', 'P-BLOCK', 5, 'Glass Tube', datetime('now'))");
  const d1 = await app.inject({ method: 'DELETE', url: '/api/accessions/acc-block', headers: adminHeaders() });
  assert.equal(d1.statusCode, 400, '有库存归属的种质删除必须被拦截');
  assert.match(d1.body, /FK_BLOCKED/);

  run("INSERT INTO accession (id, data_json, primary_id, display_name, created_at) VALUES ('acc-free', '{}', 'P-FREE', 'Free', datetime('now'))");
  const d2 = await app.inject({ method: 'DELETE', url: '/api/accessions/acc-free', headers: adminHeaders() });
  assert.equal(d2.statusCode, 200, d2.body);
  assert.equal(get("SELECT COUNT(*) AS c FROM accession WHERE id='acc-free'").c, 0, '无子引用的种质应删除成功');
});

test('W2 级联：删工单原子清从属明细（feedback/report/assignee）', async () => {
  run("INSERT INTO work_order (id, wo_no, title, status, created_at, updated_at) VALUES ('wo-1', 'WO-1', '测试工单', 'pending', datetime('now'), datetime('now'))");
  run("INSERT INTO work_order_feedback (id, work_order_id, username, kind, created_at) VALUES ('wfb-1', 'wo-1', 'carol', 'progress', datetime('now'))");
  run("INSERT INTO work_daily_report (id, work_order_id, step_code, report_date, username, created_at, updated_at) VALUES ('wdr-1', 'wo-1', 'inoculation', '2026-09-24', 'carol', datetime('now'), datetime('now'))");
  run("INSERT INTO work_order_assignee (id, work_order_id, user_id) VALUES ('woa-1', 'wo-1', 'some-user')");

  const d = await app.inject({ method: 'DELETE', url: '/api/workorders/wo-1', headers: adminHeaders() });
  assert.equal(d.statusCode, 200, d.body);
  for (const t of ['work_order_feedback', 'work_daily_report', 'work_order_assignee', 'work_order']) {
    const c = get(`SELECT COUNT(*) AS c FROM ${t} WHERE id = 'wo-1' OR (id = 'wfb-1' AND '${t}' = 'work_order_feedback') OR (id = 'wdr-1' AND '${t}' = 'work_daily_report') OR (id = 'woa-1' AND '${t}' = 'work_order_assignee')`, []).c;
    assert.equal(c, 0, `${t} 应在删工单时被清空`);
  }
});

// ---------- W3 审计可见 ----------

test('W3 打印审计接通：POST /api/print 写 audit_log，GET /api/audit-log 可取回（含涉及种质）', async () => {
  const before = get("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'PRINT'").c || 0;
  const pr = await app.inject({
    method: 'POST', url: '/api/print', headers: adminHeaders(),
    payload: { items: [{ primaryId: 'P-001' }, { id: 'P-002' }], templateId: 'tpl-1', printerName: 'LCP-3000', operator: 'admin', medium: 'paper', copies: 2 },
  });
  assert.equal(pr.statusCode, 200, pr.body);
  const after = get("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'PRINT'").c;
  assert.equal(after, before + 1, '打印必须写审计');

  const auditRes = await app.inject({ method: 'GET', url: '/api/audit-log?action=PRINT&pageSize=5', headers: adminHeaders() });
  assert.equal(auditRes.statusCode, 200, auditRes.body);
  const body = auditRes.json();
  assert.ok(body.total >= 1, '审计台账应含 PRINT 记录');
  const found = body.logs.find(l => l.action === 'PRINT');
  assert.ok(found, '应有 PRINT 记录');
  const parsed = JSON.parse(found.after_json);
  assert.equal(parsed.printerName, 'LCP-3000');
  assert.deepEqual(parsed.accessions, ['P-001', 'P-002'], '打印审计应含涉及种质');
  assert.ok(body.facets.tables.includes('print_job'), 'facets 应含 print_job');
});

test('W3 /api/audit-log 仅 admin：普通用户 403', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/users', headers: adminHeaders(), payload: { username: 'frank', password: 'frank12345', role: 'user' } });
  assert.equal(created.statusCode, 200, created.body);
  const frankId = created.json().id;
  const frankToken = signToken({ id: frankId, username: 'frank', role: 'user', user_type: 'operator' });
  const r = await app.inject({ method: 'GET', url: '/api/audit-log', headers: bearer(frankToken) });
  assert.equal(r.statusCode, 403, '非 admin 访问审计台账应被禁止');
});

// ---------- W2-8 孤儿口径 + 完整性 ----------

test('W2-8 孤儿：enabled=1 悬空令牌算孤儿；对账撤销后 orphans:[] 且 integrity ok', async () => {
  // 活跃越权形态：指向不存在用户的启用令牌（owner 校验拒绝 + 孤儿扫描报告）
  run("INSERT INTO ai_token (id, token_hash, name, role, enabled, created_by) VALUES (?,?,?,?,1,?)",
    [crypto.randomUUID(), sha256('ghost-token'), 'ghost', 'admin', 'ghost-user']);
  const gt = await app.inject({ method: 'GET', url: '/api/ai/tools', headers: bearer('ghost-token') });
  assert.equal(gt.statusCode, 401, '属主已删除的启用令牌即使未撤销也必须失效');

  const orphans = scanOrphans();
  const ghost = orphans.find(o => o.child === 'ai_token' && o.col === 'created_by');
  assert.ok(ghost, '应报出幽灵令牌孤儿');
  assert.ok(ghost.count >= 1);

  // 对账动作（reconcile-orphans 的 revoke 策略）：撤销而非物理删除
  run("UPDATE ai_token SET enabled = 0 WHERE created_by = 'ghost-user'");
  assert.deepEqual(scanOrphans(), [], '撤销后孤儿应清空（orphanScope enabled=1 生效）');

  const integ = await app.inject({ method: 'GET', url: '/api/dbadmin/integrity', headers: adminHeaders() });
  assert.equal(integ.statusCode, 200, integ.body);
  const ib = integ.json();
  assert.equal(ib.ok, true, `完整性应通过: ${JSON.stringify(ib)}`);
  assert.deepEqual(ib.orphans, []);

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  const hb = health.json();
  assert.equal(hb.status, 'ok');
  assert.ok(!hb.warnings || !hb.warnings.integrity, '健康端点不应有完整性告警');
});

// ---------- Excel 导入契约（v2.19 修复：upload 必须回传完整 rows，否则前端 IMPORT 静默无效） ----------

test('Excel 契约：/api/excel/upload 回传完整 rows；/api/excel/import 入库且 skip 模式幂等', async () => {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { cccapNo: 'T-E2E-1', name: '契约测试品种1', species: 'S. tuberosum', origin: 'Peru' },
    { cccapNo: 'T-E2E-2', name: '契约测试品种2', species: 'S. tuberosum', origin: 'Kenya' },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const xbuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const boundary = '----brc' + crypto.randomBytes(8).toString('hex');
  const mp = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    xbuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await app.inject({
    method: 'POST', url: '/api/excel/upload',
    headers: { ...bearer(adminToken), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: mp,
  });
  assert.equal(up.statusCode, 200, up.body);
  const upBody = up.json();
  assert.equal(upBody.totalRows, 2);
  assert.ok(Array.isArray(upBody.rows) && upBody.rows.length === upBody.totalRows,
    'upload 响应必须含完整 rows（前端 excelRows 依赖它，缺失则 IMPORT 静默无效）');
  assert.equal(upBody.detected.id, 'cccapNo');

  const imp = await app.inject({
    method: 'POST', url: '/api/excel/import', headers: adminHeaders(),
    payload: { rows: upBody.rows, mapping: upBody.detected, mode: 'skip' },
  });
  assert.equal(imp.statusCode, 200, imp.body);
  assert.equal(imp.json().inserted, 2);

  // 幂等：同数据再导一次，skip 模式应全部跳过
  const imp2 = await app.inject({
    method: 'POST', url: '/api/excel/import', headers: adminHeaders(),
    payload: { rows: upBody.rows, mapping: upBody.detected, mode: 'skip' },
  });
  assert.equal(imp2.statusCode, 200, imp2.body);
  assert.equal(imp2.json().skipped, 2);

  const inDb = get("SELECT COUNT(*) AS c FROM accession WHERE primary_id IN ('T-E2E-1','T-E2E-2')").c;
  assert.equal(inDb, 2, '两条契约测试种质应入库（按 primary_id 查，导入新行的 id 应是 UUID）');
  const one = get("SELECT id FROM accession WHERE primary_id = 'T-E2E-1'");
  assert.match(one.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    '导入新建行的 id 应是 UUID，与界面建行约定一致');
});

// ---------- Excel 去重根因（v2.19 修复：导入必须按 primary_id 匹配，而不是把编号当内部 id） ----------
// 2026-11-27 实测：老版导入把编号直接写进 id 列，而界面建的行 id 是 UUID、编号在 primary_id，
// 两边撞不上 → 同一编号导入后出现两行（当时库里 12 对重复）。

test('Excel 去重：导入按 primary_id 匹配界面建的行，同编号更新原行不复制', async () => {
  // 1) 用界面同款接口先建一行（id=UUID、primary_id=T-DUP-1）
  const created = await app.inject({
    method: 'POST', url: '/api/accessions', headers: adminHeaders(),
    payload: { primaryId: 'T-DUP-1', displayName: '界面建的品种', species: 'S. tuberosum', origin: 'Peru' },
  });
  assert.equal(created.statusCode, 200, created.body);
  const uiId = created.json()._id;
  assert.match(uiId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    '界面建的行 id 应是 UUID');

  // 2) replace 模式导入：同编号改名 + 一个全新编号
  const imp = await app.inject({
    method: 'POST', url: '/api/excel/import', headers: adminHeaders(),
    payload: {
      rows: [
        { cccapNo: 'T-DUP-1', name: '改名后的品种', species: 'S. tuberosum', origin: 'Peru' },
        { cccapNo: 'T-DUP-2', name: '全新品种', species: 'S. tuberosum', origin: 'Kenya' },
      ],
      mapping: { id: 'cccapNo', name: 'name', species: 'species', origin: 'origin' },
      mode: 'replace',
    },
  });
  assert.equal(imp.statusCode, 200, imp.body);
  const r = imp.json();
  assert.equal(r.updated, 1, '同编号应计为更新');
  assert.equal(r.inserted, 1, '新编号应计为新增');

  // 3) 不产生重复：两个编号共 2 行；界面那行的 id 不变、字段被更新
  const n = get("SELECT COUNT(*) AS c FROM accession WHERE primary_id IN ('T-DUP-1','T-DUP-2')").c;
  assert.equal(n, 2, '按编号去重后应只有 2 行，不应复制出第 3 行');
  const kept = get("SELECT id, display_name FROM accession WHERE primary_id = 'T-DUP-1'");
  assert.equal(kept.id, uiId, '导入应更新界面建的原行（id 不变），而不是新建一行');
  assert.equal(kept.display_name, '改名后的品种');

  // 4) skip 模式对界面建的行同样按编号生效
  const sk = await app.inject({
    method: 'POST', url: '/api/excel/import', headers: adminHeaders(),
    payload: {
      rows: [{ cccapNo: 'T-DUP-1', name: 'x' }],
      mapping: { id: 'cccapNo', name: 'name' },
      mode: 'skip',
    },
  });
  assert.equal(sk.statusCode, 200, sk.body);
  assert.equal(sk.json().skipped, 1, '同编号在 skip 模式下应被跳过');
});