// 直接向数据库导入测试数据
// 在 server 目录下运行: node ../导入测试数据.js
const path = require('path');
process.chdir(path.join(__dirname, 'server'));

const { initDb, run, get, saveDb } = require('./server/src/db/connection.js');
const { runMigrations } = require('./server/src/db/schema.js');
const XLSX = require('./server/node_modules/xlsx');

async function main() {
  await initDb();
  runMigrations();

  // 读取测试 Excel
  const wb = XLSX.readFile(path.join(__dirname, '测试数据-种质.xlsx'));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  console.log(`读取 ${rows.length} 行 Excel 数据`);

  let inserted = 0, updated = 0, errors = 0;
  const { randomUUID } = require('crypto');

  for (const row of rows) {
    const primaryId = String(row.cccapNo || '').trim();
    if (!primaryId) { errors++; continue; }

    const existing = get('SELECT id FROM accession WHERE primary_id = ?', [primaryId]);
    if (existing) {
      run(`UPDATE accession SET data_json = ?, display_name = ?, species = ?, origin = ?, last_modified_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(row), row.name || primaryId, row.species || '', row.origin || '', existing.id]);
      updated++;
    } else {
      run(`INSERT INTO accession (id, data_json, primary_id, display_name, species, origin, last_modified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [randomUUID(), JSON.stringify(row), primaryId, row.name || primaryId, row.species || '', row.origin || '']);
      inserted++;
    }
  }

  saveDb();

  const total = get('SELECT COUNT(*) as c FROM accession');
  const potato = get("SELECT COUNT(*) as c FROM accession WHERE species LIKE '%Solanum%'");
  const sweet = get("SELECT COUNT(*) as c FROM accession WHERE species LIKE '%Ipomoea%'");

  console.log('');
  console.log('=== 导入完成 ===');
  console.log(`  新增: ${inserted} 条`);
  console.log(`  更新: ${updated} 条`);
  console.log(`  错误: ${errors} 条`);
  console.log('');
  console.log('=== 数据库现状 ===');
  console.log(`  种质总数: ${total.c}`);
  console.log(`  马铃薯: ${potato.c} 条`);
  console.log(`  甘薯: ${sweet.c} 条`);
  console.log('');
  console.log('✅ 现在可以启动服务器，在浏览器里查看数据了');
  console.log('   访问: http://localhost:7800');
  console.log('   登录: admin / admin123');

  process.exit(0);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
