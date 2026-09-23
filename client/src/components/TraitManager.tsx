import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { X, Plus, Trash2, Edit3, Loader2, ImageIcon } from 'lucide-react';
import { fileToDataUrl } from '../image';

interface Trait {
  id: string;
  code: string;
  nameEn: string;
  nameZh: string;
  category: string;
  valueType: string;
  unit: string | null;
  scale: Record<string, string> | null;
  illustration?: string | null;
  descZh?: string | null;
  descEn?: string | null;
  isSystem: boolean;
  sortOrder: number;
}

interface Category {
  code: string;
  zh: string;
  en: string;
}

const VALUE_TYPES = [
  { code: 'text', zh: '文本', en: 'Text' },
  { code: 'number', zh: '数字', en: 'Number' },
  { code: 'scale', zh: '等级值', en: 'Scale' },
];

interface TraitManagerProps {
  onClose: () => void;
  onTraitsChanged?: () => void;
}

const TraitManager: React.FC<TraitManagerProps> = ({ onClose, onTraitsChanged }) => {
  const { language } = useApp();
  const [traits, setTraits] = useState<Trait[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Trait | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '', nameEn: '', nameZh: '', category: 'other', valueType: 'text', unit: '', scaleText: '',
    descZh: '', descEn: '', illustration: null as string | null,
  });
  const [saving, setSaving] = useState(false);
  const illuRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getTraits();
      setTraits(res.traits || []);
      setCategories(res.categories || []);
    } catch (e: any) {
      alert(t('trait.loadFailed', language) + ': ' + e.message);
    }
    setLoading(false);
  }, [language]);

  useEffect(() => { load(); }, [load]);

  const catLabel = (code: string) => {
    const cat = categories.find(c => c.code === code);
    if (!cat) return code;
    return language === 'zh' ? cat.zh : cat.en;
  };

  const nameLabel = (tr: Trait) => {
    return language === 'zh' ? (tr.nameZh || tr.nameEn || tr.code) : (tr.nameEn || tr.nameZh || tr.code);
  };

  const startNew = () => {
    setEditing(null);
    setForm({ code: '', nameEn: '', nameZh: '', category: 'other', valueType: 'text', unit: '', scaleText: '', descZh: '', descEn: '', illustration: null });
    setShowForm(true);
  };

  const startEdit = (tr: Trait) => {
    setEditing(tr);
    setForm({
      code: tr.code,
      nameEn: tr.nameEn || '',
      nameZh: tr.nameZh || '',
      category: tr.category,
      valueType: tr.valueType,
      unit: tr.unit || '',
      scaleText: tr.scale ? Object.entries(tr.scale).map(([k, v]) => `${k}=${v}`).join('\n') : '',
      descZh: tr.descZh || '',
      descEn: tr.descEn || '',
      illustration: tr.illustration || null,
    });
    setShowForm(true);
  };

  // v2.10：选择示意图 → 客户端压缩为 dataURL（≤300KB），超限提示
  const pickIllustration = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setForm(f => ({ ...f, illustration: dataUrl }));
    } catch (e: any) {
      if (e?.message === 'TOO_LARGE') alert(t('trait.illustrationTooLarge', language));
      else alert(t('trait.saveFailed', language) + ': ' + e.message);
    }
  };

  const parseScale = (text: string): Record<string, string> | null => {
    const obj: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      const idx = s.indexOf('=');
      if (idx < 0) continue;
      const k = s.slice(0, idx).trim();
      const v = s.slice(idx + 1).trim();
      if (k && v) obj[k] = v;
    }
    return Object.keys(obj).length ? obj : null;
  };

  const save = async () => {
    if (!form.code.trim()) { alert(t('trait.codeRequired', language)); return; }
    setSaving(true);
    try {
      const data: any = {
        code: form.code.trim().toUpperCase(),
        nameEn: form.nameEn.trim(),
        nameZh: form.nameZh.trim(),
        category: form.category,
        valueType: form.valueType,
        unit: form.unit.trim() || undefined,
      };
      if (form.valueType === 'scale') {
        data.scale = parseScale(form.scaleText) || {};
      }
      data.illustration = form.illustration;      // v2.10：示意图 dataURL（null = 清除）
      data.descZh = form.descZh.trim() || null;
      data.descEn = form.descEn.trim() || null;
      if (editing) {
        await api.updateTrait(editing.id, data);
      } else {
        await api.createTrait(data);
      }
      setShowForm(false);
      await load();
      onTraitsChanged?.();
    } catch (e: any) {
      alert(t('trait.saveFailed', language) + ': ' + e.message);
    }
    setSaving(false);
  };

  const remove = async (tr: Trait) => {
    if (!window.confirm(t('trait.deleteConfirm', language).replace('{code}', tr.code))) return;
    try {
      await api.deleteTrait(tr.id);
      await load();
      onTraitsChanged?.();
    } catch (e: any) {
      alert(t('trait.deleteFailed', language) + ': ' + e.message);
    }
  };

  const grouped = categories
    .map(cat => ({ cat, list: traits.filter(tr => tr.category === cat.code) }))
    .filter(g => g.list.length > 0);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-scale-in">
          <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0 z-10">
            <h2 className="text-lg font-black text-gray-800">{t('trait.title', language)}</h2>
            <div className="flex items-center gap-2">
              <button onClick={startNew} className="btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                <Plus className="w-4 h-4" /> {t('trait.add', language)}
              </button>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
          </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#2e7d32]" /></div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm font-bold">{t('trait.noTraits', language)}</p>
              <p className="text-xs mt-1">{t('trait.noTraitsHint', language)}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(({ cat, list }) => (
                <div key={cat.code}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-[11px] font-black text-gray-500 uppercase tracking-widest">{catLabel(cat.code)}</h3>
                    <span className="text-[10px] text-gray-300 font-bold">{list.length}</span>
                  </div>
                  <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                    {list.map(tr => (
                      <div key={tr.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/60">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-gray-600">{tr.code}</span>
                            <span className="text-sm font-semibold text-gray-800 truncate">{nameLabel(tr)}</span>
                            {tr.isSystem ? (
                              <span className="bg-green-100 text-green-700 text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0">{t('trait.system', language)}</span>
                            ) : (
                              <span className="bg-amber-100 text-amber-700 text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0">{t('trait.custom', language)}</span>
                            )}
                            {tr.illustration && <span title={t('trait.illustration', language)}><ImageIcon className="w-3 h-3 text-[#2e7d32] shrink-0" /></span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                            <span>{tr.valueType}</span>
                            {tr.unit && <span>· {tr.unit}</span>}
                            {tr.scale && <span>· {Object.keys(tr.scale).length} {t('trait.levels', language)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => startEdit(tr)} className="p-1.5 rounded-lg hover:bg-green-50 text-[#2e7d32]" title={t('common.edit', language)}>
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {!tr.isSystem && (
                            <button onClick={() => remove(tr)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400" title={t('common.delete', language)}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar animate-scale-in">
            <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h3 className="font-black text-gray-800">{editing ? t('trait.edit', language) : t('trait.add', language)}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.code', language)} *</label>
                <input
                  type="text"
                  value={form.code}
                  disabled={!!editing}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  className="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-mono disabled:bg-gray-50 disabled:text-gray-400"
                  placeholder="e.g. MY_TRAIT"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.nameZh', language)}</label>
                  <input type="text" value={form.nameZh} onChange={e => setForm(f => ({ ...f, nameZh: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.nameEn', language)}</label>
                  <input type="text" value={form.nameEn} onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.category', language)}</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm">
                    {categories.map(c => <option key={c.code} value={c.code}>{catLabel(c.code)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.valueType', language)}</label>
                  <select value={form.valueType} onChange={e => setForm(f => ({ ...f, valueType: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm">
                    {VALUE_TYPES.map(vt => <option key={vt.code} value={vt.code}>{language === 'zh' ? vt.zh : vt.en}</option>)}
                  </select>
                </div>
              </div>
              {form.valueType === 'scale' ? (
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.scale', language)}</label>
                  <textarea
                    value={form.scaleText}
                    onChange={e => setForm(f => ({ ...f, scaleText: e.target.value }))}
                    rows={5}
                    className="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-mono"
                    placeholder={'1=白\n3=浅黄\n5=黄'}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.unit', language)}</label>
                  <input type="text" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" placeholder="% / 天 / mg/100g" />
                </div>
              )}
              <p className="text-[10px] text-gray-400">{t('trait.hint', language)}</p>

              {/* v2.10：示意图 + 说明文字 */}
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.illustration', language)}</label>
                {form.illustration ? (
                  <div className="flex items-start gap-3">
                    <img src={form.illustration} alt="" className="w-24 h-24 object-contain rounded-xl bg-gray-50 border border-gray-100" />
                    <div className="flex-1 space-y-2">
                      <button onClick={() => illuRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">{t('common.edit', language)}</button>
                      <button onClick={() => setForm(f => ({ ...f, illustration: null }))} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-bold hover:bg-red-100 block">{t('common.delete', language)}</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => illuRef.current?.click()} className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 text-xs text-gray-400 hover:border-[#2e7d32] hover:text-[#2e7d32] transition-colors flex items-center justify-center gap-1.5">
                    <ImageIcon className="w-4 h-4" />{t('trait.illustrationUpload', language)}
                  </button>
                )}
                <input ref={illuRef} type="file" accept="image/*" className="hidden" onChange={e => pickIllustration(e.target.files?.[0])} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.descZh', language)}</label>
                  <textarea value={form.descZh} onChange={e => setForm(f => ({ ...f, descZh: e.target.value }))} rows={2} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" placeholder="面向申请者/保管者的中文说明" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.descEn', language)}</label>
                  <textarea value={form.descEn} onChange={e => setForm(f => ({ ...f, descEn: e.target.value }))} rows={2} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" placeholder="English description for applicants" />
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={save} disabled={saving} className="btn-primary w-full py-3 rounded-xl font-bold text-sm">
                {saving ? '...' : t('common.save', language)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TraitManager;
