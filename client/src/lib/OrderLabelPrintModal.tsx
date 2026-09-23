import React, { useState } from 'react';
import { api } from '../api';
import { t } from '../utils';
import { useApp } from '../context/AppContext';
import { X, Printer, Loader2, CheckCircle2 } from 'lucide-react';

interface Props {
  order: any;
  onClose: () => void;
  onSubmitted?: () => void;
}

// 工单标签打印确认弹窗：模板/操作员/培养基/份数/打印机 + 本工单种质数量确认
const OrderLabelPrintModal: React.FC<Props> = ({ order, onClose, onSubmitted }) => {
  const { language, templates, operators, mediaTypes, selectedPrinter } = useApp();
  const accessions: any[] = order?.accessions || [];
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id || '');
  const [operator, setOperator] = useState<string>(operators[0]?.name || '');
  const [medium, setMedium] = useState<string>(mediaTypes[0]?.name || '');
  const [copies, setCopies] = useState(1);
  const [printer, setPrinter] = useState<string>(selectedPrinter || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!accessions.length) { setErr(t('orders.accImportEmpty', language)); return; }
    if (!templateId) { setErr(t('sub.noTemplate', language)); return; }
    setBusy(true); setErr('');
    try {
      await api.print(accessions.map(a => ({ primaryId: a.primaryId, displayName: a.displayName, ...a })), templateId, printer || undefined, operator, medium, copies);
      setDone(true);
      onSubmitted?.();
    } catch (e: any) {
      setErr(e.message || '打印失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-md shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <Printer className="w-5 h-5 text-[#2e7d32]" /> {t('orders.printLabelsTitle', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-xs text-gray-500 mb-3 bg-white/70 rounded-xl px-3 py-2">
          {order.woNo} · {order.title}
          <br />
          {t('orders.printLabelsHint', language).replace('{n}', String(accessions.length))}
        </p>

        <div className="bg-white/70 rounded-xl p-3 mb-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar">
          {accessions.length === 0 && <span className="text-xs text-gray-400">{t('orders.noData', language)}</span>}
          {accessions.slice(0, 30).map((a: any) => (
            <span key={a.id || a.primaryId} className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${a.notFound ? 'bg-amber-100 text-amber-700' : 'bg-[#e8f5e9] text-[#2e7d32]'}`}>
              {a.primaryId}
              {a.notFound && <span className="px-1 rounded bg-amber-500 text-white text-[7px] font-black">{t('orders.outOfLib', language)}</span>}
            </span>
          ))}
          {accessions.length > 30 && <span className="text-[10px] text-gray-400">+{accessions.length - 30}</span>}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('common.template', language)}</label>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="glass-input rounded-xl p-3 w-full text-sm">
              {templates.length === 0 && <option value="">{t('sub.noTemplate', language)}</option>}
              {templates.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('common.operator', language)}</label>
              <select value={operator} onChange={e => setOperator(e.target.value)} className="glass-input rounded-xl p-3 w-full text-sm">
                {operators.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('setup.media', language)}</label>
              <select value={medium} onChange={e => setMedium(e.target.value)} className="glass-input rounded-xl p-3 w-full text-sm">
                {(mediaTypes || []).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('common.copies', language)}</label>
              <input type="number" min={1} value={copies} onChange={e => setCopies(Math.max(1, Number(e.target.value) || 1))} className="glass-input rounded-xl p-3 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('setup.printer.select', language)}</label>
              <input type="text" value={printer} onChange={e => setPrinter(e.target.value)} placeholder={t('setup.printer.select', language)} className="glass-input rounded-xl p-3 w-full text-sm" />
            </div>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          {done && (
            <p className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 rounded-xl px-3 py-2">
              <CheckCircle2 className="w-4 h-4" /> {t('orders.save', language)} ✓
            </p>
          )}
          <button onClick={submit} disabled={busy || done}
            className="btn-primary w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {busy ? '...' : t('orders.printLabels', language)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderLabelPrintModal;
