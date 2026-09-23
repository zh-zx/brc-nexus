import React, { useState } from 'react';
import { Language, LabelTemplate } from '../types';
import { t, generateId } from '../utils';

const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  B5: { w: 176, h: 250 },
};

interface Props {
  open: boolean;
  language: Language;
  onCancel: () => void;
  onCreate: (t: LabelTemplate) => void;
}

export const NewLabelWizard: React.FC<Props> = ({ open, language, onCancel, onCreate }) => {
  const [name, setName] = useState('New Label');
  const [mode, setMode] = useState<'roll' | 'sheet'>('roll');
  const [w, setW] = useState(40);
  const [h, setH] = useState(30);
  const [rollCols, setRollCols] = useState(1);
  const [rollGap, setRollGap] = useState(0);
  const [paper, setPaper] = useState('A4');
  const [wPaper, setWPaper] = useState(210);
  const [hPaper, setHPaper] = useState(297);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [mt, setMt] = useState(10);
  const [mb, setMb] = useState(10);
  const [ml, setMl] = useState(10);
  const [mr, setMr] = useState(10);
  const [gx, setGx] = useState(2);
  const [gy, setGy] = useState(2);

  if (!open) return null;

  let paperW = paper === 'custom' ? wPaper : PAPER_SIZES[paper].w;
  let paperH = paper === 'custom' ? hPaper : PAPER_SIZES[paper].h;
  if (orientation === 'landscape') [paperW, paperH] = [paperH, paperW];

  const sheetRows = Math.max(1, Math.floor((paperH - mt - mb + gy) / (h + gy)));
  const sheetCols = Math.max(1, Math.floor((paperW - ml - mr + gx) / (w + gx)));

  const create = () => {
    const template: LabelTemplate = {
      id: generateId(),
      name: name || 'New Label',
      width: Math.max(5, w),
      height: Math.max(5, h),
      elements: [],
      backgroundColor: '#ffffff',
      layout: mode === 'roll'
        ? { mode, rollCols: Math.max(1, rollCols), rollGapX: Math.max(0, rollGap) }
        : {
            mode, sheetWidth: paperW, sheetHeight: paperH,
            rows: sheetRows, cols: sheetCols,
            marginTop: mt, marginLeft: ml, marginBottom: mb, marginRight: mr,
            gapX: gx, gapY: gy,
          },
    };
    onCreate(template);
  };

  const num = (v: string, set: (n: number) => void, min = 0) => {
    const n = Number(v);
    if (!isNaN(n)) set(Math.max(min, n));
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[120] flex items-center justify-center p-4 no-print">
      <div className="glass-panel bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-xl font-black text-gray-800 flex items-center gap-2"><span className="w-1.5 h-6 bg-[#2e7d32] rounded-full block"></span>{t('wizard.title', language)}</h3>
          <button onClick={onCancel} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-gray-500">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5 custom-scrollbar">
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">{t('wizard.name', language)}</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full glass-input rounded-xl p-3 text-sm" />
          </div>

          {/* 纸型选择 */}
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-2">标签纸型</label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setMode('roll')} className={`text-left p-4 rounded-2xl border-2 transition-all ${mode === 'roll' ? 'border-[#2e7d32] bg-[#e8f5e9] shadow-sm' : 'border-gray-100 bg-white/60 hover:border-green-200'}`}>
                <div className="font-black text-sm text-gray-800 mb-1">📜 {t('wizard.roll', language)}</div>
                <div className="text-[10px] text-gray-500 leading-relaxed">{t('wizard.rollDesc', language)}</div>
              </button>
              <button onClick={() => setMode('sheet')} className={`text-left p-4 rounded-2xl border-2 transition-all ${mode === 'sheet' ? 'border-[#2e7d32] bg-[#e8f5e9] shadow-sm' : 'border-gray-100 bg-white/60 hover:border-green-200'}`}>
                <div className="font-black text-sm text-gray-800 mb-1">📄 {t('wizard.sheet', language)}</div>
                <div className="text-[10px] text-gray-500 leading-relaxed">{t('wizard.sheetDesc', language)}</div>
              </button>
            </div>
          </div>

          {/* 标签尺寸 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">{t('wizard.labelSize', language)}</label>
              <div className="flex gap-2">
                <input type="number" value={w} onChange={e => num(e.target.value, setW, 5)} className="flex-1 glass-input rounded-xl p-3 text-sm" />
                <span className="text-gray-400 text-sm font-bold self-center">×</span>
                <input type="number" value={h} onChange={e => num(e.target.value, setH, 5)} className="flex-1 glass-input rounded-xl p-3 text-sm" />
              </div>
            </div>
            {mode === 'roll' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">{t('wizard.rollCols', language)}</label>
                  <input type="number" value={rollCols} onChange={e => num(e.target.value, setRollCols, 1)} className="w-full glass-input rounded-xl p-3 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">{t('wizard.gapX', language)}</label>
                  <input type="number" value={rollGap} onChange={e => num(e.target.value, setRollGap)} className="w-full glass-input rounded-xl p-3 text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* 标准纸高级设置 */}
          {mode === 'sheet' && (
            <div className="bg-white/50 rounded-2xl border border-gray-100 p-4 space-y-3 animate-scale-in">
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-gray-500">{t('wizard.paperSize', language)}</label>
                <select value={paper} onChange={e => { const v = e.target.value; setPaper(v); if (v !== 'custom') setOrientation('portrait'); }} className="glass-input rounded-xl p-2 text-sm bg-white/50">
                  {Object.keys(PAPER_SIZES).map(p => <option key={p} value={p}>{p} ({PAPER_SIZES[p].w}×{PAPER_SIZES[p].h}mm)</option>)}
                  <option value="custom">自定义</option>
                </select>
                <button onClick={() => setOrientation(o => o === 'portrait' ? 'landscape' : 'portrait')} className="px-3 py-2 rounded-xl bg-white shadow-sm text-xs font-bold text-gray-600 hover:shadow-md transition-all">
                  {orientation === 'portrait' ? '竖排' : '横排'} ↻
                </button>
              </div>
              {paper === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-400 font-bold block mb-0.5">纸张宽 (mm)</label>
                    <input type="number" value={wPaper} onChange={e => num(e.target.value, setWPaper, 10)} className="w-full glass-input rounded-lg p-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 font-bold block mb-0.5">纸张高 (mm)</label>
                    <input type="number" value={hPaper} onChange={e => num(e.target.value, setHPaper, 10)} className="w-full glass-input rounded-lg p-2 text-sm" />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {[{ l: t('wizard.marginTop', language), v: mt, s: setMt }, { l: t('wizard.marginBottom', language), v: mb, s: setMb }, { l: t('wizard.marginLeft', language), v: ml, s: setMl }, { l: t('wizard.marginRight', language), v: mr, s: setMr }].map(f => (
                  <div key={f.l}>
                    <label className="text-gray-400 font-bold block mb-0.5">{f.l}</label>
                    <input type="number" value={f.v} onChange={e => num(e.target.value, f.s)} className="w-full glass-input rounded-lg p-2 text-sm" />
                  </div>
                ))}
                <div>
                  <label className="text-gray-400 font-bold block mb-0.5">{t('wizard.gapX', language)}</label>
                  <input type="number" value={gx} onChange={e => num(e.target.value, setGx)} className="w-full glass-input rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 font-bold block mb-0.5">{t('wizard.gapY', language)}</label>
                  <input type="number" value={gy} onChange={e => num(e.target.value, setGy)} className="w-full glass-input rounded-lg p-2 text-sm" />
                </div>
              </div>
              <div className="text-[10px] font-black text-[#2e7d32]">
                ✔ 计算结果：每张 {paperW}×{paperH}mm 纸张可排 <span className="text-orange-600">{sheetRows}</span> 行 × <span className="text-orange-600">{sheetCols}</span> 列 = <span className="text-orange-600">{sheetRows * sheetCols}</span> 个标签
              </div>
            </div>
          )}

          {/* 动态预览 */}
          <div>
            <div className="text-xs font-bold text-gray-500 mb-2">{t('wizard.preview', language)}</div>
            <div className="bg-gray-100 rounded-2xl p-4 flex items-center justify-center min-h-[120px]">
              {mode === 'roll' ? (
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(3, rollCols) }, (_, i) => (
                    <div key={i} className="bg-white border-2 border-dashed border-gray-300 rounded-md shadow-sm flex items-center justify-center text-[10px] text-gray-300 font-bold"
                      style={{ width: w * 2.2, height: h * 2.2 }}>{w}×{h}</div>
                  ))}
                  {rollCols > 3 && <span className="text-gray-400 text-xs">…</span>}
                </div>
              ) : (
                <div className="relative bg-white rounded-md shadow-sm" style={{ width: paperW * 1.2, height: paperH * 1.2 }}>
                  {Array.from({ length: Math.min(sheetRows, 8) * Math.min(sheetCols, 6) }, (_, i) => {
                    const r = Math.floor(i / Math.min(sheetCols, 6));
                    const c = i % Math.min(sheetCols, 6);
                    return (
                      <div key={i} className="absolute bg-[#e8f5e9] border border-[#a5d6a7] rounded-sm"
                        style={{ left: (ml * 1.2) + c * (w * 1.2 + gx * 1.2), top: (mt * 1.2) + r * (h * 1.2 + gy * 1.2), width: w * 1.2, height: h * 1.2 }} />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-white">
          <button onClick={onCancel} className="px-6 py-3 text-gray-600 font-bold hover:bg-gray-100 rounded-2xl text-sm">{t('common.cancel', language)}</button>
          <button onClick={create} className="btn-primary px-8 py-3 rounded-2xl font-black text-sm shadow-xl shadow-green-900/20 active:scale-95 transition-all">{t('wizard.create', language)}</button>
        </div>
      </div>
    </div>
  );
};
