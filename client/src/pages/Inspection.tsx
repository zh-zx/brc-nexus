import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import {
  ClipboardCheck, Plus, X, RefreshCw, Camera, Loader2, Calendar, Repeat,
  Users as UsersIcon, AlertTriangle, CheckCircle2, Wrench, Package, Snowflake, Flame,
} from 'lucide-react';

const TARGET_ICONS: Record<string, any> = {
  inventory: Package,
  freezer: Snowflake,
  cryo: Flame,
};

const TARGET_COLORS: Record<string, string> = {
  inventory: 'bg-green-100 text-green-700',
  freezer: 'bg-blue-100 text-blue-700',
  cryo: 'bg-purple-100 text-purple-700',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'tone-warn',
  in_progress: 'tone-info',
  done: 'tone-ok',
  cancelled: 'tone-neutral',
};

const RECORD_BADGE: Record<string, string> = {
  normal: 'tone-ok',
  warning: 'tone-warn',
  error: 'tone-bad',
};

/* ================= 新建/编辑巡检弹窗（管理员） ================= */
const InspectionFormModal: React.FC<{ edit?: any; onClose: () => void; onSaved: () => void }> = ({ edit, onClose, onSaved }) => {
  const { language } = useApp();
  const [form, setForm] = useState<any>(edit ? {
    title: edit.title || '', scopeType: edit.scopeType || 'all', targetType: edit.targetType || 'inventory',
    targetRef: edit.targetRef || 'all', dueDate: edit.dueDate || '', repeatMode: edit.repeatMode || 'none',
    repeatInterval: edit.repeatInterval || 1, assigneeIds: edit.assignees || [],
  } : {
    title: '', scopeType: 'all', targetType: 'inventory', targetRef: 'all', dueDate: '',
    repeatMode: 'none', repeatInterval: 1, assigneeIds: [],
  });
  const [ops, setOps] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [accQuery, setAccQuery] = useState('');
  const [accResults, setAccResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getUsers({ type: 'operator' }).then(r => setOps((r.users || []).filter((u: any) => u.status === 'active'))).catch(() => {});
    api.getWorkOrders({ status: '' }).then(r => setOrders(r.orders || [])).catch(() => {});
  }, []);

  const toggleAssignee = (id: string) => {
    const cur = form.assigneeIds || [];
    setForm({ ...form, assigneeIds: cur.includes(id) ? cur.filter((x: string) => x !== id) : [...cur, id] });
  };

  const searchAcc = async (q: string) => {
    setAccQuery(q);
    if (!q.trim()) { setAccResults([]); return; }
    try {
      const r = await api.searchAccessions(q.trim());
      setAccResults(r.accessions || []);
    } catch { setAccResults([]); }
  };

  const toggleAcc = (a: any) => {
    const cur = form.selectedAccessions || [];
    const exists = cur.some((x: any) => x.id === a.id);
    const next = exists ? cur.filter((x: any) => x.id !== a.id) : [...cur, a];
    setForm({ ...form, selectedAccessions: next, targetRef: JSON.stringify(next.map((x: any) => ({ id: x.id }))) });
  };

  const submit = async () => {
    if (!form.title.trim()) { setErr(t('inspection.titleF', language) + ' *'); return; }
    setBusy(true); setErr('');
    try {
      const payload = {
        title: form.title.trim(), scopeType: form.scopeType, targetType: form.targetType,
        targetRef: form.scopeType === 'all' ? 'all' : form.targetRef, dueDate: form.dueDate,
        repeatMode: form.repeatMode, repeatInterval: Number(form.repeatInterval) || 1, assigneeIds: form.assigneeIds,
      };
      if (edit) {
        await api.updateInspection(edit.id, payload);
      } else {
        await api.createInspection(payload);
      }
      onSaved(); onClose();
    } catch (e: any) {
      setErr(e.message || '保存失败'); setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scale-in custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[#2e7d32]" /> {t(edit ? 'inspection.detail' : 'inspection.new', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder={`${t('inspection.titleF', language)} *`} className="glass-input rounded-xl p-3 w-full text-sm" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.scope', language)}</label>
              <select value={form.scopeType} onChange={e => setForm({ ...form, scopeType: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
                <option value="all">{t('inspection.scope.all', language)}</option>
                <option value="order">{t('inspection.scope.order', language)}</option>
                <option value="accessions">{t('inspection.scope.accessions', language)}</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.targetType', language)}</label>
              <select value={form.targetType} onChange={e => setForm({ ...form, targetType: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
                <option value="inventory">{t('inspection.targetType.inventory', language)}</option>
                <option value="freezer">{t('inspection.targetType.freezer', language)}</option>
                <option value="cryo">{t('inspection.targetType.cryo', language)}</option>
              </select>
            </div>
          </div>

          {form.scopeType === 'order' && (
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.scope.order', language)}</label>
              <select value={form.targetRef} onChange={e => setForm({ ...form, targetRef: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
                <option value="">-</option>
                {orders.map((o: any) => <option key={o.id} value={o.id}>{o.woNo} · {o.title}</option>)}
              </select>
              {orders.length === 0 && <p className="text-xs text-gray-400 mt-1">{t('orders.noData', language)}</p>}
            </div>
          )}

          {form.scopeType === 'accessions' && (
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.scope.accessions', language)}</label>
              <input value={accQuery} onChange={e => searchAcc(e.target.value)} placeholder={t('orders.searchAcc', language)} className="glass-input rounded-xl p-3 w-full text-sm" />
              {accQuery.trim() && (
                <div className="mt-2 max-h-40 overflow-y-auto bg-white/70 rounded-xl p-2 space-y-1 custom-scrollbar">
                  {accResults.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">{t('orders.noData', language)}</p>}
                  {accResults.map((a: any) => (
                    <button key={a.id} type="button" onClick={() => toggleAcc(a)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-between transition-all ${(form.selectedAccessions || []).some((x: any) => x.id === a.id) ? 'bg-[#2e7d32]/10 text-[#2e7d32]' : 'hover:bg-white text-gray-600'}`}>
                      <span>{a.primaryId}</span><span className="text-[10px] text-gray-400">{a.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
              {(form.selectedAccessions || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(form.selectedAccessions || []).map((a: any) => (
                    <span key={a.id} className="px-2.5 py-1 rounded-full bg-[#e8f5e9] text-[#2e7d32] text-xs font-bold flex items-center gap-1">
                      {a.primaryId}
                      <button type="button" onClick={() => toggleAcc(a)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.dueDate', language)}</label>
              <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.repeat', language)}</label>
              <select value={form.repeatMode} onChange={e => setForm({ ...form, repeatMode: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
                <option value="none">{t('inspection.repeat.none', language)}</option>
                <option value="daily">{t('inspection.repeat.daily', language)}</option>
                <option value="weekly">{t('inspection.repeat.weekly', language)}</option>
                <option value="monthly">{t('inspection.repeat.monthly', language)}</option>
              </select>
            </div>
            {form.repeatMode !== 'none' ? (
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('inspection.repeatInterval', language)}</label>
                <input type="number" min={1} value={form.repeatInterval} onChange={e => setForm({ ...form, repeatInterval: Math.max(1, Number(e.target.value) || 1) })} className="glass-input rounded-xl p-3 w-full text-sm" />
              </div>
            ) : <div />}
          </div>

          <div>
            <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5">
              <UsersIcon className="w-3.5 h-3.5 text-[#2e7d32]" />{t('inspection.assignees', language)}
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

          {err && <p className="text-xs text-red-500">{err}</p>}
          <button onClick={submit} disabled={busy} className="btn-primary w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50">
            {busy ? '...' : t('orders.save', language)}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ================= 巡检执行弹窗（被指派者逐项上报） ================= */
const InspectionExecModal: React.FC<{ taskId: string; onClose: () => void; onSubmitted: () => void }> = ({ taskId, onClose, onSubmitted }) => {
  const { language } = useApp();
  const [data, setData] = useState<any>(null);
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.getInspectionChecklist(taskId)); } catch (e: any) { setMsg(e.message || '加载失败'); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const uploadPhoto = async (ref: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = await api.uploadFile(f, 'inspection', taskId);
      const pid = r.id || r.stored_name || String(Date.now());
      setPhotos(p => ({ ...p, [ref]: [...(p[ref] || []), pid] }));
    } catch (ex: any) { setMsg(ex.message || '上传失败'); }
  };

  const submitRef = async (ref: string) => {
    const status = statuses[ref] || 'normal';
    setBusyId(ref);
    setMsg('');
    try {
      await api.submitInspectionRecord(taskId, { targetRef: ref, status, note: notes[ref] || '', photoIds: photos[ref] || [] });
      await load();
      onSubmitted();
    } catch (e: any) {
      setMsg(e.message || '提交失败');
    } finally {
      setBusyId('');
    }
  };

  // 统一提交所有未检项
  const submitAll = async () => {
    const pending = (data?.checklist || []).filter((c: any) => !c.record);
    for (const c of pending) {
      await api.submitInspectionRecord(taskId, { targetRef: c.ref, status: statuses[c.ref] || 'normal', note: notes[c.ref] || '', photoIds: photos[c.ref] || [] });
    }
    await load();
    onSubmitted();
    setMsg('✓');
  };

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl shadow-2xl animate-scale-in flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />{msg || '...'}
        </div>
      </div>
    );
  }

  const task = data.task;
  const checked = (data.checklist || []).filter((c: any) => c.record).length;
  const total = (data.checklist || []).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scale-in custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[#2e7d32]" /> {t('inspection.checklist', language)} · {task.title}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TARGET_COLORS[task.targetType] || ''}`}>{t(`inspection.targetType.${task.targetType}`, language)}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[task.status] || ''}`}>{t(`inspection.status.${task.status}`, language)}</span>
          {task.dueDate && <span className="text-[10px] text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{t('inspection.dueDate', language)}: {task.dueDate}</span>}
          <span className="text-[10px] font-bold text-gray-500">{t('inspection.progress', language)}: {checked}/{total}</span>
          {total > 0 && (
            <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#2e7d32] rounded-full" style={{ width: `${(checked / total) * 100}%` }}></div>
            </div>
          )}
        </div>

        {msg && <p className="text-xs font-bold text-gray-500 bg-white/60 rounded-lg px-3 py-2 mb-3">{msg}</p>}

        {total === 0 && <p className="text-xs text-gray-400 bg-white/60 rounded-xl p-4">{t('inspection.emptyChecklist', language)}</p>}

        <div className="space-y-3">
          {(data.checklist || []).map((c: any) => {
            const r = c.record;
            return (
              <div key={c.ref} className={`rounded-2xl p-3 border ${r ? 'border-green-100 bg-green-50/50' : 'border-gray-100 bg-white/60'}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-700">{c.label}</p>
                    <p className="text-[10px] text-gray-400">{c.sub}</p>
                  </div>
                  {r && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${RECORD_BADGE[r.status] || ''}`}>
                      {t(`inspection.recordStatus.${r.status}`, language)}{r.username ? ` · ${r.username}` : ''}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {(['normal', 'warning', 'error'] as const).map(s => (
                    <button key={s} onClick={() => setStatuses(p => ({ ...p, [c.ref]: s }))}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold border transition-all ${(statuses[c.ref] || (r ? r.status : 'normal')) === s ? 'bg-[#2e7d32] text-white border-[#2e7d32]' : 'bg-white/70 text-gray-500 border-gray-200 hover:bg-white'}`}>
                      {t(`inspection.recordStatus.${s}`, language)}
                    </button>
                  ))}
                  <input value={notes[c.ref] ?? r?.note ?? ''} onChange={e => setNotes(p => ({ ...p, [c.ref]: e.target.value }))}
                    placeholder={t('inspection.note', language)} className="flex-1 min-w-[140px] glass-input rounded-lg px-3 py-1.5 text-xs" />
                  <label className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 cursor-pointer">
                    <Camera className="w-3 h-3" />{t('inspection.photo', language)}
                    <input type="file" accept="image/*" className="hidden" onChange={e => uploadPhoto(c.ref, e)} />
                  </label>
                  {(photos[c.ref] || []).length > 0 && <span className="text-[10px] text-blue-500 font-bold">{photos[c.ref]!.length}</span>}
                  <button onClick={() => submitRef(c.ref)} disabled={busyId === c.ref || (task.status === 'done')}
                    className="px-3 py-1.5 rounded-lg bg-[#2e7d32] text-white text-[10px] font-bold hover:bg-[#2e7d32]/90 disabled:opacity-40 flex items-center gap-1">
                    {busyId === c.ref ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    {t('inspection.submitRecord', language)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {checked < total && task.status !== 'done' && (
          <button onClick={submitAll} className="btn-primary w-full py-3 rounded-xl text-sm font-bold mt-4">{t('inspection.submitAll', language)} ({total - checked})</button>
        )}
      </div>
    </div>
  );
};

/* ================= 巡检详情（管理员/监管方：查看记录汇总） ================= */
const InspectionDetailModal: React.FC<{ taskId: string; onClose: () => void }> = ({ taskId, onClose }) => {
  const { language } = useApp();
  const [data, setData] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getInspectionChecklist(taskId).then(setData).catch((e: any) => setMsg(e.message));
    api.getInspectionRecords(taskId).then(r => setRecords(r.records || [])).catch(() => {});
  }, [taskId]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl shadow-2xl animate-scale-in flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />{msg || '...'}
        </div>
      </div>
    );
  }

  const task = data.task;
  const bad = records.filter((r: any) => r.status !== 'normal');

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scale-in custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[#2e7d32]" /> {t('inspection.detail', language)} · {task.title}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white/60 rounded-xl p-3 mb-3">
          <div><p className="text-gray-400">{t('inspection.targetType', language)}</p><p className="font-bold text-gray-700">{t(`inspection.targetType.${task.targetType}`, language)}</p></div>
          <div><p className="text-gray-400">{t('inspection.status', language)}</p><p className="font-bold text-gray-700">{t(`inspection.status.${task.status}`, language)}</p></div>
          <div><p className="text-gray-400">{t('inspection.dueDate', language)}</p><p className="font-bold text-gray-700">{task.dueDate || '-'}</p></div>
          <div><p className="text-gray-400">{t('inspection.repeat', language)}</p><p className="font-bold text-gray-700">{task.repeatMode !== 'none' ? `${t(`inspection.repeat.${task.repeatMode}`, language)} ×${task.repeatInterval}` : t('inspection.repeat.none', language)}</p></div>
          <div><p className="text-gray-400">{t('inspection.progress', language)}</p><p className="font-bold text-gray-700">{records.length}/{data.checklist.length}</p></div>
          <div><p className="text-gray-400">{t('inspection.createdBy', language)}</p><p className="font-bold text-gray-700">{task.createdBy || '-'}</p></div>
          <div><p className="text-gray-400">{t('inspection.finishedAt', language)}</p><p className="font-bold text-gray-700">{task.finishedAt?.slice(0, 16).replace('T', ' ') || '-'}</p></div>
        </div>

        {bad.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-3 mb-3">
            <p className="text-xs font-black text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{bad.length} {t('inspection.recordStatus.warning', language)} / {t('inspection.recordStatus.error', language)}</p>
            <div className="space-y-1 mt-2">
              {bad.map((r: any) => (
                <p key={r.id} className="text-[10px] text-red-600">{r.username} · {r.target_ref} · {t(`inspection.recordStatus.${r.status}`, language)}{r.note ? ` · ${r.note}` : ''}</p>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs font-bold text-gray-500 mb-2">{t('inspection.records', language)} ({records.length})</p>
        <div className="space-y-2">
          {records.length === 0 && <p className="text-xs text-gray-400 bg-white/60 rounded-xl p-3">{t('orders.noData', language)}</p>}
          {records.map((r: any) => (
            <div key={r.id} className="bg-white/60 rounded-xl p-3 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-gray-700 truncate">{r.target_ref}</p>
                <p className="text-gray-400 mt-0.5">{r.username} · {r.created_at?.slice(0, 16).replace('T', ' ')}{r.note ? ` · ${r.note}` : ''}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${RECORD_BADGE[r.status] || ''}`}>{t(`inspection.recordStatus.${r.status}`, language)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ================= 巡检主页 ================= */
const Inspection: React.FC = () => {
  const { user, language } = useApp();
  const isAdmin = user?.role === 'admin';
  const isRegulator = user?.user_type === 'regulator';

  const [tasks, setTasks] = useState<any[]>([]);
  const [filters, setFilters] = useState<any>({ status: '', targetType: '', mine: false });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<any>(null);
  const [execTask, setExecTask] = useState<any>(null);
  const [detailTask, setDetailTask] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getInspections({ status: filters.status, targetType: filters.targetType, mine: filters.mine });
      setTasks(r.inspections || []);
    } catch (e: any) { /* ignore */ }
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (task: any, status: string) => {
    if (status === 'cancelled' && !window.confirm(t('inspection.confirmCancel', language))) return;
    if (status === 'done' && !window.confirm(t('inspection.confirmDone', language))) return;
    try {
      await api.changeInspectionStatus(task.id, status);
      load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in-up pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#e8f5e9] rounded-2xl flex items-center justify-center text-[#2e7d32]">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <span className="t-eyebrow">QUALITY CONTROL</span>
            <h1 className="t-page-title text-2xl mt-1">{t('inspection.title', language)}</h1>
            <p className="text-xs text-gray-400 font-medium">{tasks.length} {t('inspection.titleF', language)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={() => { setEditTask(null); setShowForm(true); }} className="btn-primary px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t('inspection.new', language)}
            </button>
          )}
        </div>
      </div>

      {/* 筛选条 */}
      <div className="glass-card p-3 rounded-2xl flex flex-wrap gap-2 items-center">
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('inspection.status', language)}: ${t('ops.all', language)}`}</option>
          {['pending', 'in_progress', 'done', 'cancelled'].map(s => <option key={s} value={s}>{t(`inspection.status.${s}`, language)}</option>)}
        </select>
        <select value={filters.targetType} onChange={e => setFilters({ ...filters, targetType: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('inspection.targetType', language)}: ${t('ops.all', language)}`}</option>
          {['inventory', 'freezer', 'cryo'].map(s => <option key={s} value={s}>{t(`inspection.targetType.${s}`, language)}</option>)}
        </select>
        {!isAdmin && !isRegulator && (
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500 px-2 cursor-pointer">
            <input type="checkbox" checked={filters.mine} onChange={e => setFilters({ ...filters, mine: e.target.checked })} className="w-4 h-4 accent-[#2e7d32]" />
            {t('inspection.mine', language)}
          </label>
        )}
        <button onClick={load} className="px-3 py-2 rounded-xl bg-white/60 text-gray-500 hover:bg-white"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* 任务列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#2e7d32]" /></div>
      ) : tasks.length === 0 ? (
        <div className="glass-panel rounded-3xl p-12 text-center text-gray-400">
          <ClipboardCheck className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold">{t('inspection.noTasks', language)}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tasks.map(task => {
            const Icon = TARGET_ICONS[task.targetType] || ClipboardCheck;
            const canExec = (isAdmin || (task.assignees || []).includes(String(user?.id))) && !['done', 'cancelled'].includes(task.status);
            const canView = isAdmin || isRegulator || (task.assignees || []).includes(String(user?.id));
            return (
              <div key={task.id} className="glass-card rounded-2xl p-4 border-l-4 transition-all hover:shadow-md"
                style={{ borderLeftColor: task.status === 'done' ? '#34d399' : task.status === 'cancelled' ? '#9ca3af' : task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && task.status !== 'done' ? '#ef4444' : '#f59e0b' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-[#2e7d32]" />
                      <p className="text-sm font-bold text-gray-700 truncate">{task.title}</p>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{task.createdBy} · {task.createdAt?.slice(0, 10)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${STATUS_BADGE[task.status] || ''}`}>{t(`inspection.status.${task.status}`, language)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${TARGET_COLORS[task.targetType] || ''}`}>{t(`inspection.targetType.${task.targetType}`, language)}</span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold">
                    {task.scopeType === 'all' ? t('inspection.scope.all', language) : task.scopeType === 'order' ? t('inspection.scope.order', language) : t('inspection.scope.accessions', language)}
                  </span>
                  {task.repeatMode !== 'none' && (
                    <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center gap-1">
                      <Repeat className="w-3 h-3" />{t(`inspection.repeat.${task.repeatMode}`, language)} ×{task.repeatInterval}
                    </span>
                  )}
                  {task.dueDate && (
                    <span className="text-[10px] text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{task.dueDate}</span>
                  )}
                </div>
                {task.status !== 'done' && task.status !== 'cancelled' && (
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#2e7d32] rounded-full" style={{ width: `${Math.min(100, (task.records / Math.max(1, 100)) * 100)}%` }}></div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500">{t('inspection.recordsCount', language).replace('{n}', String(task.records))}</span>
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  {canExec && (
                    <button onClick={() => setExecTask(task)} className="flex-1 px-3 py-1.5 rounded-lg bg-[#2e7d32]/10 text-[#2e7d32] text-xs font-bold hover:bg-[#2e7d32]/20 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />{t('inspection.checklist', language)}
                    </button>
                  )}
                  {canView && (
                    <button onClick={() => setDetailTask(task)} className="flex-1 px-3 py-1.5 rounded-lg bg-white/60 text-gray-500 text-xs font-bold hover:bg-white flex items-center justify-center gap-1">
                      <ClipboardCheck className="w-3.5 h-3.5" />{t('inspection.detail', language)}
                    </button>
                  )}
                  {isAdmin && !['done', 'cancelled'].includes(task.status) && (
                    <button onClick={() => { setEditTask(task); setShowForm(true); }} className="px-3 py-1.5 rounded-lg bg-white/60 text-gray-500 text-xs font-bold hover:bg-white"><Wrench className="w-3.5 h-3.5" /></button>
                  )}
                </div>
                {isAdmin && task.status === 'pending' && (
                  <button onClick={() => changeStatus(task, 'in_progress')} className="mt-2 w-full px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100">{t('inspection.status.in_progress', language)}</button>
                )}
                {isAdmin && !['done', 'cancelled'].includes(task.status) && (
                  <button onClick={() => changeStatus(task, 'done')} className="mt-2 w-full px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-bold hover:bg-green-100">{t('inspection.status.done', language)}</button>
                )}
                {isAdmin && !['done', 'cancelled'].includes(task.status) && (
                  <button onClick={() => changeStatus(task, 'cancelled')} className="mt-2 w-full px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-bold hover:bg-red-100">{t('inspection.status.cancelled', language)}</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && <InspectionFormModal edit={editTask || undefined} onClose={() => { setShowForm(false); setEditTask(null); }} onSaved={load} />}
      {execTask && <InspectionExecModal taskId={execTask.id} onClose={() => setExecTask(null)} onSubmitted={load} />}
      {detailTask && <InspectionDetailModal taskId={detailTask.id} onClose={() => setDetailTask(null)} />}
    </div>
  );
};

export default Inspection;
