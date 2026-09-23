import React, { useState } from 'react';
import { Language } from '../types';
import { t } from '../utils';
import { ICON_NAMES, iconAliases } from '../lib/labelUtil';
import * as AllIcons from 'lucide-react';

interface Props {
  open: boolean;
  language: Language;
  onCancel: () => void;
  onPick: (iconName: string) => void;
}

export const IconPicker: React.FC<Props> = ({ open, language, onCancel, onPick }) => {
  const [q, setQ] = useState('');
  if (!open) return null;
  const query = q.trim().toLowerCase();
  const filtered = ICON_NAMES.filter(name => {
    if (!query) return true;
    if (name.toLowerCase().includes(query)) return true;
    return iconAliases(name).some(a => a.toLowerCase().includes(query));
  });

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[120] flex items-center justify-center p-4 no-print">
      <div className="glass-panel bg-white rounded-[2rem] w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center gap-3 bg-gray-50/50">
          <h3 className="text-lg font-black text-gray-800">图标库</h3>
          <button onClick={onCancel} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-gray-500">✕</button>
        </div>
        <div className="p-4 border-b border-gray-100">
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('design.iconSearch', language)}
            className="w-full glass-input rounded-xl p-3 text-sm"
          />
        </div>
        <div className="flex-1 overflow-auto p-4 grid grid-cols-6 gap-2 custom-scrollbar">
          {filtered.map(name => {
            const Cmp = (AllIcons as any)[name];
            if (!Cmp) return null;
            return (
              <button key={name} title={name} onClick={() => { onPick(name); onCancel(); }}
                className="aspect-square flex items-center justify-center rounded-xl bg-gray-50 hover:bg-[#e8f5e9] hover:text-[#2e7d32] hover:scale-110 transition-all text-gray-500 border border-gray-100">
                <Cmp className="w-6 h-6" />
              </button>
            );
          })}
          {filtered.length === 0 && <div className="col-span-full text-center text-gray-400 py-8 text-sm">无匹配图标</div>}
        </div>
      </div>
    </div>
  );
};
