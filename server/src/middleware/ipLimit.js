// v2.19 P0 安全：轻量内存限速（无第三方依赖）。按 IP 滑动窗口计数，用于登录爆破防护。
// 现有 auth.js 仅按「用户名」锁定，跨用户名的分布式爆破（同 IP 换用户名撞库）不受限。
// 这里补 IP 维度。单位内网 + 单进程足够；进程重启即清空（可接受）。
// 语义：只对「失败/尝试」计数，成功登录清零——正常用户不会被误伤。
import { getSettingInt } from '../db/settings.js';

export function createSlidingLimiter({ max, windowMs }) {
  const hits = new Map(); // key -> number[]（命中时间戳）
  function prune(key, now) {
    const arr = hits.get(key);
    if (!arr) return;
    const cutoff = now - windowMs;
    let i = 0;
    while (i < arr.length && arr[i] <= cutoff) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length === 0) hits.delete(key);
  }
  return {
    check(key, now = Date.now()) {
      prune(key, now);
      const arr = hits.get(key) || [];
      if (arr.length >= max) {
        // 最早一次命中滑出窗口的时间 = 最早时间戳 + windowMs
        const retryAfterMs = arr[0] + windowMs - now;
        return { allowed: false, retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)), count: arr.length };
      }
      return { allowed: true, count: arr.length };
    },
    hit(key, now = Date.now()) {
      const arr = hits.get(key) || [];
      arr.push(now);
      hits.set(key, arr);
    },
    reset(key) { hits.delete(key); },
  };
}

// 登录/建号：按 IP 的失败尝试上限（可经设置调整，默认较宽松以免误伤内网正常操作）。
// 惰性构建：import 时 DB 可能尚未 initDb()，故首用时才读设置、建 limiter。
let _loginLimiter = null;
function loginLimiter() {
  if (!_loginLimiter) {
    _loginLimiter = createSlidingLimiter({
      max: getSettingInt('auth.login_ip_max', 20),
      windowMs: Math.max(1, getSettingInt('auth.login_ip_window_min', 5)) * 60000,
    });
  }
  return _loginLimiter;
}

export function loginIpCheck(ip) { return loginLimiter().check(ip || 'unknown'); }
export function loginIpHit(ip) { loginLimiter().hit(ip || 'unknown'); }
export function loginIpReset(ip) { loginLimiter().reset(ip || 'unknown'); }
