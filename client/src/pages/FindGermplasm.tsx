import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import {
  Search, Sprout, ChevronRight, ChevronLeft, Check, Loader2, Package,
  AlertTriangle, CheckCircle2, X, Info,
} from 'lucide-react';
import TraitInfoIcon from '../components/TraitInfoIcon';
import { opsFor, opLabel } from '../lib/traitOps';

// v2.10：找种质向导（面向申请者的问卷式检索）
// Step1 挑性状 → Step2 定标准（可选）→ Step3 结果矩阵+库存 → Step4 选种提交（预填分发申请，source='wizard'）
// 复用服务端检索内核 POST /api/accessions/query；35 上限由服务端 dist.max_accessions 强制。

const PAGE = 50;

interface Props {
  onMsg?: (m: string) => void;
}

const STEPS = ['find.step1', 'find.step2', 'find.step3', 'find.step4'];

const FindGermplasm: React.FC<Props> = ({ onMsg }) => {
  const { language } = useApp();
  const [traits, setTraits] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ code: string; zh: string; en: string }[]>([]);
  const [maxAcc, setMaxAcc] = useState(35);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<Record<string, { op: string; value: string }>>({});
  const [traitValues, setTraitValues] = useState<Record<string, { valueType: string; values: { value: string; label: string }[] }>>({});
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Record<string, any>>({});
  const [form, setForm] = useState({ applicant: '', applicantOrg: '', purpose: '', resourceType: '', durationDays: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ reqNo: string; verifyWarning: string[] } | null>(null);
  const [msg, setMsg] = useState('');

  const showToast = (m: string) => { setMsg(m); onMsg?.(m); setTimeout(() => setMsg(''), 4000); };

  useEffect(() => {
    (async () => {
      try {
        const [tr, st] = await Promise.all([api.getTraits(), api.getSettings().catch(() => ({}) as Record<string, string>)]);
        setTraits(tr.traits || []);
        setCategories(tr.categories || []);
        const n = parseInt(st?.['dist.max_accessions'] || '', 10);
        if (!Number.isNaN(n) && n > 0) setMaxAcc(n);
      } catch (e: any) { showToast(e.message); }
    })();
  }, []);

  const traitByCode = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tr of traits) m[tr.code] = tr;
    return m;
  }, [traits]);
  const traitLabel = (tr: any) => language === 'zh' ? (tr.nameZh || tr.nameEn || tr.code) : (tr.nameEn || tr.nameZh || tr.code);
  const catLabel = (code: string) => {
    const c = categories.find(x => x.code === code);
    return c ? (language === 'zh' ? c.zh : c.en) : code;
  };

  const toggleTrait = (code: string) => {
    setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
    setCriteria(prev => {
      const next = { ...prev };
      if (!next[code]) {
        const tr = traitByCode[code];
        const defOp = tr?.valueType === 'scale' ? 'eq' : tr?.valueType === 'number' ? 'gte' : 'contains';
        next[code] = { op: defOp, value: '' };
      }
      return next;
    });
    // scale 性状预取候选值（带 scale 含义标签）
    const tr = traitByCode[code];
    if (tr?.valueType === 'scale' && !traitValues[code]) {
      api.getTraitValues(code).then(r => setTraitValues(prev => ({ ...prev, [code]: { valueType: r.valueType, values: r.values || [] } }))).catch(() => {});
    }
  };

  const setCriterion = (code: string, patch: { op?: string; value?: string }) => {
    setCriteria(prev => ({ ...prev, [code]: { ...(prev[code] || { op: 'eq', value: '' }), ...patch } }));
  };

  // 组装查询条件：仅包含设置了具体标准的性状；全空 → []（服务端放行=全部种质，纯列展示）
  const buildConditions = (codes: string[]) => codes
    .map(code => {
      const c = criteria[code];
      if (!c) return null;
      if (c.op === 'empty' || c.op === 'notempty') return { traitCode: code, op: c.op, value: '' };
      if (String(c.value).trim() === '') return null;
      return { traitCode: code, op: c.op, value: String(c.value).trim() };
    })
    .filter(Boolean) as { traitCode: string; op: string; value: string }[];

  const runQuery = useCallback(async (codes: string[], p: number, append: boolean) => {
    setLoading(true);
    try {
      const conditions = buildConditions(codes);
      const res = await api.queryAccessions(conditions, p, PAGE);
      setResults(prev => append ? [...prev, ...(res.accessions || [])] : (res.accessions || []));
      setTotal(res.total || 0);
      setPage(p);
      setSearched(true);
    } catch (e: any) {
      // 性状在步骤间被删：从 error 提取代码，剔除后重试一次
      const m = /未知性状代码:\s*([A-Za-z0-9_]+)/.exec(e?.message || '');
      if (m) {
        const bad = m[1];
        const rest = codes.filter(c => c !== bad);
        setSelected(rest);
        showToast(t('find.traitDeleted', language).replace('{code}', bad));
        if (rest.length || codes.length > 1) return runQuery(rest, p, append);
      } else {
        showToast(e.message);
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria, language]);

  const goStep3 = () => { setResults([]); setSearched(false); setStep(3); runQuery(selected, 1, false); };

  const togglePick = (row: any) => {
    const key = String(row.id ?? row._id);
    setPicked(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else {
        if (Object.keys(next).length >= maxAcc) { showToast(t('find.tooMany', language).replace('{n}', String(maxAcc))); return prev; }
        next[key] = row;
      }
      return next;
    });
  };

  const submit = async () => {
    if (!form.applicant.trim()) { showToast(t('find.applicantRequired', language)); return; }
    if (!form.resourceType.trim()) { showToast(t('find.resourceTypeRequired', language)); return; }
    setSubmitting(true);
    try {
      const list = Object.values(picked).map(a => ({ id: String(a.id ?? a._id), code: String(a.primaryId || ''), name: String(a.displayName || '') }));
      const r = await api.createDistRequest({
        applicant: form.applicant.trim(),
        applicantOrg: form.applicantOrg.trim(),
        purpose: form.purpose.trim(),
        resourceType: form.resourceType.trim(),
        durationDays: form.durationDays ? parseInt(form.durationDays, 10) : null,
        qty: list.length,
        accessions: list,
        source: 'wizard',
      });
      setDone({ reqNo: r.reqNo, verifyWarning: (r as any).verifyWarning || [] });
    } catch (e: any) {
      if (e?.body?.error === 'TOO_MANY_ACCESSIONS') {
        showToast(t('find.tooMany', language).replace('{n}', String(e.body.max || maxAcc)));
      } else {
        showToast(e.message);
      }
    }
    setSubmitting(false);
  };

  const pickedCount = Object.keys(picked).length;
  const inputCls = 'w-full glass-input rounded-xl px-4 py-2.5 text-sm';
  const labelCls = 'text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1';

  const grouped = categories
    .map(cat => ({ cat, list: traits.filter(tr => tr.category === cat.code) }))
    .filter(g => g.list.length > 0);

  const fmt = (v: any, code: string) => {
    if (v === null || v === undefined || v === '') return <span className="text-gray-300">-</span>;
    const tr = traitByCode[code];
    const meaning = tr?.scale?.[String(v)];
    return <span>{String(v)}{meaning ? <span className="text-gray-400"> · {meaning}</span> : ''}</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">DISCOVERY</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <Search className="w-6 h-6 text-[#2e7d32]" /> {t('find.title', language)}
          </h1>
        </div>
        {step > 1 && step < 4 && !done && (
          <button onClick={() => setStep(s => Math.max(1, s - 1))} className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-1">
            <ChevronLeft className="w-4 h-4" />{t('find.prev', language)}
          </button>
        )}
      </div>

      {msg && <div className="px-4 py-3 rounded-xl bg-amber-50 text-amber-700 text-sm font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{msg}</div>}

      {/* 步骤指示器 */}
      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map((key, i) => {
          const n = i + 1;
          const active = step === n && !done;
          const passed = step > n || !!done;
          return (
            <React.Fragment key={key}>
              {i > 0 && <ChevronRight className="w-4 h-4 text-gray-300" />}
              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${active ? 'bg-[#2e7d32] text-white shadow' : passed ? 'bg-green-100 text-green-700' : 'bg-white border border-gray-200 text-gray-400'}`}>
                {passed ? <Check className="w-3.5 h-3.5" /> : <span className="opacity-70">{n}</span>}
                {t(key, language)}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {done ? (
        /* ===== 提交成功 ===== */
        <div className="glass-card rounded-2xl p-10 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-[#2e7d32] mx-auto" />
          <h2 className="text-lg font-bold text-gray-800">{t('find.submitted', language)}</h2>
          <p className="text-sm text-gray-500">{t('find.reqNo', language)}: <span className="font-mono font-bold text-[#2e7d32]">{done.reqNo}</span></p>
          {done.verifyWarning.length > 0 && (
            <div className="mx-auto max-w-md bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 text-left">
              {done.verifyWarning.map((w, i) => <p key={i}>· {w}</p>)}
            </div>
          )}
          <p className="text-xs text-gray-400">{t('find.reviewHint', language)}</p>
          <button onClick={() => { window.location.hash = '#/dist'; }} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold inline-flex items-center gap-2">
            <Package className="w-4 h-4" />{t('find.viewDist', language)}
          </button>
        </div>
      ) : step === 1 ? (
        /* ===== Step1 挑性状 ===== */
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{t('find.pickTraitHint', language)}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-[#2e7d32]">{t('find.pickedTraits', language)}: {selected.length}</span>
          </div>
          {grouped.map(({ cat, list }) => (
            <div key={cat.code} className="glass-card rounded-2xl p-4">
              <h3 className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-3">{catLabel(cat.code)}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {list.map(tr => {
                  const on = selected.includes(tr.code);
                  return (
                    <button key={tr.code} onClick={() => toggleTrait(tr.code)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${on ? 'bg-[#e8f5e9] border-[#2e7d32] ring-1 ring-[#2e7d32]/30' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-[#2e7d32] border-[#2e7d32]' : 'border-gray-300'}`}>
                        {on && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-gray-700 truncate">{traitLabel(tr)}</span>
                        <span className="block text-[10px] font-mono text-gray-400">{tr.code}</span>
                      </span>
                      <span onClick={e => e.stopPropagation()}>
                        <TraitInfoIcon trait={tr} catLabel={catLabel(tr.category)} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button disabled={!selected.length} onClick={() => setStep(2)} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center gap-1.5">
              {t('find.next', language)}<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : step === 2 ? (
        /* ===== Step2 定标准（可选） ===== */
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{t('find.criteriaHint', language)}</p>
          {selected.map(code => {
            const tr = traitByCode[code];
            if (!tr) return null;
            const c = criteria[code] || { op: 'eq', value: '' };
            const ops = opsFor(tr);
            return (
              <div key={code} className="glass-card rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-sm font-bold text-gray-800">{traitLabel(tr)}</span>
                  <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{code}</span>
                  <span className="text-[10px] text-[#2e7d32] bg-green-50 px-2 py-0.5 rounded font-bold">{catLabel(tr.category)}</span>
                  <span className="ml-auto"><TraitInfoIcon trait={tr} catLabel={catLabel(tr.category)} /></span>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  {tr.valueType === 'scale' ? (
                    <select value={c.value} onChange={e => setCriterion(code, { op: 'eq', value: e.target.value })} className={`${inputCls} flex-1 min-w-[220px] cursor-pointer`}>
                      <option value="">{t('find.noFilter', language)}</option>
                      {(traitValues[code]?.values || Object.entries(tr.scale || {}).map(([v]) => ({ value: v, label: v }))).map(v => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select value={c.op} onChange={e => setCriterion(code, { op: e.target.value })} className={`${inputCls} w-36 cursor-pointer`}>
                        {ops.map(o => <option key={o.v} value={o.v}>{opLabel(o, language)}</option>)}
                      </select>
                      <input
                        type={tr.valueType === 'number' ? 'number' : 'text'}
                        value={c.value}
                        onChange={e => setCriterion(code, { value: e.target.value })}
                        placeholder={t('find.noFilter', language)}
                        className={`${inputCls} flex-1 min-w-[180px]`}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex justify-end">
            <button onClick={goStep3} disabled={loading} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{t('find.search', language)}
            </button>
          </div>
        </div>
      ) : (
        /* ===== Step3 结果矩阵 + Step4 提交（同屏：结果可继续勾选） ===== */
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-gray-500">{t('find.resultsHint', language).replace('{n}', String(total))}</p>
            <span className="ml-auto px-3 py-1.5 rounded-full bg-[#2e7d32] text-white text-xs font-bold">
              {t('find.selected', language).replace('{n}', String(pickedCount)).replace('{max}', String(maxAcc))}
            </span>
          </div>

          {loading && !searched ? (
            <div className="glass-card rounded-2xl p-10 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-[#2e7d32]" /></div>
          ) : searched && results.length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <Info className="w-6 h-6 text-gray-300" />{t('find.noMatch', language)}
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="overflow-auto custom-scrollbar max-h-[420px]">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-gray-400 sticky top-0">
                    <th className="px-3 py-2.5 text-left font-bold w-10"></th>
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">{t('find.colPid', language)}</th>
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">{t('find.colName', language)}</th>
                    {selected.map(code => (
                      <th key={code} className="px-3 py-2.5 text-left font-bold whitespace-nowrap">
                        <span className="flex items-center gap-1">{traitByCode[code] ? traitLabel(traitByCode[code]) : code}<TraitInfoIcon trait={traitByCode[code]} /></span>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-left font-bold whitespace-nowrap">{t('find.stock', language)}</th>
                  </tr></thead>
                  <tbody>
                    {results.map((r, i) => {
                      const key = String(r.id ?? r._id);
                      const on = !!picked[key];
                      const stock = Number(r.stockTotal || 0);
                      return (
                        <tr key={key} onClick={() => togglePick(r)} className={`border-t border-gray-50 cursor-pointer transition-colors ${on ? 'bg-green-50' : 'hover:bg-gray-50/60'}`}>
                          <td className="px-3 py-2.5">
                            <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-[#2e7d32] border-[#2e7d32]' : 'border-gray-300'}`}>
                              {on && <Check className="w-3 h-3 text-white" />}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-bold text-gray-800 whitespace-nowrap">{i + 1}. {r.primaryId || '-'}</td>
                          <td className="px-3 py-2.5 text-gray-600 max-w-[160px] truncate">{r.displayName || '-'}</td>
                          {selected.map(code => <td key={code} className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmt(r[code], code)}</td>)}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {stock > 0
                              ? <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">{t('find.inStock', language)} {stock}</span>
                              : <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">{t('find.stockOut', language)}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {results.length < total && (
                <div className="px-4 py-3 border-t border-gray-100 text-center">
                  <button disabled={loading} onClick={() => runQuery(selected, page + 1, true)} className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    {loading ? '...' : t('find.loadMore', language).replace('{a}', String(results.length)).replace('{b}', String(total))}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step4 提交表单 */}
          <div className="glass-card rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Sprout className="w-4 h-4 text-[#2e7d32]" />{t('find.step4', language)}</h3>
            <p className="text-xs text-gray-400 -mt-2">{t('find.submitHint', language)}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('find.applicant', language)} *</label>
                <input type="text" value={form.applicant} onChange={e => setForm(f => ({ ...f, applicant: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('find.applicantOrg', language)}</label>
                <input type="text" value={form.applicantOrg} onChange={e => setForm(f => ({ ...f, applicantOrg: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('find.resourceType', language)} *</label>
                <input type="text" value={form.resourceType} onChange={e => setForm(f => ({ ...f, resourceType: e.target.value }))} className={inputCls} placeholder={t('find.resourceTypePh', language)} />
              </div>
              <div>
                <label className={labelCls}>{t('find.duration', language)}</label>
                <input type="number" min={1} value={form.durationDays} onChange={e => setForm(f => ({ ...f, durationDays: e.target.value }))} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>{t('find.purpose', language)}</label>
                <textarea rows={2} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('find.qty', language)}</label>
                <input type="text" value={String(pickedCount)} readOnly disabled className={`${inputCls} bg-gray-50 text-gray-500`} />
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={submit} disabled={submitting || pickedCount === 0} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center gap-1.5">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t('find.submit', language)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FindGermplasm;
