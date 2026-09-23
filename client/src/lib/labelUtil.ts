import bwipjs from 'bwip-js';
import { LabelElement, LabelElementType, LabelSegment, LabelTemplate, LabelPageLayout } from '../types';

/* ================= 基础工具 ================= */

export const mmToPx = (mm: number) => mm * 3.7795275591;
export const pxToMm = (px: number) => px / 3.7795275591;

export const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36).slice(-4);

export const cloneTemplate = (t: LabelTemplate): LabelTemplate => JSON.parse(JSON.stringify(t));

/* ================= 日期格式 ================= */

export function formatDateWith(d: Date, fmt?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const yy = String(Y).slice(-2);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  return (fmt || 'YYYY/MM/DD')
    .replace(/YYYY/g, String(Y))
    .replace(/YY/g, yy)
    .replace(/MM/g, pad(M))
    .replace(/DD/g, pad(D))
    .replace(/HH/g, pad(h))
    .replace(/mm/g, pad(m))
    .replace(/ss/g, pad(s));
}

/* ================= 数据查找 ================= */

export function hasData(data: Record<string, any>): boolean {
  return !!data && Object.keys(data).length > 0;
}

export function findValue(data: Record<string, any>, key?: string): string | undefined {
  if (!key) return undefined;
  if (data[key] !== undefined && data[key] !== null) return String(data[key]);
  const trimmed = key.trim();
  if (data[trimmed] !== undefined && data[trimmed] !== null) return String(data[trimmed]);
  const lower = trimmed.toLowerCase();
  const found = Object.keys(data).find(k => k.toLowerCase().trim() === lower);
  return found ? String(data[found]) : undefined;
}

/* ================= 内容片段（LabelNova 数据绑定） ================= */

export function legacySegments(el: LabelElement): LabelSegment[] {
  if (el.type === LabelElementType.TEXT_STATIC) {
    return [{ id: generateId(), type: 'text', text: el.content || 'Text' }];
  }
  if (el.type === LabelElementType.DATE) {
    return [{ id: generateId(), type: 'date', dateFormat: 'YYYY/MM/DD' }];
  }
  if (el.type === LabelElementType.TEXT_DYNAMIC || el.type === LabelElementType.QR_CODE || el.type === LabelElementType.BARCODE) {
    return [{ id: generateId(), type: 'field', field: el.field || '' }];
  }
  return [{ id: generateId(), type: 'text', text: '' }];
}

export interface ResolveContext {
  data: Record<string, any>;
  rowIndex: number;
  variables?: Record<string, any>;
}

export function resolveSegments(el: LabelElement, ctx: ResolveContext): { text: string; isError: boolean } {
  const segments = el.segments && el.segments.length ? el.segments : legacySegments(el);
  let text = '';
  let isError = false;
  const designMode = !hasData(ctx.data);
  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        text += seg.text || '';
        break;
      case 'field': {
        const v = findValue(ctx.data, seg.field);
        if (v !== undefined && v !== '') text += v;
        else if (designMode) text += `[${seg.field || 'field'}]`;
        break;
      }
      case 'variable': {
        const v = ctx.variables?.[seg.variable || ''];
        if (v !== undefined && v !== null && String(v) !== '') text += String(v);
        else text += `{${seg.variable || 'var'}}`;
        break;
      }
      case 'date': {
        const d = new Date();
        const off = Number(seg.dateOffset) || 0;
        if (off) d.setDate(d.getDate() + off);
        text += formatDateWith(d, seg.dateFormat || 'YYYY/MM/DD');
        break;
      }
      case 'serial': {
        const start = seg.serialStart ?? 1;
        const step = seg.serialStep ?? 1;
        const repeat = Math.max(1, seg.serialRepeat ?? 1);
        const n = Math.floor(ctx.rowIndex / repeat);
        let val = seg.serialDecrement ? start - n * step : start + n * step;
        if (val < 0) val = 0;
        const padN = seg.serialPad || 0;
        text += padN > 0 ? String(val).padStart(padN, '0') : String(val);
        break;
      }
    }
  }
  return { text, isError };
}

/* ================= 条码渲染（bwip-js） ================= */

export const BARCODE_1D_TYPES = ['CODE128', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'CODE39', 'CODE93', 'ITF14', 'GS1-128', 'CODABAR'];
export const BARCODE_2D_TYPES = ['QRCODE', 'DATAMATRIX', 'PDF417', 'AZTEC'];

export const BARCODE_TYPE_NAMES: Record<string, string> = {
  CODE128: 'Code 128', EAN13: 'EAN-13', EAN8: 'EAN-8', UPCA: 'UPC-A', UPCE: 'UPC-E',
  CODE39: 'Code 39', CODE93: 'Code 93', ITF14: 'ITF-14', 'GS1-128': 'GS1-128', CODABAR: 'Codabar',
  QRCODE: 'QR Code', DATAMATRIX: 'DataMatrix', PDF417: 'PDF417', AZTEC: 'Aztec',
};

function barcodeBcid(t: string): string {
  const map: Record<string, string> = {
    CODE128: 'code128', EAN13: 'ean13', EAN8: 'ean8', UPCA: 'upca', UPCE: 'upce',
    CODE39: 'code39', CODE93: 'code93', ITF14: 'itf14', 'GS1-128': 'gs1-128', CODABAR: 'codabar',
    QRCODE: 'qrcode', DATAMATRIX: 'datamatrix', PDF417: 'pdf417', AZTEC: 'azteccode',
  };
  return map[t] || 'code128';
}

export interface BarcodeOptions {
  height?: number;
  showText?: boolean;
  textAlign?: 'bottom' | 'top';
  color?: string;
  backgroundColor?: string;
  eccLevel?: string;
  widthRatio?: number;
}

export function renderBarcodeDataUrl(type: string, value: string, opts: BarcodeOptions = {}): string | null {
  if (!value) return null;
  try {
    const canvas = document.createElement('canvas');
    const bcid = barcodeBcid(type);
    const is2d = BARCODE_2D_TYPES.includes(type.toUpperCase());
    const o: any = {
      bcid,
      text: value,
      scale: is2d ? 5 : 3,
      includetext: !is2d && opts.showText !== false,
      textxalign: 'center',
      padding: is2d ? 2 : 1,
      backgroundcolor: (opts.backgroundColor || '#ffffff').replace('#', ''),
      barcolor: (opts.color || '#000000').replace('#', ''),
    };
    if (bcid === 'qrcode') {
      o.eclevel = (opts.eccLevel || 'M').toUpperCase();
    } else if (bcid === 'datamatrix') {
      o.eclevel = opts.eccLevel ? String(opts.eccLevel).toUpperCase() : 'M';
    } else if (bcid === 'pdf417' || bcid === 'azteccode') {
      o.scale = 4;
    } else {
      o.height = Math.max(8, Math.round((opts.height || 12) * 3.7795 / 3));
      if (opts.widthRatio) o.widthratio = opts.widthRatio;
      if (opts.textAlign === 'top') o.textyalign = 'above';
    }
    bwipjs.toCanvas(canvas, o);
    return canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

/* ================= 元素样式（LabelCanvas 与打印 HTML 共用） ================= */

export function getElementStyle(el: LabelElement): React.CSSProperties {
  const s: React.CSSProperties = {
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    position: 'absolute',
  };
  if (el.rotation || el.flipH || el.flipV) {
    const parts: string[] = [];
    if (el.rotation) parts.push(`rotate(${el.rotation}deg)`);
    if (el.flipH) parts.push('scaleX(-1)');
    if (el.flipV) parts.push('scaleY(-1)');
    s.transform = parts.join(' ');
  }
  return s;
}

export function styleToCss(s: React.CSSProperties): string {
  return Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${typeof v === 'number' ? v + 'mm' : v}`)
    .join('; ');
}

/* ================= 打印 HTML（WYSIWYG，浏览器渲染 = 打印输出） ================= */

export interface PrintOptions {
  mode: 'roll' | 'sheet';
  copies?: number;
  offsetX?: number;
  offsetY?: number;
  rotate?: 'none' | 'left' | 'right';
  skipPages?: Set<number>;          // 1-based
  sheetWidth?: number;
  sheetHeight?: number;
  rows?: number;
  cols?: number;
  marginTop?: number;
  marginLeft?: number;
  gapX?: number;
  gapY?: number;
  rollCols?: number;
  rollGapX?: number;
  /** 记录序号起始偏移（分段打印时保持序列号连续） */
  rowIndexOffset?: number;
}

export function resolveRows(rows: Record<string, any>[], copies: number): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const r of rows) for (let i = 0; i < (copies || 1); i++) out.push(r);
  return out;
}

/** 生成单个标签的 HTML 片段（mm 定位），画布预览与打印输出共用同一套视觉 */
export function renderLabelInnerHtml(template: LabelTemplate, row: Record<string, any>, rowIndex: number, variables?: Record<string, any>): string {
  const vars: Record<string, any> = { operator: row?.operator, medium: row?.medium, ...(template.variables || {}), ...(variables || {}) };
  let bg = '';
  if (template.backgroundColor) bg = `background-color: ${template.backgroundColor};`;
  if (template.backgroundImage) bg += `background-image: url("${template.backgroundImage}"); background-size: cover; background-position: center;`;
  const parts: string[] = [];
  if (bg) parts.push(`<div style="position:absolute;left:0;top:0;width:100%;height:100%;${bg}"></div>`);
  for (const el of template.elements) {
    const seg = resolveSegments(el, { data: row, rowIndex, variables: vars });
    if (el.assignVariable) vars[el.assignVariable] = seg.text;
    const inner = elementInnerHtml(el, seg.text, seg.isError);
    const css = `${styleToCss(getElementStyle(el))};overflow:hidden;`;
    parts.push(`<div style="${css}">${inner}</div>`);
  }
  return parts.join('');
}

/** 单个元素的内部视觉（填满其包围盒），画布与打印共用 */
export function elementInnerHtml(el: LabelElement, text: string, isError: boolean): string {
  switch (el.type) {
    case LabelElementType.QR_CODE: {
      const src = renderBarcodeDataUrl('QRCODE', text, { eccLevel: el.eccLevel || 'M', color: el.color, backgroundColor: el.backgroundColor });
      if (!src) return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#c00;font-size:1mm;">QR</div>`;
      return `<img style="width:100%;height:100%;object-fit:contain;display:block;" src="${src}" />`;
    }
    case LabelElementType.BARCODE: {
      const is2d = BARCODE_2D_TYPES.includes((el.barcodeType || '').toUpperCase());
      const showText = el.barcodeTextDisplay === 'top' || el.barcodeTextDisplay === 'bottom';
      const src = renderBarcodeDataUrl(el.barcodeType || 'CODE128', text, {
        height: el.height - (showText && !is2d ? 2.5 : 0),
        showText,
        textAlign: el.barcodeTextDisplay === 'top' ? 'top' : 'bottom',
        color: el.color || '#000000',
        backgroundColor: el.backgroundColor || '#ffffff',
        eccLevel: el.eccLevel || 'M',
        widthRatio: el.barcodeWidthRatio,
      });
      if (!src) {
        return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#c00;font-size:1mm;border:0.1mm dashed #c00;">NO DATA</div>`;
      }
      return `<img style="width:100%;height:100%;object-fit:contain;object-position:center;display:block;" src="${src}" />`;
    }
    case LabelElementType.RECTANGLE:
      return `<div style="width:100%;height:100%;background:${el.backgroundColor || 'transparent'};border:${el.strokeWidth || 1}mm solid ${el.strokeColor || '#000000'};border-radius:${el.cornerRadius || 0}mm;box-sizing:border-box;"></div>`;
    case LabelElementType.CIRCLE:
      return `<div style="width:100%;height:100%;background:${el.backgroundColor || 'transparent'};border:${el.strokeWidth || 1}mm solid ${el.strokeColor || '#000000'};border-radius:50%;box-sizing:border-box;"></div>`;
    case LabelElementType.LINE: {
      const horiz = (el.height || 1) < (el.width || 1);
      const len = horiz ? el.width : el.height;
      const thick = el.strokeWidth || 1;
      const color = el.strokeColor || el.color || '#000000';
      let bg = `background-color:${color};`;
      if (el.dashed) bg = `background-image:repeating-linear-gradient(90deg, ${color}, ${color} ${el.dashLength || 1}mm, transparent ${el.dashLength || 1}mm, transparent ${(el.dashLength || 1) * 2}mm);`;
      return `<div style="width:${horiz ? len : thick}mm;height:${horiz ? thick : len}mm;${bg};box-sizing:border-box;margin:auto;"></div>`;
    }
    case LabelElementType.TABLE:
      return tableInnerHtml(el);
    case LabelElementType.IMAGE:
      if (!el.imageSrc) return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:1.5mm;">Image</div>`;
      return `<img style="width:100%;height:100%;object-fit:fill;display:block;" src="${el.imageSrc}" />`;
    case LabelElementType.ICON:
      if (el.imageSrc) return `<img style="width:100%;height:100%;object-fit:contain;display:block;" src="${el.imageSrc}" />`;
      return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:${el.color || '#000'};"><span style="font-size:${Math.min(el.width, el.height) * 0.6}mm;line-height:1;">◆</span></div>`;
    case LabelElementType.TEXT_PARAGRAPH:
      return `<div style="width:100%;height:100%;color:${el.color || '#000'};font-size:${el.fontSize}pt;font-weight:${el.isBold ? 'bold' : 'normal'};font-family:${el.fontFamily || 'Arial, sans-serif'};text-align:${el.textAlign || 'left'};white-space:pre-wrap;word-break:break-word;overflow:hidden;display:flex;align-items:${el.verticalAlign === 'top' ? 'flex-start' : el.verticalAlign === 'bottom' ? 'flex-end' : 'center'};">${escapeHtml(text)}</div>`;
    default: {
      // 文本
      const invBg = el.isInverted ? el.color || '#000' : 'transparent';
      const invColor = el.isInverted ? el.backgroundColor || '#fff' : (el.color || '#000');
      return `<div style="width:100%;height:100%;color:${invColor};background:${invBg};font-size:${el.fontSize}pt;font-weight:${el.isBold ? 'bold' : 'normal'};font-family:${el.fontFamily || 'Arial, sans-serif'};text-align:${el.textAlign || 'left'};white-space:nowrap;overflow:hidden;display:flex;align-items:${el.verticalAlign === 'top' ? 'flex-start' : el.verticalAlign === 'bottom' ? 'flex-end' : 'center'};padding:${el.isInverted ? '0.4mm 0.6mm' : '0'};box-sizing:border-box;">${escapeHtml(text)}</div>`;
    }
  }
}

function tableInnerHtml(el: LabelElement): string {
  const t = el.table || { rows: 3, cols: 3, cells: [] };
  const rows = t.rows || 3;
  const cols = t.cols || 3;
  const cells: any[] = t.cells && t.cells.length ? t.cells : Array.from({ length: rows * cols }, (_, i) => ({ text: String(i + 1) }));
  // 已放置网格：用于正确处理合并单元格
  const placed: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  // 列宽：colWidths 为相对权重（空缺=1），归一化为百分比
  const cw = Array.from({ length: cols }, (_, c) => (t.colWidths && t.colWidths[c] > 0 ? t.colWidths[c] : 1));
  const cwSum = cw.reduce((a, b) => a + b, 0);
  let html = `<table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;">`;
  html += `<colgroup>${cw.map(v => `<col style="width:${(v / cwSum * 100).toFixed(3)}%">`).join('')}</colgroup>`;
  for (let r = 0; r < rows; r++) {
    const rh = t.rowHeights && t.rowHeights[r] > 0 ? ` style="height:${t.rowHeights[r]}mm"` : '';
    html += `<tr${rh}>`;
    for (let c = 0; c < cols; c++) {
      if (placed[r][c]) continue;
      const cell = cells[r * cols + c];
      if (!cell || cell.hidden) {
        // 被合并覆盖的空位：标记放置
        placed[r][c] = true;
        continue;
      }
      const rs = cell.rowSpan || 1;
      const cs = cell.colSpan || 1;
      for (let rr = r; rr < Math.min(r + rs, rows); rr++)
        for (let cc = c; cc < Math.min(c + cs, cols); cc++) placed[rr][cc] = true;
      const align = cell.align === 'right' ? 'right' : cell.align === 'center' ? 'center' : 'left';
      const td = `<td rowspan="${rs}" colspan="${cs}" style="border:0.15mm solid ${el.strokeColor || '#666'};background:${cell.bgColor || 'transparent'};padding:0.3mm;overflow:hidden;text-align:${align};vertical-align:middle;font-size:${el.fontSize}pt;font-weight:${cell.bold || el.isBold ? 'bold' : 'normal'};color:${cell.color || el.color || '#000'};">${escapeHtml(cell.text || '')}</td>`;
      html += td;
    }
    html += `</tr>`;
  }
  html += `</table>`;
  return html;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 计算一个标签在整批打印中的记录序号（用于序列号连续与跳过页编号）。
 * 若数据行携带 __rowIndex 则直接使用（分段/范围打印时保证序列号连续）。
 */
function effIndex(row: Record<string, any>, i: number, o: PrintOptions): number {
  const ri = row && typeof (row as any).__rowIndex === 'number' ? (row as any).__rowIndex : i;
  return ri + (o.rowIndexOffset || 0);
}

/** 生成各页 body 片段（打印 / PDF 导出共用） */
export function renderLabelsPagesHtml(template: LabelTemplate, rows: Record<string, any>[], opts: PrintOptions): string {
  const o = opts;
  const copies = o.copies || 1;
  const all = resolveRows(rows, copies);
  const skip = o.skipPages || new Set<number>();
  const labelW = template.width;
  const labelH = template.height;
  const pages: string[] = [];

  if (o.mode === 'sheet' && o.cols && o.rows) {
    const sheetW = o.sheetWidth || 210;
    const sheetH = o.sheetHeight || 297;
    const mt = o.marginTop || 0;
    const ml = o.marginLeft || 0;
    const gx = o.gapX || 0;
    const gy = o.gapY || 0;
    const perPage = o.cols * o.rows;
    for (let p = 0; p < all.length; p += perPage) {
      const pageRows = all.slice(p, p + perPage);
      let inner = `<div style="width:${sheetW}mm;height:${sheetH}mm;position:relative;margin:0;padding:0;">`;
      pageRows.forEach((row, idx) => {
        const gi = effIndex(row, p + idx, o) + 1;
        if (skip.has(gi)) return;
        const r = Math.floor(idx / o.cols!);
        const c = idx % o.cols!;
        const x = ml + c * (labelW + gx);
        const y = mt + r * (labelH + gy);
        inner += `<div style="position:absolute;left:${x + (o.offsetX || 0)}mm;top:${y + (o.offsetY || 0)}mm;width:${labelW}mm;height:${labelH}mm;overflow:hidden;">${renderLabelInnerHtml(template, row, effIndex(row, p + idx, o), undefined)}</div>`;
      });
      inner += `</div>`;
      pages.push(`<div class="page" style="page-break-after:${p + perPage >= all.length ? 'auto' : 'always'};">${inner}</div>`);
    }
  } else {
    // 卷式：一张标签一页（或一行多列）
    const cols = o.rollCols || 1;
    const gx = o.rollGapX || 0;
    const rotate = o.rotate === 'left' || o.rotate === 'right';
    const pw = rotate ? labelH : labelW;
    const ph = rotate ? labelW : labelH;
    const rotCss = o.rotate === 'left' ? 'rotate(-90deg)' : 'rotate(90deg)';
    for (let i = 0; i < all.length; i++) {
      const row = all[i];
      const gi = effIndex(row, i, o) + 1;
      if (skip.has(gi)) continue;
      const c = i % cols;
      const x = c * (labelW + gx);
      const inner = rotate
        ? `<div style="position:absolute;left:0;top:0;width:${labelW}mm;height:${labelH}mm;transform:${rotCss};transform-origin:${labelW / 2}mm ${labelH / 2}mm;">${renderLabelInnerHtml(template, row, effIndex(row, i, o), undefined)}</div>`
        : renderLabelInnerHtml(template, row, effIndex(row, i, o), undefined);
      pages.push(
        `<div class="page" style="width:${pw}mm;height:${ph}mm;position:relative;page-break-after:${i >= all.length - 1 ? 'auto' : 'always'};left:${x + (o.offsetX || 0)}mm;top:${o.offsetY || 0}mm;overflow:hidden;">${inner}</div>`
      );
    }
  }

  return pages.join('');
}

/** 生成完整打印 HTML 文档 */
export function renderLabelsHtml(template: LabelTemplate, rows: Record<string, any>[], opts: PrintOptions): string {
  const o = opts;
  const labelW = template.width;
  const labelH = template.height;
  const pageW = o.mode === 'sheet' ? (o.sheetWidth || 210) : (o.rotate === 'left' || o.rotate === 'right' ? labelH : labelW);
  const pageH = o.mode === 'sheet' ? (o.sheetHeight || 297) : (o.rotate === 'left' || o.rotate === 'right' ? labelW : labelH);
  const pages = renderLabelsPagesHtml(template, rows, opts);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; size: ${pageW}mm ${pageH}mm; }
    html, body { margin: 0; padding: 0; }
    * { box-sizing: border-box; color: #000; }
    .page { margin: 0; padding: 0; }
  </style></head><body>${pages}</body></html>`;
}

/* ================= 表格数据默认 ================= */

export function makeEmptyTable(rows: number, cols: number): LabelElement['table'] {
  return {
    rows, cols,
    cells: Array.from({ length: rows * cols }, (_, i) => ({ text: String(i + 1) })),
  };
}

/* ================= 图标库（lucide → SVG dataURL） ================= */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as AllIcons from 'lucide-react';

export const ICON_NAMES = [
  'barcode', 'box', 'package', 'package-check', 'truck', 'leaf', 'sprout', 'flower-2',
  'tag', 'tags', 'user', 'users', 'phone', 'home', 'map-pin', 'mail', 'heart', 'star',
  'sun', 'moon', 'cloud', 'bell', 'calendar', 'calendar-days', 'camera', 'cart',
  'credit-card', 'download', 'upload', 'edit-3', 'eye', 'file-text', 'flag', 'folder',
  'globe', 'grid-3x3', 'help-circle', 'info', 'key', 'lock', 'menu', 'message-square',
  'mic', 'music', 'printer', 'refresh-cw', 'search', 'settings', 'share-2', 'shield',
  'shopping-bag', 'trash-2', 'wifi', 'zap', 'check', 'check-circle', 'alert-triangle',
  'x-circle', 'arrow-right', 'plus', 'minus', 'clock', 'scissors', 'wrench', 'syringe',
  'flask-conical', 'dna', 'beaker', 'test-tube', 'clipboard-list', 'database',
  'hard-drive', 'layers', 'link', 'file', 'bookmark', 'briefcase', 'buildings',
  'factory', 'warehouse', 'flask-round', 'package-open', 'scan-line', 'sticky-note',
];

const ICON_ALIASES: Record<string, string[]> = {
  barcode: ['条码', '码', 'bar', 'tiao ma'],
  box: ['盒子', '箱子', '盒', 'hezi'],
  package: ['包装', '包裹', '打包', 'baozhuang'],
  'package-check': ['已打包', '验货'],
  'package-open': ['开箱'],
  truck: ['快递', '物流', '货车', '运输', 'kuaidi', 'wuliu'],
  leaf: ['叶子', '叶', 'ye'],
  sprout: ['植物', '发芽', '苗', 'zhiwu'],
  'flower-2': ['花', 'hua'],
  tag: ['标签', '价签', 'biaoqian'],
  tags: ['标签组', '多标签'],
  user: ['用户', '人', '人员', 'yonghu', 'ren'],
  users: ['用户组', '人群', '多人'],
  phone: ['电话', '手机', '拨打', 'dianhua'],
  home: ['首页', '家', '房子', 'jia'],
  'map-pin': ['地址', '位置', '定位', '地标', 'dizhi', 'weizhi'],
  mail: ['邮件', '邮箱', '信', 'youjian'],
  heart: ['心', '爱心', 'xin'],
  star: ['星', '星星', '星级', 'xing'],
  sun: ['太阳', '晴天', 'taiyang'],
  moon: ['月亮', '夜晚', 'yueliang'],
  cloud: ['云', '云朵', 'yun'],
  bell: ['铃', '提醒', '通知', 'ling'],
  calendar: ['日历', '日期', 'rili', 'riqi'],
  'calendar-days': ['日历', '日程', '排期'],
  camera: ['相机', '拍照', '摄像头', 'xiangji', 'shexiangtou'],
  cart: ['购物车', '购物', 'gouwuche'],
  'credit-card': ['银行卡', '卡', '刷卡'],
  download: ['下载', 'xia zai'],
  upload: ['上传', 'shang chuan'],
  'edit-3': ['编辑', '笔', '修改', 'bianji'],
  eye: ['眼睛', '查看', '预览', 'yanjing'],
  'file-text': ['文件', '文档', '文本', 'wendang'],
  flag: ['旗', '旗帜', 'qi'],
  folder: ['文件夹', '目录', 'wenjianjia'],
  globe: ['地球', '全球', '网络', 'diqiu'],
  'grid-3x3': ['网格', '宫格', 'wangge'],
  'help-circle': ['帮助', '问号', '帮助中心', 'bangzhu'],
  info: ['信息', '提示', 'xinxi'],
  key: ['钥匙', '密钥', 'yaoshi'],
  lock: ['锁', '锁定', '加密', 'suo'],
  menu: ['菜单', '列表', 'caidan'],
  'message-square': ['消息', '聊天', '对话', 'xiaoxi'],
  mic: ['麦克风', '语音', 'maikefeng'],
  music: ['音乐', 'yinyue'],
  printer: ['打印', '打印机', 'dayin'],
  'refresh-cw': ['刷新', '旋转', 'shuaxin'],
  search: ['搜索', '查找', 'sousuo'],
  settings: ['设置', '齿轮', 'shezhi'],
  'share-2': ['分享', 'fenxiang'],
  shield: ['盾', '安全', '防护', 'dun', 'anquan'],
  'shopping-bag': ['购物袋', '袋子', 'gouwu'],
  'trash-2': ['垃圾', '垃圾桶', '删除', 'laji'],
  wifi: ['无线', '网络', 'wuxian'],
  zap: ['闪电', '电量', 'shandian'],
  check: ['对勾', '勾', '正确', 'dui'],
  'check-circle': ['完成', '成功', '对勾', 'wancheng'],
  'alert-triangle': ['警告', '提醒', '注意', 'jinggao'],
  'x-circle': ['关闭', '错误', '叉', 'guanbi'],
  'arrow-right': ['箭头', '向右', '右', 'jiantou'],
  plus: ['加', '添加', '新增', 'jia'],
  minus: ['减', '减少', 'jian'],
  clock: ['时钟', '时间', '计时', 'shizhong'],
  scissors: ['剪刀', '剪切', 'jiandao'],
  wrench: ['扳手', '维修', '工具', 'banshou'],
  syringe: ['注射', '针筒', '打针', 'zhushe'],
  'flask-conical': ['烧瓶', '实验', 'shaoping'],
  dna: ['dna', '基因', 'jiyin'],
  beaker: ['烧杯', '量杯', 'shaobei'],
  'test-tube': ['试管', 'shiguan'],
  'clipboard-list': ['清单', '列表', '记录', 'qingdan'],
  database: ['数据库', '数据', 'shujuku'],
  'hard-drive': ['硬盘', '存储', 'yingpan'],
  layers: ['图层', '层', 'tuceng'],
  link: ['链接', 'lianjie'],
  file: ['文件', '档案', 'wenjian'],
  bookmark: ['书签', 'shuqian'],
  briefcase: ['公文包', '工作', 'gongwenbao'],
  buildings: ['大楼', '大厦', '建筑', 'dasha'],
  factory: ['工厂', '厂房', 'gongchang'],
  warehouse: ['仓库', '库房', 'cangku'],
  'flask-round': ['圆瓶', '容器', 'ping'],
  'scan-line': ['扫码', '扫描', 'saoma'],
  'sticky-note': ['便签', '便签纸', '贴纸', 'bianqian'],
};

export function iconAliases(name: string): string[] {
  return ICON_ALIASES[name] || [];
}

export function iconDataUrl(name: string, color: string, px: number): string {
  const Cmp = (AllIcons as any)[name];
  if (!Cmp) return '';
  const svg = renderToStaticMarkup(React.createElement(Cmp, { size: px, color, strokeWidth: 2 }));
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function iconColorDataUrl(name: string, color: string, px: number): string {
  return iconDataUrl(name, color, px);
}
