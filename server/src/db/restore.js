// v2.19 P0：数据库「备份 → 恢复」落地（W4-13）。
// 设计要点（Windows 安全 + 避免 WAL 损坏）：
//   恢复不能在服务器运行、连接持有 brc.db 时就地覆盖文件（Windows 会 EBUSY/EPERM，
//   且旧 -wal 帧会串染新库）。故拆两阶段：
//     1) stageRestore()：admin 在运行时点「恢复」→ 校验备份合法 → 写待恢复标记文件。
//     2) applyPendingRestore()：下次启动 initDb() 之前（此时无任何连接）执行真正的
//        文件替换——先把当前库快照留底，再原子改名覆盖 brc.db，并清掉 -wal/-shm，删除标记。
//   恢复是「连同 audit_log 一起回退」的动作，故留一条进程外日志 data/restore.log 作可追溯痕迹。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.BRC_DATA_DIR || path.join(__dirname, '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'brc.db');
const MARKER = path.join(DATA_DIR, '.restore-pending.json');
const RESTORE_LOG = path.join(DATA_DIR, 'restore.log');

// 仅允许 backups 目录内的裸文件名，杜绝路径穿越
const SAFE_NAME = /^[A-Za-z0-9._-]+\.db$/;

function appendLog(line) {
  try {
    fs.appendFileSync(RESTORE_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch (_) { /* 日志失败不阻断恢复 */ }
}

function assertValidBackup(filename) {
  if (!filename || typeof filename !== 'string' || !SAFE_NAME.test(filename)) {
    const e = new Error('非法备份文件名（仅允许 backups 目录下的 .db 裸文件名）'); e.code = 'BAD_NAME'; throw e;
  }
  const resolved = path.resolve(BACKUP_DIR, filename);
  if (!resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
    const e = new Error('备份路径越界'); e.code = 'BAD_NAME'; throw e;
  }
  if (!fs.existsSync(resolved)) {
    const e = new Error('备份文件不存在'); e.code = 'NOT_FOUND'; throw e;
  }
  const st = fs.statSync(resolved);
  if (st.size < 512) {
    const e = new Error('备份文件过小，可能已损坏'); e.code = 'TOO_SMALL'; throw e;
  }
  // SQLite 头 16 字节魔数校验
  const fd = fs.openSync(resolved, 'r');
  const buf = Buffer.alloc(16);
  try { fs.readSync(fd, buf, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (buf.toString('latin1', 0, 15) !== 'SQLite format 3') {
    const e = new Error('不是有效的 SQLite 数据库备份'); e.code = 'NOT_SQLITE'; throw e;
  }
  return { src: resolved, size: st.size };
}

// 阶段一（运行时）：校验并写入待恢复标记。不改动当前库。
export function stageRestore(filename, { username } = {}) {
  const { src, size } = assertValidBackup(filename);
  const payload = { backup: filename, stagedAt: new Date().toISOString(), stagedBy: username || '' };
  fs.writeFileSync(MARKER, JSON.stringify(payload));
  appendLog(`STAGE by=${username || '?'} backup=${filename} size=${size}`);
  return { backup: filename, size, stagedAt: payload.stagedAt };
}

// 待恢复状态（供 UI 展示「已排入恢复，重启后生效」）
export function pendingRestore() {
  if (!fs.existsSync(MARKER)) return null;
  try { return JSON.parse(fs.readFileSync(MARKER, 'utf8')); }
  catch (_) { return { corrupt: true }; }
}

// 阶段二（启动、initDb 之前）：应用待恢复标记。返回执行信息或 null（无标记）。
export function applyPendingRestore() {
  if (!fs.existsSync(MARKER)) return null;
  let marker;
  try { marker = JSON.parse(fs.readFileSync(MARKER, 'utf8')); }
  catch (_) { try { fs.unlinkSync(MARKER); } catch { /* ignore */ } appendLog('ABORT reason=marker-unreadable'); return { aborted: true, reason: '恢复标记损坏，已忽略' }; }

  const backupName = String(marker.backup || '');
  let src;
  try { ({ src } = assertValidBackup(backupName)); }
  catch (e) { try { fs.unlinkSync(MARKER); } catch { /* ignore */ } appendLog(`ABORT backup=${backupName} reason=${e.message}`); return { aborted: true, reason: `恢复取消：${e.message}` }; }

  const ts = new Date().toISOString();
  // 先把「当前库」快照留底，使恢复本身可回退
  let safety = null;
  if (fs.existsSync(DB_FILE)) {
    safety = `pre-restore-${Date.now()}.db`;
    try { fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, safety)); }
    catch (e) { appendLog(`ABORT reason=safety-copy-failed:${e.message}`); return { aborted: true, reason: `恢复取消：留底快照失败（${e.message}）` }; }
  }
  // 原子替换：先复制到临时文件 → 改名覆盖 brc.db → 清掉旧 -wal/-shm（避免串染新库）
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const tmp = DB_FILE + '.restoring';
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, DB_FILE);
    for (const ext of ['-wal', '-shm']) {
      const p = DB_FILE + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) {
    appendLog(`FAIL backup=${backupName} reason=${e.message}`);
    return { aborted: true, reason: `恢复失败（${e.message}）；当前库未被破坏，可重试` };
  }
  try { fs.unlinkSync(MARKER); } catch (_) { /* ignore */ }
  appendLog(`RESTORE by=${marker.stagedBy || '?'} backup=${backupName} safety=${safety || 'none'} at=${ts}`);
  return { restored: true, backup: backupName, safety, at: ts, stagedBy: marker.stagedBy || '' };
}

export { BACKUP_DIR };
