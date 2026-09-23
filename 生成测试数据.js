// 生成测试 Excel 文件，用于导入测试
// 运行方式: node 生成测试数据.js
const XLSX = require('xlsx');

const testData = [
  { cccapNo: 'CIP-001', name: 'Russet Burbank', species: 'Solanum tuberosum', origin: 'USA', collectionYear: 1980, source: 'USDA', tubeCount: 12 },
  { cccapNo: 'CIP-002', name: 'Atlantic', species: 'Solanum tuberosum', origin: 'Canada', collectionYear: 1985, source: 'AAFC', tubeCount: 8 },
  { cccapNo: 'CIP-003', name: 'Yukon Gold', species: 'Solanum tuberosum', origin: 'Canada', collectionYear: 1980, source: 'AAFC', tubeCount: 15 },
  { cccapNo: 'CIP-004', name: 'Kenya Longe', species: 'Solanum tuberosum', origin: 'Kenya', collectionYear: 1995, source: 'CIP', tubeCount: 10 },
  { cccapNo: 'CIP-005', name: 'Cruza 148', species: 'Solanum tuberosum', origin: 'Peru', collectionYear: 1988, source: 'CIP', tubeCount: 6 },
  { cccapNo: 'CIP-101', name: '龙薯 9 号', species: 'Ipomoea batatas', origin: '中国', collectionYear: 2005, source: 'CCCAP', tubeCount: 20 },
  { cccapNo: 'CIP-102', name: '徐薯 18', species: 'Ipomoea batatas', origin: '中国', collectionYear: 1988, source: '江苏农科院', tubeCount: 15 },
  { cccapNo: 'CIP-103', name: '商薯 19', species: 'Ipomoea batatas', origin: '中国', collectionYear: 1995, source: '河南农科院', tubeCount: 12 },
  { cccapNo: 'CIP-104', name: 'Beauregard', species: 'Ipomoea batatas', origin: 'USA', collectionYear: 1987, source: 'LSU', tubeCount: 10 },
  { cccapNo: 'CIP-105', name: 'O\'Henry', species: 'Ipomoea batatas', origin: 'USA', collectionYear: 1996, source: 'NC State', tubeCount: 7 },
  { cccapNo: 'CIP-201', name: '紫罗兰', species: 'Solanum tuberosum', origin: '中国', collectionYear: 2010, source: 'CCCAP', tubeCount: 9 },
  { cccapNo: 'CIP-202', name: '红皮', species: 'Solanum tuberosum', origin: '中国', collectionYear: 2008, source: 'CCCAP', tubeCount: 11 },
];

const ws = XLSX.utils.json_to_sheet(testData);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '种质数据');

// 设置列宽
ws['!cols'] = [
  { wch: 12 },  // cccapNo
  { wch: 20 },  // name
  { wch: 22 },  // species
  { wch: 15 },  // origin
  { wch: 14 },  // collectionYear
  { wch: 20 },  // source
  { wch: 10 },  // tubeCount
];

XLSX.writeFile(wb, '测试数据-种质.xlsx');
console.log('✅ 已生成测试数据文件: 测试数据-种质.xlsx');
console.log('   包含 12 条种质记录（5 马铃薯 + 5 甘薯 + 2 其他）');
console.log('');
console.log('导入步骤:');
console.log('  1. 启动服务器 (运行 启动.bat)');
console.log('  2. 浏览器打开 http://localhost:7800');
console.log('  3. 登录后点击「系统设置」');
console.log('  4. 在「数据导入」区域上传此 Excel 文件');
console.log('  5. 选择「覆盖」模式，点 Import');
