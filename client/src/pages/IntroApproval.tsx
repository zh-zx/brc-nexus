import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { ArrowDownToLine, Plus, X, Check, Ban, Clock, FileText, Upload, ShieldAlert, CalendarClock, Trash2, RefreshCw, ChevronLeft } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'tone-warn',
  in_review: 'tone-info',
  approved: 'tone-ok',
  rejected: 'tone-bad',
};

const IntroApproval: React.FC = () => {
  const { language, user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [requests, setRequests] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [flow, setFlow] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [qualReminders, setQualReminders] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ applicantOrg: '', contact: '', resourceType: '', qty: '', origin: '', traitDescription: '', riskLevel: '', qualificationNo: '', qualificationExpiry: '' });
  const [msg, setMsg] = useState('');

  // approve form
  const [approveComment, setApproveComment] = useState('');
  // quarantine form
  const [qForm, setQForm] = useState<any>({ batchNo: '', baseName: '', startDate: '', endDate: '' });
  // result form
  const [resForm, setResForm] = useState<any>({ conclusion: '', passed: true });
  // uploads
  const [files, setFiles] = useState<any[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadFlow = useCallback(async () => {
    const res = await api.getIntroFlow();
    setFlow(res.stages || []);
  }, []);

  const loadList = useCallback(async () => {
    const res = await api.getIntroRequests({ status: statusFilter, q, page: 1 });
    setRequests(res.requests || []);
    setTotal(res.total || 0);
  }, [statusFilter, q]);

  useEffect(() => { loadFlow(); }, [loadFlow]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { api.getQuarantineReminders().then(r => setReminders(r.reminders || [])).catch(() => {}); }, []);
  useEffect(() => { api.getQualificationReminders().then(r => setQualReminders(r.reminders || [])).catch(() => {}); }, []);

  const statusText = (s: string) => t(`intro.status.${s}`, language);
  const stageTitle = (s: any) => (language === 'zh' ? s?.title : s?.titleEn || s?.title);

  const openDetail = async (id: string) => {
    const d = await api.getIntroRequest(id);
    setDetail(d);
    setApproveComment('');
    setResForm({ conclusion: '', passed: true });
    loadUploads(id);
  };

  const loadUploads = async (id: string) => {
    const res = await api.getUploadsByRef('intro_request', id);
    setFiles(res.files || []);
  };

  const doApprove = async (decision: string) => {
    if (!detail) return;
    try {
      await api.approveIntroRequest(detail.id, detail.currentStage, decision, approveComment);
      setMsg(`✓ ${decision === 'approve' ? t('intro.approved', language) : t('intro.rejected', language)}`);
      openDetail(detail.id); loadList();
    } catch (e: any) { alert(e.message); }
  };

  const submitForm = async () => {
    if (!form.applicantOrg || !form.resourceType) { alert(t('intro.required', language)); return; }
    try {
      await api.createIntroRequest({ ...form, qty: form.qty ? Number(form.qty) : null });
      setShowForm(false);
      setForm({ applicantOrg: '', contact: '', resourceType: '', qty: '', origin: '', traitDescription: '', riskLevel: '', qualificationNo: '', qualificationExpiry: '' });
      loadList();
    } catch (e: any) { alert(e.message); }
  };

  const addQuarantine = async () => {
    if (!detail || !qForm.batchNo) { alert(t('intro.quarantineNew', language) + ': ' + t('intro.batchNo', language)); return; }
    try {
      await api.createQuarantine({ requestId: detail.id, ...qForm });
      setQForm({ batchNo: '', baseName: '', startDate: '', endDate: '' });
      openDetail(detail.id);
    } catch (e: any) { alert(e.message); }
  };

  const submitResult = async (qid: string) => {
    try {
      await api.submitQuarantineResult(qid, { conclusion: resForm.conclusion, passed: resForm.passed, monitor: [], reportDocs: [] });
      setMsg(`✓ ${t('intro.result', language)}`);
      openDetail(detail.id);
    } catch (e: any) { alert(e.message); }
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    try {
      await api.uploadFile(file, 'intro_request', detail.id);
      loadUploads(detail.id);
    } catch (err: any) { alert(err.message); }
    e.target.value = '';
  };

  const deleteRequest = async () => {
    if (!detail) return;
    if (!window.confirm(t('intro.deleteConfirm', language))) return;
    try {
      await api.deleteIntroRequest(detail.id);
      setDetail(null); loadList();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">INTAKE APPROVAL</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <ArrowDownToLine className="w-6 h-6 text-[#2e7d32]" /> {t('intro.title', language)}
          </h1>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold">
          <Plus className="w-4 h-4 inline mr-1" />{t('intro.new', language)}
        </button>
      </div>

      {/* Reminders */}
      {reminders.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
          <p className="text-sm font-bold text-red-700 flex items-center gap-2"><CalendarClock className="w-4 h-4" /> {t('intro.reminders', language)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reminders.map(r => (
              <span key={r.id} className="bg-white text-red-600 text-xs px-3 py-1.5 rounded-lg border border-red-100">
                {r.batchNo} · {r.endDate}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Qualification expiry reminders */}
      {qualReminders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-amber-700 flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> {t('intro.qualWarning', language)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {qualReminders.map(r => (
              <span key={r.id} className="bg-white text-amber-700 text-xs px-3 py-1.5 rounded-lg border border-amber-200">
                {r.applicantOrg} · {r.reqNo} · {r.qualificationExpiry}
              </span>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="glass-card p-5 rounded-2xl border-green-200/50 animate-scale-in">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" value={form.applicantOrg} onChange={e => setForm({ ...form, applicantOrg: e.target.value })} placeholder={`${t('intro.applicantOrg', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder={t('intro.contact', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.resourceType} onChange={e => setForm({ ...form, resourceType: e.target.value })} placeholder={`${t('intro.resourceType', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder={t('intro.qty', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder={t('intro.origin', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.traitDescription} onChange={e => setForm({ ...form, traitDescription: e.target.value })} placeholder={t('intro.traitDesc', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.riskLevel} onChange={e => setForm({ ...form, riskLevel: e.target.value })} placeholder={t('intro.riskLevel', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={form.qualificationNo} onChange={e => setForm({ ...form, qualificationNo: e.target.value })} placeholder={t('intro.qualificationNo', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="date" value={form.qualificationExpiry} onChange={e => setForm({ ...form, qualificationExpiry: e.target.value })} placeholder={t('intro.qualificationExpiry', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={submitForm} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold">{t('common.save', language)}</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4 rounded-2xl flex flex-wrap gap-2 items-center">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{t('dist.status', language)}: {t('ops.all', language)}</option>
          {['pending', 'in_review', 'approved', 'rejected'].map(s => <option key={s} value={s}>{statusText(s)}</option>)}
        </select>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadList()} placeholder={`${t('ops.search', language)} (${t('intro.reqNo', language)}/单位/类型)`} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* List */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {requests.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{t('intro.noData', language)}</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="px-4 py-3 text-left font-bold">{t('intro.reqNo', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('intro.applicantOrg', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('intro.resourceType', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('intro.qty', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('intro.status', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('intro.createdAt', language)}</th>
            </tr></thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} className="border-t border-gray-50 hover:bg-green-50/40 cursor-pointer" onClick={() => openDetail(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs text-[#2e7d32] font-bold">{r.reqNo}</td>
                  <td className="px-4 py-3 font-medium text-gray-700">{r.applicantOrg}</td>
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
                {t('intro.detail', language)} · <span className="font-mono text-[#2e7d32]">{detail.reqNo}</span>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_COLORS[detail.status] || 'tone-neutral'}`}>{statusText(detail.status)}</span>
              </h3>
              <div className="flex gap-2">
                <button onClick={() => { setDetail(null); }} className="px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-100"><RefreshCw className="w-3.5 h-3.5 inline mr-1" />刷新</button>
                {isAdmin && <button onClick={deleteRequest} className="px-3 py-2 rounded-lg text-xs text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 inline mr-1" />{t('intro.delete', language)}</button>}
              </div>
            </div>

            {/* Request info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[['reqNo', detail.reqNo], [t('intro.applicantOrg', language), detail.applicantOrg], [t('intro.contact', language), detail.contact || '-'], [t('intro.resourceType', language), detail.resourceType], [t('intro.qty', language), detail.qty ?? '-'], [t('intro.origin', language), detail.origin || '-'], [t('intro.riskLevel', language), detail.riskLevel || '-'], [t('intro.qualificationNo', language), detail.qualificationNo || '-'], [t('intro.qualificationExpiry', language), detail.qualificationExpiry || '-'], [t('intro.createdAt', language), new Date(detail.createdAt).toLocaleString()]].map(([k, v]) => (
                <div key={k as string} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">{k}</p>
                  <p className="font-medium text-gray-700 mt-0.5 break-words">{v as any}</p>
                </div>
              ))}
            </div>
            {detail.traitDescription && <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-xl p-3">{t('intro.traitDesc', language)}: {detail.traitDescription}</p>}

            {/* Approval timeline */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-[#2e7d32]" /> {t('intro.flow', language)}</h4>
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
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${a.decision === 'approve' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{a.decision === 'approve' ? t('intro.approved', language) : t('intro.rejected', language)}</span>
                      <span className="font-bold text-gray-700">第{a.stage}环节</span>
                      <span className="text-gray-500 text-xs">{a.approver}</span>
                      <span className="text-gray-400 text-xs ml-auto">{a.comment || ''} · {new Date(a.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Approve action */}
              {(detail.status === 'pending' || detail.status === 'in_review') && isAdmin && (
                <div className="mt-4 bg-blue-50/60 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs font-bold text-blue-700 mb-2">{t('intro.approve', language)} · {t('intro.stage', language)} {detail.currentStage}: {stageTitle((detail.flow || []).find((s: any) => s.stageNo === detail.currentStage))}</p>
                  <div className="flex gap-2 flex-wrap">
                    <input type="text" value={approveComment} onChange={e => setApproveComment(e.target.value)} placeholder={t('intro.comment', language)} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
                    <button onClick={() => doApprove('approve')} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold"><Check className="w-4 h-4 inline mr-1" />{t('intro.approved', language)}</button>
                    <button onClick={() => doApprove('reject')} className="px-4 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600"><Ban className="w-4 h-4 inline mr-1" />{t('intro.rejected', language)}</button>
                  </div>
                </div>
              )}
            </div>

            {/* Quarantine */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-amber-500" /> {t('intro.quarantine', language)}</h4>
              {(detail.quarantine || []).map((q: any) => (
                <div key={q.id} className="bg-white border border-gray-100 rounded-xl p-4 mb-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800">{q.batchNo}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${q.status === 'completed' ? 'bg-green-100 text-green-700' : q.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{q.status}</span>
                    {q.baseName && <span className="text-gray-500 text-xs">{q.baseName}</span>}
                    <span className="text-gray-400 text-xs ml-auto">{q.startDate} → {q.endDate}</span>
                  </div>
                  {q.conclusion && <p className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-2">{t('intro.conclusion', language)}: {q.conclusion}</p>}
                  {q.status !== 'completed' && q.status !== 'failed' && isAdmin && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <input type="text" value={resForm.conclusion} onChange={e => setResForm({ ...resForm, conclusion: e.target.value })} placeholder={t('intro.conclusion', language)} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
                      <button onClick={() => setResForm({ ...resForm, passed: !resForm.passed })} className={`px-3 py-2 rounded-lg text-xs font-bold ${resForm.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{resForm.passed ? t('intro.passed', language) : t('intro.failed', language)}</button>
                      <button onClick={() => submitResult(q.id)} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold">{t('intro.result', language)}</button>
                    </div>
                  )}
                </div>
              ))}

              {isAdmin && (
                <div className="bg-gray-50 rounded-xl p-4 flex flex-wrap gap-2">
                  <input type="text" value={qForm.batchNo} onChange={e => setQForm({ ...qForm, batchNo: e.target.value })} placeholder={`${t('intro.batchNo', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" />
                  <input type="text" value={qForm.baseName} onChange={e => setQForm({ ...qForm, baseName: e.target.value })} placeholder={t('intro.baseName', language)} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[150px]" />
                  <input type="date" value={qForm.startDate} onChange={e => setQForm({ ...qForm, startDate: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm" />
                  <input type="date" value={qForm.endDate} onChange={e => setQForm({ ...qForm, endDate: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm" />
                  <button onClick={addQuarantine} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold"><Plus className="w-4 h-4 inline mr-1" />{t('intro.quarantineNew', language)}</button>
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="mt-6">
              <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" /> {t('intro.docs', language)}</h4>
              <div className="flex flex-wrap gap-2 mb-3">
                {files.map(f => (
                  <a key={f.id} href={`/uploads/${f.storedName}`} target="_blank" rel="noreferrer" className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-700 hover:border-[#2e7d32] flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#2e7d32]" /> {f.originalName}
                    <span className="text-gray-400">({(f.size / 1024).toFixed(1)}KB)</span>
                  </a>
                ))}
                {files.length === 0 && <span className="text-xs text-gray-400">{t('intro.noData', language)}</span>}
              </div>
              <input type="file" ref={fileInputRef} className="hidden" onChange={uploadFile} />
              <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded-lg bg-white border border-dashed border-gray-300 text-xs font-bold text-gray-500 hover:border-[#2e7d32] hover:text-[#2e7d32]">
                <Upload className="w-3.5 h-3.5 inline mr-1" />{t('intro.upload', language)}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default IntroApproval;
