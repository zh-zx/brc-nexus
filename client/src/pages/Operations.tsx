import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Search, Download, Plus, Trash2, Save, ClipboardList, Settings, Lock, X, ChevronRight, Clock, Camera, MessageSquarePlus, FileText } from 'lucide-react';

// 审计 before/after JSON：pretty 供展开态 <pre>（缩进 JSON），fmtAudit 供折叠态 summary（单行紧凑摘要）
function pretty(json: any): string {
  if (json == null || json === '') return '';
  try { return JSON.stringify(typeof json === 'string' ? JSON.parse(json) : json, null, 2); }
  catch { return String(json); }
}
function fmtAudit(json: any): string {
  if (json == null || json === '') return '—';
  let obj: any = json;
  try { if (typeof json === 'string') obj = JSON.parse(json); } catch { return String(json).slice(0, 60); }
  if (obj && typeof obj === 'object') {
    const parts = Object.entries(obj)
      .filter(([, v]) => v != null && v !== '')
      .slice(0, 4)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? '{…}' : String(v)}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return String(obj).slice(0, 60);
}

const Operations: React.FC = () => {
  const { language, user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'query' | 'config' | 'audit'>('query');

  // ---- Query tab ----
  const [modules, setModules] = useState<string[]>([]);
  const [purposes, setPurposes] = useState<string[]>([]);
  const [steps, setSteps] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<{ module: string; step: string; operator: string; from: string; to: string; batch: string; purpose: string }>({
    module: '', step: '', operator: '', from: '', to: '', batch: '', purpose: '',
  });
  const [detail, setDetail] = useState<any>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [correctTime, setCorrectTime] = useState('');
  const [detailMsg, setDetailMsg] = useState('');

  // ---- Quick submit ----
  const [submitModule, setSubmitModule] = useState('');
  const [submitPurpose, setSubmitPurpose] = useState('');
  const [submitStep, setSubmitStep] = useState('');
  const [submitBatch, setSubmitBatch] = useState('');
  const [submitContent, setSubmitContent] = useState<Record<string, string>>({});
  const [submitNotes, setSubmitNotes] = useState('');
  const [submitMsg, setSubmitMsg] = useState('');

  // ---- Config tab ----
  const [cfgSteps, setCfgSteps] = useState<any[]>([]);
  const [cfgModule, setCfgModule] = useState('tissue_culture');
  const [editing, setEditing] = useState<any | null>(null);

  // ---- Audit tab (admin, v2.19 P0 审计台账) ----
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditFacets, setAuditFacets] = useState<{ tables: string[]; actions: string[] }>({ tables: [], actions: [] });
  const [auditFilters, setAuditFilters] = useState<{ table: string; action: string; user: string; from: string; to: string; q: string }>(
    { table: '', action: '', user: '', from: '', to: '', q: '' });

  const loadSteps = useCallback(async () => {
    const res = await api.getOperationSteps();
    setSteps(res.steps || []);
    setModules(res.modules || []);
    setPurposes(res.purposes || []);
  }, []);

  const loadRecords = useCallback(async () => {
    const res = await api.getOperationRecords({ ...filters, page, limit: 20 });
    setRecords(res.records || []);
    setTotal(res.total || 0);
  }, [filters, page]);

  useEffect(() => { loadSteps(); }, [loadSteps]);
  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(() => { if (tab === 'config') { api.getOperationSteps(cfgModule).then(r => setCfgSteps(r.steps || [])); } }, [tab, cfgModule]);

  const loadAudit = useCallback(async () => {
    const res = await api.getAuditLog({ ...auditFilters, page: auditPage, pageSize: 20 });
    setAuditLogs(res.logs || []);
    setAuditTotal(res.total || 0);
    if (res.facets) setAuditFacets(res.facets);
  }, [auditFilters, auditPage]);
  useEffect(() => { if (tab === 'audit' && isAdmin) { loadAudit(); } }, [tab, isAdmin, loadAudit]);
  const resetAuditFilters = () => { setAuditFilters({ table: '', action: '', user: '', from: '', to: '', q: '' }); setAuditPage(1); };

  const stepTitle = (s: any) => (language === 'zh' ? s?.title : s?.titleEn || s?.title);
  const stepByCode = (code: string) => steps.find(s => s.code === code);

  const handleSubmit = async () => {
    if (!submitModule || !submitStep) { setSubmitMsg(t('ops.selectStepFirst', language)); return; }
    const step = stepByCode(submitStep);
    const content: Record<string, string> = {};
    (step?.requiredFields || []).forEach((f: string) => { content[f] = submitContent[f] || ''; });
    try {
      await api.createOperationRecord({ module: submitModule, stepCode: submitStep, batchId: submitBatch, content, notes: submitNotes });
      setSubmitMsg(t('ops.recordSaved', language));
      setSubmitContent({});
      setSubmitNotes('');
      setSubmitBatch('');
      setSubmitPurpose('');
      loadRecords();
    } catch (e: any) {
      setSubmitMsg(t('ops.recordFailed', language) + ': ' + e.message);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportOperations(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `operations-${Date.now()}.xlsx`; a.click();
    } catch (e: any) { alert(e.message); }
  };

  const resetFilters = () => {
    setFilters({ module: '', step: '', operator: '', from: '', to: '', batch: '', purpose: '' });
    setPage(1);
  };

  const openDetail = async (id: string) => {
    try {
      const res = await api.getOperationDetail(id);
      setDetail(res);
      setReviewComment('');
      setCorrectTime('');
      setDetailMsg('');
    } catch (e: any) { alert(e.message); }
  };

  const submitReview = async () => {
    if (!reviewComment.trim()) return;
    try {
      await api.reviewOperation(detail.record.id, reviewComment);
      setDetailMsg('✔ ' + t('ops.review.add', language));
      openDetail(detail.record.id);
    } catch (e: any) { setDetailMsg('✘ ' + e.message); }
  };

  const submitCorrectTime = async () => {
    if (!correctTime) return;
    try {
      await api.correctOperationTime(detail.record.id, new Date(correctTime).toISOString());
      setDetailMsg('✔ ' + t('ops.correctTime', language));
      openDetail(detail.record.id);
    } catch (e: any) { setDetailMsg('✘ ' + e.message); }
  };

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    try {
      await api.uploadFile(file, 'operation_record', detail.record.id);
      openDetail(detail.record.id);
    } catch (err: any) { setDetailMsg('✘ ' + err.message); }
  };

  // ---- Config actions ----
  const loadCfg = () => api.getOperationSteps(cfgModule).then(r => setCfgSteps(r.steps || []));
  const saveStep = async () => {
    if (!editing?.title) return;
    const payload = {
      module: cfgModule,
      code: editing.code,
      title: editing.title,
      titleEn: editing.titleEn || '',
      stepNo: editing.stepNo || 0,
      sortOrder: editing.sortOrder || 0,
      requiredFields: (editing.requiredFields || '').split(',').map((s: string) => s.trim()).filter(Boolean),
      dueDays: parseInt(editing.dueDays) || 0,
      purpose: editing.purpose || '',
    };
    try {
      if (editing.id) {
        await api.saveOperationStep(payload, editing.id);
      } else {
        await api.saveOperationStep({ ...payload, code: (editing.code || '').trim() || editing.title });
      }
      alert(t('ops.stepSaved', language));
      setEditing(null);
      loadCfg();
    } catch (e: any) { alert(e.message); }
  };
  const deleteStep = async (id: string) => {
    if (!window.confirm(t('ops.deleteStepConfirm', language))) return;
    await api.deleteOperationStep(id);
    loadCfg();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">ACTIVITY LOG</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-[#2e7d32]" /> {t('ops.title', language)}
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('query')} className={`t-btn px-4 py-2.5 ${tab === 'query' ? 't-btn-primary' : 't-btn-outline'}`}>
            {t('ops.query', language)}
          </button>
          {isAdmin && (
            <button onClick={() => setTab('config')} className={`t-btn px-4 py-2.5 ${tab === 'config' ? 't-btn-primary' : 't-btn-outline'}`}>
              {t('ops.config', language)}
            </button>
          )}
          {isAdmin && (
            <button onClick={() => { setTab('audit'); if (auditLogs.length === 0) loadAudit(); }} className={`t-btn px-4 py-2.5 ${tab === 'audit' ? 't-btn-primary' : 't-btn-outline'}`}>
              {t('ops.audit', language)}
            </button>
          )}
        </div>
      </div>

      {tab === 'query' && (
        <>
          {/* Filters */}
          <div className="glass-card p-4 rounded-2xl">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-8 gap-2 items-end">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.module', language)}</label>
                <select value={filters.module} onChange={e => setFilters({ ...filters, module: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm">
                  <option value="">{t('ops.all', language)}</option>
                  {modules.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.purpose', language)}</label>
                <select value={filters.purpose} onChange={e => setFilters({ ...filters, purpose: e.target.value, step: '' })} className="w-full glass-input rounded-lg px-2 py-2 text-sm">
                  <option value="">{t('ops.all', language)}</option>
                  {purposes.map(p => <option key={p} value={p}>{t(`ops.purpose.${p}`, language)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.step', language)}</label>
                <select value={filters.step} onChange={e => setFilters({ ...filters, step: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm">
                  <option value="">{t('ops.all', language)}</option>
                  {steps.filter(s => !filters.purpose || s.purpose === filters.purpose).map(s => <option key={s.code} value={s.code}>{stepTitle(s)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.operator', language)}</label>
                <input type="text" value={filters.operator} onChange={e => setFilters({ ...filters, operator: e.target.value })} placeholder={isAdmin ? '' : user?.username || ''} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.from', language)}</label>
                <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.to', language)}</label>
                <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.batch', language)}</label>
                <input type="text" value={filters.batch} onChange={e => setFilters({ ...filters, batch: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setPage(1); loadRecords(); }} className="flex-1 btn-primary px-3 py-2 rounded-lg text-xs font-bold"><Search className="w-4 h-4 inline mr-1" />{t('ops.search', language)}</button>
                <button onClick={handleExport} className="t-btn t-btn-outline flex-1 px-3 py-2 text-xs"><Download className="w-4 h-4 inline mr-1" />{t('ops.export', language)}</button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-gray-400">{t('ops.batch', language)}: {total} 条</span>
              <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-700">{t('ops.reset', language)}</button>
            </div>
          </div>

          {/* Records table */}
          <div className="glass-card rounded-2xl overflow-hidden">
            {records.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">{t('ops.noData', language)}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="px-4 py-3 text-left font-bold">{t('ops.createdAt', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.module', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.step', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.operator', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.content', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.batch', language)}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-t border-gray-50 hover:bg-green-50/40 cursor-pointer" onClick={() => openDetail(r.id)}>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-xs">{new Date(r.event_at).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-gray-700 font-medium">{r.module}</td>
                      <td className="px-4 py-2.5 text-gray-700">{stepTitle(stepByCode(r.step_code)) || r.step_code}</td>
                      <td className="px-4 py-2.5 text-gray-700">{r.operator}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs truncate max-w-[240px]">
                        {Object.entries(r.content || {}).map(([k, v]) => `${k}=${v}`).join('  ')}
                        {r.notes ? <span className="text-amber-600">  ⚠{r.notes}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{r.batch_id}</td>
                      <td className="px-4 py-2.5"><ChevronRight className="w-4 h-4 text-gray-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {total > 20 && (
              <div className="px-4 py-3 flex justify-between items-center border-t border-gray-100">
                <span className="text-xs text-gray-400">{page}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(Math.max(1, page - 1))} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-40" disabled={page <= 1}>←</button>
                  <button onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-40" disabled={page * 20 >= total}>→</button>
                </div>
              </div>
            )}
          </div>

          {/* Quick submit */}
          <div className="glass-card p-5 rounded-2xl">
            <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Plus className="w-4 h-4 text-[#2e7d32]" /> {t('ops.submit', language)}</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select value={submitModule} onChange={e => { setSubmitModule(e.target.value); setSubmitStep(''); }} className="glass-input rounded-lg px-3 py-2 text-sm">
                <option value="">{t('ops.module', language)}...</option>
                {modules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={submitPurpose} onChange={e => { setSubmitPurpose(e.target.value); setSubmitStep(''); }} className="glass-input rounded-lg px-3 py-2 text-sm">
                <option value="">{t('ops.purpose', language)}...</option>
                {purposes.map(p => <option key={p} value={p}>{t(`ops.purpose.${p}`, language)}</option>)}
              </select>
              <select value={submitStep} onChange={e => setSubmitStep(e.target.value)} className="glass-input rounded-lg px-3 py-2 text-sm">
                <option value="">{t('ops.step', language)}...</option>
                {steps.filter(s => (!submitModule || s.module === submitModule) && (!submitPurpose || s.purpose === submitPurpose)).map(s => <option key={s.code} value={s.code}>{stepTitle(s)}</option>)}
              </select>
              <input type="text" value={submitBatch} onChange={e => setSubmitBatch(e.target.value)} placeholder={t('ops.batchNo', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
            {submitStep && (
              <div className="space-y-2 mb-3 animate-scale-in">
                {stepByCode(submitStep)?.requiredFields?.map((f: string) => (
                  <div key={f} className="flex items-center gap-2">
                    <label className="text-xs font-bold text-gray-500 w-32">{f} <span className="text-red-400">*</span></label>
                    <input type="text" value={submitContent[f] || ''} onChange={e => setSubmitContent({ ...submitContent, [f]: e.target.value })} className="flex-1 glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-gray-500 w-32">{t('ops.notes', language)}</label>
                  <input type="text" value={submitNotes} onChange={e => setSubmitNotes(e.target.value)} className="flex-1 glass-input rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button onClick={handleSubmit} className="btn-primary px-5 py-2 rounded-lg text-sm font-bold"><Save className="w-4 h-4 inline mr-1" />{t('ops.submit', language)}</button>
              <span className="text-xs text-gray-400 flex items-center gap-1"><Lock className="w-3 h-3" /> {t('ops.immutable', language)}</span>
              {submitMsg && <span className="text-xs text-[#2e7d32] font-medium">{submitMsg}</span>}
            </div>
          </div>
        </>
      )}

      {tab === 'config' && isAdmin && (
        <div className="glass-card p-5 rounded-2xl">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <label className="text-xs font-bold text-gray-500">{t('ops.module', language)}</label>
            <select value={cfgModule} onChange={e => { setCfgModule(e.target.value); setEditing(null); }} className="glass-input rounded-lg px-3 py-2 text-sm">
              {modules.map(m => <option key={m} value={m}>{m}</option>)}
              {!modules.includes(cfgModule) && <option value={cfgModule}>{cfgModule}</option>}
            </select>
            <button onClick={() => setEditing({ module: cfgModule, title: '', titleEn: '', code: '', stepNo: cfgSteps.length + 1, sortOrder: cfgSteps.length + 1, requiredFields: '', dueDays: 0, purpose: '' })} className="btn-primary px-4 py-2 rounded-lg text-xs font-bold ml-auto">
              <Plus className="w-4 h-4 inline mr-1" />{t('ops.addStep', language)}
            </button>
          </div>

          {editing && (
            <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-4 space-y-3 animate-scale-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input type="text" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder={t('ops.stepTitle', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                <input type="text" value={editing.titleEn} onChange={e => setEditing({ ...editing, titleEn: e.target.value })} placeholder={t('ops.stepTitleEn', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                <input type="text" value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })} placeholder={t('ops.stepCode', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                <input type="text" value={editing.requiredFields} onChange={e => setEditing({ ...editing, requiredFields: e.target.value })} placeholder={`${t('ops.requiredFields', language)} (quantity,medium)`} className="glass-input rounded-lg px-3 py-2 text-sm" />
                <input type="number" value={editing.dueDays} onChange={e => setEditing({ ...editing, dueDays: e.target.value })} placeholder={t('ops.dueDays', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                <select value={editing.purpose} onChange={e => setEditing({ ...editing, purpose: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
                  <option value="">{t('ops.purpose', language)}...</option>
                  {purposes.map(p => <option key={p} value={p}>{t(`ops.purpose.${p}`, language)}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={saveStep} className="btn-primary px-4 py-2 rounded-lg text-xs font-bold"><Save className="w-4 h-4 inline mr-1" />{t('ops.save', language)}</button>
                <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100"><X className="w-4 h-4" /></button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cfgSteps.map(s => (
              <div key={s.id} className="bg-white/60 border border-gray-100 rounded-xl p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-800">{s.stepNo}. {stepTitle(s)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{s.code} {s.isSystem ? '· system' : ''}{s.purpose ? ` · ${t(`ops.purpose.${s.purpose}`, language)}` : ''}{s.dueDays ? ` · ${s.dueDays}d` : ''}</p>
                  {s.requiredFields?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.requiredFields.map((f: string) => <span key={f} className="bg-amber-50 text-amber-700 text-[10px] px-1.5 py-0.5 rounded">{f}</span>)}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditing({ ...s, requiredFields: (s.requiredFields || []).join(',') })} className="p-1.5 rounded-lg text-gray-400 hover:text-[#2e7d32] hover:bg-green-50"><Settings className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteStep(s.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && isAdmin && (
        <>
          {/* Audit filters */}
          <div className="glass-card p-4 rounded-2xl">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2 items-end">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.auditTable', language)}</label>
                <select value={auditFilters.table} onChange={e => { setAuditFilters({ ...auditFilters, table: e.target.value }); setAuditPage(1); }} className="w-full glass-input rounded-lg px-2 py-2 text-sm">
                  <option value="">{t('ops.all', language)}</option>
                  {auditFacets.tables.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.auditAction', language)}</label>
                <select value={auditFilters.action} onChange={e => { setAuditFilters({ ...auditFilters, action: e.target.value }); setAuditPage(1); }} className="w-full glass-input rounded-lg px-2 py-2 text-sm">
                  <option value="">{t('ops.all', language)}</option>
                  {auditFacets.actions.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.operator', language)}</label>
                <input type="text" value={auditFilters.user} onChange={e => setAuditFilters({ ...auditFilters, user: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.from', language)}</label>
                <input type="date" value={auditFilters.from} onChange={e => setAuditFilters({ ...auditFilters, from: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.to', language)}</label>
                <input type="date" value={auditFilters.to} onChange={e => setAuditFilters({ ...auditFilters, to: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">{t('ops.auditKeyword', language)}</label>
                <input type="text" value={auditFilters.q} onChange={e => setAuditFilters({ ...auditFilters, q: e.target.value })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setAuditPage(1); loadAudit(); }} className="flex-1 btn-primary px-3 py-2 rounded-lg text-xs font-bold"><Search className="w-4 h-4 inline mr-1" />{t('ops.search', language)}</button>
                <button onClick={resetAuditFilters} className="t-btn t-btn-outline px-3 py-2 text-xs">{t('ops.reset', language)}</button>
              </div>
            </div>
            <div className="mt-3 text-xs text-gray-400">{t('ops.auditTotal', language)}: {auditTotal}</div>
          </div>

          {/* Audit table */}
          <div className="glass-card rounded-2xl overflow-hidden">
            {auditLogs.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">{t('ops.noData', language)}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="px-4 py-3 text-left font-bold">{t('ops.auditTime', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.auditTable', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.auditAction', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.auditRecord', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.operator', language)}</th>
                    <th className="px-4 py-3 text-left font-bold">{t('ops.auditDetail', language)}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(r => (
                    <tr key={r.id} className="border-t border-gray-50 align-top hover:bg-green-50/30">
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap text-xs">{r.timestamp ? new Date(r.timestamp.replace(' ', 'T') + 'Z').toLocaleString() : ''}</td>
                      <td className="px-4 py-2.5 text-gray-700 font-medium whitespace-nowrap text-xs">{r.table_name}</td>
                      <td className="px-4 py-2.5"><span className="tone-neutral text-xs px-1.5 py-0.5 rounded">{r.action}</span></td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs font-mono truncate max-w-[140px]" title={r.record_id || ''}>{r.record_id || '-'}</td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs whitespace-nowrap">{r.username || '-'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <details>
                          <summary className="cursor-pointer text-gray-400 hover:text-gray-600 select-none">{fmtAudit(r.before_json)} → {fmtAudit(r.after_json)}</summary>
                          <div className="mt-2 space-y-1">
                            {r.before_json && <pre className="bg-gray-50 rounded-lg p-2 text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-auto">{pretty(r.before_json)}</pre>}
                            {r.after_json && <pre className="bg-green-50/60 rounded-lg p-2 text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-auto">{pretty(r.after_json)}</pre>}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {auditTotal > 20 && (
              <div className="px-4 py-3 flex justify-between items-center border-t border-gray-100">
                <span className="text-xs text-gray-400">{auditPage}</span>
                <div className="flex gap-2">
                  <button onClick={() => setAuditPage(Math.max(1, auditPage - 1))} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-40" disabled={auditPage <= 1}>←</button>
                  <button onClick={() => setAuditPage(auditPage + 1)} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-40" disabled={auditPage * 20 >= auditTotal}>→</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30 animate-fade-in" onClick={() => setDetail(null)}>
          <div className="w-full max-w-md bg-white h-full overflow-auto p-6 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-[#2e7d32]" /> {t('ops.detail', language)}</h3>
              <button onClick={() => setDetail(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            {detailMsg && <div className="mb-3 text-xs font-bold text-[#2e7d32]">{detailMsg}</div>}
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">{t('ops.createdAt', language)}</span><span className="font-medium">{new Date(detail.record.event_at).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">{t('ops.module', language)}</span><span className="font-medium">{detail.record.module}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">{t('ops.step', language)}</span><span className="font-medium">{stepTitle(stepByCode(detail.record.step_code)) || detail.record.step_code}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">{t('ops.operator', language)}</span><span className="font-medium">{detail.record.operator}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">{t('ops.batch', language)}</span><span className="font-medium">{detail.record.batch_id || '-'}</span></div>
              <div>
                <p className="text-gray-400 mb-1">{t('ops.content', language)}</p>
                <pre className="bg-gray-50 rounded-lg p-3 text-xs whitespace-pre-wrap">{JSON.stringify(detail.record.content || {}, null, 2)}</pre>
              </div>
              {detail.record.notes && (
                <div>
                  <p className="text-gray-400 mb-1">{t('ops.notes', language)}</p>
                  <p className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800">{detail.record.notes}</p>
                </div>
              )}

              {/* 审核意见 */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-gray-500 font-bold text-xs mb-2 flex items-center gap-1.5"><MessageSquarePlus className="w-4 h-4 text-[#2e7d32]" /> {t('ops.review', language)}</p>
                {detail.reviews?.length > 0 ? detail.reviews.map((rv: any) => (
                  <div key={rv.id} className="bg-green-50 rounded-lg p-3 mb-2">
                    <p className="text-xs text-gray-800">{rv.comment}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{rv.reviewer} · {new Date(rv.created_at).toLocaleString()}</p>
                  </div>
                )) : <p className="text-xs text-gray-400">{t('ops.review.list', language)}：-</p>}
                {isAdmin && (
                  <div className="mt-2 space-y-2">
                    <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} placeholder={t('ops.review.comment', language)} className="w-full glass-input rounded-lg px-3 py-2 text-xs" rows={2} />
                    <button onClick={submitReview} className="btn-primary px-4 py-2 rounded-lg text-xs font-bold"><Save className="w-3.5 h-3.5 inline mr-1" />{t('ops.review.add', language)}</button>
                  </div>
                )}
              </div>

              {/* 时间修正 */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-gray-500 font-bold text-xs mb-2 flex items-center gap-1.5"><Clock className="w-4 h-4 text-amber-500" /> {t('ops.correctTime', language)} <span className="text-[10px] font-normal text-gray-400">{t('ops.correctTimeHint', language)}</span></p>
                {detail.corrections?.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {detail.corrections.map((c: any) => (
                      <div key={c.id} className="text-[11px] text-gray-500 bg-amber-50 rounded px-2 py-1.5">
                        {c.old_at} → {c.new_at} <span className="text-gray-400">({c.corrected_by})</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-center">
                  <input type="datetime-local" value={correctTime} onChange={e => setCorrectTime(e.target.value)} className="flex-1 glass-input rounded-lg px-3 py-2 text-xs" />
                  <button onClick={submitCorrectTime} disabled={!correctTime} className="bg-amber-500 text-white px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40">OK</button>
                </div>
              </div>

              {/* 附件照片 */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-gray-500 font-bold text-xs mb-2 flex items-center gap-1.5"><Camera className="w-4 h-4 text-blue-500" /> {t('ops.photos', language)}</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {detail.photos?.map((p: any) => (
                    <a key={p.id} href={`/uploads/${p.storedName}`} target="_blank" rel="noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-100 hover:shadow-md transition-shadow">
                      <img src={`/uploads/${p.storedName}`} alt={p.originalName} className="w-full h-full object-cover" />
                    </a>
                  ))}
                  {!detail.photos?.length && <p className="text-xs text-gray-400">-</p>}
                </div>
                <label className="inline-flex items-center gap-1.5 cursor-pointer bg-white border border-gray-200 px-3 py-2 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50">
                  <Camera className="w-3.5 h-3.5" /> {t('ops.upload', language)}
                  <input type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
                </label>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] text-gray-400"><Lock className="w-3 h-3" /> {t('ops.immutable', language)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Operations;
