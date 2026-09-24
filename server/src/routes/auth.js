import { getDb, run, get, all, exec } from '../db/connection.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { loginIpCheck, loginIpHit, loginIpReset } from '../middleware/ipLimit.js';
import { getSettingBool, getSettingInt } from '../db/settings.js';

// 登录审计（受 auth.audit_login 门控；失败/锁定始终记录以保证锁定计数）
function logLogin(username, action, detail, ip, userId = null) {
  const audit = getSettingBool('auth.audit_login', true);
  if (!audit && (action === 'login' || action === 'logout')) return;
  run(
    'INSERT INTO login_log (id, user_id, username, action, ip, detail) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), userId, username, action, ip, detail || ''],
  );
}

function isLocked(username) {
  const lock = get("SELECT * FROM login_lock WHERE username = ? ORDER BY created_at DESC LIMIT 1", [username]);
  if (!lock || !lock.locked_until) return null;
  if (new Date(lock.locked_until).getTime() > Date.now()) return lock;
  return null;
}

export default async function authRoutes(fastify) {
  fastify.get('/api/auth/status', async (request, reply) => {
    const admin = get("SELECT id FROM user WHERE role = 'admin'");
    return { needsSetup: !admin, allowRegister: getSettingBool('auth.allow_register', true) };
  });

  fastify.post('/api/auth/setup', async (request, reply) => {
    const ip = request.ip || '';
    const gate = loginIpCheck(ip);
    if (!gate.allowed) {
      reply.header('Retry-After', String(gate.retryAfter));
      return reply.status(429).send({ error: '尝试过多，请稍后再试', retryAfter: gate.retryAfter });
    }
    const { username, password, displayName } = request.body;
    if (!username || !password) { loginIpHit(ip); return reply.status(400).send({ error: '用户名和密码不能为空' }); }
    if (password.length < 6) { loginIpHit(ip); return reply.status(400).send({ error: '密码至少6位' }); }

    const existing = get("SELECT id FROM user WHERE role = 'admin'");
    if (existing) return reply.status(400).send({ error: '管理员已存在，不能重复创建' });

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    run('INSERT INTO user (id, username, password_hash, role, display_name, user_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, username, hash, 'admin', displayName || username, 'operator', 'active']);
    loginIpReset(ip);
    const token = signToken({ id, username, role: 'admin', user_type: 'operator' });
    return { token, user: { id, username, role: 'admin', display_name: displayName || username, user_type: 'operator' } };
  });

  // 自助注册（可配置是否需要管理员审核）
  fastify.post('/api/auth/register', async (request, reply) => {
    if (!getSettingBool('auth.allow_register', true)) {
      return reply.status(403).send({ error: '当前未开放注册，请联系管理员创建账号' });
    }
    const { username, password, displayName, org, email } = request.body;
    if (!username || !password) return reply.status(400).send({ error: '用户名和密码不能为空' });
    if (password.length < 6) return reply.status(400).send({ error: '密码至少6位' });
    const exists = get('SELECT id FROM user WHERE username = ?', [username]);
    if (exists) return reply.status(400).send({ error: '用户名已存在' });

    const requiresApproval = getSettingBool('auth.register_requires_approval', true);
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    run(
      'INSERT INTO user (id, username, password_hash, role, display_name, user_type, status, org, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, username, hash, 'user', displayName || username, 'operator', requiresApproval ? 'pending' : 'active', org || '', email || ''],
    );
    if (requiresApproval) {
      return { success: true, pending: true, message: '注册成功，请等待管理员审核后登录' };
    }
    const token = signToken({ id, username, role: 'user', user_type: 'operator' });
    return { token, user: { id, username, role: 'user', display_name: displayName || username, user_type: 'operator' } };
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body;
    if (!username || !password) return reply.status(400).send({ error: '请输入用户名和密码' });
    const ip = request.ip || '';

    // v2.19 P0：IP 维度限流——堵住「同一 IP 换用户名撞库」（现有仅按用户名锁定）。
    const gate = loginIpCheck(ip);
    if (!gate.allowed) {
      logLogin(username, 'login_throttled', `IP 限流（窗口内 ${gate.count} 次失败尝试）`, ip);
      reply.header('Retry-After', String(gate.retryAfter));
      return reply.status(429).send({ error: '登录尝试过多，请稍后再试', retryAfter: gate.retryAfter });
    }

    const lock = isLocked(username);
    if (lock) {
      loginIpHit(ip);
      logLogin(username, 'locked', `账号锁定至 ${lock.locked_until}`, ip);
      return reply.status(423).send({ error: '账号已锁定，请稍后再试', lockedUntil: lock.locked_until });
    }

    const user = get('SELECT * FROM user WHERE username = ?', [username]);
    if (!user) {
      loginIpHit(ip);
      logLogin(username, 'login_failed', '用户不存在', ip);
      return reply.status(401).send({ error: '用户名或密码错误' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      loginIpHit(ip);
      logLogin(username, 'login_failed', '密码错误', ip, user.id);
      // 失败计数 → 锁定（注意 login_log.created_at 为 SQLite datetime 格式，窗口起点需同格式比较）
      const maxFailures = getSettingInt('auth.max_login_failures', 5);
      const lockoutMinutes = getSettingInt('auth.lockout_minutes', 30);
      const windowStart = new Date(Date.now() - lockoutMinutes * 60000).toISOString().replace('T', ' ').slice(0, 19);
      const fails = get(
        "SELECT COUNT(*) as c FROM login_log WHERE username = ? AND action IN ('login_failed','locked') AND created_at >= ?",
        [username, windowStart],
      );
      if ((fails?.c || 0) >= maxFailures) {
        const lockedUntil = new Date(Date.now() + lockoutMinutes * 60000).toISOString();
        run('INSERT INTO login_lock (id, username, locked_until, reason) VALUES (?, ?, ?, ?)',
          [uuidv4(), username, lockedUntil, `连续登录失败超过 ${maxFailures} 次`]);
        logLogin(username, 'locked', `连续失败自动锁定 ${lockoutMinutes} 分钟`, ip, user.id);
        return reply.status(423).send({ error: '登录失败次数过多，账号已锁定', lockedUntil });
      }
      return reply.status(401).send({ error: '用户名或密码错误' });
    }

    // 状态门：待审核 / 已停用
    if (user.status === 'pending') {
      logLogin(username, 'login_failed', '账号待管理员审核', ip, user.id);
      return reply.status(403).send({ error: '账号待管理员审核，请联系管理员' });
    }
    if (user.status === 'disabled') {
      logLogin(username, 'login_failed', '账号已停用', ip, user.id);
      return reply.status(403).send({ error: '账号已停用，请联系管理员' });
    }

    run("UPDATE user SET last_login_at = datetime('now') WHERE id = ?", [user.id]);
    loginIpReset(ip);
    logLogin(username, 'login', '登录成功', ip, user.id);
    const token = signToken(user);
    return {
      token,
      user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name, user_type: user.user_type || 'operator', org: user.org, status: user.status },
    };
  });

  // 登出（JWT 无状态，仅写审计日志）
  fastify.post('/api/auth/logout', { preHandler: [authMiddleware] }, async (request, reply) => {
    logLogin(request.user.username, 'logout', '主动登出', request.ip || '', request.user.id);
    return { success: true };
  });

  fastify.get('/api/auth/me', { preHandler: [authMiddleware] }, async (request, reply) => {
    // v2.8：实时查 DB 行（含 display_name/avatar），不再只回 JWT payload
    const row = get(
      'SELECT id, username, role, display_name, user_type, org, email, status, avatar FROM user WHERE id = ?',
      [request.user.id],
    );
    if (!row) return reply.status(401).send({ error: '用户不存在' });
    return { user: row };
  });

  // v2.8：个人资料（显示名 / 用户名 / 头像）——可改用户名并级联历史引用
  fastify.put('/api/my/profile', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { displayName, username, avatar } = request.body || {};
    const uid = request.user.id;

    const current = get('SELECT * FROM user WHERE id = ?', [uid]);
    if (!current) return reply.status(404).send({ error: '用户不存在' });

    const updates = [];
    const params = [];
    let newDisplayName = current.display_name;
    let newAvatar = current.avatar;

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 50) {
        return reply.status(400).send({ error: '显示名不能为空且不超过50字' });
      }
      newDisplayName = displayName.trim();
      updates.push('display_name = ?');
      params.push(newDisplayName);
    }

    if (avatar !== undefined) {
      if (avatar === null || avatar === '') {
        updates.push('avatar = NULL');
        newAvatar = null;
      } else if (
        typeof avatar === 'object' &&
        (avatar.type === 'emoji' || avatar.type === 'image') &&
        typeof avatar.value === 'string' &&
        avatar.value.length > 0 &&
        avatar.value.length <= 300000
      ) {
        const json = JSON.stringify(avatar);
        updates.push('avatar = ?');
        params.push(json);
        newAvatar = json;
      } else {
        return reply.status(400).send({ error: '头像格式不正确' });
      }
    }

    // 用户名修改：唯一性 + 级联历史引用
    const oldUsername = current.username;
    let newUsername = oldUsername;
    if (username !== undefined && username !== oldUsername) {
      if (typeof username !== 'string' || !/^[A-Za-z0-9_\-一-龥]{2,32}$/.test(username.trim())) {
        return reply.status(400).send({ error: '用户名需为2-32位字母/数字/下划线/连字符/中文' });
      }
      newUsername = username.trim();
      const dup = get('SELECT id FROM user WHERE username = ? AND id != ?', [newUsername, uid]);
      if (dup) return reply.status(400).send({ error: '用户名已存在' });
      updates.push('username = ?');
      params.push(newUsername);
    }

    if (updates.length > 0) {
      params.push(uid);
      run(`UPDATE user SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // 级联：同步功能引用的显示用户名（审计日志/登录日志保留历史原名，不可篡改）
    if (newUsername !== oldUsername) {
      run('UPDATE operation_record SET operator = ? WHERE operator = ?', [newUsername, oldUsername]);
      run('UPDATE freezer_movement SET operator = ? WHERE operator = ?', [newUsername, oldUsername]);
      run('UPDATE user SET approved_by = ? WHERE approved_by = ?', [newUsername, oldUsername]);
      run('UPDATE work_order_feedback SET username = ? WHERE username = ?', [newUsername, oldUsername]);
      run('UPDATE work_daily_report SET username = ? WHERE username = ?', [newUsername, oldUsername]);
      // audit_log / login_log 不级联（审计留痕原则）
    }

    // 审计
    run(
      'INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
      ['user', uid, 'PROFILE_UPDATE',
        JSON.stringify({ username: oldUsername, display_name: current.display_name, avatar: current.avatar }),
        JSON.stringify({ username: newUsername, display_name: newDisplayName, avatar: newAvatar }),
        uid, request.user.username],
    );

    const fresh = get(
      'SELECT id, username, role, display_name, user_type, org, email, status, avatar FROM user WHERE id = ?',
      [uid],
    );
    const token = signToken(fresh);
    return { token, user: fresh };
  });
}
