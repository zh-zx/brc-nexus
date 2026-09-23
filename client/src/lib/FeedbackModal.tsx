import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../utils';
import { useApp } from '../context/AppContext';
import { X, Send } from 'lucide-react';
import { PRIORITY_KEYS } from './orderUi';

interface Props {
  order: any;
  onClose: () => void;
  onSubmitted?: () => void;
}

// 通用报工弹窗（工作台快捷报工 / 工单页 / 清单页共用）
const FeedbackModal: React.FC<Props> = ({ order, onClose, onSubmitted }) => {
  const { language } = useApp();
  const [kind, setKind] = useState('progress');
  const [qty, setQty] = useState('');
  const [content, setContent] = useState('');
  const [stepCode, setStepCode] = useState('');
  const [steps, setSteps] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (order?.purpose) {
      api.getOperationSteps('tissue_culture').then(r => {
        setSteps((r.steps || []).filter((s: any) => s.purpose === order.purpose));
      }).catch(() => {});
    }
  }, [order?.purpose]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.submitWorkOrderFeedback(order.id, {
        kind,
        qty: qty ? Number(qty) : 0,
        content,
        stepCode,
      });
      onSubmitted?.();
      onClose();
    } catch (e: any) {
      setErr(e.message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-md shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <Send className="w-5 h-5 text-[#2e7d32]" /> {t('orders.report', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3 bg-gray-50 rounded-lg px-3 py-2">
          {order.woNo} · {order.title}
          <span className="ml-2 text-orange-500">{order.priority ? t(PRIORITY_KEYS[order.priority] || 'orders.priNormal', language) : ''}</span>
        </p>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['progress', 'issue', 'done'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${kind === k ? 'bg-[#2e7d32] text-white border-[#2e7d32]' : 'bg-white/60 text-gray-500 border-gray-200 hover:bg-white'}`}>
                {t(`orders.kind.${k}`, language)}
              </button>
            ))}
          </div>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)}
            placeholder={t('orders.qty', language)} className="glass-input rounded-xl p-3 w-full text-sm" />
          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder={t('orders.content', language)} rows={3}
            className="glass-input rounded-xl p-3 w-full text-sm resize-none" />
          {steps.length > 0 && (
            <select value={stepCode} onChange={e => setStepCode(e.target.value)} className="glass-input rounded-xl p-3 w-full text-sm">
              <option value="">{t('orders.stepCode', language)}</option>
              {steps.map((s: any) => (
                <option key={s.code} value={s.code}>{s.stepNo}. {s.title}{s.dueDays ? `（${s.dueDays}天）` : ''}</option>
              ))}
            </select>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button onClick={submit} disabled={busy}
            className="btn-primary w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50">
            {busy ? '...' : t('orders.save', language)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
