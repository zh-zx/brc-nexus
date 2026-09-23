import React, { useMemo, useState, useEffect } from 'react';
import { LabelTemplate } from '../types';
import { t } from '../utils';
import { useApp } from '../context/AppContext';
import { renderLabelsHtml, renderLabelsPagesHtml, PrintOptions, mmToPx } from '../lib/labelUtil';
import { LabelCanvas } from './LabelCanvas';
import { api } from '../api';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Printer, FileDown, X, ChevronLeft, ChevronRight, LayoutGrid, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  open: boolean;
  template: LabelTemplate;
  rows: Record<string, any>[];
  onClose: () => void;
}

type RangeMode = 'all' | 'current' | 'custom';

/** 解析 "1,3,5-10" 之类页码，返回 0-based 去重排序数组 */
function parseRange(text: string, len: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,，;；\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[-~–]\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= len) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = parseInt(part, 10);
      if (i >= 1 && i <= len) out.add(i - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export const PrintModal: React.FC<Props> = ({ open, template, rows, onClose }) => {
  const { language, selectedPrinter, operators, mediaTypes, primaryIdColumn } = useApp();

  const layout = template.layout || { mode: 'roll' as const, rollCols: 1, rollGapX: 0 };
  const isSheet = layout.mode === 'sheet';
  const sheetW = layout.sheetWidth || 210;
  const sheetH = layout.sheetHeight || 297;
  const sheetRows = layout.rows || 1;
  const sheetCols = layout.cols || 1;
  const perPage = sheetRows * sheetCols;
  const rollCols = layout.rollCols || 1;

  const [previewMode, setPreviewMode] = useState<'single' | 'sheet'>(isSheet ? 'sheet' : 'single');
  const [range, setRange] = useState<RangeMode>('all');
  const [customText, setCustomText] = useState('');
  const [copies, setCopies] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [rotate, setRotate] = useState<'none' | 'left' | 'right'>('none');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [operator, setOperator] = useState('');
  const [medium, setMedium] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { if (!operator && operators.length) setOperator(operators[0].name); }, [operators]);
  useEffect(() => { if (!medium && mediaTypes.length) setMedium(mediaTypes[0].name); }, [mediaTypes]);
  useEffect(() => { setCurrentIndex(0); setSkip(new Set()); setDone(null); }, [open, template.id]);

  const fullList = useMemo(() => {
    const out: any[] = [];
    const c = Math.max(1, Math.min(10000, copies || 1));
    for (const r of rows) for (let i = 0; i < c; i++) out.push({ ...r, __rowIndex: out.length });
    return out;
  }, [rows, copies]);

  const maxIdx = Math.max(0, fullList.length - 1);
  const cur = Math.min(Math.max(currentIndex, 0), maxIdx);
  const totalPages = Math.max(1, Math.ceil(fullList.length / perPage));
  const currentPage = Math.floor(cur / perPage);

  const selected = useMemo(() => {
    if (!fullList.length) return { list: [] as Record<string, any>[], offset: 0 };
    if (range === 'current') {
      if (isSheet && perPage > 1) {
        const start = Math.floor(cur / perPage) * perPage;
        const end = Math.min(start + perPage, fullList.length);
        return { list: fullList.slice(start, end), offset: start };
      }
      return { list: [fullList[cur]], offset: cur };
    }
    if (range === 'custom') {
      const idxs = parseRange(customText, fullList.length);
      return { list: idxs.map(i => fullList[i]), offset: idxs[0] ?? 0 };
    }
    return { list: fullList, offset: 0 };
  }, [fullList, range, customText, cur, isSheet, perPage]);

  const pageW = isSheet ? sheetW : (rotate !== 'none' ? template.height : template.width);
  const pageH = isSheet ? sheetH : (rotate !== 'none' ? template.width : template.height);

  const previewScale = useMemo(() => {
    if (!open) return 1;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    return Math.max(0.6, Math.min(3.5, (vh * 0.48) / mmToPx(template.height)));
  }, [open, template.height]);

  const sheetScale = useMemo(() => {
    if (!open) return 1;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    return Math.max(0.3, Math.min(1.5, (vh * 0.5) / mmToPx(sheetH)));
  }, [open, sheetH]);

  // 当前页（sheet）所含全部标签的 gi 序号
  const currentPageGis = useMemo(() => {
    const start = currentPage * perPage;
    const arr: number[] = [];
    for (let i = start; i < Math.min(start + perPage, fullList.length); i++) arr.push(i + 1);
    return arr;
  }, [currentPage, perPage, fullList.length]);

  if (!open) return null;

  const toggleSkip = (gi: number) => {
    setSkip(prev => {
      const n = new Set(prev);
      if (n.has(gi)) n.delete(gi); else n.add(gi);
      return n;
    });
  };

  const pageSkipped = currentPageGis.length > 0 && currentPageGis.every(g => skip.has(g));
  const pageSlice = fullList.slice(currentPage * perPage, currentPage * perPage + perPage);

  const buildOpts = (): PrintOptions => ({
    mode: isSheet ? 'sheet' : 'roll',
    copies: 1,
    offsetX, offsetY,
    rotate: isSheet ? 'none' : rotate,
    skipPages: skip,
    ...(isSheet
      ? { sheetWidth: sheetW, sheetHeight: sheetH, rows: sheetRows, cols: sheetCols, marginTop: layout.marginTop || 0, marginLeft: layout.marginLeft || 0, gapX: layout.gapX || 0, gapY: layout.gapY || 0 }
      : { rollCols, rollGapX: layout.rollGapX || 0 }),
  });

  const handlePrint = async () => {
    if (!selected.list.length || busy) return;
    setBusy(true); setDone(null);
    try {
      const html = renderLabelsHtml(template, selected.list, buildOpts());
      await api.print(selected.list, template.id, selectedPrinter || undefined, operator || undefined, medium || undefined, 1, html);
      setDone('ok');
    } catch (e) {
      setDone('err');
    } finally { setBusy(false); }
  };

  const handleExportPdf = async () => {
    if (!selected.list.length || busy) return;
    setBusy(true); setDone(null);
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;';
    holder.innerHTML = renderLabelsPagesHtml(template, selected.list, buildOpts());
    document.body.appendChild(holder);
    try {
      await new Promise(r => setTimeout(r, 300));
      const pages = Array.from(holder.querySelectorAll('.page')) as HTMLElement[];
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageW, pageH] } as any);
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false });
        const img = canvas.toDataURL('image/png');
        if (i > 0) pdf.addPage([pageW, pageH], 'portrait');
        pdf.addImage(img, 'PNG', 0, 0, pageW, pageH);
      }
      pdf.save(`${template.name || 'label'}.pdf`);
      setDone('pdf');
    } catch (e) {
      setDone('err');
    } finally { document.body.removeChild(holder); setBusy(false); }
  };

  const segBtn = (active: boolean) =>
    `px-3 py-2 rounded-xl text-xs font-bold transition-all border ${active ? 'bg-[#e8f5e9] border-[#2e7d32] text-[#2e7d32] shadow-sm' : 'bg-white border-gray-100 text-gray-600 hover:border-green-200'}`;

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[130] flex items-center justify-center p-3 no-print">
      <div className="glass-panel bg-white rounded-[2rem] w-full max-w-6xl max-h-[95vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden">
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 bg-gray-50/50 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-[#2e7d32] rounded-full block"></span>
              {t('design.printPreview', language)}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              {template.name} · {template.width}×{template.height}mm · {isSheet ? `${sheetW}×${sheetH}mm ${sheetRows}×${sheetCols}` : `卷式 ${rollCols}列`}
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-gray-500">✕</button>
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-10">
            <AlertCircle className="w-12 h-12" />
            <p className="text-sm font-bold">{t('design.noDataSource', language)}</p>
            <p className="text-xs">请先在左侧导入数据源或选择数据记录</p>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* 左侧设置 */}
            <aside className="w-72 shrink-0 border-r border-gray-100 p-4 space-y-4 overflow-y-auto custom-scrollbar bg-gray-50/40">
              {/* 预览模式 */}
              <div>
                <div className="text-xs font-bold text-gray-500 mb-2">预览模式</div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPreviewMode('single')} className={`${segBtn(previewMode === 'single')} flex items-center justify-center gap-1.5`}>
                    <FileText className="w-3.5 h-3.5" /> {t('design.singleLabel', language)}
                  </button>
                  <button
                    onClick={() => isSheet && setPreviewMode('sheet')}
                    disabled={!isSheet}
                    className={`${segBtn(previewMode === 'sheet')} flex items-center justify-center gap-1.5 ${!isSheet ? 'opacity-40 cursor-not-allowed' : ''}`}
                    title={!isSheet ? '标准标签纸模式可用' : ''}>
                    <LayoutGrid className="w-3.5 h-3.5" /> {t('design.sheetLayout', language)}
                  </button>
                </div>
              </div>

              {/* 打印范围 */}
              <div>
                <div className="text-xs font-bold text-gray-500 mb-2">{t('design.printRange', language)}</div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setRange('all')} className={segBtn(range === 'all')}>{t('design.printRangeAll', language)}</button>
                    <button onClick={() => setRange('current')} className={segBtn(range === 'current')}>
                      {isSheet ? '当前页' : t('design.printRangeCurrent', language)}
                    </button>
                  </div>
                  <button onClick={() => setRange('custom')} className={`${segBtn(range === 'custom')} w-full`}>{t('design.printRangeCustom', language)}</button>
                  {range === 'custom' && (
                    <input value={customText} onChange={e => setCustomText(e.target.value)} placeholder={t('design.printRangeCustomPlaceholder', language)}
                      className="w-full glass-input rounded-xl p-2.5 text-sm animate-scale-in" />
                  )}
                </div>
              </div>

              {/* 份数 & 偏移 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('design.copies', language)}</label>
                  <input type="number" min={1} max={1000} value={copies} onChange={e => setCopies(Math.max(1, Number(e.target.value) || 1))} className="w-full glass-input rounded-xl p-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('design.offsetH', language)}</label>
                  <input type="number" step="0.5" value={offsetX} onChange={e => setOffsetX(Number(e.target.value) || 0)} className="w-full glass-input rounded-xl p-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('design.offsetV', language)}</label>
                  <input type="number" step="0.5" value={offsetY} onChange={e => setOffsetY(Number(e.target.value) || 0)} className="w-full glass-input rounded-xl p-2.5 text-sm" />
                </div>
                {!isSheet && (
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('design.printDir', language)}</label>
                    <select value={rotate} onChange={e => setRotate(e.target.value as any)} className="w-full glass-input rounded-xl p-2.5 text-sm bg-white/50">
                      <option value="none">{t('design.printDir.none', language)}</option>
                      <option value="left">{t('design.printDir.left', language)}</option>
                      <option value="right">{t('design.printDir.right', language)}</option>
                    </select>
                  </div>
                )}
              </div>

              {/* 打印信息 */}
              <div className="bg-white/70 rounded-xl border border-green-100 p-3 space-y-1.5 text-[11px] text-gray-600">
                <div className="flex justify-between"><span className="text-gray-400">数据记录</span><b className="text-[#2e7d32]">{rows.length} × {copies}</b></div>
                <div className="flex justify-between"><span className="text-gray-400">本次打印</span><b className="text-[#2e7d32]">{selected.list.length} 个</b></div>
                <div className="flex justify-between"><span className="text-gray-400">输出页数</span><b className="text-orange-600">{Math.max(1, Math.ceil(selected.list.length / (isSheet ? perPage : 1)))}</b></div>
              </div>

              {/* 操作员 / 培养基 */}
              {(operators.length > 0 || mediaTypes.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {operators.length > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('common.operator', language)}</label>
                      <select value={operator} onChange={e => setOperator(e.target.value)} className="w-full glass-input rounded-xl p-2.5 text-sm bg-white/50">
                        {operators.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                      </select>
                    </div>
                  )}
                  {mediaTypes.length > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('common.medium', language)}</label>
                      <select value={medium} onChange={e => setMedium(e.target.value)} className="w-full glass-input rounded-xl p-2.5 text-sm bg-white/50">
                        {mediaTypes.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </aside>

            {/* 右侧预览 */}
            <main className="flex-1 min-w-0 relative bg-gray-100/70 overflow-auto custom-scrollbar">
              {previewMode === 'single' ? (
                <>
                  <div className="min-h-full flex items-center justify-center p-6">
                    <div className="bg-white rounded shadow-2xl ring-1 ring-black/5 p-0 inline-block">
                      <LabelCanvas template={template} data={fullList[cur]} rowIndex={cur} primaryIdColumn={primaryIdColumn} scale={previewScale} />
                    </div>
                  </div>
                  {/* 单标签导航 */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur rounded-full shadow-lg px-3 py-2 flex items-center gap-1.5 text-xs font-bold text-gray-600 border border-gray-100">
                    <button onClick={() => setCurrentIndex(Math.max(0, cur - 1))} disabled={cur <= 0} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-1 min-w-[70px] text-center">
                      {t('design.pageOf', language).replace('{p}', String(cur + 1)).replace('{n}', String(fullList.length))}
                    </span>
                    <button onClick={() => setCurrentIndex(Math.min(maxIdx, cur + 1))} disabled={cur >= maxIdx} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-30">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-gray-200 mx-1" />
                    <label className="flex items-center gap-1.5 cursor-pointer select-none px-1">
                      <input type="checkbox" checked={!skip.has(cur + 1)} onChange={() => toggleSkip(cur + 1)} className="w-4 h-4 accent-green-700" />
                      {t('design.skipPage', language)}
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-h-full flex items-center justify-center p-6">
                    <div className="relative bg-white shadow-2xl rounded-sm ring-1 ring-gray-200" style={{ width: sheetW * sheetScale * mmToPx(1), height: sheetH * sheetScale * mmToPx(1) }}>
                      {pageSlice.map((row, idx) => {
                        const r = Math.floor(idx / sheetCols);
                        const c = idx % sheetCols;
                        const x = (layout.marginLeft || 0) + c * (template.width + (layout.gapX || 0));
                        const y = (layout.marginTop || 0) + r * (template.height + (layout.gapY || 0));
                        return (
                          <div key={idx} className="absolute" style={{ left: x * sheetScale * mmToPx(1), top: y * sheetScale * mmToPx(1), transform: `scale(${sheetScale})`, transformOrigin: '0 0' }}>
                            <LabelCanvas template={template} data={row} rowIndex={currentPage * perPage + idx} primaryIdColumn={primaryIdColumn} scale={1} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* 纸张页导航 */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur rounded-full shadow-lg px-3 py-2 flex items-center gap-1.5 text-xs font-bold text-gray-600 border border-gray-100">
                    <button onClick={() => setCurrentIndex(Math.max(0, currentPage - 1) * perPage)} disabled={currentPage <= 0} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-1 min-w-[70px] text-center">第 {currentPage + 1} / {totalPages} 页</span>
                    <button onClick={() => setCurrentIndex(Math.min(totalPages - 1, currentPage + 1) * perPage)} disabled={currentPage >= totalPages - 1} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-30">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="w-px h-4 bg-gray-200 mx-1" />
                    <label className="flex items-center gap-1.5 cursor-pointer select-none px-1">
                      <input type="checkbox" checked={!pageSkipped} onChange={() => { if (pageSkipped) currentPageGis.forEach(g => skip.has(g) && toggleSkip(g)); else currentPageGis.forEach(g => !skip.has(g) && toggleSkip(g)); }} className="w-4 h-4 accent-green-700" />
                      {t('design.skipPage', language)}
                    </label>
                  </div>
                </>
              )}
            </main>
          </div>
        )}

        {/* 底部状态与操作 */}
        <div className="px-5 py-3 border-t border-gray-100 bg-white flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            {done === 'ok' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#2e7d32] animate-scale-in"><CheckCircle2 className="w-4 h-4" /> {t('design.printSuccess', language)}</span>
            )}
            {done === 'pdf' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#2e7d32] animate-scale-in"><CheckCircle2 className="w-4 h-4" /> {t('design.pdfSaved', language)}</span>
            )}
            {done === 'err' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500 animate-scale-in"><AlertCircle className="w-4 h-4" /> {t('design.printFailed', language)}</span>
            )}
          </div>
          <button onClick={onClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-2xl text-sm">{t('common.cancel', language)}</button>
          <button onClick={handleExportPdf} disabled={busy || !selected.list.length}
            className="px-5 py-2.5 rounded-2xl text-sm font-bold bg-white border border-[#2e7d32] text-[#2e7d32] hover:bg-[#e8f5e9] transition-all flex items-center gap-2 disabled:opacity-40 active:scale-95">
            <FileDown className="w-4 h-4" /> {t('design.exportPdf', language)}
          </button>
          <button onClick={handlePrint} disabled={busy || !selected.list.length}
            className="btn-primary px-6 py-2.5 rounded-2xl font-black text-sm shadow-xl shadow-green-900/20 flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all">
            {busy ? <span className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" /> : <Printer className="w-4 h-4" />}
            {t('design.printNow', language)}
          </button>
        </div>
      </div>
    </div>
  );
};
