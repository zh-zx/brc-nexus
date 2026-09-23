// 参数读取助手：从 app_setting 读配置，带默认值（缓存避免每次查库）
import { get } from './connection.js';

const cache = new Map();

export function getSetting(key, def = '') {
  if (cache.has(key)) return cache.get(key);
  const row = get('SELECT value FROM app_setting WHERE key = ?', [key]);
  const value = row?.value ?? def;
  cache.set(key, value);
  return value;
}

export function getSettingBool(key, def = false) {
  const v = String(getSetting(key, def ? 'true' : 'false'));
  return v === 'true' || v === '1';
}

export function getSettingInt(key, def = 0) {
  const n = parseInt(String(getSetting(key, String(def))), 10);
  return Number.isFinite(n) ? n : def;
}

export function getSettingJson(key, def = null) {
  try {
    return JSON.parse(getSetting(key, '') || 'null') ?? def;
  } catch {
    return def;
  }
}

// 设置被修改时由路由主动清缓存（PUT /api/settings 里调用）
export function clearSettingsCache() {
  cache.clear();
}
