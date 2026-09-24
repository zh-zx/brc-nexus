import { run } from '../db/connection.js';

// v2.19 P0 审计（W3-10）：统一 audit_log 写点。业务关键操作（打印/库存替换/分发/性状编辑）
// 此前不写审计。审计失败绝不阻断业务（与 dbadmin/freezer 既有容错范式一致）。
export function writeAudit({ table, recordId, action, before, after, req }) {
  try {
    run(
      'INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username, ip_address) VALUES (?,?,?,?,?,?,?,?)',
      [
        table,
        recordId != null ? String(recordId) : null,
        action,
        before !== undefined && before !== null ? JSON.stringify(before) : null,
        after !== undefined && after !== null ? JSON.stringify(after) : null,
        req?.user?.id || '',
        req?.user?.username || '',
        req?.ip || '',
      ],
    );
  } catch (_) { /* 审计失败不阻断业务 */ }
}
