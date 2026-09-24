#!/usr/bin/env node
// v2.19 P0：一次性孤儿对账脚本（应用层级联策略的落地清理）。
//
// 背景：schema.js 的 FK 声明都在 `CREATE TABLE IF NOT EXISTS` 内，对既有库从未生效，
// 加之旧删除向量不清子表，历史遗留了「子记录指向已不存在的父记录」的孤儿。
// 本脚本按 refs.js 单一事实源声明的策略，先把每条孤儿报告出来（默认只读），
// 再用 `--apply` 实际清理；清理前自动 `VACUUM INTO` 备份，并逐条写 audit_log 留痕。
//
// 用法：
//   node scripts/reconcile-orphans.mjs            # 只读报告（安全，可随时跑）
//   node scripts/reconcile-orphans.mjs --apply    # 实际清理（会改动数据，先备份）
//
// 建议 --apply 前先停服（WAL 下跨进程写需抢写锁，停服最稳妥）。
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, get, all, run, tx, backupDb, closeDb } from '../src/db/connection.js';
import { scanOrphans, FK_REFS } from '../src/db/refs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// 列出指向已消失父记录的子行 id（与 scanOrphans 判定口径一致：非空且 NOT EXISTS，并套用 orphanScope）。
function orphanIds(child, col, parent, parentKey, orphanScope) {
  const pk = parentKey || 'id';
  const scope = orphanScope ? ` AND (${orphanScope})` : '';
  return all(
    `SELECT x.id AS id, x.${q(col)} AS val FROM ${q(child)} x
     WHERE x.${q(col)} IS NOT NULL AND x.${q(col)} != ''${scope}
       AND NOT EXISTS (SELECT 1 FROM ${q(parent)} p WHERE p.${q(pk)} = x.${q(col)})`
  );
}

function refFor(child, col) {
  return FK_REFS.find(r => r.child === child && r.col === col) || null;
}

// 清理策略：把 scanOrphans 报告的每条孤儿映射到一个动作。
//   revoke   → UPDATE ai_token SET enabled=0（撤令牌，保留台账）
//   setnull  → 可空外键置 NULL，保留实物行，待人工重新挂接
//   rehome   → 非空外键(inventory.room_id)迁到「待归属」默认房间，保留实物行
//   delete   → 删从属明细（cascade 语义：父工单已不存在）
// 未列出的 (child.col) 若被报为孤儿 → 仅报告、需人工判断（返回 null）。
function actionFor(child, col) {
  const key = `${child}.${col}`;
  if (key === 'ai_token.created_by') return 'revoke';
  if (key === 'inventory.accession_id') return 'setnull';
  if (key === 'freezer_sample.accession_id') return 'setnull';
  if (key === 'inventory.room_id') return 'rehome';
  if (key === 'work_order_feedback.work_order_id') return 'delete';
  if (key === 'work_daily_report.work_order_id') return 'delete';
  const ref = refFor(child, col);
  if (!ref) return null;
  if (ref.strategy === 'revoke') return 'revoke';
  if (ref.strategy === 'cascade') return 'delete';
  return null; // 未知 block：不自动破坏实物，留人工
}

function ensureUnassignedRoom() {
  const NAME = '待归属 / UNASSIGNED';
  const hit = get('SELECT id FROM room WHERE name = ?', [NAME]);
  if (hit) return hit.id;
  const id = globalThis.crypto.randomUUID();
  run('INSERT INTO room (id, name) VALUES (?, ?)', [id, NAME]);
  return id;
}

function writeReconcileAudit(child, id, col, action, detail) {
  run(
    'INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?,?,?,?,?,?,?)',
    [child, String(id), 'RECONCILE_ORPHAN', JSON.stringify({ col, ...detail }), JSON.stringify({ col, fix: action }), '', 'reconcile-script']
  );
}

function main() {
  initDb();
  const orphans = scanOrphans();
  console.log('=== BRC 孤儿对账 ===');
  console.log(APPLY ? '模式：APPLY（将实际清理，先备份）' : '模式：DRY-RUN（只读报告，加 --apply 才清理）');

  // audit 策略的「有意悬空」历史引用：不计入孤儿，仅透明展示数量，说明为何不清理。
  const auditDangling = [];
  for (const r of FK_REFS) {
    if (r.strategy !== 'audit') continue;
    const pk = r.parentKey || 'id';
    try {
      const c = get(
        `SELECT COUNT(*) AS c FROM ${q(r.child)} x WHERE x.${q(r.col)} IS NOT NULL AND x.${q(r.col)} != '' AND NOT EXISTS (SELECT 1 FROM ${q(r.parent)} p WHERE p.${q(pk)} = x.${q(r.col)})`
      );
      if (Number(c?.c || 0) > 0) auditDangling.push({ ref: `${r.child}.${r.col}`, count: Number(c.c) });
    } catch (_) { /* 表/列不存在则跳过 */ }
  }
  if (auditDangling.length) {
    console.log('\n[有意保留的历史留痕，非孤儿，不处理]');
    for (const d of auditDangling) console.log(`  ${d.ref}: ${d.count} 条悬空（audit 策略，父删除后保留为历史）`);
  }

  if (!orphans.length) {
    console.log('\n[结果] 无孤儿，完整性 OK。');
    closeDb();
    return;
  }

  console.log(`\n[报告] 发现 ${orphans.length} 类孤儿引用：`);
  let unhandled = 0;
  const plan = [];
  for (const o of orphans) {
    const act = actionFor(o.child, o.col);
    const label = `${o.child}.${o.col} → ${o.parent}`;
    if (!act) {
      console.log(`  ${label}: ${o.count} 条  ⚠ 无自动策略，需人工判断`);
      unhandled += o.count;
      continue;
    }
    console.log(`  ${label}: ${o.count} 条  → 动作 ${act}`);
    plan.push({ ...o, action: act });
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未改动任何数据。确认无误后运行：node scripts/reconcile-orphans.mjs --apply');
    if (unhandled) console.log(`注意：${unhandled} 条孤儿无自动策略，即使 --apply 也不会被清理。`);
    closeDb();
    return;
  }

  // 备份
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, '../data/backups', `pre-reconcile-${ts}.db`);
  backupDb(backupPath);
  console.log(`\n[备份] 已生成快照：${backupPath}`);

  let cleaned = 0;
  tx((h) => {
    for (const p of plan) {
      const ref = refFor(p.child, p.col);
      const rows = orphanIds(p.child, p.col, p.parent, ref?.parentKey, ref?.orphanScope);
      for (const row of rows) {
        if (p.action === 'revoke') {
          h.run('UPDATE ai_token SET enabled = 0 WHERE id = ?', [row.id]);
        } else if (p.action === 'setnull') {
          h.run(`UPDATE ${q(p.child)} SET ${q(p.col)} = NULL WHERE id = ?`, [row.id]);
        } else if (p.action === 'rehome') {
          const roomId = ensureUnassignedRoom();
          h.run(`UPDATE ${q(p.child)} SET ${q(p.col)} = ? WHERE id = ?`, [roomId, row.id]);
        } else if (p.action === 'delete') {
          h.run(`DELETE FROM ${q(p.child)} WHERE id = ?`, [row.id]);
        }
        writeReconcileAudit(p.child, row.id, p.col, p.action, { danglingRef: row.val });
        cleaned++;
      }
    }
  });
  console.log(`\n[清理完成] 处理 ${cleaned} 条孤儿（逐条写入 audit_log，action=RECONCILE_ORPHAN）。`);

  const remaining = scanOrphans();
  if (remaining.length) {
    console.log(`[剩余] 仍有 ${remaining.length} 类孤儿未清（无自动策略，需人工处理）：`);
    for (const o of remaining) console.log(`  ${o.child}.${o.col} → ${o.parent}: ${o.count}`);
  } else {
    console.log('[剩余] orphans: [] —— 完整性 OK。');
  }
  closeDb();
}

main();
