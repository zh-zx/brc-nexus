// 系统消息推送助手（v2.4）
// 供审批/提醒/超时等场景调用；受 notify.enabled 门控；同日同对象同类型去重
import { run, get } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { getSettingBool } from '../db/settings.js';

export function pushMessage({ user_id = null, role = null, type, title, title_en, body, body_en, ref_table = '', ref_id = '' }) {
  if (!getSettingBool('notify.enabled', true)) return false;
  // 同日去重：同一目标+类型+引用对象当天只发一条
  const dup = get(
    `SELECT id FROM sys_message
     WHERE type = ? AND ref_table = ? AND ref_id = ?
       AND (? IS NULL OR user_id = ?) AND (? IS NULL OR role = ?)
       AND date(created_at) = date('now') LIMIT 1`,
    [type, ref_table, ref_id, user_id, user_id, role, role],
  );
  if (dup) return false;
  run(
    'INSERT INTO sys_message (id, user_id, role, type, title, title_en, body, body_en, ref_table, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), user_id, role, type, title, title_en, body, body_en, ref_table, ref_id],
  );
  return true;
}
