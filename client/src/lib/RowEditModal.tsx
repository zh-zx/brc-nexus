import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Language } from '../types';
import { X, AlertTriangle, Save, Trash2, Plus, Edit3 } from 'lucide-react';

// v2.9：数据库管理台「可视化模式」行级增删改弹窗（二次确认 + 审计由服务端保证）
const SENSITIVE = new Set(['token_hash', 'password_hash', 'api_token']);

interface RowEditModalProps {
  table: string;
  mode: 'insert' | 'update' | 'delete';
  columns: string[];        // 可编辑列名（accession = 基础列 + 性状 code）
  row?: any;                // 已有行（update/delete 摘要）
  traits?: any[];           // accession 性状定义（按类别分组渲染）
  categories?: { code: string; zh: string; en: string }[];
  keyColOverride?: string;  // 指定键列（accession → id）
  onClose: () => void;
  onDone: () => void;
}

const colLabel = (table: string, col: string, language: Language) => {
  const tv = t(`dbadmin.col.${table}.${col}`, language);
  if (tv !== `dbadmin.col.${table}.${col}`) return tv;
  const gv = t(`dbadmin.col.${col}`, language);
  return gv === `dbadmin.col.${col}` ? col : gv;
};

const RowEditModal: React.FC<RowEditModalProps> = ({
  table, mode, columns, row, traits = [], categories = [], keyColOverride, onClose, onDone,
}) => {
  const { language } = useApp();
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const c of columns) {
      if (SENSITIVE.has(c)) continue;
      const v = row?.[c];
      f[c] = v === null || v === undefined ? '' : String(v);
    }
    return f;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const keyCol = useMemo(() => {
    if (keyColOverride) return keyColOverride;
    if (columns.includes('primary_id')) return 'primary_id';
    if (columns.includes('id')) return 'id';
    return columns[0];
  }, [keyColOverride, columns]);

  const keyValue = row ? (row[keyCol] ?? row.id ?? row[columns[0]]) : undefined;
  const key = keyCol ? { col: keyCol, value: keyValue } : undefined;

  const traitByCode = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tr of traits) m[tr.code] = tr;
    return m;
  }, [traits]);

  const catLabel = (code: string) => {
    const c = categories.find(x => x.code === code);
    return c ? (language === 'zh' ? c.zh : c.en) : code;
  };
  const traitLabel = (tr: any) => language === 'zh' ? (tr.nameZh || tr.nameEn || tr.code) : (tr.nameEn || tr.nameZh || tr.code);

  const setField = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const inputCls = 'w-full glass-input rounded-xl px-4 py-2.5 text-sm';
  const labelCls = 'text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1';

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (mode === 'delete') {
        await api.dbRow({ table, mode, key, confirm: true });
      } else {
        const rowData: Record<string, any> = {};
        for (const [k, v] of Object.entries(form)) {
          if (SENSITIVE.has(k)) continue;
          if (mode === 'insert') {
            if (v !== '') rowData[k] = v;      // 新增：空字段不提交
          } else {
            rowData[k] = v === '' ? null : v;  // 编辑：空串 → 清空
          }
        }
        await api.dbRow({ table, mode, row: rowData, key, confirm: true });
      }
      onDone();
      onClose();
    } catch (e: any) {
      if (e.body?.error === 'FK_BLOCKED') {
        const refs: { child: string; col: string; count: number }[] = e.body.references || [];
        setError(t('dbadmin.rowDeleteBlocked', language) + '\n' + refs.map(r => `· ${r.child}.${r.col} × ${r.count}`).join('\n'));
      } else {
        setError(e.message || '操作失败');
      }
    }
    setSaving(false);
  };

  const renderInput = (k: string, opts: { readOnly?: boolean; type?: string } = {}) => (
    <input
      type={opts.type || 'text'}
      value={form[k] ?? ''}
      readOnly={opts.readOnly}
      onChange={e => setField(k, e.target.value)}
      className={`${inputCls} ${opts.readOnly ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
    />
  );

  const renderScale = (k: string, scale: Record<string, string>) => (
    <select value={form[k] ?? ''} onChange={e => setField(k, e.target.value)} className={`${inputCls} cursor-pointer`}>
      <option value="">{t('acc.gridEmpty', language)}</option>
      {Object.entries(scale || {}).map(([kk, v]) => (
        <option key={kk} value={kk}>{kk} · {v}</option>
      ))}
    </select>
  );

  const title = mode === 'insert' ? t('dbadmin.rowNew', language)
    : mode === 'update' ? t('dbadmin.rowEdit', language)
    : t('dbadmin.rowDelete', language);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar animate-scale-in">
        <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            {mode === 'delete' ? <Trash2 className="w-5 h-5 text-red-500" />
              : mode === 'insert' ? <Plus className="w-5 h-5 text-[#2e7d32]" />
              : <Edit3 className="w-5 h-5 text-[#2e7d32]" />}
            {title}
            <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{table}</span>
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-sm p-3 rounded-xl whitespace-pre-line flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}
            </div>
          )}

          {mode === 'delete' ? (
            <div>
              <p className="text-sm text-gray-600 mb-3">{t('dbadmin.rowDeleteConfirm', language)}</p>
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                {Object.entries(row || {}).filter(([k]) => !SENSITIVE.has(k)).slice(0, 8).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-xs">
                    <span className="text-gray-400 font-bold">{colLabel(table, k, language)}</span>
                    <span className="text-gray-700 font-medium truncate">{v === null || v === undefined ? 'NULL' : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* 基础字段（accession 固定 4 列；通用表 = 全部可编辑列） */}
              {(table === 'accession' ? ['primary_id', 'display_name', 'species', 'origin'] : columns.filter(c => !SENSITIVE.has(c))).map(k => {
                const tr = traitByCode[k];
                const readOnly = mode === 'update' && k === keyCol;
                return (
                  <div key={k}>
                    <label className={labelCls}>{colLabel(table, k, language)}</label>
                    {tr?.valueType === 'scale' ? renderScale(k, tr.scale)
                      : readOnly ? renderInput(k, { readOnly: true })
                      : renderInput(k, { type: tr?.valueType === 'number' ? 'number' : 'text' })}
                  </div>
                );
              })}

              {/* accession 性状（按类别分组） */}
              {table === 'accession' && categories.length > 0 && traits.length > 0 && (
                categories.map(cat => {
                  const catTraits = traits.filter(tr => tr.category === cat.code);
                  if (!catTraits.length) return null;
                  return (
                    <div key={cat.code}>
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 mt-2 border-t border-gray-50 pt-3">{catLabel(cat.code)}</h4>
                      <div className="space-y-3">
                        {catTraits.map(tr => (
                          <div key={tr.code}>
                            <label className={labelCls}>
                              {traitLabel(tr)} <span className="text-gray-300 font-mono normal-case">{tr.code}</span>
                            </label>
                            {tr.valueType === 'scale' ? renderScale(tr.code, tr.scale)
                              : renderInput(tr.code, { type: tr.valueType === 'number' ? 'number' : 'text' })}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">
            {t('dbadmin.rowCancel', language)}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-60 ${mode === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-[#2e7d32] hover:bg-green-700'}`}
          >
            {mode === 'delete' ? <Trash2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? '...' : (mode === 'delete' ? t('dbadmin.rowDelete', language) : t('dbadmin.rowSave', language))}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RowEditModal;
