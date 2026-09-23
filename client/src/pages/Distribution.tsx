import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { ArrowUpFromLine, Plus, X, Check, Ban, Clock, PackageSearch, Truck, Repeat, GitBranch, Trash2, RefreshCw, ChevronLeft, AlertTriangle } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'tone-warn',
  in_review: 'tone-info',
  approved: 'tone-ok',
  rejected: 'tone-bad',
};

const Distribution: React.FC = () => {
  const { language, user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [requests, setRequests] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [flow, setFlow] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [trace, setTrace] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ applicant: '', applicantOrg: '', purpose: '', resourceType: '', qty: '', durationDays: '' });
  const [msg, setMsg] = useState('');
  const [verifyWarn, setVerifyWarn] = useState<string[]>([]);
  const [invMatch, setInvMatch] = useState<any>({ traitCode: '', traitValue: '', op: 'eq', origin: '' });

  // sub-forms
  const [approveComment, setApproveComment] = useState('');
  const [invResult, setInvResult] = useState<any>(null);
  const [orderForm, setOrderForm] = useState<any>({ pickupMethod: 'self', logisticsNo: '', handler: '', items: '' });
  const [trackForm, setTrackForm] = useState<any>({ reportNo: '', consumedQty: '', remainderHandle: '', note: '' });

  const loadFlow = useCallback(async () => {
    const res = await api.getDistFlow();
    setFlow(res.stages || []);
  }, []);

  const loadList = useCallback(async () => {
    const res = await api.getDistRequests({ status: statusFilter, q, page: 1 });
    setRequests(res.requests || []);
    setTotal(res.total || 0);
  }, [statusFilter, q]);

  useEffect(() => { loadFlow(); }, [loadFlow]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { api.getDistReminders().then(r => setReminders(r.reminders || [])).catch(() => {}); }, []);

  const statusText = (s: string) => t(`dist.status.${s}`, language);
  const stageTitle = (s: any) => (language === 'zh' ? s?.title : s?.titleEn || s?.title);

  const openDetail = async (id: string) => {
    const d = await api.getDistRequest(id);
    setDetail(d);
    setApproveComment('');
    setInvResult(null);
    setOrderForm({ pickupMethod: 'self', logisticsNo: '', handler: '', items: '' });
    setTrackForm({ reportNo: '', consumedQty: '', remainderHandle: '', note: '' });
  };

  const doApprove = async (decision: string) => {
    if (!detail) return;
    try {
      await api.approveDistRequest(detail.id, detail.currentStage, decision, approveComment);
      setMsg(`✓ ${decision === 'approve' ? t('dist.approved', language) : t('dist.rejected', language)}`);
      openDetail(detail.id); loadList();
    } catch (e: any) { alert(e.message); }
  };

  const submitForm = async () => {
    if (!form.applicant || !form.resourceType || form.qty === '') { alert(t('dist.required', language)); return; }
    try {
      const res = await api.createDistRequest({
        ...form,
        qty: Number(form.qty),
        durationDays: form.durationDays ? parseInt(form.durationDays) : null,
        docs: [],
      });
      setVerifyWarn(res.verifyWarning || []);
      setShowForm(false);
      setForm({ applicant: '', applicantOrg: '', purpose: '', resourceType: '', qty: '', durationDays: '' });
      loadList();
    } catch (e: any) { alert(e.message); }
  };

  const checkInventory = async () => {
    if (!detail) return;
    try {
      const res = await api.checkDistInventory({
        resourceType: detail.resourceType,
        qty: detail.qty || 0,
        traitCode: invMatch.traitCode || undefined,
        traitValue: invMatch.traitValue || undefined,
        op: invMatch.op || 'eq',
        origin: invMatch.origin || undefined,
      });
      setInvResult(res);
    } catch (e: any) { alert(e.message); }
  };

  const issueOrder = async () => {
    if (!detail) return;
    try {
      await api.createDistOrder({
        requestId: detail.id,
        pickupMethod: orderForm.pickupMethod,
        logisticsNo: orderForm.logisticsNo,
        handler: orderForm.handler,
        items: orderForm.items.split('\n').map((s: string) => s.trim()).filter(Boolean),
      });
      setMsg(`✓ ${t('dist.order', language)}`);
      openDetail(detail.id);
    } catch (e: any) { alert(e.message); }
  };

  const submitTracking = async () => {
    if (!detail) return;
    try {
      await api.createDistTracking({
        requestId: detail.id,
        reportNo: trackForm.reportNo,
        consumedQty: trackForm.consumedQty ? Number(trackForm.consumedQty) : null,
        remainderHandle: trackForm.remainderHandle,
        note: trackForm.note,
      });
      setMsg(`✓ ${t('dist.submitTrack', language)}`);
      setTrackForm({ reportNo: '', consumedQty: '', remainderHandle: '', note: '' });
      openDetail(detail.id);
    } catch (e: any) { alert(e.message); }
  };

  const showTrace = async () => {
    if (!detail) return;
    try {
      const res = await api.traceDistRequest(detail.reqNo);
      setTrace(res);
    } catch (e: any) { alert(e.message); }
  };

  const deleteRequest = async () => {
    if (!detail) return;
    if (!window.confirm(t('dist.deleteConfirm', language))) return;
    try {
      await api.deleteDistRequest(detail.id);
      setDetail(null); loadList();
    } catch (e: any) { alert(e.message); }
  };

  const traceIcon = (type: string) => {
    switch (type) {
      case 'submit': return <span className="bg-green-100 text-green-700 p-1.5 rounded-lg"><Check className="w-3.5 h-3.5" /></span>;
      case 'approve': return <span className="bg-blue-100 text-blue-700 p-1.5 rounded-lg"><Check className="w-3.5 h-3.5" /></span>;
      case 'reject': return <span className="bg-red-100 text-red-600 p-1.5 rounded-lg"><Ban className="w-3.5 h-3.5" /></span>;
      case 'order': return <span className="bg-purple-100 text-purple-700 p-1.5 rounded-lg"><Truck className="w-3.5 h-3.5" /></span>;
      case 'track': return <span className="bg-amber-100 text-amber-700 p-1.5 rounded-lg"><Repeat className="w-3.5 h-3.5" /></span>;
      default: return <span className="bg-gray-100 text-gray-500 p-1.5 rounded-lg"><GitBranch className="w-3.5 h-3.5" /></span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">DISTRIBUTION</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <ArrowUpFromLine className="w-6 h-6 text-[#2e7d32]" /> {t('dist.title', language)}
          </h1>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold">
          <Plus className="w-4 h-4 inline mr-1" />{t('dist.new', language)}
        </button>
      </div>

      {/* Reminders */}
      {reminders.length > 0 && (
        <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
          <p className="text-sm font-bold text-orange-700 flex items-center gap-2"><Clock className="w-4 h-4" /> {t('dist.reminders', language)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reminders.map(r => (
              <span key={r.id} className="bg-white text-orange-600 text-xs px-3 py-1.5 rounded-lg border border-orange-100">{r.reqNo} · {r.applicant}</span>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="glass-card p-5 rounded-2xl border-green-200/50 animate-scale-in">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" value={form.applicant} onChange={e => setForm({ ...form, applicant: e.target.value })} placeholder={`${t('dist.applicant', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.applicantOrg} onChange={e => setForm({ ...form, applicantOrg: e.target.value })} placeholder={t('dist.applicantOrg', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.resourceType} onChange={e => setForm({ ...form, resourceType: e.target.value })} placeholder={`${t('dist.resourceType', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder={`${t('dist.qty', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder={t('dist.purpose', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={form.durationDays} onChange={e => setForm({ ...form, durationDays: e.target.value })} placeholder={t('dist.durationDays', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={submitForm} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold">{t('common.save', language)}</button>
          </div>
        </div>
      )}

      {/* 资质校验提示 */}
      {verifyWarn.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 animate-scale-in">
          <p className="text-sm font-bold text-amber-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t('dist.verifyWarnTitle', language)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {verifyWarn.map((w, i) => (
              <span key={i} className="bg-white text-amber-600 text-xs px-3 py-1.5 rounded-lg border border-amber-100">{w}</span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4 rounded-2xl flex flex-wrap gap-2 items-center">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{t('dist.status', language)}: {t('ops.all', language)}</option>
          {['pending', 'in_review', 'approved', 'rejected'].map(s => <option key={s} value={s}>{statusText(s)}</option>)}
        </select>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadList()} placeholder={`${t('ops.search', language)} (编号/申请方/类型)`} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* List */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {requests.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{t('dist.noData', language)}</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="px-4 py-3 text-left font-bold">{t('intro.reqNo', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('dist.applicant', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('dist.resourceType', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('dist.qty', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('dist.status', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('dist.createdAt', language)}</th>
            </tr></thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} className="border-t border-gray-50 hover:bg-green-50/40 cursor-pointer" onClick={() => openDetail(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs text-[#2e7d32] font-bold">{r.reqNo}</td>
                  <td className="px-4 py-3 font-medium text-gray-700">{r.applicant}</td>
                  <td className="px-4 py-3 text-gray-600">{r.resourceType}</td>
                  <td className="px-4 py-3 text-gray-600">{r.qty ?? '-'}</td>
                  <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_COLORS[r.status] || 'tone-neutral'}`}>{statusText(r.status)}</span></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > 0 && <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-50">{total} 条</div>}
      </div>

      {/* Detail */}
      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30 animate-fade-in" onClick={() => setDetail(null)}>
          <div className="w-full max-w-3xl bg-white h-full overflow-auto p-6 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <ChevronLeft className="w-4 h-4 text-gray-300 cursor-pointer" onClick={() => setDetail(null)} />
                {t('dist.detail', language)} · <span className="font-mono text-[#2e7d32]">{detail.reqNo}</span>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_COLORS[detail.status] || 'tone-neutral'}`}>{statusText(detail.status)}</span>
              </h3>
              <div className="flex gap-2">
                <button onClick={showTrace} className="px-3 py-2 rounded-lg text-xs font-bold bg-[#e8f5e9] text-[#2e7d32] hover:bg-green-100"><GitBranch className="w-3.5 h-3.5 inline mr-1" />{t('dist.trace', language)}</button>
                {isAdmin && <button onClick={deleteRequest} className="px-3 py-2 rounded-lg text-xs text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 inline mr-1" />{t('dist.delete', language)}</button>}
              </div>
            </div>

            {/* Request info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[[t('dist.applicant', language), detail.applicant], [t('dist.applicantOrg', language), detail.applicantOrg || '-'], [t('dist.resourceType', language), detail.resourceType], [t('dist.qty', language), detail.qty ?? '-'], [t('dist.durationDays', language), detail.durationDays ?? '-'], [t('dist.purpose', language), detail.purpose || '-'], [t('dist.createdAt', language), new Date(detail.createdAt).toLocaleString()], [t('dist.qualification', language), `${(detail.qualificationDocsJson || []).length} docs`]].map(([k, v]) => (
                <div key={k as string} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">{k}</p>
                  <p className="font-medium text-gray-700 mt-0.5 break-words">{v as any}</p>
                </div>
              ))}
            </div>

            {/* Approval flow */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Check className="w-4 h-4 text-[#2e7d32]" /> {t('intro.flow', language)}</h4>
              <div className="flex items-center flex-wrap gap-2">
                {(detail.flow || []).map((s: any) => {
                  const approved = (detail.approvals || []).find((a: any) => a.stage === s.stageNo && a.decision === 'approve');
                  const rejected = (detail.approvals || []).find((a: any) => a.stage === s.stageNo && a.decision === 'reject');
                  const current = detail.currentStage === s.stageNo;
                  return (
                    <div key={s.stageNo} className={`px-3 py-2 rounded-xl border text-xs font-bold ${rejected ? 'bg-red-50 border-red-200 text-red-600' : approved ? 'bg-green-50 border-green-200 text-green-700' : current ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'}`}>
                      {s.stageNo}. {stageTitle(s)}
                      {approved && <Check className="w-3 h-3 inline ml-1" />}
                      {rejected && <Ban className="w-3 h-3 inline ml-1" />}
                      {current && <Clock className="w-3 h-3 inline ml-1" />}
                    </div>
                  );
                })}
              </div>
              {(detail.approvals || []).length > 0 && (
                <div className="mt-3 space-y-2">
                  {(detail.approvals || []).map((a: any) => (
                    <div key={a.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5 text-sm">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${a.decision === 'approve' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{a.decision === 'approve' ? t('dist.approved', language) : t('dist.rejected', language)}</span>
                      <span className="font-bold text-gray-700">第{a.stage}环节</span>
                      <span className="text-gray-500 text-xs">{a.approver}</span>
                      <span className="text-gray-400 text-xs ml-auto">{a.comment || ''} · {new Date(a.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {(detail.status === 'pending' || detail.status === 'in_review') && isAdmin && (
                <div className="mt-4 bg-blue-50/60 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-blue-700 mb-2">{t('dist.approve', language)} · {t('dist.stage', language)} {detail.currentStage}: {stageTitle((detail.flow || []).find((s: any) => s.stageNo === detail.currentStage))}</p>
                  <div className="flex gap-2 flex-wrap">
                    <input type="text" value={approveComment} onChange={e => setApproveComment(e.target.value)} placeholder={t('dist.comment', language)} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
                    <button onClick={() => doApprove('approve')} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold"><Check className="w-4 h-4 inline mr-1" />{t('dist.approved', language)}</button>
                    <button onClick={() => doApprove('reject')} className="px-4 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600"><Ban className="w-4 h-4 inline mr-1" />{t('dist.rejected', language)}</button>
                  </div>
                </div>
              )}
            </div>

            {/* Inventory match */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><PackageSearch className="w-4 h-4 text-blue-500" /> {t('dist.inventory', language)}</h4>
              <div className="bg-gray-50 rounded-xl p-4 flex flex-wrap gap-2 items-end">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{t('dist.traitMatch', language)}</p>
                  <div className="flex gap-2">
                    <input type="text" value={invMatch.traitCode} onChange={e => setInvMatch({ ...invMatch, traitCode: e.target.value })} placeholder={t('dist.traitCode', language)} className="glass-input rounded-lg px-3 py-2 text-sm w-32" />
                    <select value={invMatch.op} onChange={e => setInvMatch({ ...invMatch, op: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm w-28" title={t('dist.traitOp', language)}>
                      {['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].map(o => <option key={o} value={o}>{t(`dist.op.${o}`, language)}</option>)}
                    </select>
                    <input type="text" value={invMatch.traitValue} onChange={e => setInvMatch({ ...invMatch, traitValue: e.target.value })} placeholder={t('dist.traitValue', language)} className="glass-input rounded-lg px-3 py-2 text-sm w-32" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{t('dist.originMatch', language)}</p>
                  <input type="text" value={invMatch.origin} onChange={e => setInvMatch({ ...invMatch, origin: e.target.value })} placeholder={t('dist.originMatch', language)} className="glass-input rounded-lg px-3 py-2 text-sm w-40" />
                </div>
                <button onClick={checkInventory} className="px-4 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100"><PackageSearch className="w-3.5 h-3.5 inline mr-1" />{t('dist.checkInv', language)}</button>
              </div>
              {invResult && (
                <div className={`mt-3 rounded-xl p-4 border ${invResult.sufficient ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${invResult.sufficient ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{invResult.sufficient ? t('dist.sufficient', language) : t('dist.insufficient', language)}</span>
                    <span className="text-sm text-gray-600">{t('dist.available', language)}: <strong>{invResult.available}</strong></span>
                    <span className="text-sm text-gray-600">{t('dist.requested', language)}: <strong>{invResult.requested}</strong></span>
                    {!invResult.sufficient && <span className="text-sm text-red-600">{t('dist.shortfall', language)}: <strong>{invResult.shortfall}</strong></span>}
                    {invResult.traitMatched && <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">{t('dist.traitMatch', language)}: {invResult.traitMatched.code} {t(`dist.op.${invResult.traitMatched.op}`, language)} {invResult.traitMatched.value}</span>}
                  </div>
                  {(invResult.rooms || []).map((r: any) => (
                    <div key={r.room} className="mt-2 bg-white/60 rounded-lg p-2 text-xs">
                      <p className="font-bold text-gray-700">{r.room}: {r.count}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.items.map((i: any, idx: number) => <span key={idx} className="bg-white border border-gray-100 px-1.5 py-0.5 rounded text-gray-600">{i.germplasmName} ×{i.quantity}{i.expiryDate ? ` · ${t('dist.expiryDate', language)} ${i.expiryDate}` : ''}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Orders */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Truck className="w-4 h-4 text-purple-500" /> {t('dist.order', language)}</h4>
              {(detail.orders || []).map((o: any) => (
                <div key={o.id} className="bg-white border border-gray-100 rounded-xl p-4 mb-2 text-sm flex items-center gap-3 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${o.pickupMethod === 'logistics' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{o.pickupMethod === 'logistics' ? t('dist.logistics', language) : t('dist.self', language)}</span>
                  {o.logisticsNo && <span className="text-xs font-mono text-gray-600">№ {o.logisticsNo}</span>}
                  {o.handler && <span className="text-xs text-gray-500">{t('dist.handler', language)}: {o.handler}</span>}
                  <span className="text-xs text-gray-400 ml-auto">{new Date(o.shippedAt).toLocaleString()}</span>
                </div>
              ))}
              {isAdmin && (
                <div className="bg-gray-50 rounded-xl p-4 flex flex-wrap gap-2">
                  <select value={orderForm.pickupMethod} onChange={e => setOrderForm({ ...orderForm, pickupMethod: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
                    <option value="self">{t('dist.self', language)}</option>
                    <option value="logistics">{t('dist.logistics', language)}</option>
                  </select>
                  <input type="text" value={orderForm.logisticsNo} onChange={e => setOrderForm({ ...orderForm, logisticsNo: e.target.value })} placeholder={t('dist.logisticsNo', language)} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" />
                  <input type="text" value={orderForm.handler} onChange={e => setOrderForm({ ...orderForm, handler: e.target.value })} placeholder={t('dist.handler', language)} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[120px]" />
                  <input type="text" value={orderForm.items} onChange={e => setOrderForm({ ...orderForm, items: e.target.value })} placeholder={`${t('dist.items', language)} (一行一个)`} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" />
                  <button onClick={issueOrder} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold"><Truck className="w-4 h-4 inline mr-1" />{t('dist.issue', language)}</button>
                </div>
              )}
            </div>

            {/* Tracking */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Repeat className="w-4 h-4 text-amber-500" /> {t('dist.tracking', language)}</h4>
              {(detail.tracking || []).map((tr: any) => (
                <div key={tr.id} className="bg-white border border-gray-100 rounded-xl p-4 mb-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800">#{tr.reportNo || '-'}</span>
                    <span className="text-xs text-gray-500">{t('dist.consumedQty', language)}: <strong>{tr.consumedQty ?? '-'}</strong></span>
                    <span className="text-xs text-gray-500">{t('dist.remainderHandle', language)}: {tr.remainderHandle || '-'}</span>
                    <span className="text-xs text-gray-400 ml-auto">{new Date(tr.reportAt).toLocaleString()} · {tr.user}</span>
                  </div>
                  {tr.note && <p className="mt-1 text-xs text-gray-500">{tr.note}</p>}
                </div>
              ))}
              <div className="bg-gray-50 rounded-xl p-4 flex flex-wrap gap-2">
                <input type="text" value={trackForm.reportNo} onChange={e => setTrackForm({ ...trackForm, reportNo: e.target.value })} placeholder={`${t('dist.reportNo', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[120px]" />
                <input type="number" value={trackForm.consumedQty} onChange={e => setTrackForm({ ...trackForm, consumedQty: e.target.value })} placeholder={t('dist.consumedQty', language)} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[120px]" />
                <input type="text" value={trackForm.remainderHandle} onChange={e => setTrackForm({ ...trackForm, remainderHandle: e.target.value })} placeholder={t('dist.remainderHandle', language)} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" />
                <input type="text" value={trackForm.note} onChange={e => setTrackForm({ ...trackForm, note: e.target.value })} placeholder={t('dist.note', language)} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" />
                <button onClick={submitTracking} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold"><Repeat className="w-4 h-4 inline mr-1" />{t('dist.submitTrack', language)}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trace modal */}
      {trace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={() => setTrace(null)}>
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[80vh] overflow-auto p-6 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2"><GitBranch className="w-5 h-5 text-[#2e7d32]" /> {t('dist.timeline', language)}</h3>
              <button onClick={() => setTrace(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-gray-200"></div>
              {(trace.timeline || []).map((item: any, i: number) => (
                <div key={i} className="relative">
                  <div className="absolute -left-6 top-0.5">{traceIcon(item.type)}</div>
                  <p className="font-bold text-sm text-gray-800">{item.title}</p>
                  <p className="text-xs text-gray-500">{item.detail}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{new Date(item.at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default Distribution;
