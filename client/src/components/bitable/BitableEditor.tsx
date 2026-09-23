// v2.15：多维表格编辑器（Bitable 形态）——服务端筛选/排序/分组 + 窗口化虚拟滚动 + 自由增键。
// 数据规模目标：万级种质 × 千级性状（只传可见列，分页 100/页）。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../api';
import { t } from '../../utils';
import { AlertTriangle, Save, X, Loader2, Plus } from 'lucide-react';
import * as XLSX from 'xlsx';
import BitableGrid from './BitableGrid';
import BitableToolbar from './BitableToolbar';
import {
  BitableColumn, QueryState, RowDensity, DENSITY_H,
  FLAT_PAGE, GROUP_PAGE, MAX_VISIBLE_COLS, EXPORT_CAP,
} from './types';
import { mcpdOf, mcpdHeader, passportCoreFields } from '../../lib/mcpd';
import type { Language } from '../../types';

const VIEW_KEY = 'bitable.view.v1';
const GROUP_NONE = '__none__';

// 服务端管理列/内部列（不可作为自定义键/视图字段）
const RESERVED_KEYS = new Set([
  'id', '_id', 'data_json', 'created_at', 'primary_id', 'display_name',
  'source_upload_id', 'last_modified_at', 'last_modified_by',
  'lastModifiedAt', 'lastModifiedBy', 'sourceUploadId', 'lastSubcultureDate',
  'stockTotal', 'stockForms',
]);
const BASE_ALIAS = new Set(['name', 'primaryId', 'primary_id', 'displayName', 'display_name', 'species', 'speciesName', 'origin']);
const KEY_RE = /^[A-Za-z0-9_]{1,64}$/;

interface ViewCfg {
  columns: string[];
  widths: Record<string, number>;
  density: RowDensity;
  customTypes: Record<string, 'text' | 'number'>;
}

function loadView(): ViewCfg | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || v.v !== 1 || !Array.isArray(v.columns)) return null;
    return {
      columns: v.columns.filter((k: any) => typeof k === 'string'),
      widths: typeof v.widths === 'object' && v.widths ? v.widths : {},
      density: ['compact', 'normal', 'tall'].includes(v.density) ? v.density : 'normal',
      customTypes: typeof v.customTypes === 'object' && v.customTypes ? v.customTypes : {},
    };
  } catch { return null; }
}

interface Props {
  canEdit: boolean;
  onClose: () => void;
  onOpenDetail: (id: string) => void;
  onSaved: () => void;
}

const BitableEditor: React.FC<Props> = ({ canEdit, onClose, onOpenDetail, onSaved }) => {
  const { language } = useApp();

  const [traits, setTraits] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ code: string; zh: string; en: string }[]>([]);
  const [rawFields, setRawFields] = useState<string[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [view, setView] = useState<ViewCfg>(() => loadView() || { columns: [], widths: {}, density: 'normal', customTypes: {} });
  const [viewReady, setViewReady] = useState(() => !!loadView());
  const [query, setQuery] = useState<QueryState>({ keyword: '', filters: [], sort: [], groupBy: null });
  const [reloadKey, setReloadKey] = useState(0);

  const [pages, setPages] = useState<Map<number, any[]>>(() => new Map());
  const [libTotal, setLibTotal] = useState(0);
  const [libGroups, setLibGroups] = useState<{ field: string; truncated: boolean; items: { value: string | null; count: number }[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupPages, setGroupPages] = useState<Map<string, { rows: any[]; page: number; total: number }>>(new Map());

  const [dirty, setDirty] = useState<Map<string, Map<string, string | null>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAll, setSelectionAll] = useState(false);
  const [qualityHighlight, setQualityHighlight] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMcpd, setExportMcpd] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [, setTick] = useState(0);

  const versionRef = useRef(0);
  const inFlightRef = useRef<Set<number>>(new Set());
  const groupInFlight = useRef<Set<string>>(new Set());
  // 去重标记（同步维护；行对象一律从 state 读取，避免 ref 镜像滞后导致的对象身份漂移）
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const loadedGroupRef = useRef<Map<string, { page: number; count: number; total: number }>>(new Map());

  // ---- 初始元数据 ----
  useEffect(() => {
    Promise.all([
      api.getTraits().then(r => { setTraits(r.traits || []); setCategories(r.categories || []); }),
      api.getAccessionFields().then(r => setRawFields(r.fields || [])),
    ]).then(() => setDataLoaded(true)).catch(() => setDataLoaded(true));
  }, []);

  const traitByCode = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tr of traits) m[tr.code] = tr;
    return m;
  }, [traits]);

  const rawCustom = useMemo(
    () => rawFields.filter(k => !RESERVED_KEYS.has(k) && !traitByCode[k] && !BASE_ALIAS.has(k)),
    [rawFields, traitByCode],
  );
  const customFields = useMemo(() => {
    const s = new Set<string>([...rawCustom, ...Object.keys(view.customTypes)]);
    return [...s].filter(k => !RESERVED_KEYS.has(k) && !traitByCode[k] && !BASE_ALIAS.has(k));
  }, [rawCustom, view.customTypes, traitByCode]);

  const traitLabel = useCallback((tr: any) => language === 'zh' ? (tr.nameZh || tr.nameEn || tr.code) : (tr.nameEn || tr.nameZh || tr.code), [language]);

  const allColumns: BitableColumn[] = useMemo(() => {
    const base: BitableColumn[] = [
      { key: 'primaryId', kind: 'base', type: 'text', readonly: true, label: t('bitable.base.primaryId', language) },
      { key: 'displayName', kind: 'base', type: 'text', label: t('bitable.base.displayName', language) },
      { key: 'species', kind: 'base', type: 'text', label: t('bitable.base.species', language) },
      { key: 'origin', kind: 'base', type: 'text', label: t('bitable.base.origin', language) },
    ];
    const traitCols: BitableColumn[] = traits.map(tr => ({
      key: tr.code, kind: 'trait', type: tr.valueType, label: traitLabel(tr),
      scale: tr.scale || null, traitId: tr.id, category: tr.category, nameZh: tr.nameZh, nameEn: tr.nameEn,
    }));
    const customCols: BitableColumn[] = customFields.map(k => ({
      key: k, kind: 'custom', type: view.customTypes[k] || 'text', label: k,
    }));
    const stockCols: BitableColumn[] = [
      { key: 'stockTotal', kind: 'stock', type: 'number', readonly: true, label: t('bitable.stockTotal', language) },
      { key: 'stockForms', kind: 'stock', type: 'text', readonly: true, label: t('bitable.stockForms', language) },
    ];
    return [...base, ...traitCols, ...customCols, ...stockCols];
  }, [traits, customFields, view.customTypes, language, traitLabel]);

  const colByKey = useMemo(() => {
    const m: Record<string, BitableColumn> = {};
    for (const c of allColumns) m[c.key] = c;
    return m;
  }, [allColumns]);

  // 首启默认视图：基础 4 列 + 自定义键 + 前 8 个性状
  useEffect(() => {
    if (viewReady || !dataLoaded) return;
    const defs = [
      'primaryId', 'displayName', 'species', 'origin',
      ...customFields,
      ...traits.slice(0, 8).map(tr => tr.code),
    ];
    setView(v => ({ ...v, columns: [...new Set(defs)].slice(0, MAX_VISIBLE_COLS) }));
    setViewReady(true);
  }, [viewReady, dataLoaded, customFields, traits]);

  // 视图配置持久化
  useEffect(() => {
    if (!viewReady) return;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ v: 1, ...view })); } catch { /* 忽略配额错误 */ }
  }, [view, viewReady]);

  const columnsPayload = useMemo(
    () => view.columns.filter(k => colByKey[k] && !['primaryId', 'displayName', 'species', 'origin'].includes(k)),
    [view.columns, colByKey],
  );

  const sendableFilters = useMemo(
    () => query.filters.filter(f => {
      if (f.op === 'anyempty' || f.op === 'notanyempty') return !!(f.fields && f.fields.length);
      if (!f.field) return false;
      if (f.op === 'empty' || f.op === 'notempty') return true;
      return String(f.value ?? '').trim() !== '';
    }),
    [query.filters],
  );

  const payloadBase = useCallback(() => ({
    keyword: query.keyword || undefined,
    filters: sendableFilters,
    sort: query.sort,
    columns: columnsPayload,
    fieldTypes: view.customTypes,
  }), [query.keyword, query.sort, sendableFilters, columnsPayload, view.customTypes]);

  // ---- 取数 ----
  const fetchPage = useCallback(async (p: number) => {
    const v = versionRef.current;
    if (loadedPagesRef.current.has(p) || inFlightRef.current.has(p)) return;
    inFlightRef.current.add(p);
    try {
      const res = await api.bitableQuery({ ...payloadBase(), page: p, limit: FLAT_PAGE });
      if (v !== versionRef.current) return;
      loadedPagesRef.current.add(p);
      setPages(prev => { const n = new Map(prev); n.set(p, res.rows); return n; });
      setLibTotal(res.total);
      setTick(x => x + 1);
    } catch (e) {
      console.error('bitable fetch failed', e);
    } finally {
      inFlightRef.current.delete(p);
    }
  }, [payloadBase]);

  const fetchGroups = useCallback(async () => {
    const v = versionRef.current;
    const gb = query.groupBy;
    if (!gb) return;
    try {
      const res = await api.bitableQuery({ ...payloadBase(), groupBy: gb, page: 1, limit: 1 });
      if (v !== versionRef.current) return;
      setLibGroups(res.groups || { field: gb, truncated: false, items: [] });
      setLibTotal(res.total);
      setTick(x => x + 1);
    } catch (e) {
      console.error('bitable groups failed', e);
    }
  }, [payloadBase, query.groupBy]);

  const loadGroup = useCallback(async (gkey: string) => {
    const v = versionRef.current;
    const gb = query.groupBy;
    if (!gb || groupInFlight.current.has(gkey)) return;
    const lr = loadedGroupRef.current.get(gkey);
    if (lr && lr.count >= lr.total) return;
    const nextPage = (lr?.page || 0) + 1;
    groupInFlight.current.add(gkey);
    try {
      const cond = gkey === GROUP_NONE
        ? { field: gb, op: 'empty', value: '' }
        : { field: gb, op: 'eq', value: gkey };
      const res = await api.bitableQuery({
        ...payloadBase(),
        filters: [...sendableFilters, cond],
        page: nextPage, limit: GROUP_PAGE,
      });
      if (v !== versionRef.current) return;
      loadedGroupRef.current.set(gkey, {
        page: nextPage,
        count: (lr?.count || 0) + res.rows.length,
        total: res.total,
      });
      setGroupPages(prev => {
        const n = new Map(prev);
        const old = n.get(gkey);
        const rows = old && nextPage > 1 ? [...old.rows, ...res.rows] : res.rows;
        n.set(gkey, { rows, page: nextPage, total: res.total });
        return n;
      });
      setTick(x => x + 1);
    } catch (e) {
      console.error('bitable group fetch failed', e);
    } finally {
      groupInFlight.current.delete(gkey);
    }
  }, [payloadBase, query.groupBy, sendableFilters]);

  // 查询/列/重载变化 → 清缓存重取
  // 注意：pagesRef/groupPagesRef 必须同步清空——若只 setState，fetchPage 内的
  // 「已缓存则跳过」会命中旧 ref 而跳过取数，而 total 已清零 → 表格空白。
  const queryKey = JSON.stringify({ q: query, cols: columnsPayload, r: reloadKey });
  useEffect(() => {
    versionRef.current++;
    inFlightRef.current = new Set();
    groupInFlight.current = new Set();
    loadedPagesRef.current = new Set();
    loadedGroupRef.current = new Map();
    setPages(new Map());
    setGroupPages(new Map());
    setLibGroups(null);
    setCollapsed(new Set());
    setLibTotal(0);
    if (query.groupBy) fetchGroups();
    else fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // 分组展开首屏：前 5 组自动加载
  useEffect(() => {
    if (!libGroups) return;
    libGroups.items.slice(0, 5).forEach(g => {
      const gkey = g.value === null || g.value === '' ? GROUP_NONE : g.value;
      loadGroup(gkey);
    });
  }, [libGroups, loadGroup]);

  const getRow = useCallback((i: number) => {
    const p = Math.floor(i / FLAT_PAGE) + 1;
    return pages.get(p)?.[i % FLAT_PAGE];
  }, [pages]);

  const onNeedRange = useCallback((start: number, end: number) => {
    if (query.groupBy) return;
    for (let p = Math.floor(start / FLAT_PAGE) + 1; p <= Math.floor((end - 1) / FLAT_PAGE) + 1; p++) fetchPage(p);
  }, [query.groupBy, fetchPage]);

  // ---- 脏格 ----
  const pidOf = (row: any) => String(row?.primaryId ?? row?.primary_id ?? '');
  const origVal = (row: any, key: string): string => {
    const v = row?.[key];
    return v === null || v === undefined ? '' : String(v);
  };
  const cellValue = useCallback((row: any, key: string): string => {
    const cells = dirty.get(pidOf(row));
    if (cells?.has(key)) { const v = cells.get(key); return v === null ? '' : v; }
    return origVal(row, key);
  }, [dirty]);
  const cellDirty = useCallback((row: any, key: string): boolean => !!dirty.get(pidOf(row))?.has(key), [dirty]);

  const setCell = useCallback((row: any, key: string, raw: string) => {
    const col = colByKey[key];
    if (!col || col.readonly || !canEdit) return;
    const pid = pidOf(row);
    const orig = origVal(row, key);
    const target = raw === '' ? null : raw;
    setDirty(prev => {
      const n = new Map(prev);
      const cells = new Map(n.get(pid) || []);
      if ((target === null && orig === '') || (target !== null && target === orig)) cells.delete(key);
      else cells.set(key, target);
      if (cells.size === 0) n.delete(pid); else n.set(pid, cells);
      return n;
    });
  }, [dirty, colByKey, canEdit]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const cells of dirty.values()) n += cells.size;
    return n;
  }, [dirty]);

  const saveAll = async () => {
    if (!canEdit || !dirtyCount || saving) return;
    if (!window.confirm(t('bitable.confirmSave', language).replace('{n}', String(dirtyCount)))) return;
    setSaving(true);
    try {
      const rows = [...dirty.entries()].map(([pid, cells]) => ({ primaryId: pid, updates: Object.fromEntries(cells) }));
      const res = await api.batchUpdateAccessions({ rows, mode: 'replace', allowCustomKeys: true });
      const parts: string[] = [];
      if (res.notFound?.length) parts.push(`${t('bitable.notFoundRows', language)}: ${res.notFound.length}`);
      if (res.failed?.length) parts.push(`${t('bitable.failedRows', language)}: ${res.failed.length}`);
      alert(t('bitable.saved', language).replace('{n}', String(res.updated?.length || 0)) + (parts.length ? ' — ' + parts.join(' · ') : ''));
      setDirty(new Map());
      setReloadKey(x => x + 1);
      onSaved();
      api.getAccessionFields().then(r => setRawFields(r.fields || [])).catch(() => {});
    } catch (e: any) {
      alert(t('bitable.saveFailed', language) + ' ' + e.message);
    }
    setSaving(false);
  };

  const requestClose = () => {
    if (dirtyCount && !window.confirm(t('bitable.discardConfirm', language))) return;
    onClose();
  };

  // ---- 列操作 ----
  const toggleVisible = (key: string) => {
    if (view.columns.includes(key)) {
      if (key === 'primaryId') return;
      setView(v => ({ ...v, columns: v.columns.filter(k => k !== key) }));
    } else {
      if (view.columns.length >= MAX_VISIBLE_COLS) { alert(t('bitable.fieldsCap', language)); return; }
      setView(v => ({ ...v, columns: [...v.columns, key] }));
    }
  };
  const moveColumn = (key: string, dir: -1 | 1) => {
    setView(v => {
      const arr = [...v.columns];
      const i = arr.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return v;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...v, columns: arr };
    });
  };
  const resizeCol = useCallback((key: string, w: number) => {
    setView(v => ({ ...v, widths: { ...v.widths, [key]: Math.round(w) } }));
  }, []);

  const renameTrait = async (traitId: string, nameZh: string, nameEn: string) => {
    try {
      await api.updateTrait(traitId, { nameZh, nameEn });
      const r = await api.getTraits();
      setTraits(r.traits || []);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const createTraitField = async (payload: any) => {
    await api.createTrait(payload);
    const r = await api.getTraits();
    setTraits(r.traits || []);
    setCategories(r.categories || []);
    if (!view.columns.includes(payload.code)) {
      setView(v => v.columns.length >= MAX_VISIBLE_COLS ? v : { ...v, columns: [...v.columns, payload.code] });
    }
  };
  const createCustomField = (key: string, type: 'text' | 'number') => {
    setView(v => ({
      ...v,
      customTypes: { ...v.customTypes, [key]: type },
      columns: v.columns.includes(key) || v.columns.length >= MAX_VISIBLE_COLS ? v.columns : [...v.columns, key],
    }));
  };

  // ---- 导出 ----
  const exportCols = useMemo(() => view.columns.filter(k => colByKey[k]).map(k => colByKey[k]), [view.columns, colByKey]);

  const exportView = async (which: 'all' | 'selected') => {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: any[] = [];
      if (which === 'all' || selectionAll) {
        let page = 1;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const res = await api.bitableQuery({ ...payloadBase(), page, limit: 500 });
          rows.push(...res.rows);
          if (!res.rows.length || rows.length >= res.total || rows.length >= EXPORT_CAP) break;
          page++;
        }
      } else {
        const pids = [...selected];
        for (let i = 0; i < pids.length; i += 200) {
          const chunk = pids.slice(i, i + 200);
          let page = 1;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const res = await api.bitableQuery({
              columns: columnsPayload, fieldTypes: view.customTypes,
              filters: [{ field: 'primaryId', op: 'in', value: chunk.join(',') }],
              page, limit: 500,
            });
            rows.push(...res.rows);
            if (res.rows.length < 500 || page * 500 >= res.total) break;
            page++;
          }
        }
      }
      const headers = exportCols.map(c => exportMcpd ? mcpdHeader(c.key, { [c.key]: c.label }) : c.label);
      const aoa = [headers, ...rows.map(r => exportCols.map(c => {
        const v = r[c.key];
        return v === null || v === undefined ? '' : v;
      }))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Germplasm');
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `BRC-bitable-${ts}-${which}.xlsx`);
    } catch (e: any) {
      alert(e.message);
    }
    setExporting(false);
  };

  // ---- 选择 ----
  const toggleSelect = (pid: string) => {
    if (selectionAll) setSelectionAll(false);
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(pid)) n.delete(pid); else n.add(pid);
      return n;
    });
  };
  const loadedRows = useMemo(() => [...pages.values()].flat(), [pages]);
  const allLoadedSelected = useMemo(
    () => loadedRows.length > 0 && loadedRows.every(r => selected.has(pidOf(r))),
    [loadedRows, selected],
  );
  const toggleSelectAll = () => {
    if (selectionAll) { setSelectionAll(false); setSelected(new Set()); return; }
    if (allLoadedSelected) { setSelected(new Set()); return; }
    setSelected(new Set(loadedRows.map(pidOf)));
  };
  const clearSelection = () => { setSelected(new Set()); setSelectionAll(false); };

  // ---- 质量 ----
  const knownFieldKeys = useMemo(() => allColumns.map(c => c.key), [allColumns]);
  const coreFields = useMemo(() => passportCoreFields(knownFieldKeys), [knownFieldKeys]);
  const qualityPresets = useMemo(() => {
    const presets: { key: string; label: string; fields: string[] }[] = [];
    const core = passportCoreFields(knownFieldKeys);
    if (core.length) presets.push({ key: 'passport', label: t('bitable.quality.passport', language), fields: core });
    const find = (mcpd: string) => knownFieldKeys.filter(k => mcpdOf(k)?.mcpd === mcpd);
    const geo = [...find('DECLATITUDE'), ...find('DECLONGITUDE')];
    if (geo.length) presets.push({ key: 'geo', label: t('bitable.quality.geo', language), fields: geo });
    const cd = find('COLLDATE');
    if (cd.length) presets.push({ key: 'colldate', label: t('bitable.quality.colldate', language), fields: cd });
    const ss = find('SAMPSTAT');
    if (ss.length) presets.push({ key: 'sampstat', label: t('bitable.quality.sampstat', language), fields: ss });
    return presets;
  }, [knownFieldKeys, language]);

  // ---- 网格回调 ----
  const gridSort = useCallback((field: string, dir: 'asc' | 'desc') => {
    setQuery(q => ({ ...q, sort: [{ field, dir }, ...q.sort.filter(s => s.field !== field)].slice(0, 3) }));
  }, []);
  const gridFilterBy = useCallback((key: string) => {
    setQuery(q => ({ ...q, filters: [...q.filters, { field: key, op: colByKey[key]?.type === 'number' ? 'eq' : 'contains', value: '' }] }));
  }, [colByKey]);
  const toggleGroup = (gkey: string) => {
    const wasCollapsed = collapsed.has(gkey);
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(gkey)) n.delete(gkey); else n.add(gkey);
      return n;
    });
    if (wasCollapsed) loadGroup(gkey);   // 展开时补载（loadGroup 内部自带去重）
  };
  const groupRowsOf = useCallback((gkey: string) => {
    const g = groupPages.get(gkey);
    return { rows: g?.rows || [], loaded: !!g };
  }, [groupPages]);

  return (
    <div className="fixed inset-0 z-[45] flex flex-col" style={{ background: 'var(--t-page-bg)' }} data-testid="bitable-root">
      <BitableToolbar
        canEdit={canEdit}
        total={libTotal}
        selectedCount={selected.size}
        selectionAll={selectionAll}
        onClearSelection={clearSelection}
        onSelectAllMatching={() => { setSelectionAll(true); setSelected(new Set()); }}
        query={query}
        onQueryChange={patch => setQuery(q => ({ ...q, ...patch }))}
        onKeyword={kw => setQuery(q => ({ ...q, keyword: kw }))}
        allColumns={allColumns}
        visibleKeys={view.columns.filter(k => colByKey[k])}
        onToggleVisible={toggleVisible}
        onMoveColumn={moveColumn}
        density={view.density}
        onDensity={d => setView(v => ({ ...v, density: d }))}
        qualityHighlight={qualityHighlight}
        onQualityHighlight={setQualityHighlight}
        qualityPresets={qualityPresets}
        exportMcpd={exportMcpd}
        onExportMcpd={setExportMcpd}
        onExport={exportView}
        exporting={exporting}
        dirtyCount={dirtyCount}
        onAddField={() => setAddFieldOpen(true)}
        onClose={requestClose}
      />
      <BitableGrid
        canEdit={canEdit}
        columns={view.columns.filter(k => colByKey[k]).map(k => colByKey[k])}
        densityH={DENSITY_H[view.density]}
        total={libTotal}
        getRow={getRow}
        onNeedRange={onNeedRange}
        cellValue={cellValue}
        cellDirty={cellDirty}
        onCellChange={setCell}
        selected={selected}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        allLoadedSelected={allLoadedSelected}
        onOpenDetail={onOpenDetail}
        onSort={gridSort}
        onHide={key => { if (key !== 'primaryId') setView(v => ({ ...v, columns: v.columns.filter(k => k !== key) })); }}
        onFilterBy={gridFilterBy}
        onRenameTrait={renameTrait}
        widths={view.widths}
        onResize={resizeCol}
        groups={query.groupBy ? libGroups : null}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        groupRows={groupRowsOf}
        onLoadMoreGroup={gkey => loadGroup(gkey)}
        qualityHighlight={qualityHighlight}
        coreFields={coreFields}
        onAddField={() => setAddFieldOpen(true)}
      />
      {/* 底部保存条 */}
      {canEdit && dirtyCount > 0 && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-warn-bg)' }}>
          <div className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--t-warn-fg)' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {t('bitable.unsaved', language).replace('{n}', String(dirtyCount))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { if (window.confirm(t('bitable.discardConfirm', language))) setDirty(new Map()); }}
              data-testid="bt-discard"
              className="bt-ghost px-3 py-1.5 rounded text-xs font-bold border text-[var(--t-text-soft)] hover:bg-[var(--t-table-hover)] transition-colors"
              style={{ borderColor: 'var(--t-divider)' }}>
              {t('bitable.discard', language)}
            </button>
            <button onClick={saveAll} disabled={saving} data-testid="bt-save"
              className="btn-primary px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? t('bitable.saving', language) : t('bitable.save', language).replace('{n}', String(dirtyCount))}
            </button>
          </div>
        </div>
      )}
      {addFieldOpen && (
        <NewFieldModal
          existingKeys={knownFieldKeys}
          categories={categories}
          language={language}
          onClose={() => setAddFieldOpen(false)}
          onCustom={createCustomField}
          onTrait={createTraitField}
        />
      )}
    </div>
  );
};

// ---- 新增字段弹窗 ----
const NewFieldModal: React.FC<{
  existingKeys: string[];
  categories: { code: string; zh: string; en: string }[];
  language: Language;
  onClose: () => void;
  onCustom: (key: string, type: 'text' | 'number') => void;
  onTrait: (payload: any) => Promise<void>;
}> = ({ existingKeys, categories, language, onClose, onCustom, onTrait }) => {
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<'trait' | 'custom'>('trait');
  const [nameZh, setNameZh] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [category, setCategory] = useState('other');
  const [valueType, setValueType] = useState<'text' | 'number' | 'scale'>('text');
  const [unit, setUnit] = useState('');
  const [options, setOptions] = useState<{ k: string; v: string }[]>([{ k: '', v: '' }, { k: '', v: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    const k = key.trim();
    if (!KEY_RE.test(k)) { setError(t('bitable.keyInvalid', language)); return; }
    if (existingKeys.includes(k) || RESERVED_KEYS.has(k)) { setError(t('bitable.keyDup', language)); return; }
    if (mode === 'custom') {
      onCustom(k, valueType === 'number' ? 'number' : 'text');
      alert(t('bitable.created', language));
      onClose();
      return;
    }
    if (!nameZh.trim() && !nameEn.trim()) { setError(t('bitable.nameRequired', language)); return; }
    const scale = valueType === 'scale'
      ? Object.fromEntries(options.filter(o => o.k.trim() && o.v.trim()).map(o => [o.k.trim(), o.v.trim()]))
      : undefined;
    if (valueType === 'scale' && (!scale || !Object.keys(scale).length)) { setError(t('bitable.optionsRequired', language)); return; }
    setBusy(true);
    try {
      await onTrait({
        code: k, nameZh: nameZh.trim(), nameEn: nameEn.trim(), category,
        valueType, unit: unit.trim() || undefined, scale,
      });
      onClose();
    } catch (e: any) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[88vh] overflow-auto shadow-2xl p-5"
        style={{ background: 'var(--t-card-bg)', borderRadius: 'var(--t-card-radius)' }} data-testid="bt-add-field-dialog">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black">{t('bitable.addFieldTitle', language)}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--t-table-hover)]"><X className="w-4 h-4" /></button>
        </div>
        <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.fieldKey', language)}</label>
        <input value={key} onChange={e => setKey(e.target.value)} data-testid="bt-nf-key"
          placeholder={t('bitable.fieldKeyHint', language)}
          className="w-full mb-3 px-3 py-2 text-sm border rounded-lg font-mono" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
        <div className="flex gap-2 mb-3">
          <button type="button" data-testid="bt-nf-mode-trait" onClick={() => setMode('trait')}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${mode === 'trait' ? 'bg-[var(--t-pill-muted-bg)]' : ''}`}
            style={{ borderColor: 'var(--t-divider)' }}>
            {t('bitable.registerAsTrait', language)}
          </button>
          <button type="button" data-testid="bt-nf-mode-custom" onClick={() => { setMode('custom'); if (valueType === 'scale') setValueType('text'); }}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${mode === 'custom' ? 'bg-[var(--t-pill-muted-bg)]' : ''}`}
            style={{ borderColor: 'var(--t-divider)' }}>
            {t('bitable.customMode', language)}
          </button>
        </div>
        <p className="text-[10px] opacity-50 mb-3">{mode === 'trait' ? t('bitable.registerAsTraitHint', language) : t('bitable.customKeyHint', language)}</p>
        {mode === 'trait' && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.nameZh', language)}</label>
                <input value={nameZh} onChange={e => setNameZh(e.target.value)} data-testid="bt-nf-zh"
                  className="w-full px-3 py-2 text-sm border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.nameEn', language)}</label>
                <input value={nameEn} onChange={e => setNameEn(e.target.value)} data-testid="bt-nf-en"
                  className="w-full px-3 py-2 text-sm border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.category', language)}</label>
                <select value={category} onChange={e => setCategory(e.target.value)} data-testid="bt-nf-category"
                  className="w-full px-2 py-2 text-sm border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }}>
                  {categories.map(c => <option key={c.code} value={c.code}>{language === 'zh' ? c.zh : c.en}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.fieldType', language)}</label>
                <select value={valueType} onChange={e => setValueType(e.target.value as any)} data-testid="bt-nf-type"
                  className="w-full px-2 py-2 text-sm border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }}>
                  <option value="text">{t('bitable.typeText', language)}</option>
                  <option value="number">{t('bitable.typeNumber', language)}</option>
                  <option value="scale">{t('bitable.typeScale', language)}</option>
                </select>
              </div>
            </div>
          </>
        )}
        {mode === 'custom' && (
          <div className="mb-3">
            <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.fieldType', language)}</label>
            <select value={valueType} onChange={e => setValueType(e.target.value as any)} data-testid="bt-nf-type"
              className="w-1/2 px-2 py-2 text-sm border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }}>
              <option value="text">{t('bitable.typeText', language)}</option>
              <option value="number">{t('bitable.typeNumber', language)}</option>
            </select>
          </div>
        )}
        {mode === 'trait' && valueType === 'number' && (
          <div className="mb-3">
            <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.unit', language)}</label>
            <input value={unit} onChange={e => setUnit(e.target.value)}
              className="w-1/2 px-3 py-2 text-sm border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
          </div>
        )}
        {mode === 'trait' && valueType === 'scale' && (
          <div className="mb-3">
            <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">{t('bitable.optionsLabel', language)}</label>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input value={o.k} placeholder={t('bitable.optionKey', language)} data-testid={`bt-nf-opt-k-${i}`}
                  onChange={e => setOptions(prev => prev.map((x, j) => j === i ? { ...x, k: e.target.value } : x))}
                  className="w-20 px-2 py-1.5 text-xs border rounded-lg font-mono" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
                <input value={o.v} placeholder={t('bitable.optionLabel', language)} data-testid={`bt-nf-opt-v-${i}`}
                  onChange={e => setOptions(prev => prev.map((x, j) => j === i ? { ...x, v: e.target.value } : x))}
                  className="flex-1 px-2 py-1.5 text-xs border rounded-lg" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
              </div>
            ))}
            <button type="button" onClick={() => setOptions(prev => [...prev, { k: '', v: '' }])}
              className="text-[11px] font-bold opacity-60 hover:opacity-100 flex items-center gap-1 mt-1">
              <Plus className="w-3 h-3" />{t('bitable.addOption', language)}
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold border" style={{ borderColor: 'var(--t-divider)' }}>
            {t('common.cancel', language)}
          </button>
          <button onClick={submit} disabled={busy} data-testid="bt-nf-submit"
            className="btn-primary px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{t('bitable.create', language)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BitableEditor;
