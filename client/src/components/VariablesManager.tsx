import React, { useState } from 'react';
import { Language } from '../types';
import { t } from '../utils';
import { Plus, Trash2, Variable } from 'lucide-react';

interface Props {
  open: boolean;
  language: Language;
  variables: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
  onCancel: () => void;
}

/** 内置变量（系统提供，不可删除） */
const BUILTIN = ['operator', 'medium', 'date', 'serial'];

/** 变量管理器：新增 / 修改默认值 / 删除自定义全局变量（LabelNova 7.3） */
export const VariablesManager: React.FC<Props> = ({ open, language, variables, onChange, onCancel }) => {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  if (!open) return null;

  const custom = Object.entries(variables).filter(([k]) => !BUILTIN.includes(k));

  const addVar = () => {
    const n = name.trim();
    if (!n) return;
    if (BUILTIN.includes(n)) { alert('该名称为系统内置变量，请换一个名称'); return; }
    onChange({ ...variables, [n]: value });
    setName(''); setValue('');
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[120] flex items-center justify-center p-4 no-print">
      <div className="glass-panel bg-white rounded-[2rem] w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
            <Variable className="w-5 h-5 text-[#2e7d32]" /> {t('design.variables', language)}
          </h3>
          <button onClick={onCancel} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white shadow-sm hover:shadow-md transition-all text-gray-500">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4 custom-scrollbar">
          {/* 内置变量（只读） */}
          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('design.builtinVars', language)}</h4>
            <div className="space-y-1.5">
              {BUILTIN.map(b => (
                <div key={b} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <code className="text-xs font-bold text-gray-600">{b}</code>
                  <span className="text-[10px] text-gray-400">
                    {b === 'operator' ? t('common.operator', language)
                      : b === 'medium' ? t('common.medium', language)
                        : b === 'date' ? t('design.seg.date', language)
                          : t('design.seg.serial', language)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 自定义变量 */}
          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('design.customVars', language)}</h4>
            {custom.length === 0 && <div className="text-[11px] text-gray-300 py-2 text-center">{t('design.noVars', language)}</div>}
            <div className="space-y-1.5">
              {custom.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                  <code className="text-xs font-bold text-[#2e7d32] min-w-[70px]">{k}</code>
                  <span className="text-gray-300 text-xs">=</span>
                  <input
                    value={v}
                    onChange={e => onChange({ ...variables, [k]: e.target.value })}
                    className="flex-1 glass-input rounded p-1.5 text-xs"
                    placeholder={t('design.defaultValue', language)}
                  />
                  <button
                    onClick={() => { const nv = { ...variables }; delete nv[k]; onChange(nv); }}
                    className="p-1.5 rounded hover:bg-red-50 text-red-400"
                    title={t('common.delete', language)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 新增 */}
          <div className="bg-[#e8f5e9]/60 rounded-xl p-3 border border-green-100 space-y-2">
            <div className="text-[10px] font-bold text-[#2e7d32] uppercase tracking-wider">{t('design.addVar', language)}</div>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t('design.varName', language)}
                className="flex-1 glass-input rounded-lg p-2 text-xs" onKeyDown={e => { if (e.key === 'Enter') addVar(); }} />
              <input value={value} onChange={e => setValue(e.target.value)} placeholder={t('design.defaultValue', language)}
                className="flex-1 glass-input rounded-lg p-2 text-xs" onKeyDown={e => { if (e.key === 'Enter') addVar(); }} />
              <button onClick={addVar} disabled={!name.trim()}
                className="px-3 py-2 rounded-lg bg-[#2e7d32] text-white text-xs font-bold flex items-center gap-1 hover:bg-[#256029] disabled:opacity-40 transition-all active:scale-95">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">{t('design.varTip', language)}</p>
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 flex justify-end bg-white">
          <button onClick={onCancel} className="btn-primary px-8 py-3 rounded-2xl font-black text-sm shadow-xl shadow-green-900/20 active:scale-95 transition-all">{t('common.done', language)}</button>
        </div>
      </div>
    </div>
  );
};
