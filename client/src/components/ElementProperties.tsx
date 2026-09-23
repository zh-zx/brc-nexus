import React, { useState } from 'react';
import { Language, LabelTemplate, LabelElement, LabelElementType, LabelSegment, TableCell } from '../types';
import { t } from '../utils';
import { legacySegments, makeEmptyTable, iconDataUrl, BARCODE_1D_TYPES, BARCODE_2D_TYPES, BARCODE_TYPE_NAMES } from '../lib/labelUtil';
import { Plus, ArrowUp, ArrowDown, Trash2, Merge, Split } from 'lucide-react';

const FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'sans-serif', 'monospace'];
const TEXT_TYPES = [LabelElementType.TEXT_STATIC, LabelElementType.TEXT_DYNAMIC, LabelElementType.TEXT_PARAGRAPH];

interface Props {
  language: Language;
  template: LabelTemplate;
  selectedIds: string[];
  columns: string[];
  primaryIdColumn: string;
  variableNames: string[];
  onUpdateTemplate: (t: LabelTemplate) => void;
  onDeleteSelected: () => void;
  onOpenImagePicker: (id: string) => void;
  onOpenIconPicker: (id: string) => void;
  onOpenBgImage: () => void;
}

/* ---------- 小组件 ---------- */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="mb-2.5">
    <label className="text-[10px] font-bold text-gray-400 block mb-1">{label}</label>
    {children}
  </div>
);

const Num: React.FC<{ label: string; value: number; onChange: (v: number) => void; step?: number }> = ({ label, value, onChange, step = 0.5 }) => (
  <Field label={label}>
    <input type="number" step={step} value={value} onChange={e => onChange(Number(e.target.value) || 0)} className="w-full glass-input rounded p-2 text-sm" />
  </Field>
);

const ColorPick: React.FC<{ label: string; value?: string; onChange: (v?: string) => void; allowClear?: boolean }> = ({ label, value, onChange, allowClear }) => (
  <Field label={label}>
    <div className="flex items-center gap-2">
      <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} className="w-9 h-9 rounded cursor-pointer border border-gray-200 bg-white p-0.5" />
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="透明" className="flex-1 glass-input rounded p-2 text-sm" />
      {allowClear && <button onClick={() => onChange(undefined)} className="text-[10px] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500">无</button>}
    </div>
  </Field>
);

const Sel: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }> = ({ label, value, onChange, options }) => (
  <Field label={label}>
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full glass-input rounded p-2 text-sm bg-white/50">
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </Field>
);

const Check: React.FC<{ label: string; checked?: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 py-1 cursor-pointer select-none">
    <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 rounded text-[#2e7d32] focus:ring-[#2e7d32]" />
    {label}
  </label>
);

/* ---------- 片段编辑器（LabelNova 数据绑定） ---------- */
const SegmentEditor: React.FC<{
  el: LabelElement; language: Language; columns: string[]; variableNames: string[];
  onChange: (segments: LabelSegment[]) => void;
}> = ({ el, language, columns, variableNames, onChange }) => {
  const segments = el.segments && el.segments.length ? el.segments : legacySegments(el);
  const set = (i: number, u: Partial<LabelSegment>) => onChange(segments.map((s, idx) => idx === i ? { ...s, ...u } : s));
  const remove = (i: number) => onChange(segments.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= segments.length) return;
    const arr = [...segments];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const add = (type: string) => {
    const seg: LabelSegment = { id: Math.random().toString(36).slice(2, 8), type: type as LabelSegment['type'] };
    if (type === 'text') seg.text = '';
    if (type === 'field') seg.field = columns[0] || '';
    if (type === 'variable') seg.variable = variableNames[0] || '';
    if (type === 'date') seg.dateFormat = 'YYYY/MM/DD';
    if (type === 'serial') { seg.serialStart = 1; seg.serialStep = 1; seg.serialRepeat = 1; seg.serialPad = 0; }
    onChange([...segments, seg]);
  };
  const typeLabel = (s: LabelSegment) => {
    switch (s.type) {
      case 'text': return t('design.seg.text', language);
      case 'field': return t('design.seg.field', language);
      case 'variable': return t('design.seg.variable', language);
      case 'date': return t('design.seg.date', language);
      case 'serial': return t('design.seg.serial', language);
    }
  };
  const badgeColor = (s: LabelSegment) => {
    switch (s.type) {
      case 'text': return 'bg-gray-100 text-gray-600';
      case 'field': return 'bg-blue-50 text-blue-600';
      case 'variable': return 'bg-purple-50 text-purple-600';
      case 'date': return 'bg-orange-50 text-orange-600';
      case 'serial': return 'bg-green-50 text-green-700';
    }
  };

  return (
    <div className="bg-white/40 rounded-xl border border-white/60 p-2.5 space-y-2">
      <div className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">{t('design.segments', language)}</div>
      {segments.map((seg, i) => (
        <div key={seg.id} className="bg-white rounded-lg border border-gray-100 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${badgeColor(seg)}`}>{typeLabel(seg)}</span>
            <div className="flex gap-0.5">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
              <button onClick={() => move(i, 1)} disabled={i === segments.length - 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
              <button onClick={() => remove(i)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
          {seg.type === 'text' && <input value={seg.text || ''} onChange={e => set(i, { text: e.target.value })} placeholder="输入固定文字..." className="w-full glass-input rounded p-1.5 text-sm" />}
          {seg.type === 'field' && (
            <select value={seg.field || ''} onChange={e => set(i, { field: e.target.value })} className="w-full glass-input rounded p-1.5 text-sm bg-white/50">
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="operator">{t('common.operator', language)}</option>
              <option value="medium">Medium</option>
            </select>
          )}
          {seg.type === 'variable' && (
            <select value={seg.variable || ''} onChange={e => set(i, { variable: e.target.value })} className="w-full glass-input rounded p-1.5 text-sm bg-white/50">
              {(variableNames.length ? variableNames : ['']).map(v => <option key={v} value={v}>{v || '(无变量)'}</option>)}
            </select>
          )}
          {seg.type === 'date' && (
            <div className="space-y-1.5">
              <input value={seg.dateFormat || ''} onChange={e => set(i, { dateFormat: e.target.value })} placeholder="YYYY年MM月DD日" className="w-full glass-input rounded p-1.5 text-xs" />
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <span>{t('design.dateOffset', language)}:</span>
                <input type="number" value={seg.dateOffset || 0} onChange={e => set(i, { dateOffset: Number(e.target.value) || 0 })} className="w-16 glass-input rounded p-1 text-xs" />
              </div>
            </div>
          )}
          {seg.type === 'serial' && (
            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-400">
              <label>{t('design.serialStart', language)}<input type="number" value={seg.serialStart ?? 1} onChange={e => set(i, { serialStart: Number(e.target.value) || 0 })} className="w-full glass-input rounded p-1 text-xs" /></label>
              <label>{t('design.serialStep', language)}<input type="number" value={seg.serialStep ?? 1} onChange={e => set(i, { serialStep: Number(e.target.value) || 1 })} className="w-full glass-input rounded p-1 text-xs" /></label>
              <label>{t('design.serialRepeat', language)}<input type="number" value={seg.serialRepeat ?? 1} onChange={e => set(i, { serialRepeat: Number(e.target.value) || 1 })} className="w-full glass-input rounded p-1 text-xs" /></label>
              <label>{t('design.serialPad', language)}<input type="number" value={seg.serialPad || 0} onChange={e => set(i, { serialPad: Number(e.target.value) || 0 })} className="w-full glass-input rounded p-1 text-xs" /></label>
              <label className="col-span-2 flex items-center gap-2">
                <input type="checkbox" checked={!!seg.serialDecrement} onChange={e => set(i, { serialDecrement: e.target.checked })} className="w-4 h-4" />
                {t('design.serialDec', language)}
              </label>
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-1.5">
        <select
          value=""
          onChange={e => { if (e.target.value) add(e.target.value); }}
          className="flex-1 glass-input rounded p-1.5 text-xs text-gray-500 bg-white/50">
          <option value="">{t('design.addSegment', language)} +</option>
          <option value="text">{t('design.seg.text', language)}</option>
          <option value="field">{t('design.seg.field', language)}</option>
          <option value="variable">{t('design.seg.variable', language)}</option>
          <option value="date">{t('design.seg.date', language)}</option>
          <option value="serial">{t('design.seg.serial', language)}</option>
        </select>
      </div>
    </div>
  );
};

/* ---------- 表格编辑器 ---------- */
const TableEditor: React.FC<{ el: LabelElement; language: Language; onChange: (u: Partial<LabelElement>) => void }> = ({ el, language, onChange }) => {
  const tbl = el.table || makeEmptyTable(3, 3);
  const rows = tbl.rows || 3;
  const cols = tbl.cols || 3;
  const cells: TableCell[] = tbl.cells && tbl.cells.length ? [...tbl.cells] : Array.from({ length: rows * cols }, () => ({ text: '' }));
  const [sel, setSel] = useState<Set<number>>(new Set());

  const setTable = (nt: LabelElement['table']) => onChange({ table: nt });

  const setCell = (idx: number, u: Partial<TableCell>) => {
    const nc = [...cells];
    nc[idx] = { ...(nc[idx] || { text: '' }), ...u };
    setTable({ ...tbl, rows, cols, cells: nc });
  };

  const toggle = (idx: number) => {
    setSel(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });
  };

  const addRow = () => setTable({ ...tbl, rows: rows + 1, cells: [...cells, ...Array.from({ length: cols }, () => ({ text: '' }))] });
  const addCol = () => {
    const nc = [...cells];
    for (let r = 0; r < rows; r++) nc.splice((r + 1) * cols + r, 0, { text: '' });
    setTable({ ...tbl, rows, cols: cols + 1, cells: nc });
  };
  const delRow = () => rows > 1 && setTable({ ...tbl, rows: rows - 1, cells: cells.slice(0, (rows - 1) * cols) });
  const delCol = () => {
    if (cols <= 1) return;
    const nc = cells.filter((_, i) => i % cols !== cols - 1);
    setTable({ ...tbl, cols: cols - 1, cells: nc });
  };

  const merge = () => {
    if (sel.size < 2) return;
    const idxs = [...sel].sort((a, b) => a - b);
    const r0 = Math.floor(idxs[0] / cols), c0 = idxs[0] % cols;
    const r1 = Math.floor(idxs[idxs.length - 1] / cols), c1 = idxs[idxs.length - 1] % cols;
    const all = new Set(idxs);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!all.has(r * cols + c)) return; // 非连续矩形
    const nc = cells.map(cell => ({ ...cell, hidden: false, rowSpan: 1, colSpan: 1 }));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (r === r0 && c === c0) { nc[r * cols + c] = { ...nc[r * cols + c], rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 }; }
      else nc[r * cols + c] = { ...nc[r * cols + c], hidden: true };
    }
    setTable({ ...tbl, rows, cols, cells: nc });
    setSel(new Set());
  };

  const split = () => {
    let changed = false;
    const nc = cells.map((cell, i) => {
      if (sel.has(i) && (cell.rowSpan || 1) > 1) {
        changed = true;
        return { ...cell, rowSpan: 1, colSpan: 1, hidden: false };
      }
      return cell;
    });
    if (changed) { setTable({ ...tbl, rows, cols, cells: nc }); setSel(new Set()); }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Num label={t('design.tableRows', language)} value={rows} onChange={v => {
          if (v > rows) setTable({ ...tbl, rows: v, cells: [...cells, ...Array.from({ length: (v - rows) * cols }, () => ({ text: '' }))] });
          else if (v < rows && v > 0) setTable({ ...tbl, rows: v, cells: cells.slice(0, v * cols) });
        }} step={1} />
        <Num label={t('design.tableCols', language)} value={cols} onChange={v => {
          if (v > cols) {
            const nc = [...cells];
            for (let r = 0; r < rows; r++) nc.splice((r + 1) * cols + r, 0, ...Array.from({ length: v - cols }, () => ({ text: '' })));
            setTable({ ...tbl, cols: v, cells: nc });
          } else if (v < cols && v > 0) setTable({ ...tbl, cols: v, cells: cells.filter((_, i) => i % cols < v) });
        }} step={1} />
      </div>
      <div className="text-[10px] text-gray-400 mb-1">点击单元格选择（可多选）→ 合并 / 拆分</div>
      <div className="grid gap-px bg-gray-200 border border-gray-200 rounded overflow-hidden" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {Array.from({ length: rows * cols }, (_, i) => {
          const cell: TableCell = cells[i] || { text: '' };
          const hidden = !!cell.hidden;
          const isSel = sel.has(i);
          return (
            <input
              key={i}
              disabled={hidden}
              value={hidden ? '' : (cell.text || '')}
              onChange={e => setCell(i, { text: e.target.value })}
              onClick={() => toggle(i)}
              placeholder={hidden ? '·' : ''}
              className={`min-w-0 text-[11px] p-1 outline-none ${hidden ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-white hover:bg-blue-50'} ${isSel ? 'bg-blue-100 ring-1 ring-blue-400' : ''}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={addRow} className="flex-1 text-[10px] font-bold py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"><Plus className="w-3 h-3 inline mr-1" />{t('design.tableInsertRow', language)}</button>
        <button onClick={addCol} className="flex-1 text-[10px] font-bold py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"><Plus className="w-3 h-3 inline mr-1" />{t('design.tableInsertCol', language)}</button>
        <button onClick={delRow} className="flex-1 text-[10px] font-bold py-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500"><Trash2 className="w-3 h-3 inline mr-1" />{t('design.tableDelRow', language)}</button>
        <button onClick={delCol} className="flex-1 text-[10px] font-bold py-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500"><Trash2 className="w-3 h-3 inline mr-1" />{t('design.tableDelCol', language)}</button>
        <button onClick={merge} className="flex-1 text-[10px] font-bold py-1.5 rounded bg-[#e8f5e9] hover:bg-green-100 text-[#2e7d32]"><Merge className="w-3 h-3 inline mr-1" />{t('design.tableMerge', language)}</button>
        <button onClick={split} className="flex-1 text-[10px] font-bold py-1.5 rounded bg-[#e8f5e9] hover:bg-green-100 text-[#2e7d32]"><Split className="w-3 h-3 inline mr-1" />{t('design.tableSplit', language)}</button>
      </div>

      {/* 行高 / 列宽（LabelNova 5.2 调整行列尺寸） */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-gray-400 font-bold">{t('design.tableRowH', language)}（mm）</div>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: rows }, (_, r) => (
            <input key={r} type="number" step={0.5} value={tbl.rowHeights?.[r] ?? ''}
              placeholder={`R${r + 1}`}
              onChange={e => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                const rh = [...(tbl.rowHeights || [])];
                if (v === undefined || v > 0) rh[r] = v as number; else rh[r] = undefined;
                setTable({ ...tbl, rows, cols, cells, rowHeights: rh.some(x => x > 0) ? rh : undefined });
              }}
              className="w-14 glass-input rounded p-1 text-[10px]" />
          ))}
        </div>
        <div className="text-[10px] text-gray-400 font-bold">{t('design.tableColW', language)}（比例）</div>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: cols }, (_, c) => (
            <input key={c} type="number" step={0.5} value={tbl.colWidths?.[c] ?? ''}
              placeholder={`C${c + 1}`}
              onChange={e => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                const cwid = [...(tbl.colWidths || [])];
                if (v === undefined || v > 0) cwid[c] = v as number; else cwid[c] = undefined;
                setTable({ ...tbl, rows, cols, cells, colWidths: cwid.some(x => x > 0) ? cwid : undefined });
              }}
              className="w-14 glass-input rounded p-1 text-[10px]" />
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------- 空选择：标签背景 ---------- */
const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  B5: { w: 176, h: 250 },
};

const BackgroundPanel: React.FC<{ template: LabelTemplate; language: Language; onUpdateTemplate: (t: LabelTemplate) => void; onOpenBgImage: () => void }> = ({ template, language, onUpdateTemplate, onOpenBgImage }) => {
  const layout = template.layout || { mode: 'roll' as const, rollCols: 1, rollGapX: 0 };

  /** 纸张模式：按标签尺寸+边距间距自动计算每张纸行列数 */
  const calcRowsCols = (l: typeof layout & { [k: string]: any }) => {
    const sw = l.sheetWidth || 210, sh = l.sheetHeight || 297;
    const gx = l.gapX || 0, gy = l.gapY || 0;
    const rows = Math.max(1, Math.floor((sh - (l.marginTop || 0) - (l.marginBottom || 0) + gy) / (template.height + gy)));
    const cols = Math.max(1, Math.floor((sw - (l.marginLeft || 0) - (l.marginRight || 0) + gx) / (template.width + gx)));
    return { rows, cols };
  };

  const setLayout = (u: Record<string, any>) => {
    const next = { ...layout, ...u } as typeof layout & { [k: string]: any };
    if (next.mode === 'sheet') Object.assign(next, calcRowsCols(next));
    onUpdateTemplate({ ...template, layout: next });
  };

  const switchMode = (mode: 'roll' | 'sheet') => {
    if (mode === layout.mode) return;
    if (mode === 'roll') setLayout({ mode, rollCols: 1, rollGapX: 0 });
    else setLayout({ mode, sheetWidth: 210, sheetHeight: 297, marginTop: 10, marginBottom: 10, marginLeft: 10, marginRight: 10, gapX: 2, gapY: 2 });
  };

  const applyPaper = (key: string) => {
    if (key === 'custom') return;
    setLayout({ sheetWidth: PAPER_SIZES[key].w, sheetHeight: PAPER_SIZES[key].h });
  };

  const curPreset = Object.entries(PAPER_SIZES).find(([, v]) => v.w === (layout.sheetWidth || 0) && v.h === (layout.sheetHeight || 0))?.[0] || 'custom';

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider mb-3 flex items-center gap-1">{t('design.canvasBg', language)}</h3>
        <div className="space-y-3 bg-white/40 rounded-xl border border-white/60 p-3">
          <ColorPick label={t('design.bgColor', language)} value={template.backgroundColor || '#ffffff'} onChange={v => onUpdateTemplate({ ...template, backgroundColor: v || '#ffffff' })} allowClear />
          <Field label={t('design.bgImage', language)}>
            <div className="flex gap-2">
              <button onClick={onOpenBgImage} className="flex-1 text-xs font-bold py-2 rounded-lg bg-[#e8f5e9] hover:bg-green-100 text-[#2e7d32]">{t('design.uploadImage', language)}</button>
              {template.backgroundImage && (
                <button onClick={() => onUpdateTemplate({ ...template, backgroundImage: undefined })} className="px-3 text-xs font-bold py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-500">{t('design.clearBgImage', language)}</button>
              )}
            </div>
            {template.backgroundImage && <div className="mt-2 rounded overflow-hidden border border-gray-200"><img src={template.backgroundImage} className="w-full h-16 object-cover" /></div>}
          </Field>
        </div>
      </div>
      <div>
        <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider mb-3">{t('design.config', language)}</h3>
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <Field label={t('design.templateName', language)}>
            <input value={template.name} onChange={e => onUpdateTemplate({ ...template, name: e.target.value })} className="w-full glass-input rounded p-2 text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label={t('common.width', language)} value={template.width} onChange={v => { const w = Math.max(1, v); const l = { ...layout } as any; if (l.mode === 'sheet') Object.assign(l, calcRowsCols(l)); onUpdateTemplate({ ...template, width: w, layout: l }); }} />
            <Num label={t('common.height', language)} value={template.height} onChange={v => { const h = Math.max(1, v); const l = { ...layout } as any; if (l.mode === 'sheet') Object.assign(l, calcRowsCols(l)); onUpdateTemplate({ ...template, height: h, layout: l }); }} />
          </div>
        </div>
      </div>

      {/* 纸张 / 打印排版（LabelNova 4.2：随时修改纸张设置） */}
      <div>
        <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider mb-3">{t('design.pageSetup', language)}</h3>
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <div className="grid grid-cols-1 gap-2">
            <button onClick={() => switchMode('roll')} className={`text-left px-3 py-2 rounded-lg border transition-all text-xs font-bold ${layout.mode === 'roll' ? 'border-[#2e7d32] bg-[#e8f5e9] text-[#2e7d32]' : 'border-gray-100 bg-white/60 text-gray-600 hover:border-green-200'}`}>
              📜 {t('design.modeRoll', language)}
            </button>
            <button onClick={() => switchMode('sheet')} className={`text-left px-3 py-2 rounded-lg border transition-all text-xs font-bold ${layout.mode === 'sheet' ? 'border-[#2e7d32] bg-[#e8f5e9] text-[#2e7d32]' : 'border-gray-100 bg-white/60 text-gray-600 hover:border-green-200'}`}>
              📄 {t('design.modeSheet', language)}
            </button>
          </div>

          {layout.mode === 'roll' ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Num label={t('wizard.rollCols', language)} value={layout.rollCols || 1} onChange={v => setLayout({ rollCols: Math.max(1, v) })} step={1} />
                <Num label={t('wizard.gapX', language)} value={layout.rollGapX || 0} onChange={v => setLayout({ rollGapX: Math.max(0, v) })} />
              </div>
              <div className="text-[10px] text-gray-400">热敏纸一卷一页，每页并排 {(layout.rollCols || 1)} 张标签</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <select value={curPreset} onChange={e => applyPaper(e.target.value)} className="flex-1 glass-input rounded p-2 text-xs bg-white/50">
                  {Object.entries(PAPER_SIZES).map(([k, v]) => <option key={k} value={k}>{k} ({v.w}×{v.h}mm)</option>)}
                  <option value="custom">{t('design.custom', language)}</option>
                </select>
                <button onClick={() => setLayout({ sheetWidth: layout.sheetHeight || 297, sheetHeight: layout.sheetWidth || 210 })}
                  className="px-3 py-2 rounded-lg bg-white shadow-sm text-[10px] font-bold text-gray-600 hover:shadow-md transition-all whitespace-nowrap">
                  {(layout.sheetWidth || 210) <= (layout.sheetHeight || 297) ? t('design.portrait', language) : t('design.landscape', language)} ↻
                </button>
              </div>
              {curPreset === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <Num label={`${t('common.width', language)}(mm)`} value={layout.sheetWidth || 210} onChange={v => setLayout({ sheetWidth: Math.max(10, v) })} />
                  <Num label={`${t('common.height', language)}(mm)`} value={layout.sheetHeight || 297} onChange={v => setLayout({ sheetHeight: Math.max(10, v) })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {([['wizard.marginTop', 'marginTop'], ['wizard.marginBottom', 'marginBottom'], ['wizard.marginLeft', 'marginLeft'], ['wizard.marginRight', 'marginRight'], ['wizard.gapX', 'gapX'], ['wizard.gapY', 'gapY']] as const).map(([key, prop]) => (
                  <label key={prop} className="text-[10px] text-gray-500 font-bold">
                    {t(key, language)}
                    <input type="number" value={(layout as any)[prop] ?? 0} onChange={e => setLayout({ [prop]: Math.max(0, Number(e.target.value) || 0) })} className="w-full glass-input rounded p-1.5 text-xs mt-0.5" />
                  </label>
                ))}
              </div>
              <div className="text-[10px] font-black text-[#2e7d32]">
                ✔ {t('design.perSheet', language)}：<span className="text-orange-600">{layout.rows || 1}</span> {t('design.rows', language)} × <span className="text-orange-600">{layout.cols || 1}</span> {t('design.cols', language)} = <span className="text-orange-600">{(layout.rows || 1) * (layout.cols || 1)}</span> 张
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------- 主组件 ---------- */
export const ElementProperties: React.FC<Props> = (props) => {
  const { template, selectedIds, language, columns, primaryIdColumn, variableNames, onUpdateTemplate, onDeleteSelected, onOpenImagePicker, onOpenIconPicker, onOpenBgImage } = props;

  const updateEl = (id: string, updates: Partial<LabelElement>) => {
    onUpdateTemplate({ ...template, elements: template.elements.map(el => el.id === id ? { ...el, ...updates } : el) });
  };

  if (selectedIds.length === 0) {
    return <BackgroundPanel template={template} language={language} onUpdateTemplate={onUpdateTemplate} onOpenBgImage={onOpenBgImage} />;
  }

  if (selectedIds.length > 1) {
    return (
      <div className="text-center mt-10 text-gray-400">
        <div className="w-14 h-14 bg-white/50 rounded-full flex items-center justify-center mx-auto mb-3">
          <span className="font-black text-[#2e7d32]">{selectedIds.length}</span>
        </div>
        <p className="text-sm font-medium">{t('design.multiSelect', language).replace('{n}', String(selectedIds.length))}</p>
        <p className="text-[10px] mt-2 text-gray-300">使用顶部工具栏进行对齐 / 等距分布 / 编组 / 层级调整</p>
        <button onClick={onDeleteSelected} className="mt-4 w-full bg-red-50 text-red-500 py-3 rounded-xl text-xs font-bold hover:bg-red-100 border border-red-100">删除所选 ({selectedIds.length})</button>
      </div>
    );
  }

  const el = template.elements.find(e => e.id === selectedIds[0]);
  if (!el) return null;
  const isText = TEXT_TYPES.includes(el.type);
  const isBarcodeable = [LabelElementType.TEXT_STATIC, LabelElementType.TEXT_DYNAMIC, LabelElementType.TEXT_PARAGRAPH, LabelElementType.BARCODE, LabelElementType.QR_CODE].includes(el.type);
  const is2d = el.type === LabelElementType.BARCODE && BARCODE_2D_TYPES.includes((el.barcodeType || '').toUpperCase());

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* 通用：坐标尺寸旋转 */}
      <div className="bg-white/40 rounded-xl border border-white/60 p-3">
        <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider mb-2.5">{t('design.config', language)}</h3>
        <div className="grid grid-cols-4 gap-2">
          <Num label="X" value={el.x} onChange={v => updateEl(el.id, { x: Math.max(0, v) })} />
          <Num label="Y" value={el.y} onChange={v => updateEl(el.id, { y: Math.max(0, v) })} />
          <Num label="W" value={el.width} onChange={v => updateEl(el.id, { width: Math.max(1, v) })} />
          <Num label="H" value={el.height} onChange={v => updateEl(el.id, { height: Math.max(1, v) })} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400">{t('design.rotation', language)}</span>
          <input type="number" step={15} value={el.rotation || 0} onChange={e => updateEl(el.id, { rotation: Number(e.target.value) || 0 })} className="flex-1 glass-input rounded p-2 text-sm" />
          <button onClick={() => updateEl(el.id, { rotation: ((el.rotation || 0) - 45 + 360) % 360 })} className="text-[10px] font-bold px-2 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">↺45</button>
          <button onClick={() => updateEl(el.id, { rotation: ((el.rotation || 0) + 45) % 360 })} className="text-[10px] font-bold px-2 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">↻45</button>
        </div>
      </div>

      {/* 文本样式 */}
      {isText && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">{t('design.properties', language)}</h3>
          <div className="grid grid-cols-2 gap-2">
            <Num label={t('common.font', language)} value={el.fontSize} onChange={v => updateEl(el.id, { fontSize: Math.max(1, v) })} step={1} />
            <Field label={t('design.fontFamily', language)}>
              <select value={el.fontFamily || 'Arial'} onChange={e => updateEl(el.id, { fontFamily: e.target.value })} className="w-full glass-input rounded p-2 text-sm bg-white/50">
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
          </div>
          <Check label="Bold" checked={el.isBold} onChange={v => updateEl(el.id, { isBold: v })} />
          <ColorPick label={t('design.fillColor', language)} value={el.color} onChange={v => updateEl(el.id, { color: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Sel label={t('design.textAlign', language)} value={el.textAlign || 'left'} onChange={v => updateEl(el.id, { textAlign: v as any })} options={[{ v: 'left', l: '左' }, { v: 'center', l: '中' }, { v: 'right', l: '右' }]} />
            <Sel label={t('design.verticalAlign', language)} value={el.verticalAlign || 'middle'} onChange={v => updateEl(el.id, { verticalAlign: v as any })} options={[{ v: 'top', l: '上' }, { v: 'middle', l: '中' }, { v: 'bottom', l: '下' }]} />
          </div>
          {el.type !== LabelElementType.TEXT_PARAGRAPH && (
            <Check label={t('design.invert', language)} checked={el.isInverted} onChange={v => updateEl(el.id, { isInverted: v })} />
          )}
        </div>
      )}

      {/* 图形 */}
      {el.type === LabelElementType.RECTANGLE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">图形</h3>
          <ColorPick label={t('design.fillColor', language)} value={el.backgroundColor} onChange={v => updateEl(el.id, { backgroundColor: v })} allowClear />
          <ColorPick label={t('design.strokeColor', language)} value={el.strokeColor || '#000000'} onChange={v => updateEl(el.id, { strokeColor: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={t('design.strokeWidth', language)} value={el.strokeWidth || 1} onChange={v => updateEl(el.id, { strokeWidth: Math.max(0, v) })} step={0.1} />
            <Num label={t('design.cornerRadius', language)} value={el.cornerRadius || 0} onChange={v => updateEl(el.id, { cornerRadius: Math.max(0, v) })} step={0.5} />
          </div>
        </div>
      )}
      {el.type === LabelElementType.CIRCLE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">圆形</h3>
          <ColorPick label={t('design.fillColor', language)} value={el.backgroundColor} onChange={v => updateEl(el.id, { backgroundColor: v })} allowClear />
          <ColorPick label={t('design.strokeColor', language)} value={el.strokeColor || '#000000'} onChange={v => updateEl(el.id, { strokeColor: v })} />
          <Num label={t('design.strokeWidth', language)} value={el.strokeWidth || 1} onChange={v => updateEl(el.id, { strokeWidth: Math.max(0, v) })} step={0.1} />
        </div>
      )}
      {el.type === LabelElementType.LINE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">线条</h3>
          <ColorPick label={t('design.strokeColor', language)} value={el.strokeColor || el.color || '#000000'} onChange={v => updateEl(el.id, { strokeColor: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={t('design.strokeWidth', language)} value={el.strokeWidth || 1} onChange={v => updateEl(el.id, { strokeWidth: Math.max(0.1, v) })} step={0.1} />
            <Num label={t('design.dashLength', language)} value={el.dashLength || 1} onChange={v => updateEl(el.id, { dashLength: Math.max(0.3, v) })} step={0.2} />
          </div>
          <Check label={t('design.dashed', language)} checked={el.dashed} onChange={v => updateEl(el.id, { dashed: v })} />
        </div>
      )}

      {/* 条码 / 二维码 */}
      {el.type === LabelElementType.BARCODE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">{t('design.barcodeConfig', language)}</h3>
          <Sel label={t('design.barcodeType', language)} value={el.barcodeType || 'CODE128'} onChange={v => updateEl(el.id, { barcodeType: v })} options={[...BARCODE_1D_TYPES, ...BARCODE_2D_TYPES].map(t => ({ v: t, l: BARCODE_TYPE_NAMES[t] || t }))} />
          {!is2d && (
            <>
              <Sel label={t('design.barcodeText', language)} value={el.barcodeTextDisplay || 'bottom'} onChange={v => updateEl(el.id, { barcodeTextDisplay: v as any })} options={[{ v: 'bottom', l: t('design.barcodeText.bottom', language) }, { v: 'top', l: t('design.barcodeText.top', language) }, { v: 'none', l: t('design.barcodeText.none', language) }]} />
              <Num label={t('design.widthRatio', language)} value={el.barcodeWidthRatio || 2} onChange={v => updateEl(el.id, { barcodeWidthRatio: Math.max(2, v) })} step={0.5} />
            </>
          )}
          {is2d && (
            <Sel label={t('design.eccLevel', language)} value={el.eccLevel || 'M'} onChange={v => updateEl(el.id, { eccLevel: v })} options={[{ v: 'L', l: 'L (7%)' }, { v: 'M', l: 'M (15%)' }, { v: 'Q', l: 'Q (25%)' }, { v: 'H', l: 'H (30%)' }]} />
          )}
          <ColorPick label="Bar" value={el.color || '#000000'} onChange={v => updateEl(el.id, { color: v })} />
          <ColorPick label="BG" value={el.backgroundColor || '#ffffff'} onChange={v => updateEl(el.id, { backgroundColor: v })} />
        </div>
      )}
      {el.type === LabelElementType.QR_CODE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">{t('design.barcodeConfig', language)}</h3>
          <Sel label={t('design.eccLevel', language)} value={el.eccLevel || 'M'} onChange={v => updateEl(el.id, { eccLevel: v })} options={[{ v: 'L', l: 'L (7%)' }, { v: 'M', l: 'M (15%)' }, { v: 'Q', l: 'Q (25%)' }, { v: 'H', l: 'H (30%)' }]} />
          <ColorPick label="FG" value={el.color || '#000000'} onChange={v => updateEl(el.id, { color: v })} />
          <ColorPick label="BG" value={el.backgroundColor || '#ffffff'} onChange={v => updateEl(el.id, { backgroundColor: v })} />
        </div>
      )}

      {/* 图片 / 图标 */}
      {el.type === LabelElementType.IMAGE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">图片</h3>
          <button onClick={() => onOpenImagePicker(el.id)} className="w-full text-xs font-bold py-2.5 rounded-lg bg-[#e8f5e9] hover:bg-green-100 text-[#2e7d32]">{t('design.uploadImage', language)}</button>
          {el.imageSrc && <div className="rounded overflow-hidden border border-gray-200"><img src={el.imageSrc} className="w-full h-16 object-contain bg-white" /></div>}
        </div>
      )}
      {el.type === LabelElementType.ICON && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">图标</h3>
          <button onClick={() => onOpenIconPicker(el.id)} className="w-full text-xs font-bold py-2.5 rounded-lg bg-[#e8f5e9] hover:bg-green-100 text-[#2e7d32]">选择图标</button>
          <ColorPick label={t('design.fillColor', language)} value={el.color || '#000000'} onChange={v => updateEl(el.id, { color: v, imageSrc: iconDataUrl(el.iconName || 'tag', v || '#000000', 128) })} />
        </div>
      )}

      {/* 表格 */}
      {el.type === LabelElementType.TABLE && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3 space-y-2.5">
          <h3 className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">表格</h3>
          <TableEditor el={el} language={language} onChange={u => updateEl(el.id, u)} />
          <div className="grid grid-cols-2 gap-2">
            <Num label={t('common.font', language)} value={el.fontSize} onChange={v => updateEl(el.id, { fontSize: Math.max(1, v) })} step={1} />
            <ColorPick label={t('design.strokeColor', language)} value={el.strokeColor || '#666666'} onChange={v => updateEl(el.id, { strokeColor: v })} />
          </div>
        </div>
      )}

      {/* 数据绑定片段 */}
      {isBarcodeable && (
        <SegmentEditor el={el} language={language} columns={columns} variableNames={variableNames} onChange={segs => updateEl(el.id, { segments: segs })} />
      )}

      {/* 赋值给变量 */}
      {(el.type === LabelElementType.TEXT_DYNAMIC || el.type === LabelElementType.BARCODE || el.type === LabelElementType.QR_CODE) && (
        <div className="bg-white/40 rounded-xl border border-white/60 p-3">
          <Field label="赋值给全局变量（供其他元素引用）">
            <select value={el.assignVariable || ''} onChange={e => updateEl(el.id, { assignVariable: e.target.value || undefined })} className="w-full glass-input rounded p-2 text-sm bg-white/50">
              <option value="">— 不赋值 —</option>
              {(variableNames.length ? variableNames : []).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        </div>
      )}

      {/* 删除 */}
      <button onClick={onDeleteSelected} className="w-full bg-red-50 text-red-500 py-3 rounded-xl text-xs font-bold hover:bg-red-100 flex items-center justify-center gap-2 border border-red-100 active:scale-95 transition-transform">
        <Trash2 className="w-4 h-4" /> {t('design.deleteEl', language)}
      </button>
    </div>
  );
};
