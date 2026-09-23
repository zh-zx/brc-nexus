import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api, dataSource } from '../api';
import { t } from '../utils';
import {
  Search, Plus, X, ChevronLeft, ChevronRight, Edit3, Trash2, Save, Database,
  AlertTriangle, Loader2, Cloud, ClipboardList, Check, ChevronDown, Filter, Table2
} from 'lucide-react';
import TraitManager from '../components/TraitManager';
import BitableEditor from '../components/bitable/BitableEditor';
import BatchEditModal from '../lib/BatchEditModal';
import TraitInfoIcon from '../components/TraitInfoIcon';
import { opsFor } from '../lib/traitOps';

const PAGE_SIZE = 50;

// Keys never shown/edited directly (server-managed columns or internals)
const IGNORED_KEYS = [
  'id', '_id', 'lastSubcultureDate', 'sourceUploadId', 'lastModifiedBy', 'lastModifiedAt',
  'data_json', 'primary_id', 'display_name', 'created_at', 'last_modified_at', 'last_modified_by',
];
const BASIC_ORDER = ['primaryId', 'displayName', 'species', 'origin'];

const Accessions: React.FC = () => {
  const { language, user } = useApp();
  const [accessions, setAccessions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  // v2.11：基因组学预留块
  const [omics, setOmics] = useState<any[]>([]);
  const [showOmicsForm, setShowOmicsForm] = useState(false);
  const [omicsForm, setOmicsForm] = useState({ category: 'link', title: '', ref: '', url: '', notes: '' });
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});
  const [customFieldKey, setCustomFieldKey] = useState('');
  const [customFieldVal, setCustomFieldVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dsMode, setDsMode] = useState<'local' | 'ggce'>('local');
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  // v2.9 网格编辑：表格内直接编辑（admin / approver）
  const [gridEdit, setGridEdit] = useState(false);
  const [gridDirty, setGridDirty] = useState<Map<string, Map<string, string | null>>>(new Map());
  const [gridSaving, setGridSaving] = useState(false);
  // v2.15 多维表格（Bitable 形态；admin/approver 编辑，regulator 只读）
  const [showBitable, setShowBitable] = useState(false);

  // Trait registry (local mode only)
  const [traits, setTraits] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ code: string; zh: string; en: string }[]>([]);
  const [showTraits, setShowTraits] = useState(false);
  const [traitSel, setTraitSel] = useState('');
  const [traitVal, setTraitVal] = useState('');

  // Trait query panel (local mode only)
  const [showQuery, setShowQuery] = useState(false);
  const [queryRows, setQueryRows] = useState<any[]>([{ traitCode: '', op: 'eq', value: '' }]);
  const [queryCommitted, setQueryCommitted] = useState<any[] | null>(null);
  const [queryActive, setQueryActive] = useState(false);
  const [queryTotal, setQueryTotal] = useState(0);
  const [traitValOptions, setTraitValOptions] = useState<Record<string, any[]>>({});

  useEffect(() => {
    dataSource.getMode().then(m => setDsMode(m)).catch(() => {});
  }, []);

  useEffect(() => {
    if (dsMode === 'local') {
      api.getTraits().then(res => {
        setTraits(res.traits || []);
        setCategories(res.categories || []);
      }).catch(() => {});
    }
  }, [dsMode]);

  const reloadTraits = useCallback(() => {
    api.getTraits().then(res => {
      setTraits(res.traits || []);
      setCategories(res.categories || []);
    }).catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let result: { accessions: any[]; total: number };
      if (queryCommitted && queryCommitted.length) {
        result = await api.queryAccessions(queryCommitted, page, PAGE_SIZE);
        setQueryTotal(result.total || 0);
      } else if (searchTerm.trim()) {
        result = await dataSource.searchAccessions(searchTerm.trim(), page);
      } else {
        result = await dataSource.listAccessions(page, PAGE_SIZE);
      }
      setAccessions(result.accessions || []);
      setTotal(result.total || 0);
    } catch (e: any) {
      console.error('Failed to fetch accessions', e);
      setAccessions([]);
      setTotal(0);
    }
    setLoading(false);
  }, [searchTerm, page, queryCommitted]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (dsMode === 'local') {
      api.getAccessionFields().then(res => setFields(res.fields || [])).catch(() => {});
    } else {
      // GGCE mode: use standard MCPD-ish fields
      setFields(['primaryId', 'displayName', 'species', 'origin', 'accessionNumber', 'taxonomySpecies', 'site', 'statusCode', 'lifeFormCode']);
    }
  }, [dsMode]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSearch = (val: string) => {
    if (gridEdit && gridDirtyCount && !confirmDiscardDirty()) return;
    setSearchTerm(val);
    setPage(1);
    // typing in the search box deactivates trait query
    setQueryActive(false);
    setQueryCommitted(null);
  };

  const changePage = (p: number) => {
    if (gridEdit && gridDirtyCount && !confirmDiscardDirty()) return;
    setPage(p);
  };

  // ---- trait query helpers ----
  // v2.10：opsFor 抽到 lib/traitOps.ts（与找种质向导共用）

  const updateQueryRow = (i: number, patch: any) => {
    setQueryRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addQueryRow = () => setQueryRows(prev => [...prev, { traitCode: '', op: 'eq', value: '' }]);
  const removeQueryRow = (i: number) =>
    setQueryRows(prev => (prev.length <= 1 ? [{ traitCode: '', op: 'eq', value: '' }] : prev.filter((_, idx) => idx !== i)));

  const loadTraitOptions = async (code: string) => {
    if (!code || traitValOptions[code]) return;
    try {
      const res = await api.getTraitValues(code);
      setTraitValOptions(p => ({ ...p, [code]: res.values || [] }));
    } catch (e) { /* ignore */ }
  };

  const runQuery = () => {
    const conds = queryRows
      .filter(r => r.traitCode && r.op && (r.op === 'empty' || r.op === 'notempty' || String(r.value ?? '').trim() !== ''))
      .map(r => ({ traitCode: r.traitCode, op: r.op, value: String(r.value ?? '').trim() }));
    if (!conds.length) { alert(t('acc.query.noCond', language)); return; }
    setSearchTerm('');
    setQueryCommitted(conds);
    setQueryActive(true);
    setPage(1);
  };

  const clearQuery = () => {
    setQueryActive(false);
    setQueryCommitted(null);
    setQueryRows([{ traitCode: '', op: 'eq', value: '' }]);
    setPage(1);
  };

  // ---- v2.9 网格编辑 ----
  const gridDirtyCount = useMemo(() => {
    let n = 0;
    for (const cells of gridDirty.values()) n += cells.size;
    return n;
  }, [gridDirty]);

  const cellOrigVal = (acc: any, col: string): string => {
    const v = acc[col];
    if (v === null || v === undefined) return '';
    return String(v);
  };

  const gridPid = (acc: any) => String(acc.primaryId ?? acc.primary_id ?? '');

  // 空串 → 清空(null)；与原值相同或本为空 → 撤销该格记录
  const setGridCell = (acc: any, col: string, raw: string) => {
    const pid = gridPid(acc);
    const orig = cellOrigVal(acc, col);
    const target = raw === '' ? null : raw;
    setGridDirty(prev => {
      const next = new Map(prev);
      const cells = new Map(next.get(pid) || []);
      if ((target === null && orig === '') || (target !== null && target === orig)) {
        cells.delete(col);
      } else {
        cells.set(col, target);
      }
      if (cells.size === 0) next.delete(pid);
      else next.set(pid, cells);
      return next;
    });
  };

  const gridCellValue = (acc: any, col: string): string => {
    const cells = gridDirty.get(gridPid(acc));
    if (cells && cells.has(col)) {
      const v = cells.get(col);
      return v === null ? '' : v;
    }
    return cellOrigVal(acc, col);
  };

  const gridCellDirty = (acc: any, col: string): boolean => {
    const cells = gridDirty.get(gridPid(acc));
    return !!cells && cells.has(col);
  };

  const confirmDiscardDirty = (): boolean => {
    if (!gridDirtyCount) return true;
    return window.confirm(t('acc.gridDiscardDirty', language));
  };

  const exitGrid = () => {
    if (!confirmDiscardDirty()) return;
    setGridEdit(false);
    setGridDirty(new Map());
  };

  const saveGrid = async () => {
    if (!gridDirtyCount) return;
    if (!window.confirm(t('acc.gridConfirm', language).replace('{n}', String(gridDirtyCount)))) return;
    setGridSaving(true);
    try {
      const rows: { primaryId: string; updates: Record<string, string | null> }[] = [];
      for (const [pid, cells] of gridDirty) {
        rows.push({ primaryId: pid, updates: Object.fromEntries(cells) });
      }
      const res = await api.batchUpdateAccessions({ rows, mode: 'replace' });
      const parts: string[] = [];
      if (res.notFound?.length) parts.push(`${t('acc.batchEditNotFound', language)}: ${res.notFound.length}`);
      if (res.failed?.length) parts.push(`${t('acc.batchEditFailed', language)}: ${res.failed.length}`);
      alert(t('acc.gridSaved', language).replace('{n}', String(res.updated?.length || 0)) + (parts.length ? ' — ' + parts.join(' · ') : ''));
      setGridDirty(new Map());
      fetchData();
    } catch (e: any) {
      alert('保存失败: ' + e.message);
    }
    setGridSaving(false);
  };

  const renderGridCell = (acc: any, col: string) => {
    const tr = traitByCode[col];
    const dirty = gridCellDirty(acc, col);
    const val = gridCellValue(acc, col);
    const cls = `w-full px-2 py-1.5 rounded-lg text-xs outline-none transition-colors ${
      dirty ? 'bg-amber-50 ring-2 ring-amber-300' : 'bg-transparent border border-transparent hover:bg-gray-50 focus:border-green-300 focus:bg-white'
    }`;
    if (tr?.valueType === 'scale') {
      return (
        <select value={val} onChange={e => setGridCell(acc, col, e.target.value)} className={`${cls} cursor-pointer`}>
          <option value="">{t('acc.gridEmpty', language)}</option>
          {Object.entries((tr.scale as Record<string, string>) || {}).map(([k, v]) => (
            <option key={k} value={k}>{k} · {v}</option>
          ))}
        </select>
      );
    }
    if (tr?.valueType === 'number') {
      return <input type="number" value={val} onChange={e => setGridCell(acc, col, e.target.value)} className={cls} />;
    }
    return (
      <input
        type="text"
        value={val}
        onChange={e => setGridCell(acc, col, e.target.value)}
        className={cls}
        placeholder={dirty && val === '' ? t('acc.gridEmpty', language) : undefined}
      />
    );
  };

  const selectAccession = async (acc: any) => {
    setSelected(acc);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setShowOmicsForm(false);
    setOmicsForm({ category: 'link', title: '', ref: '', url: '', notes: '' });
    // v2.11：基因组学预留块
    const accId = acc.id || acc._id;
    if (accId && dsMode === 'local') {
      api.getOmics(accId).then(r => setOmics(r.entries || [])).catch(() => setOmics([]));
    } else {
      setOmics([]);
    }
  };

  // v2.15：多维表格行展开 → 拉全量记录后打开详情抽屉（行数据仅含可见列）
  const openBitableDetail = async (id: string) => {
    try {
      selectAccession(await api.getAccession(id));
    } catch (e) { console.error('open detail failed', e); }
  };

  const closeDetail = () => {
    setSelected(null);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setOmics([]);
    setShowOmicsForm(false);
  };

  // ---- v2.11：基因组学条目增删 ----
  const OMICS_CATEGORIES = [
    { v: 'marker', zh: '分子标记', en: 'Marker' },
    { v: 'snp', zh: 'SNP', en: 'SNP' },
    { v: 'indel', zh: 'InDel', en: 'InDel' },
    { v: 'assembly', zh: '基因组组装', en: 'Assembly' },
    { v: 'gbs', zh: 'GBS/测序', en: 'GBS/Sequencing' },
    { v: 'publication', zh: '文献', en: 'Publication' },
    { v: 'link', zh: '外部链接', en: 'External link' },
  ];
  const omicsCatLabel = (v: string) => {
    const c = OMICS_CATEGORIES.find(x => x.v === v);
    return c ? (language === 'zh' ? c.zh : c.en) : v;
  };
  const addOmics = async () => {
    if (!omicsForm.title.trim()) { alert(t('omics.titleRequired', language)); return; }
    try {
      await api.addOmics(selected.id || selected._id, {
        category: omicsForm.category,
        title: omicsForm.title.trim(),
        ref: omicsForm.ref.trim() || undefined,
        url: omicsForm.url.trim() || undefined,
        notes: omicsForm.notes.trim() || undefined,
      });
      setShowOmicsForm(false);
      setOmicsForm({ category: 'link', title: '', ref: '', url: '', notes: '' });
      const r = await api.getOmics(selected.id || selected._id);
      setOmics(r.entries || []);
    } catch (e: any) { alert(e.message); }
  };
  const removeOmics = async (id: string) => {
    if (!window.confirm(t('omics.deleteConfirm', language))) return;
    try {
      await api.deleteOmics(id);
      setOmics(prev => prev.filter(x => x.id !== id));
    } catch (e: any) { alert(e.message); }
  };

  const startEdit = () => {
    setEditData({ ...selected });
    setIsEditing(true);
  };

  const handleEditChange = (key: string, val: any) => {
    setEditData((prev: any) => ({ ...prev, [key]: val }));
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await api.updateAccession(selected.id || selected._id, editData);
      setSelected(updated);
      setIsEditing(false);
      fetchData();
    } catch (e: any) {
      alert('保存失败: ' + e.message);
    }
    setSaving(false);
  };

  const deleteAccession = async () => {
    if (!selected) return;
    try {
      await api.deleteAccession(selected.id || selected._id);
      closeDetail();
      fetchData();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  const createAccession = async () => {
    if (!createData.primaryId && !createData.primary_id) {
      alert('种质编号不能为空');
      return;
    }
    setSaving(true);
    try {
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(createData)) {
        if (v) data[k] = v;
      }
      if (customFieldKey.trim() && customFieldVal.trim()) {
        data[customFieldKey.trim()] = customFieldVal.trim();
      }
      await api.createAccession(data);
      setShowCreate(false);
      setCreateData({});
      setCustomFieldKey('');
      setCustomFieldVal('');
      setTraitSel('');
      setTraitVal('');
      fetchData();
    } catch (e: any) {
      alert('创建失败: ' + e.message);
    }
    setSaving(false);
  };

  // ---- trait helpers ----
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

  const formatVal = (v: any): string => {
    if (v === null || v === undefined) return '-';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // Sections for VIEW mode: only populated fields, grouped by category
  const buildViewSections = (obj: any) => {
    const sections: { title?: string; titleKey?: string; fields: { key: string; label: string; trait?: any; value: any }[] }[] = [];
    const handled = new Set<string>(IGNORED_KEYS);

    const basicFields = BASIC_ORDER
      .filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
      .map(k => ({ key: k, label: k, value: obj[k] }));
    sections.push({ titleKey: 'trait.basic', fields: basicFields });

    for (const cat of categories) {
      const catTraits = traits.filter(tr => tr.category === cat.code);
      if (!catTraits.length) continue;
      const fs: any[] = [];
      for (const tr of catTraits) {
        const v = obj[tr.code];
        if (v !== undefined && v !== null && v !== '') {
          fs.push({ key: tr.code, label: traitLabel(tr), trait: tr, value: v });
          handled.add(tr.code);
        }
      }
      if (fs.length) sections.push({ title: catLabel(cat.code), fields: fs });
    }

    const otherFields: any[] = [];
    for (const k of Object.keys(obj)) {
      if (handled.has(k)) continue;
      const v = obj[k];
      if (v === undefined || v === null || v === '') continue;
      otherFields.push({ key: k, label: k, value: v });
    }
    if (otherFields.length) sections.push({ titleKey: 'trait.other', fields: otherFields });

    return sections;
  };

  // Sections for EDIT mode: all registered traits (empty allowed), grouped by category
  const buildEditSections = (obj: any) => {
    const sections: { title?: string; titleKey?: string; fields: { key: string; label: string; trait?: any; value: any }[] }[] = [];
    const handled = new Set<string>(IGNORED_KEYS);

    const basicFields = BASIC_ORDER.map(k => ({ key: k, label: k, value: obj[k] ?? '' }));
    sections.push({ titleKey: 'trait.basic', fields: basicFields });

    for (const cat of categories) {
      const catTraits = traits.filter(tr => tr.category === cat.code);
      if (!catTraits.length) continue;
      const fs = catTraits.map(tr => ({ key: tr.code, label: traitLabel(tr), trait: tr, value: obj[tr.code] ?? '' }));
      for (const tr of catTraits) handled.add(tr.code);
      sections.push({ title: catLabel(cat.code), fields: fs });
    }

    const otherFields = Object.keys(obj)
      .filter(k => !handled.has(k))
      .map(k => ({ key: k, label: k, value: obj[k] ?? '' }));
    if (otherFields.length) sections.push({ titleKey: 'trait.other', fields: otherFields });

    return sections;
  };

  const visibleColumns = useMemo(() => {
    if (queryCommitted?.length) {
      const codes = queryCommitted.map(c => c.traitCode);
      return [...codes, ...fields.filter(f => !codes.includes(f))].slice(0, 10);
    }
    return fields.slice(0, 10);
  }, [fields, queryCommitted]);

  // 表格列：基础 4 列 + 至多 4 个可见列（v2.10：性状列优先展示——带 ⓘ 说明与网格编辑语义）
  const tableCols = useMemo(() => {
    const base = ['primaryId', 'displayName', 'species', 'origin'];
    const sys = ['id', '_id', 'primary_id', 'display_name'];
    const rest = visibleColumns.filter(c => !base.includes(c) && !sys.includes(c));
    const traitCols = rest.filter(c => traitByCode[c]);
    const otherCols = rest.filter(c => !traitByCode[c]);
    return [...base, ...[...traitCols, ...otherCols].slice(0, 4)];
  }, [visibleColumns, traitByCode]);

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in-up pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#e8f5e9] rounded-2xl flex items-center justify-center text-[#2e7d32]">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <span className="t-eyebrow">GERMPLASM</span>
            <h1 className="t-page-title text-2xl mt-1">{t('acc.title', language)}</h1>
            <p className="text-xs text-gray-400 font-medium">{t('acc.total', language).replace('{n}', String(total))}</p>
          </div>
        </div>
        {dsMode === 'local' ? (
          <div className="flex items-center gap-2">
            {user && (user.role === 'admin' || user.user_type === 'approver') && (
              <>
                <button
                  onClick={() => setShowBatchEdit(true)}
                  className="t-btn t-btn-outline px-4 py-2.5 rounded-xl hover:-translate-y-0.5 active:translate-y-0"
                >
                  <ClipboardList className="w-4 h-4" /> {t('acc.batchEdit', language)}
                </button>
                {!gridEdit && (
                  <button
                    onClick={() => { setGridDirty(new Map()); setGridEdit(true); }}
                    className="t-btn t-btn-outline px-4 py-2.5 rounded-xl hover:-translate-y-0.5 active:translate-y-0"
                  >
                    <Edit3 className="w-4 h-4" /> {t('acc.gridEdit', language)}
                  </button>
                )}
              </>
            )}
            {user && (user.role === 'admin' || user.user_type === 'approver' || user.user_type === 'regulator') && !gridEdit && (
              <button
                onClick={() => setShowBitable(true)}
                data-testid="open-bitable"
                className="t-btn t-btn-outline px-4 py-2.5 rounded-xl hover:-translate-y-0.5 active:translate-y-0"
              >
                <Table2 className="w-4 h-4" /> {t('bitable.open', language)}
              </button>
            )}
            <button
              onClick={() => setShowTraits(true)}
              className="t-btn t-btn-outline px-4 py-2.5 rounded-xl hover:-translate-y-0.5 active:translate-y-0"
            >
              <ClipboardList className="w-4 h-4" /> {t('trait.manage', language)}
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t('acc.new', language)}
            </button>
          </div>
        ) : (
          <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-100 text-blue-700 text-xs font-bold">
            <Cloud className="w-4 h-4" /> GGCE 只读模式 · 数据来自 GGCE Server
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative w-full max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={t('acc.search', language)}
          className="w-full glass-input rounded-xl pl-11 pr-4 py-3 text-sm"
        />
      </div>

      {/* Trait query panel (local mode) */}
      {dsMode === 'local' && (
        <div className="glass-panel rounded-2xl border-white/50">
          <button onClick={() => setShowQuery(!showQuery)} className="w-full px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#2e7d32]" /> {t('acc.query.title', language)}
            </span>
            <span className="flex items-center gap-2">
              {queryActive && (
                <span className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-bold">
                  {t('acc.query.hits', language).replace('{n}', String(queryTotal))}
                </span>
              )}
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showQuery ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {showQuery && (
            <div className="px-4 pb-4 space-y-2 border-t border-gray-100 pt-3">
              {queryRows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.traitCode}
                    onChange={e => {
                      const code = e.target.value;
                      updateQueryRow(i, { traitCode: code, op: code ? (opsFor(traitByCode[code])[0]?.v ?? 'eq') : 'eq', value: '' });
                      loadTraitOptions(code);
                    }}
                    className="glass-input rounded-xl px-3 py-2 text-sm min-w-[160px] flex-1"
                  >
                    <option value="">{t('acc.query.selectTrait', language)}</option>
                    {categories.map(cat => (
                      <optgroup key={cat.code} label={catLabel(cat.code)}>
                        {traits.filter(tr => tr.category === cat.code).map(tr => (
                          <option key={tr.id} value={tr.code}>{tr.code} — {traitLabel(tr)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <select value={row.op} onChange={e => updateQueryRow(i, { op: e.target.value })} className="glass-input rounded-xl px-3 py-2 text-sm">
                    {opsFor(traitByCode[row.traitCode]).map(o => (
                      <option key={o.v} value={o.v}>{language === 'zh' ? o.zh : o.en}</option>
                    ))}
                  </select>
                  {row.op === 'empty' || row.op === 'notempty' ? (
                    <span className="text-xs text-gray-400">{t('acc.query.noValue', language)}</span>
                  ) : traitByCode[row.traitCode]?.valueType === 'scale' ? (
                    <select value={row.value} onChange={e => updateQueryRow(i, { value: e.target.value })} className="glass-input rounded-xl px-3 py-2 text-sm">
                      <option value="">{t('acc.query.selectValue', language)}</option>
                      {Object.entries((traitByCode[row.traitCode]?.scale as Record<string, string>) || {}).map(([k, v]) => (
                        <option key={k} value={k}>{k} · {v}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={row.value ?? ''}
                      onChange={e => updateQueryRow(i, { value: e.target.value })}
                      placeholder={t('acc.query.value', language)}
                      className="glass-input rounded-xl px-3 py-2 text-sm flex-1 min-w-[120px]"
                      list={row.traitCode ? `tv-${row.traitCode}` : undefined}
                    />
                  )}
                  <button onClick={() => removeQueryRow(i)} className="p-2 rounded-lg hover:bg-red-50 text-red-400"><X className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={addQueryRow} className="text-xs font-bold text-[#2e7d32] hover:bg-green-50 rounded-lg px-3 py-2 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> {t('acc.query.add', language)}
                </button>
                <div className="flex-1" />
                <button onClick={clearQuery} className="text-xs font-bold text-gray-400 hover:bg-gray-100 rounded-lg px-3 py-2">{t('acc.query.clear', language)}</button>
                <button onClick={runQuery} className="btn-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                  <Search className="w-3.5 h-3.5" /> {t('acc.query.run', language)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {Object.entries(traitValOptions).map(([code, vals]) => (
        <datalist key={code} id={`tv-${code}`}>
          {vals.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </datalist>
      ))}

      {/* Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border-white/50 flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#2e7d32]" />
          </div>
        ) : accessions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-gray-400">
            <Database className="w-16 h-16 mb-3 opacity-30" />
            <p className="text-sm font-bold">{t('acc.noData', language)}</p>
            <p className="text-xs mt-1">{t('acc.importHint', language)}</p>
          </div>
        ) : (
          <div className="overflow-x-auto flex-1 custom-scrollbar">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">#</th>
                  {tableCols.map(col => {
                    const tr = traitByCode[col];
                    return (
                      <th key={col} className="px-4 py-3 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {gridEdit ? (
                          <span className="flex items-center gap-1">{tr ? traitLabel(tr) : col} {gridEdit && <span className="text-amber-400">✎</span>}</span>
                        ) : tr ? (
                          <span className="flex items-center gap-1 normal-case tracking-normal">{traitLabel(tr)}<TraitInfoIcon trait={tr} catLabel={catLabel(tr.category)} /></span>
                        ) : col}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {accessions.map((acc, i) => (
                  <tr
                    key={acc.id || acc._id || i}
                    onClick={() => { if (!gridEdit) selectAccession(acc); }}
                    className={`border-b border-gray-50 ${gridEdit ? 'cursor-default' : 'cursor-pointer transition-colors hover:bg-green-50/50'} ${selected?.id === acc.id || selected?._id === acc._id ? 'bg-green-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-4 py-3 font-bold text-gray-800">
                      {gridEdit
                        ? <span className="inline-block px-2 py-1.5 text-xs font-bold text-gray-500">{acc.primaryId || acc.primary_id || '-'}</span>
                        : (acc.primaryId || acc.primary_id || '-')}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{gridEdit ? renderGridCell(acc, 'displayName') : (acc.displayName || acc.display_name || '-')}</td>
                    <td className="px-4 py-3">
                      {gridEdit
                        ? renderGridCell(acc, 'species')
                        : (acc.species ? <span className="bg-green-100 text-green-800 text-[11px] px-2 py-0.5 rounded-full font-medium">{acc.species}</span> : <span className="text-gray-300">-</span>)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{gridEdit ? renderGridCell(acc, 'origin') : (acc.origin || '-')}</td>
                    {tableCols.slice(4).map(col => (
                      <td key={col} className="px-4 py-3 text-xs text-gray-500 max-w-[120px] truncate">
                        {gridEdit ? renderGridCell(acc, col) : (acc[col] !== undefined ? String(acc[col]) : '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-white/50">
            <span className="text-xs text-gray-400 font-medium">
              {t('acc.page', language).replace('{p}', String(page)).replace('{t}', String(totalPages))}
            </span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button>
              <button disabled={page >= totalPages} onClick={() => changePage(page + 1)} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {/* v2.9 网格编辑操作条 */}
        {gridEdit && (
          <div className="sticky bottom-0 border-t border-amber-200 bg-amber-50/95 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-xs font-bold text-amber-800 flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {gridDirtyCount > 0
                ? t('acc.gridSave', language).replace('{n}', String(gridDirtyCount))
                : <span className="truncate">{t('acc.gridEditHint', language)}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={exitGrid} className="px-4 py-2 rounded-xl text-xs font-bold border border-gray-300 text-gray-600 hover:bg-white transition-colors">
                {t('acc.gridExit', language)}
              </button>
              <button onClick={saveGrid} disabled={!gridDirtyCount || gridSaving} className="btn-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                <Save className="w-4 h-4" /> {gridSaving ? '...' : t('acc.gridSave', language).replace('{n}', String(gridDirtyCount))}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* v2.15 多维表格（Bitable 形态）：覆盖层 z-[45] < 详情抽屉 z-50 */}
      {showBitable && (
        <BitableEditor
          canEdit={!!user && (user.role === 'admin' || user.user_type === 'approver')}
          onClose={() => setShowBitable(false)}
          onOpenDetail={openBitableDetail}
          onSaved={fetchData}
        />
      )}

      {/* Detail Slide-over */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={closeDetail} />
          <div className="relative w-full max-w-lg bg-white shadow-2xl h-full overflow-y-auto animate-fade-in-up custom-scrollbar">
            <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-black text-gray-800">{t('acc.detail', language)}</h2>
              <div className="flex items-center gap-2">
                {!isEditing ? (
                  <>
                    {dsMode === 'local' && (
                      <>
                        <button onClick={startEdit} className="p-2 rounded-xl hover:bg-green-50 text-[#2e7d32] transition-colors"><Edit3 className="w-5 h-5" /></button>
                        {user?.role === 'admin' && (
                          <button onClick={() => setShowDeleteConfirm(true)} className="p-2 rounded-xl hover:bg-red-50 text-red-400 transition-colors"><Trash2 className="w-5 h-5" /></button>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={saveEdit} disabled={saving} className="btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                      <Save className="w-4 h-4" /> {saving ? '...' : t('common.save', language)}
                    </button>
                    <button onClick={() => setIsEditing(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"><X className="w-5 h-5" /></button>
                  </>
                )}
                <button onClick={closeDetail} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"><X className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Delete confirmation */}
              {showDeleteConfirm && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-800">{t('acc.deleteConfirm', language)}</p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={deleteAccession} className="bg-red-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-red-700">确认删除</button>
                      <button onClick={() => setShowDeleteConfirm(false)} className="bg-white px-4 py-1.5 rounded-lg text-xs font-bold border">{t('common.cancel', language)}</button>
                    </div>
                  </div>
                </div>
              )}

              {isEditing ? (
                buildEditSections(editData).map((sec, si) => {
                  const hasVal = sec.fields.some(f => f.value !== '' && f.value !== undefined);
                  const isBasic = si === 0;
                  return (
                    <details key={si} open={isBasic || hasVal} className="group">
                      <summary className="cursor-pointer list-none flex items-center gap-2">
                        <ChevronDown className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-180 shrink-0" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          {sec.titleKey ? t(sec.titleKey, language) : sec.title}
                        </span>
                        {!isBasic && <span className="text-[10px] text-gray-300 font-bold">{sec.fields.length}</span>}
                      </summary>
                      <div className="space-y-3 pt-3">
                        {sec.fields.map(f => (
                          <div key={f.key}>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{f.label}</label>
                            <input
                              type="text"
                              value={f.value ?? ''}
                              onChange={(e) => handleEditChange(f.key, e.target.value)}
                              className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                              placeholder={f.trait?.scale ? Object.entries(f.trait.scale).map(([k, v]) => `${k}=${v}`).join('  ') : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })
              ) : (
                buildViewSections(selected).map((sec, si) => (
                  <div key={si}>
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <span className="w-1 h-3 bg-[#2e7d32] rounded-full" />
                      {sec.titleKey ? t(sec.titleKey, language) : sec.title}
                    </h3>
                    <div className="space-y-2">
                      {sec.fields.map(f => (
                        <div key={f.key}>
                          <label className="text-[10px] font-bold text-gray-400">{f.label}</label>
                          <p className="text-sm font-medium text-gray-800 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100 break-words">
                            {formatVal(f.value)}
                            {f.trait?.scale && f.trait.scale[String(f.value)] ? (
                              <span className="text-gray-400"> · {f.trait.scale[String(f.value)]}</span>
                            ) : null}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* v2.11：基因组学预留块（链接+元数据模式） */}
              {!isEditing && (
                <div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1 h-3 bg-[#2e7d32] rounded-full" />
                      {t('omics.title', language)}
                    </h3>
                    {(selected as any)?.stockId && (
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded" title={t('omics.stockId', language)}>
                        Breedbase: {(selected as any).stockId}
                      </span>
                    )}
                    {user?.role === 'admin' && dsMode === 'local' && (
                      <button onClick={() => setShowOmicsForm(s => !s)} className="ml-auto px-2.5 py-1 rounded-lg bg-green-50 text-[#2e7d32] text-[10px] font-bold hover:bg-green-100">
                        + {t('omics.add', language)}
                      </button>
                    )}
                  </div>

                  {showOmicsForm && (
                    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3 space-y-2 mb-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select value={omicsForm.category} onChange={e => setOmicsForm(f => ({ ...f, category: e.target.value }))} className="glass-input rounded-lg px-3 py-2 text-xs">
                          {OMICS_CATEGORIES.map(c => <option key={c.v} value={c.v}>{omicsCatLabel(c.v)}</option>)}
                        </select>
                        <input value={omicsForm.title} onChange={e => setOmicsForm(f => ({ ...f, title: e.target.value }))} placeholder={t('omics.titleField', language)} className="glass-input rounded-lg px-3 py-2 text-xs" />
                        <input value={omicsForm.ref} onChange={e => setOmicsForm(f => ({ ...f, ref: e.target.value }))} placeholder={t('omics.ref', language)} className="glass-input rounded-lg px-3 py-2 text-xs" />
                        <input value={omicsForm.url} onChange={e => setOmicsForm(f => ({ ...f, url: e.target.value }))} placeholder={t('omics.url', language)} className="glass-input rounded-lg px-3 py-2 text-xs" />
                      </div>
                      <textarea rows={2} value={omicsForm.notes} onChange={e => setOmicsForm(f => ({ ...f, notes: e.target.value }))} placeholder={t('omics.notes', language)} className="w-full glass-input rounded-lg px-3 py-2 text-xs" />
                      <button onClick={addOmics} className="btn-primary w-full py-2 rounded-lg text-xs font-bold">{t('common.save', language)}</button>
                    </div>
                  )}

                  {omics.length === 0 ? (
                    <p className="text-xs text-gray-300 py-1">{t('omics.empty', language)}</p>
                  ) : (
                    <div className="space-y-2">
                      {omics.map(o => (
                        <div key={o.id} className="flex items-start gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700 shrink-0 mt-0.5">{omicsCatLabel(o.category)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-gray-700 break-words">{o.title}</p>
                            {o.ref && <p className="text-[10px] text-gray-400 break-words">{o.ref}</p>}
                            {o.url && <a href={o.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline break-all">{o.url}</a>}
                            {o.notes && <p className="text-[10px] text-gray-500 break-words">{o.notes}</p>}
                          </div>
                          {user?.role === 'admin' && (
                            <button onClick={() => removeOmics(o.id)} className="p-1 rounded-lg hover:bg-red-50 text-red-400 shrink-0" title={t('common.delete', language)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar animate-scale-in">
            <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-800">{t('acc.new', language)}</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">primaryId *</label>
                <input type="text" value={createData.primaryId || ''} onChange={(e) => setCreateData(p => ({ ...p, primaryId: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">displayName</label>
                <input type="text" value={createData.displayName || ''} onChange={(e) => setCreateData(p => ({ ...p, displayName: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">species</label>
                <input type="text" value={createData.species || ''} onChange={(e) => setCreateData(p => ({ ...p, species: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">origin</label>
                <input type="text" value={createData.origin || ''} onChange={(e) => setCreateData(p => ({ ...p, origin: e.target.value }))} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" />
              </div>

              {/* Trait selector (local mode with registered traits) */}
              {dsMode === 'local' && traits.length > 0 && (
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('trait.select', language)}</label>
                  <div className="flex gap-2">
                    <select
                      value={traitSel}
                      onChange={e => setTraitSel(e.target.value)}
                      className="flex-1 min-w-0 glass-input rounded-xl px-3 py-2.5 text-sm"
                    >
                      <option value="">{t('trait.selectPlaceholder', language)}</option>
                      {categories.map(cat => (
                        <optgroup key={cat.code} label={catLabel(cat.code)}>
                          {traits.filter(tr => tr.category === cat.code).map(tr => (
                            <option key={tr.id} value={tr.code}>{tr.code} — {traitLabel(tr)}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={traitVal}
                      onChange={e => setTraitVal(e.target.value)}
                      placeholder={t('trait.value', language)}
                      className="w-28 glass-input rounded-xl px-3 py-2.5 text-sm"
                    />
                    <button
                      onClick={() => {
                        if (!traitSel) return;
                        setCreateData(p => ({ ...p, [traitSel]: traitVal }));
                        setTraitSel('');
                        setTraitVal('');
                      }}
                      className="btn-primary px-3 rounded-xl text-xs font-bold"
                      title={t('common.add', language)}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                  {Object.keys(createData).filter(k => traitByCode[k]).map(k => (
                    <div key={k} className="flex items-center gap-2 mt-2 bg-gray-50 rounded-lg px-3 py-1.5">
                      <span className="text-[10px] font-mono font-bold text-gray-500">{traitByCode[k].code}</span>
                      <span className="text-xs text-gray-600 flex-1 truncate">{createData[k] || <span className="text-gray-300">—</span>}</span>
                      <button
                        onClick={() => setCreateData(p => { const q = { ...p }; delete q[k]; return q; })}
                        className="text-red-400 hover:text-red-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('acc.customField', language)} key</label>
                <input type="text" value={customFieldKey} onChange={(e) => setCustomFieldKey(e.target.value)} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" placeholder="e.g. biologicalStatus" />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">{t('acc.customField', language)} value</label>
                <input type="text" value={customFieldVal} onChange={(e) => setCustomFieldVal(e.target.value)} className="w-full glass-input rounded-xl px-4 py-2.5 text-sm" placeholder="e.g. Breeding line" />
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={createAccession} disabled={saving} className="btn-primary w-full py-3 rounded-xl font-bold text-sm">
                {saving ? t('common.saving', language) || '创建中...' : t('common.save', language)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trait Manager modal */}
      {showTraits && (
        <TraitManager
          onClose={() => setShowTraits(false)}
          onTraitsChanged={reloadTraits}
        />
      )}

      {/* Batch Edit modal */}
      {showBatchEdit && (
        <BatchEditModal onClose={() => setShowBatchEdit(false)} onDone={() => fetchData()} />
      )}
    </div>
  );
};

export default Accessions;
