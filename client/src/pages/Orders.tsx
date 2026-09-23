import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import {
  Plus, X, Send, Play, Ban, Trash2, Pencil, Camera, LayoutGrid, List,
  ClipboardList, Clock, AlertTriangle, Users as UsersIcon, PackageSearch, RotateCcw,
  RefreshCw, CheckCircle2, Printer, FileUp, Loader2, SlidersHorizontal, CalendarDays,
} from 'lucide-react';
import { STATUS_COLORS, PRIORITY_COLORS, STATUS_KEYS, PRIORITY_KEYS } from '../lib/orderUi';
import FeedbackModal from '../lib/FeedbackModal';
import OrderLabelPrintModal from '../lib/OrderLabelPrintModal';
import DailyReportModal from '../components/DailyReportModal';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const ENDED_STATUSES = ['done', 'blocked', 'cancelled'];

/* ================= 新建 / 编辑工单弹窗 ================= */
const OrderFormModal: React.FC<{ edit?: any; onClose: () => void; onSaved: () => void }> = ({ edit, onClose, onSaved }) => {
  const { language } = useApp();
  const [form, setForm] = useState<any>(edit ? {
    title: edit.title || '', description: edit.description || '', purpose: edit.purpose || '',
    accessions: edit.accessions || [], targetQty: edit.targetQty || '', priority: edit.priority || 'normal', dueDate: edit.dueDate || '',
  } : {
    title: '', description: '', purpose: '', assigneeIds: [], accessions: [], targetQty: '', priority: 'normal', dueDate: '',
  });
  const [ops, setOps] = useState<any[]>([]);
  const [steps, setSteps] = useState<any[]>([]);
  const [accQuery, setAccQuery] = useState('');
  const [accResults, setAccResults] = useState<any[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    api.getUsers({ type: 'operator' }).then(r => setOps((r.users || []).filter((u: any) => u.status === 'active'))).catch(() => {});
    api.getOperationSteps('tissue_culture').then(r => setSteps(r.steps || [])).catch(() => {});
  }, []);

  const searchAcc = async (q: string) => {
    setAccQuery(q);
    if (!q.trim()) { setAccResults([]); return; }
    try {
      const r = await api.searchAccessions(q.trim());
      setAccResults(r.accessions || []);
    } catch { setAccResults([]); }
  };

  // 并入已选列表（去重，primaryId 为准）；notFound 条目补 id 并保留「库外」标记
  const mergeAccessions = (list: any[]) => {
    const merged = [...(form.accessions || [])];
    for (const a of list || []) {
      if (!a || !a.primaryId) continue;
      const rec = a.notFound ? { ...a, id: a.id || 'nf-' + a.primaryId, notFound: true } : a;
      if (!merged.some((x: any) => x.primaryId === rec.primaryId)) merged.push(rec);
    }
    setForm({ ...form, accessions: merged });
  };

  // 上传附件（xlsx/csv）→ 服务端解析种质编号 → 并入已选列表（含库外标记）
  const handleAccFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImportBusy(true); setErr('');
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const fileData = btoa(bin);
      const r = await api.parseOrderAccessions({ fileData });
      mergeAccessions(r.accessions || []);
    } catch (ex: any) {
      setErr(ex.message || t('orders.accImportError', language));
    } finally {
      setImportBusy(false);
    }
  };

  // 粘贴多个编号批量加入（服务端批量校验，未入库的标记为库外）
  const applyPaste = async () => {
    const ids = pasteText.split(/[\s,，;；、]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) return;
    setPasteBusy(true); setErr('');
    try {
      const r = await api.parseOrderAccessions({ ids });
      mergeAccessions(r.accessions || []);
      setPasteText('');
    } catch (ex: any) {
      setErr(ex.message || t('orders.accImportError', language));
    } finally {
      setPasteBusy(false);
    }
  };

  // 把当前搜索结果全部加入
  const addAllResults = () => mergeAccessions(accResults);

  const toggleAssignee = (id: string) => {
    const cur = form.assigneeIds || [];
    setForm({ ...form, assigneeIds: cur.includes(id) ? cur.filter((x: string) => x !== id) : [...cur, id] });
  };

  const toggleAcc = (a: any) => {
    const cur = form.accessions || [];
    const exists = cur.some((x: any) => x.id === a.id);
    setForm({ ...form, accessions: exists ? cur.filter((x: any) => x.id !== a.id) : [...cur, a] });
  };

  const notFoundCount = (form.accessions || []).filter((a: any) => a.notFound).length;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const payload = {
        title: form.title, description: form.description, purpose: form.purpose,
        accessions: form.accessions, targetQty: Number(form.targetQty) || 0,
        priority: form.priority, dueDate: form.dueDate,
      };
      if (edit) {
        await api.updateWorkOrder(edit.id, payload);
      } else {
        await api.createWorkOrder({ ...payload, assigneeIds: form.assigneeIds || [] });
      }
      onSaved(); onClose();
    } catch (e: any) { setErr(e.message || '保存失败'); setBusy(false); }
  };

  const purposes = [...new Set(steps.map((s: any) => s.purpose).filter(Boolean))];
  const purposeSteps = steps.filter((s: any) => s.purpose === form.purpose);

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scale-in custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-[#2e7d32]" /> {t(edit ? 'orders.edit' : 'orders.new', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder={`${t('orders.titleF', language)} *`} className="glass-input rounded-xl p-3 w-full text-sm" />
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder={t('orders.description', language)} rows={2} className="glass-input rounded-xl p-3 w-full text-sm resize-none" />

          {!edit && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5">
                <UsersIcon className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.assignees', language)}
              </p>
              <div className="flex flex-wrap gap-2">
                {ops.length === 0 && <p className="text-xs text-gray-400">{t('orders.noData', language)}</p>}
                {ops.map((u: any) => (
                  <button key={u.id} type="button" onClick={() => toggleAssignee(u.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${(form.assigneeIds || []).includes(u.id) ? 'bg-[#2e7d32] text-white border-[#2e7d32]' : 'bg-white/60 text-gray-500 border-gray-200 hover:bg-white'}`}>
                    {u.display_name || u.username}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-bold text-gray-500 mb-1 flex items-center gap-1.5">
              <PackageSearch className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.accessions', language)}
            </p>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <p className="text-[10px] text-gray-400">{t('orders.accessionsHint', language)}</p>
              <label className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 text-[10px] font-bold hover:bg-indigo-100 cursor-pointer">
                {importBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileUp className="w-3 h-3" />}
                {importBusy ? '...' : t('orders.uploadAcc', language)}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleAccFile} />
              </label>
            </div>
            <input value={accQuery} onChange={e => searchAcc(e.target.value)} placeholder={t('orders.searchAcc', language)}
              className="w-full glass-input rounded-xl px-3 py-2 text-sm" />
            {accQuery.trim() && (
              <div className="mt-2 max-h-40 overflow-y-auto bg-white/70 rounded-xl p-2 space-y-1 custom-scrollbar">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] text-gray-400">{t('orders.searchResults', language)}: {accResults.length}</span>
                  {accResults.length > 0 && (
                    <button type="button" onClick={addAllResults}
                      className="text-[10px] font-bold text-[#2e7d32] hover:underline">
                      {t('orders.addAllResults', language).replace('{n}', String(accResults.filter(a => !(form.accessions || []).some((x: any) => x.id === a.id)).length))}
                    </button>
                  )}
                </div>
                {accResults.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">{t('orders.noData', language)}</p>}
                {accResults.map((a: any) => {
                  const sel = (form.accessions || []).some((x: any) => x.id === a.id);
                  return (
                    <button key={a.id} type="button" onClick={() => toggleAcc(a)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-between transition-all ${sel ? 'bg-[#2e7d32]/10 text-[#2e7d32]' : 'hover:bg-white text-gray-600'}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-4 h-4 rounded border flex items-center justify-center text-[9px] flex-shrink-0 ${sel ? 'bg-[#2e7d32] border-[#2e7d32] text-white' : 'border-gray-300 text-transparent'}`}>✓</span>
                        <span>{a.primaryId}</span>
                      </span>
                      <span className="text-[10px] text-gray-400 truncate max-w-[180px]">{a.displayName}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <input value={pasteText} onChange={e => setPasteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyPaste(); } }}
                placeholder={t('orders.pasteIds', language)} className="flex-1 glass-input rounded-xl px-3 py-2 text-sm" />
              <button type="button" onClick={applyPaste} disabled={pasteBusy}
                className="px-3 py-2 rounded-xl bg-[#2e7d32]/10 text-[#2e7d32] text-xs font-bold hover:bg-[#2e7d32]/20 flex items-center gap-1 disabled:opacity-50">
                {pasteBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {t('orders.applyPaste', language)}
              </button>
            </div>
            {notFoundCount > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 font-bold">{t('orders.notFoundWarning', language).replace('{n}', String(notFoundCount))}</p>
              </div>
            )}
            {(form.accessions || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(form.accessions || []).map((a: any) => (
                  <span key={a.id} className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${a.notFound ? 'bg-amber-100 text-amber-700' : 'bg-[#e8f5e9] text-[#2e7d32]'}`}>
                    {a.primaryId}
                    {a.notFound && <span className="px-1 rounded bg-amber-500 text-white text-[8px] font-black">{t('orders.outOfLib', language)}</span>}
                    <button type="button" onClick={() => toggleAcc(a)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
              <option value="">{t('orders.purposeNone', language)}</option>
              {purposes.map(p => <option key={p} value={p}>{t(`ops.purpose.${p}`, language) || p}</option>)}
            </select>
            <input type="number" value={form.targetQty} onChange={e => setForm({ ...form, targetQty: e.target.value })}
              placeholder={t('orders.targetQty', language)} className="glass-input rounded-xl p-3 w-full text-sm" />
            <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
              className="glass-input rounded-xl p-3 w-full text-sm" />
          </div>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
            {PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEYS[p], language)}</option>)}
          </select>

          {purposeSteps.length > 0 && (
            <div className="bg-white/60 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-500 mb-2">{t('orders.stepChain', language)}</p>
              <div className="flex flex-wrap gap-1.5">
                {purposeSteps.map((s: any, i: number) => (
                  <span key={s.code} className="px-2 py-1 rounded-lg bg-white text-[10px] font-bold text-gray-600 border border-gray-100">
                    {i + 1}. {s.title}{s.dueDays ? `（${s.dueDays}天）` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {err && <p className="text-xs text-red-500">{err}</p>}
          <button onClick={submit} disabled={busy} className="btn-primary w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50">
            {busy ? '...' : t('orders.save', language)}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ================= 工单列表 / 看板 / 详情 ================= */

// v2.8: 手动进度滑条（仅 manual 模式显示；写审计）
const ManualProgressControl: React.FC<{ order: any; onSaved: () => void }> = ({ order, onSaved }) => {
  const { language } = useApp();
  const [progress, setProgress] = useState<number>(order.progress || 0);
  const [doneQty, setDoneQty] = useState<string>(String(order.doneQty || 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { setProgress(order.progress || 0); setDoneQty(String(order.doneQty || 0)); }, [order.progress, order.doneQty]);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.setWorkOrderProgress(order.id, { progress, doneQty: Number(doneQty) || 0 });
      onSaved();
    } catch (e: any) { setErr(e.message || '保存失败'); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={100} value={progress} onChange={e => setProgress(Number(e.target.value))}
          className="flex-1 accent-[#2e7d32]" />
        <span className="text-xs font-black text-gray-700 w-10 text-right">{progress}%</span>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" min={0} value={doneQty} onChange={e => setDoneQty(e.target.value)}
          placeholder={t('orders.dailyQty', language)} className="glass-input rounded-xl px-3 py-1.5 text-sm w-32" />
        <button onClick={save} disabled={busy}
          className="px-4 py-1.5 rounded-lg bg-[#2e7d32] text-white text-xs font-bold hover:bg-[#1b5e20] disabled:opacity-50 flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          {t('orders.setProgress', language)}
        </button>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>
    </div>
  );
};

const Orders: React.FC = () => {
  const { user, language } = useApp();
  const isAdmin = user?.role === 'admin';
  const viewAll = isAdmin || user?.user_type === 'regulator';

  const [orders, setOrders] = useState<any[]>([]);
  const [filters, setFilters] = useState<any>({ status: '', priority: '', q: '' });
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editOrder, setEditOrder] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [dailyOrder, setDailyOrder] = useState<any>(null);
  const [reportOrder, setReportOrder] = useState<any>(null);
  const [printLabelOrder, setPrintLabelOrder] = useState<any>(null);
  const [printWoBusy, setPrintWoBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getWorkOrders({ ...filters, mine: viewAll ? undefined : true });
      setOrders(r.orders || []);
    } catch (e: any) {
      setMsg(e.message || '加载失败');
    } finally { setLoading(false); }
  }, [filters, viewAll]);

  useEffect(() => { load(); }, [load]);

  const isMyOrder = (o: any) => isAdmin || (o.assignees || []).some((a: any) => a.userId === user?.id);
  // 详情抽屉的 assignees 在顶层 detail.assignees，不在 detail.order 内
  const detailMine = detail ? (isAdmin || (detail.assignees || []).some((a: any) => a.userId === user?.id)) : false;

  const openDetail = async (o: any) => {
    try {
      const d = await api.getWorkOrder(o.id);
      setDetail(d);
      api.getWorkOrderDailyReports(o.id).then(r => setDailyReports(r.reports || [])).catch(() => setDailyReports([]));
    } catch (e: any) { alert(e.message); }
  };
  const reloadDetail = async () => {
    if (!detail) return;
    try {
      const d = await api.getWorkOrder(detail.order.id);
      setDetail(d);
      api.getWorkOrderDailyReports(detail.order.id).then(r => setDailyReports(r.reports || [])).catch(() => setDailyReports([]));
    } catch (e: any) { /* ignore */ }
  };

  const act = async (st: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api.changeWorkOrderStatus(detail.order.id, st);
      setMsg('✓');
      await reloadDetail(); load();
    } catch (e: any) { alert(e.message); }
  };

  const doDelete = async () => {
    if (!window.confirm(t('orders.confirmDelete', language))) return;
    try {
      await api.deleteWorkOrder(detail.order.id);
      setMsg('✓');
      setDetail(null); load();
    } catch (e: any) { alert(e.message); }
  };

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await api.uploadFile(f, 'work_order_feedback', detail.order.id);
      setMsg('✓');
      await reloadDetail();
    } catch (err: any) { alert(err.message); }
    e.target.value = '';
  };

  // 打印工单：组装工单信息 HTML → 走 /api/print 管线（打印代理出纸，无代理则记录任务）
  const printWorkOrder = async () => {
    if (!detail) return;
    setPrintWoBusy(true);
    try {
      const o = detail.order;
      const accRows = (o.accessions || []).map((a: any, i: number) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${i + 1}</td><td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold;">${a.primaryId || ''}</td><td style="padding:6px 10px;border:1px solid #ddd;">${a.displayName || ''}</td><td style="padding:6px 10px;border:1px solid #ddd;">${a.species || ''}</td></tr>`).join('');
      const stepRows = (detail.steps || []).map((s: any, i: number) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${i + 1}</td><td style="padding:6px 10px;border:1px solid #ddd;">${s.title}</td><td style="padding:6px 10px;border:1px solid #ddd;">${s.dueDate || '-'}</td><td style="padding:6px 10px;border:1px solid #ddd;">${s.isDone ? '✓' : s.isCurrent ? '▶' : ''}</td></tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:24px;color:#222;}h1{font-size:20px;margin:0 0 4px;}h2{font-size:14px;margin:16px 0 6px;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px;}table{border-collapse:collapse;width:100%;font-size:12px;}td,th{font-size:12px;} .meta{display:flex;gap:24px;font-size:12px;color:#555;margin-top:8px;flex-wrap:wrap;}</style></head><body>
        <h1>工单 ${o.woNo || ''} · ${o.title || ''}</h1>
        <div class="meta">
          <span>状态：${o.status || ''}</span><span>优先级：${o.priority || ''}</span><span>截止：${o.dueDate || '-'}</span><span>进度：${o.progress || 0}%</span>
        </div>
        ${o.description ? `<p style="font-size:12px;color:#444;margin-top:10px;">${o.description}</p>` : ''}
        <h2>目标种质（${(o.accessions || []).length}）</h2>
        <table><tr><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">#</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">种质编号</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">名称</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">物种</th></tr>${accRows}</table>
        ${stepRows ? `<h2>步骤链</h2><table><tr><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">#</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">步骤</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">预计完成</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;"></th></tr>${stepRows}</table>` : ''}
        <p style="font-size:11px;color:#999;margin-top:16px;">打印时间：${new Date().toLocaleString()}</p>
      </body></html>`;
      await api.print([{ primaryId: o.woNo || o.title || 'workorder' }], '', undefined, undefined, undefined, 1, html);
      setMsg('✓ ' + t('orders.printWo', language));
    } catch (e: any) {
      alert(e.message || t('orders.accImportError', language));
    } finally {
      setPrintWoBusy(false);
    }
  };

  const card = (o: any) => (
    <div key={o.id} onClick={() => openDetail(o)} className="glass-card rounded-2xl p-3 border-l-4 cursor-pointer transition-all hover:shadow-md"
      style={{ borderLeftColor: o.overdue ? '#ef4444' : o.priority === 'urgent' ? '#f97316' : o.priority === 'high' ? '#fbbf24' : '#34d399' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-mono text-gray-400">{o.woNo}</p>
          <p className="text-sm font-bold text-gray-700 truncate">{o.title}</p>
        </div>
        {o.overdue && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {o.priority && <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${PRIORITY_COLORS[o.priority] || ''}`}>{t(PRIORITY_KEYS[o.priority] || o.priority, language)}</span>}
        {o.dueDate && <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{o.dueDate}</span>}
      </div>
      {(o.targetQty > 0 || o.progress > 0) && (
        <div className="mt-2">
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-[#2e7d32] rounded-full" style={{ width: `${Math.min(100, o.progress || 0)}%` }}></div>
          </div>
          <p className="text-[9px] text-gray-400 mt-1">{o.progress || 0}%{o.targetQty > 0 ? `（${o.doneQty || 0}/${o.targetQty}）` : ''}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-gray-400 truncate">{(o.assignees || []).map((a: any) => a.displayName || a.username).join('、') || '-'}</span>
        {isMyOrder(o) && !['done', 'cancelled'].includes(o.status) && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={e => { e.stopPropagation(); setDailyOrder(o); }}
              className="px-2 py-1 rounded-lg bg-teal-50 text-teal-600 text-[10px] font-bold hover:bg-teal-100 flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />{t('orders.dailyShort', language)}
            </button>
            <button onClick={e => { e.stopPropagation(); setReportOrder(o); }}
              className="px-2 py-1 rounded-lg bg-[#2e7d32]/10 text-[#2e7d32] text-[10px] font-bold hover:bg-[#2e7d32]/20 flex items-center gap-1">
              <Send className="w-3 h-3" />{t('orders.report', language)}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const cols = [
    { key: 'pending', cls: STATUS_COLORS.pending, label: t('orders.status.pending', language) },
    { key: 'in_progress', cls: STATUS_COLORS.in_progress, label: t('orders.status.in_progress', language) },
    { key: 'ended', cls: STATUS_COLORS.done, label: t('orders.status.done', language) },
  ];

  return (
    <div className="space-y-5 pb-10">
      {/* 标题 + 操作 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">WORK ORDERS</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-[#2e7d32]" /> {t('orders.title', language)}
          </h1>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-xl bg-white/60 p-1 gap-1">
            <button onClick={() => setView('kanban')} title={t('orders.kanban', language)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${view === 'kanban' ? 'bg-[#2e7d32] text-white shadow-sm' : 'text-gray-500 hover:bg-white'}`}>
              <LayoutGrid className="w-3.5 h-3.5" />{t('orders.kanban', language)}
            </button>
            <button onClick={() => setView('list')} title={t('orders.list', language)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${view === 'list' ? 'bg-[#2e7d32] text-white shadow-sm' : 'text-gray-500 hover:bg-white'}`}>
              <List className="w-3.5 h-3.5" />{t('orders.list', language)}
            </button>
          </div>
          <button onClick={load} className="px-3 py-2 rounded-xl bg-white/60 text-gray-500 hover:bg-white"><RefreshCw className="w-4 h-4" /></button>
          {isAdmin && (
            <button onClick={() => { setEditOrder(null); setShowForm(true); }} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold">
              <Plus className="w-4 h-4 inline mr-1" />{t('orders.new', language)}
            </button>
          )}
        </div>
      </div>

      {/* 筛选条 */}
      <div className="glass-card p-3 rounded-2xl flex flex-wrap gap-2 items-center">
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('orders.status', language)}: ${t('ops.all', language)}`}</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{t(STATUS_KEYS[s], language)}</option>)}
        </select>
        <select value={filters.priority} onChange={e => setFilters({ ...filters, priority: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('orders.priority', language)}: ${t('ops.all', language)}`}</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEYS[p], language)}</option>)}
        </select>
        <input type="text" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })}
          placeholder={`${t('orders.titleF', language)} / ${t('orders.woNo', language)}`} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* 看板视图 */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cols.map(col => {
            const items = col.key === 'ended' ? orders.filter(o => ENDED_STATUSES.includes(o.status)) : orders.filter(o => o.status === col.key);
            return (
              <div key={col.key} className="bg-white/40 rounded-2xl p-3">
                <div className="flex items-center justify-between px-1 mb-3">
                  {col.key === 'ended' ? (
                    <div className="flex gap-1 flex-wrap">
                      {['done', 'blocked', 'cancelled'].map(s => (
                        <span key={s} className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${STATUS_COLORS[s]}`}>{t(STATUS_KEYS[s], language)}</span>
                      ))}
                    </div>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${col.cls}`}>{col.label}</span>
                  )}
                  <span className="text-xs font-black text-gray-400">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map(card)}
                  {items.length === 0 && (
                    <div className="text-center text-[10px] text-gray-300 py-6 border border-dashed border-gray-200 rounded-xl">{t('orders.noData', language)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 列表视图 */}
      {view === 'list' && (
        <div className="glass-card rounded-2xl overflow-hidden">
          {orders.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{t('orders.noData', language)}</div> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="px-4 py-3 text-left font-bold">{t('orders.woNo', language)}</th>
                <th className="px-4 py-3 text-left font-bold">{t('orders.titleF', language)}</th>
                <th className="px-4 py-3 text-left font-bold">{t('orders.status', language)}</th>
                <th className="px-4 py-3 text-left font-bold">{t('orders.priority', language)}</th>
                <th className="px-4 py-3 text-left font-bold">{t('orders.progress', language)}</th>
                <th className="px-4 py-3 text-left font-bold">{t('orders.dueDate', language)}</th>
                <th className="px-4 py-3 text-left font-bold">{t('orders.assignees', language)}</th>
              </tr></thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} onClick={() => openDetail(o)} className="border-t border-gray-50 hover:bg-teal-50/40 cursor-pointer">
                    <td className="px-4 py-3 t-num text-xs text-gray-400">{o.woNo}</td>
                    <td className="px-4 py-3 font-bold text-gray-700 flex items-center gap-2">
                      {o.title}
                      {o.overdue && <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[9px] font-bold">{t('orders.overdueTag', language)}</span>}
                    </td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[o.status] || ''}`}>{t(STATUS_KEYS[o.status] || o.status, language)}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PRIORITY_COLORS[o.priority] || ''}`}>{t(PRIORITY_KEYS[o.priority] || o.priority, language)}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#2e7d32] rounded-full" style={{ width: `${Math.min(100, o.progress || 0)}%` }}></div>
                        </div>
                        <span className="t-num text-xs text-gray-500">{o.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 t-num text-gray-500 text-xs">{o.dueDate || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{(o.assignees || []).map((a: any) => a.displayName || a.username).join('、') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 详情抽屉 */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scale-in custom-scrollbar" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-lg font-bold text-gray-700 truncate">{detail.order.woNo} · {detail.order.title}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${STATUS_COLORS[detail.order.status] || ''}`}>
                  {t(STATUS_KEYS[detail.order.status] || detail.order.status, language)}
                </span>
              </div>
              <button onClick={() => setDetail(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>

            {/* 信息 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-white/60 rounded-xl p-3 mb-3">
              <div><p className="text-gray-400">{t('orders.purpose', language)}</p><p className="font-bold text-gray-700">{detail.order.purpose ? t(`ops.purpose.${detail.order.purpose}`, language) || detail.order.purpose : t('orders.purposeNone', language)}</p></div>
              <div><p className="text-gray-400">{t('orders.priority', language)}</p><p className="font-bold text-gray-700">{t(PRIORITY_KEYS[detail.order.priority] || 'orders.priNormal', language)}</p></div>
              <div><p className="text-gray-400">{t('orders.dueDate', language)}</p><p className="font-bold text-gray-700">{detail.order.dueDate || '-'}</p></div>
              <div><p className="text-gray-400">{t('orders.progress', language)}</p><p className="font-bold text-gray-700">{detail.order.progress || 0}%{detail.order.targetQty > 0 ? `（${detail.order.doneQty || 0}/${detail.order.targetQty}）` : ''}</p></div>
              <div><p className="text-gray-400">{t('orders.createdBy', language)}</p><p className="font-bold text-gray-700">{detail.order.createdBy || '-'}</p></div>
              <div><p className="text-gray-400">{t('orders.assignedTo', language)}</p><p className="font-bold text-gray-700">{(detail.assignees || []).map((a: any) => a.displayName || a.username).join('、') || '-'}</p></div>
            </div>
            {detail.order.description && <p className="text-xs text-gray-500 bg-white/60 rounded-xl p-3 mb-3">{detail.order.description}</p>}

            {/* v2.8: 进度模式（auto 自动汇总 / manual 手动） */}
            {detailMine && (
              <div className="bg-white/60 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.progressMode', language)}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${detail.order.progressMode === 'manual' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                    {detail.order.progressMode === 'manual' ? t('orders.progressModeManual', language) : t('orders.progressModeAuto', language)}
                  </span>
                  <div className="ml-auto flex rounded-lg bg-white p-0.5 gap-0.5">
                    <button onClick={async () => { try { await api.setWorkOrderProgressMode(detail.order.id, ''); await reloadDetail(); } catch (e: any) { alert(e.message); } }}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${detail.order.progressMode !== 'manual' ? 'bg-[#2e7d32] text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                      {t('orders.progressModeAuto', language)}
                    </button>
                    <button onClick={async () => { try { await api.setWorkOrderProgressMode(detail.order.id, 'manual'); await reloadDetail(); } catch (e: any) { alert(e.message); } }}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${detail.order.progressMode === 'manual' ? 'bg-amber-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                      {t('orders.progressModeManual', language)}
                    </button>
                  </div>
                </div>
                {detail.order.progressMode === 'manual' && (
                  <ManualProgressControl order={detail.order} onSaved={reloadDetail} />
                )}
                <p className="text-[10px] text-gray-400 mt-1.5">{t('orders.progressModeHint', language)}</p>
              </div>
            )}
            {(detail.order.accessions || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(detail.order.accessions || []).map((a: any) => (
                  <span key={a.id || a.primaryId} className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${a.notFound ? 'bg-amber-100 text-amber-700' : 'bg-[#e8f5e9] text-[#2e7d32]'}`}>
                    {a.primaryId}
                    {a.notFound && <span className="px-1 rounded bg-amber-500 text-white text-[8px] font-black">{t('orders.outOfLib', language)}</span>}
                  </span>
                ))}
              </div>
            )}

            {/* 步骤链（v2.6）：每步预计 D+n 完成 · 提前提醒 */}
            {(detail.steps || []).length > 0 && (
              <div className="bg-white/60 rounded-xl p-3 mb-3">
                <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.stepChain', language)}
                  {detail.currentStep && (
                    <span className="ml-auto text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">{t('orders.currentStep', language)}: {detail.currentStep.title || detail.currentStep.code}</span>
                  )}
                </p>
                <div className="space-y-1.5">
                  {(detail.steps || []).map((s: any, i: number) => (
                    <div key={s.code} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${s.isDone ? 'bg-green-50' : s.isCurrent ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0 ${s.isDone ? 'bg-green-500 text-white' : s.isCurrent ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                        {s.isDone ? '✓' : i + 1}
                      </span>
                      <span className={`font-bold ${s.isDone ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{s.title || s.code}</span>
                      <span className="flex-1" />
                      {s.dueDate && <span className="text-[10px] text-gray-400">{t('orders.stepChainDue', language)}: {s.dueDate}</span>}
                      {s.reminderLeadDays > 0 && (
                        <span className="text-[10px] text-orange-500">{t('orders.stepReminderDays', language).replace('{n}', String(s.reminderLeadDays))}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 状态操作 */}
            <div className="flex flex-wrap gap-2 mb-3">
              {detailMine && ['pending', 'in_progress', 'blocked'].includes(detail.order.status) && (
                <button onClick={() => setReportOrder(detail.order)} className="btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                  <Send className="w-3.5 h-3.5" />{t('orders.report', language)}
                </button>
              )}
              {detailMine && ['pending', 'in_progress', 'blocked'].includes(detail.order.status) && (
                <button onClick={() => setDailyOrder(detail.order)} className="px-4 py-2 rounded-xl bg-teal-50 text-teal-600 text-xs font-bold hover:bg-teal-100 flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />{t('orders.submitDaily', language)}
                </button>
              )}
              {detailMine && (
                <button onClick={printWorkOrder} disabled={printWoBusy} className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-xs font-bold hover:bg-indigo-100 flex items-center gap-1 disabled:opacity-50">
                  {printWoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}{t('orders.printWo', language)}
                </button>
              )}
              {detailMine && (detail.order.accessions || []).length > 0 && (
                <button onClick={() => setPrintLabelOrder(detail.order)} className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-xs font-bold hover:bg-indigo-100 flex items-center gap-1">
                  <Printer className="w-3.5 h-3.5" />{t('orders.printLabels', language)}
                </button>
              )}
              {detailMine && detail.order.status === 'pending' && (
                <button onClick={() => act('in_progress')} className="px-4 py-2 rounded-xl bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100 flex items-center gap-1">
                  <Play className="w-3.5 h-3.5" />{t('orders.start', language)}
                </button>
              )}
              {detailMine && detail.order.status === 'blocked' && (
                <button onClick={() => act('in_progress')} className="px-4 py-2 rounded-xl bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100 flex items-center gap-1">
                  <RotateCcw className="w-3.5 h-3.5" />{t('orders.start', language)}
                </button>
              )}
              {isAdmin && !['done', 'cancelled'].includes(detail.order.status) && (
                <button onClick={() => { setEditOrder(detail.order); setShowForm(true); }} className="px-4 py-2 rounded-xl bg-gray-50 text-gray-600 text-xs font-bold hover:bg-gray-100 flex items-center gap-1">
                  <Pencil className="w-3.5 h-3.5" />{t('orders.edit', language)}
                </button>
              )}
              {isAdmin && !['done', 'cancelled'].includes(detail.order.status) && (
                <button onClick={() => act('cancelled', t('orders.confirmCancel', language))} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-600 text-xs font-bold hover:bg-amber-100 flex items-center gap-1">
                  <Ban className="w-3.5 h-3.5" />{t('orders.cancel', language)}
                </button>
              )}
              {isAdmin && detail.order.status === 'pending' && (
                <button onClick={doDelete} className="px-4 py-2 rounded-xl bg-red-50 text-red-500 text-xs font-bold hover:bg-red-100 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" />{t('orders.delete', language)}
                </button>
              )}
            </div>

            {/* 报工时间线 */}
            <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.feedbackTimeline', language)}</p>
            <div className="space-y-2 mb-3">
              {(detail.feedback || []).length === 0 && <p className="text-xs text-gray-400 bg-white/60 rounded-xl p-3">{t('orders.noData', language)}</p>}
              {(detail.feedback || []).map((f: any) => (
                <div key={f.id} className="bg-white/60 rounded-xl p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${f.kind === 'done' ? 'bg-green-100 text-green-700' : f.kind === 'issue' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>
                        {t(`orders.kind.${f.kind}`, language)}
                      </span>
                      <span className="font-bold text-gray-700">{f.username}</span>
                      {f.qty > 0 && <span className="text-gray-500">{t('orders.qty', language)}: {f.qty}</span>}
                      {f.step_code && <span className="text-gray-400">{f.step_code}</span>}
                    </div>
                    <span className="text-[10px] text-gray-400">{f.created_at?.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  {f.content && <p className="text-gray-500 mt-1">{f.content}</p>}
                </div>
              ))}
            </div>

            {/* 日报台账（v2.8：订单→工序→日报，按日期倒序） */}
            <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.dailyReports', language)}</p>
            <div className="space-y-2 mb-3">
              {dailyReports.length === 0 && <p className="text-xs text-gray-400 bg-white/60 rounded-xl p-3">{t('orders.noData', language)}</p>}
              {dailyReports.map((r: any) => (
                <div key={r.id} className="bg-white/60 rounded-xl p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 text-[9px] font-bold">{r.reportDate}</span>
                      <span className="font-bold text-gray-700">{r.stepCode}</span>
                      <span className="text-gray-500">{r.username}</span>
                      {r.qty > 0 && <span className="text-gray-500">{t('orders.qty', language)}: {r.qty}</span>}
                    </div>
                    <span className="text-[10px] text-gray-400">{r.updatedAt?.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                  {r.content && <p className="text-gray-500 mt-1">{r.content}</p>}
                  {r.photos?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {r.photos.map((p: any) => (
                        <a key={p.id} href={`/uploads/${p.stored_name}`} target="_blank" rel="noreferrer"
                          className="block w-14 h-14 rounded-lg overflow-hidden border border-gray-100 hover:shadow-md transition-shadow">
                          <img src={`/uploads/${p.stored_name}`} alt={p.original_name} className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 关联操作记录 */}
            <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.linkedRecords', language)}</p>
            <div className="space-y-2 mb-3">
              {(detail.records || []).length === 0 && <p className="text-xs text-gray-400 bg-white/60 rounded-xl p-3">{t('orders.noData', language)}</p>}
              {(detail.records || []).map((r: any) => (
                <div key={r.id} className="bg-white/60 rounded-xl p-3 text-xs flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-700">{r.step_code} · {r.title}</p>
                    <p className="text-gray-400 mt-0.5">{r.operator} · {r.event_at?.slice(0, 16).replace('T', ' ')}{r.content?.qty ? ` · ${t('orders.qty', language)}: ${r.content.qty}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 照片 */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5"><Camera className="w-3.5 h-3.5 text-[#2e7d32]" />{t('orders.photos', language)}</p>
              {detailMine && (
                <label className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 cursor-pointer flex items-center gap-1">
                  <Camera className="w-3 h-3" />{t('ops.upload', language)}
                  <input type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(detail.photos || []).length === 0 && <p className="text-xs text-gray-400 bg-white/60 rounded-xl p-3">{t('orders.noData', language)}</p>}
              {(detail.photos || []).map((p: any) => (
                <a key={p.id} href={`/uploads/${p.stored_name}`} target="_blank" rel="noreferrer"
                  className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-100 hover:shadow-md transition-shadow">
                  <img src={`/uploads/${p.stored_name}`} alt={p.original_name} className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {showForm && <OrderFormModal edit={editOrder || undefined} onClose={() => { setShowForm(false); setEditOrder(null); }} onSaved={() => { load(); if (detail) reloadDetail(); }} />}
      {reportOrder && <FeedbackModal order={reportOrder} onClose={() => setReportOrder(null)} onSubmitted={() => { load(); reloadDetail(); }} />}
      {dailyOrder && <DailyReportModal order={dailyOrder} onClose={() => setDailyOrder(null)} onSubmitted={() => { load(); reloadDetail(); }} />}
      {printLabelOrder && <OrderLabelPrintModal order={printLabelOrder} onClose={() => setPrintLabelOrder(null)} onSubmitted={() => { setMsg('✓'); }} />}

      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default Orders;
