// labelUtil 冒烟测试：验证 12 种元素 + 卷式/纸张布局的 HTML 生成不抛异常
// 运行: cd client && npx -y tsx /tmp/labelutil-smoke.ts
import { LabelTemplate, LabelElement, LabelElementType, LabelSegment } from '../src/types';
import {
  resolveSegments, formatDateWith, renderLabelsHtml, renderLabelsPagesHtml,
  makeEmptyTable, iconDataUrl,
} from '../src/lib/labelUtil';

const rid = () => Math.random().toString(36).slice(2, 8);
let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('  ✓', name); }
  catch (e: any) { failures++; console.error('  ✗', name, '→', e.message); }
}

// --- resolveSegments ---
const segs: LabelSegment[] = [
  { id: rid(), type: 'text', text: '编号:' },
  { id: rid(), type: 'field', field: 'cccapNo' },
  { id: rid(), type: 'variable', variable: 'operator' },
  { id: rid(), type: 'date', dateFormat: 'YYYY年MM月DD日', dateOffset: -7 },
  { id: rid(), type: 'serial', serialStart: 100, serialStep: 2, serialRepeat: 2, serialPad: 3 },
];
const el: LabelElement = { id: rid(), type: LabelElementType.TEXT_DYNAMIC, x: 0, y: 0, width: 40, height: 6, fontSize: 9, segments: segs };
check('resolveSegments 拼接', () => {
  const r = resolveSegments(el, { data: { cccapNo: 'CIP-001' }, rowIndex: 0, variables: { operator: '张三' } });
  if (!r.text.includes('编号:CIP-001张三')) throw new Error('文本错误: ' + r.text);
});
check('resolveSegments 序列号(repeat=2, step=2: 0/1→100, 2/3→102)', () => {
  const r = resolveSegments(el, { data: {}, rowIndex: 2, variables: {} });
  if (!r.text.includes('102')) throw new Error('序列号错误: ' + r.text);
});
check('formatDateWith', () => {
  const d = new Date(2026, 7, 5);
  if (formatDateWith(d, 'YYYY-MM-DD') !== '2026-08-05') throw new Error('日期错误');
  if (formatDateWith(d, 'YYMMDD') !== '260805') throw new Error('短日期错误');
});

// --- 全类型模板 ---
function makeTemplate(): LabelTemplate {
  const els: LabelElement[] = [
    { id: rid(), type: LabelElementType.TEXT_STATIC, x: 2, y: 2, width: 40, height: 6, fontSize: 9, isBold: true, textAlign: 'center', segments: [{ id: rid(), type: 'text', text: '种质标签' }] },
    { id: rid(), type: LabelElementType.TEXT_DYNAMIC, x: 2, y: 9, width: 40, height: 6, fontSize: 9, segments: [{ id: rid(), type: 'field', field: 'cccapNo' }] },
    { id: rid(), type: LabelElementType.TEXT_PARAGRAPH, x: 2, y: 16, width: 40, height: 12, fontSize: 8, verticalAlign: 'top', segments: [{ id: rid(), type: 'field', field: 'name' }] },
    { id: rid(), type: LabelElementType.DATE, x: 2, y: 28, width: 40, height: 6, fontSize: 8, segments: [{ id: rid(), type: 'date', dateFormat: 'YYYY/MM/DD' }] },
    { id: rid(), type: LabelElementType.TABLE, x: 2, y: 35, width: 30, height: 20, fontSize: 6, strokeColor: '#333', table: makeEmptyTable(3, 3) },
    { id: rid(), type: LabelElementType.BARCODE, x: 2, y: 56, width: 40, height: 14, barcodeType: 'CODE128', barcodeTextDisplay: 'bottom', segments: [{ id: rid(), type: 'field', field: 'cccapNo' }] },
    { id: rid(), type: LabelElementType.QR_CODE, x: 44, y: 2, width: 20, height: 20, eccLevel: 'M', segments: [{ id: rid(), type: 'field', field: 'cccapNo' }] },
    { id: rid(), type: LabelElementType.RECTANGLE, x: 44, y: 24, width: 30, height: 10, strokeColor: '#000', strokeWidth: 1, cornerRadius: 2, backgroundColor: '#eee' },
    { id: rid(), type: LabelElementType.CIRCLE, x: 44, y: 36, width: 14, height: 14, strokeColor: '#000', strokeWidth: 1 },
    { id: rid(), type: LabelElementType.LINE, x: 44, y: 52, width: 30, height: 1.2, strokeColor: '#f00', strokeWidth: 1.2, dashed: true, dashLength: 2 },
    { id: rid(), type: LabelElementType.IMAGE, x: 44, y: 56, width: 14, height: 14 },
    { id: rid(), type: LabelElementType.ICON, x: 44, y: 70, width: 10, height: 10, iconName: 'tag', color: '#2e7d32', imageSrc: iconDataUrl('tag', '#2e7d32', 128) },
  ];
  return { id: 't1', name: '测试', width: 70, height: 90, elements: els, backgroundColor: '#ffffff', layout: { mode: 'roll', rollCols: 2, rollGapX: 2 } };
}

const tpl = makeTemplate();
const rows = [
  { cccapNo: 'CIP-001', name: '品种A', operator: '张三' },
  { cccapNo: 'CIP-002', name: '品种B', operator: '李四' },
  { cccapNo: 'CIP-003', name: '品种C', operator: '王五' },
];

// 带合并单元格的表格模板
function mergedTableTpl(): LabelTemplate {
  const cells = [
    { text: '甲', rowSpan: 2, colSpan: 1 },
    { text: '乙' }, { text: '丙' },
    { text: '', hidden: true },
    { text: '丁', colSpan: 2 },
    { text: '', hidden: true },
    { text: '戊' }, { text: '己' }, { text: '庚' },
  ];
  const t = makeEmptyTable(3, 3);
  t.cells = cells;
  const tbEl: LabelElement = { id: rid(), type: LabelElementType.TABLE, x: 2, y: 35, width: 30, height: 20, fontSize: 6, strokeColor: '#333', table: t };
  return { id: 't2', name: '合并表', width: 40, height: 60, elements: [tbEl], backgroundColor: '#ffffff', layout: { mode: 'roll', rollCols: 1 } };
}

check('renderLabelsHtml 卷式多列', () => {
  const html = renderLabelsHtml(tpl, rows, { mode: 'roll', rollCols: 2, rollGapX: 2 });
  if (!html.includes('<!DOCTYPE html>')) throw new Error('缺少文档头');
  const pages = html.match(/class="page"/g);
  if (!pages || pages.length !== 3) throw new Error('页数错误: ' + pages?.length);
  if (!html.includes('CIP-001')) throw new Error('数据未渲染');
});
check('renderLabelsHtml 表格合并单元格', () => {
  // 单条记录 → 1 个标签 → 7 个可见单元格（3×3 减 2 个被合并覆盖）
  const html = renderLabelsHtml(mergedTableTpl(), [rows[0]], { mode: 'roll', rollCols: 1 });
  if (!html.includes('rowspan="2"')) throw new Error('rowspan 缺失');
  if (!html.includes('colspan="2"')) throw new Error('colspan 缺失');
  if ((html.match(/<td/g) || []).length !== 7) throw new Error('可见单元格数量错误: ' + (html.match(/<td/g) || []).length);
});
check('renderLabelsHtml 卷式旋转', () => {
  const html = renderLabelsHtml(tpl, rows, { mode: 'roll', rotate: 'right', rollCols: 1 });
  if (!html.includes('rotate(90deg)')) throw new Error('缺少旋转');
  if (!html.includes('size: 90mm 70mm')) throw new Error('页面尺寸未随旋转互换: ' + html.match(/size:[^;]+/)?.[0]);
});
check('renderLabelsHtml 跳过页', () => {
  const skip = new Set([2]);
  const html = renderLabelsHtml(tpl, rows, { mode: 'roll', rollCols: 1, skipPages: skip });
  if (html.includes('CIP-002')) throw new Error('跳过页仍渲染');
  if (!html.includes('CIP-001') || !html.includes('CIP-003')) throw new Error('非跳过页缺失');
});
check('renderLabelsHtml 份数', () => {
  const html = renderLabelsHtml(tpl, rows, { mode: 'roll', rollCols: 1, copies: 2 });
  const n = (html.match(/class="page"/g) || []).length;
  if (n !== 6) throw new Error('份数展开错误: ' + n);
});
check('renderLabelsHtml 纸张模式', () => {
  const sheetTpl: LabelTemplate = { ...tpl, layout: { mode: 'sheet', sheetWidth: 210, sheetHeight: 297, rows: 4, cols: 3, marginTop: 10, marginLeft: 10, gapX: 2, gapY: 2 } };
  const html = renderLabelsHtml(sheetTpl, rows, { mode: 'sheet', sheetWidth: 210, sheetHeight: 297, rows: 4, cols: 3, marginTop: 10, marginLeft: 10, gapX: 2, gapY: 2 });
  const pages = (html.match(/class="page"/g) || []).length;
  if (pages !== 1) throw new Error('纸张页数错误: ' + pages);
  if (!html.includes('left:10mm;top:10mm')) throw new Error('边距未生效');
});
check('renderLabelsPagesHtml 与分段打印 offset', () => {
  const sub = rows.slice(1, 3).map((r, i) => ({ ...r, __rowIndex: i + 1 }));
  const pages = renderLabelsPagesHtml(tpl, sub, { mode: 'roll', rollCols: 1 });
  if (!pages.includes('CIP-002') || !pages.includes('CIP-003')) throw new Error('分段数据缺失');
});
check('翻转 transform 与模板变量默认值', () => {
  const tpl2: LabelTemplate = {
    id: 't3', name: '翻转', width: 40, height: 30,
    elements: [{
      id: rid(), type: LabelElementType.TEXT_STATIC, x: 2, y: 2, width: 30, height: 6, fontSize: 9,
      rotation: 45, flipH: true, flipV: true,
      segments: [{ id: rid(), type: 'variable', variable: 'batch' }],
    }],
    backgroundColor: '#ffffff', layout: { mode: 'roll', rollCols: 1 },
    variables: { batch: 'B-2026' },
  };
  const html = renderLabelsHtml(tpl2, [{}], { mode: 'roll', rollCols: 1 });
  if (!html.includes('rotate(45deg) scaleX(-1) scaleY(-1)')) throw new Error('翻转 transform 缺失: ' + html.match(/transform:[^;"]+/)?.[0]);
  if (!html.includes('B-2026')) throw new Error('模板变量默认值未生效');
});
check('表格行高列宽(colgroup/tr height)', () => {
  const t = mergedTableTpl();
  const tb = t.elements[0];
  tb.table!.rowHeights = [4, 6, 8];
  tb.table!.colWidths = [2, 1, 1];
  const html = renderLabelsHtml(t, [rows[0]], { mode: 'roll', rollCols: 1 });
  if (!html.includes('<colgroup>')) throw new Error('colgroup 缺失');
  if (!html.includes('width:50.000%')) throw new Error('列宽比例错误: ' + html.match(/width:[\d.]+%/)?.[0]);
  if (!html.includes('height:4mm') || !html.includes('height:8mm')) throw new Error('行高未生效');
});

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✓ 全部通过');
process.exit(failures ? 1 : 0);
