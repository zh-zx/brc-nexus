import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { t } from '../utils';

// v2.10：性状说明卡 —— 小 ⓘ 图标，点击弹出浮层（示意图 + 说明文字 + scale 含义表）。
// fixed 定位（按按钮锚点，边缘翻转），不受表格 overflow 裁剪影响；Esc/点外关闭。
interface TraitLike {
  nameZh?: string | null;
  nameEn?: string | null;
  code: string;
  category?: string;
  unit?: string | null;
  illustration?: string | null;
  descZh?: string | null;
  descEn?: string | null;
  scale?: Record<string, string> | null;
}

interface Props {
  trait?: TraitLike | null;
  catLabel?: string;
  className?: string;
}

const TraitInfoIcon: React.FC<Props> = ({ trait, catLabel, className = '' }) => {
  const { language } = useApp();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!trait) return null;

  const label = language === 'zh' ? (trait.nameZh || trait.nameEn || trait.code) : (trait.nameEn || trait.nameZh || trait.code);
  const desc = language === 'zh' ? (trait.descZh || trait.descEn || '') : (trait.descEn || trait.descZh || '');
  const scaleEntries = trait.scale && typeof trait.scale === 'object' ? Object.entries(trait.scale) : [];
  const hasInfo = !!(trait.illustration || desc || scaleEntries.length || catLabel || trait.unit);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const cardW = 320, cardH = 360;
      let left = Math.min(r.left, window.innerWidth - cardW - 16);
      let top = r.bottom + 8;
      if (top + cardH > window.innerHeight) top = Math.max(16, r.top - cardH - 8);
      setPos({ top, left: Math.max(16, left) });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title={label}
        className={`inline-flex items-center justify-center align-middle text-gray-300 hover:text-[#2e7d32] transition-colors ${className}`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[70] w-80 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-gray-100 p-4 animate-scale-in"
            style={{ top: pos.top, left: pos.left }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="font-bold text-gray-800 text-sm">{label}</span>
              <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{trait.code}</span>
              {catLabel && <span className="text-[10px] font-bold text-[#2e7d32] bg-green-50 px-2 py-0.5 rounded">{catLabel}</span>}
              {trait.unit && <span className="text-[10px] text-gray-400">{t('trait.unit', language)}: {trait.unit}</span>}
            </div>
            {trait.illustration && (
              <img src={trait.illustration} alt={label} className="w-full max-h-48 object-contain rounded-xl bg-gray-50 border border-gray-100 mb-2" />
            )}
            {desc && <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line mb-2">{desc}</p>}
            {scaleEntries.length > 0 && (
              <div className="mt-1 border-t border-gray-50 pt-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('trait.scaleMeaning', language)}</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {scaleEntries.map(([k, v]) => (
                    <React.Fragment key={k}>
                      <span className="text-xs font-bold text-gray-700">{k}</span>
                      <span className="text-xs text-gray-500">{v}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
            {!hasInfo && <p className="text-xs text-gray-400">{t('trait.noInfo', language)}</p>}
          </div>
        </>
      )}
    </>
  );
};

export default TraitInfoIcon;
