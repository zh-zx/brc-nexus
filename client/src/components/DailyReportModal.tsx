import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../utils';
import { useApp } from '../context/AppContext';
import { X, Calendar, ClipboardList, Camera, Loader2, Send, CheckCircle2 } from 'lucide-react';

interface Props {
  order: any;
  onClose: () => void;
  onSubmitted?: () => void;
}

// v2.8 日报提交弹窗：选工序（订单步骤链）→ 日期（默认今天）→ 数量/内容/照片 → 提交
const DailyReportModal: React.FC<Props> = ({ order, onClose, onSubmitted }) => {
  const { language } = useApp();
  const [steps, setSteps] = useState<any[]>([]);
  const [stepCode, setStepCode] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState('');
  const [content, setContent] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photoPreview, setPhotoPreview] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getOperationSteps('tissue_culture').then(r => {
      const all = r.steps || [];
      const filtered = order.purpose ? all.filter((s: any) => s.purpose === order.purpose) : all;
      setSteps(filtered);
      if (filtered[0]) setStepCode(filtered[0].code);
    }).catch(() => {});
  }, [order.purpose]);

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = await api.uploadFile(f, 'work_daily_report', order.id);
      setPhotoIds(ids => [...ids, r.id]);
      setPhotoPreview(p => [...p, { id: r.id, name: f.name }]);
    } catch (ex: any) {
      setErr(ex.message || '上传失败');
    }
  };

  const submit = async () => {
    if (!stepCode) { setErr(t('orders.dailyStepRequired', language)); return; }
    setBusy(true); setErr('');
    try {
      await api.submitDailyReport(order.id, { stepCode, reportDate: date, qty: Number(qty) || 0, content, photoIds });
      setDone(true);
      onSubmitted?.();
    } catch (e: any) {
      setErr(e.message || t('orders.accImportError', language));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-lg shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-[#2e7d32]" /> {t('orders.submitDaily', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-xs text-gray-500 mb-3 bg-white/70 rounded-xl px-3 py-2">{order.woNo} · {order.title}</p>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('orders.dailyStep', language)}</label>
            <select value={stepCode} onChange={e => setStepCode(e.target.value)} className="glass-input rounded-xl p-3 w-full text-sm">
              {steps.length === 0 && <option value="">{t('orders.noData', language)}</option>}
              {steps.map((s: any) => <option key={s.code} value={s.code}>{s.title || s.code}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />{t('orders.dailyDate', language)}
            </label>
            <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
              onChange={e => setDate(e.target.value)} className="glass-input rounded-xl p-3 w-full text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('orders.dailyQty', language)}</label>
            <input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)}
              placeholder={t('orders.targetQty', language)} className="glass-input rounded-xl p-3 w-full text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('orders.dailyContent', language)}</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
              placeholder={t('orders.dailyContentHint', language)} className="glass-input rounded-xl p-3 w-full text-sm resize-none" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('orders.dailyPhotos', language)}</label>
              <label className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 cursor-pointer">
                <Camera className="w-3 h-3" />{t('ops.upload', language)}
                <input type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
              </label>
            </div>
            {photoPreview.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {photoPreview.map(p => (
                  <span key={p.id} className="px-2 py-1 rounded-lg bg-white/70 text-[10px] font-bold text-gray-600 flex items-center gap-1">
                    {p.name}
                    <button type="button" onClick={() => { setPhotoIds(ids => ids.filter(i => i !== p.id)); setPhotoPreview(pp => pp.filter(x => x.id !== p.id)); }}
                      className="hover:text-red-500"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          {done && (
            <p className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 rounded-xl px-3 py-2">
              <CheckCircle2 className="w-4 h-4" /> {t('orders.dailySaved', language)} ✓
            </p>
          )}
          <button onClick={submit} disabled={busy || done}
            className="btn-primary w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {busy ? '...' : t('orders.submitDaily', language)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DailyReportModal;
