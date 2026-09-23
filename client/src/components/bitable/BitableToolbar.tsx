// v2.16：多维表格工具栏——飞书形态三行结构（视图标签栏/幽灵工具栏/条件 chips）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { t } from '../../utils';
import {
  Search, Filter, ArrowUpDown, Layers, Rows3, Columns3, ClipboardCheck, Download,
  X, Plus, ChevronLeft, ChevronRight, ChevronDown, Lock, Check, ArrowUp, ArrowDown, Table2,
} from 'lucide-react';
import {
  BitableColumn, BitableFilter, BitableSort, QueryState, RowDensity,
  DENSITY_H, MAX_VISIBLE_COLS, opLabelOf, opsForColumn,
} from './types';
import { mcpdOf, VOCABS } from '../../lib/mcpd';
import type { Language } from '../../types';

export interface QualityPreset { key: string; label: string; fields: string[] }

interface Props {
  canEdit: boolean;
  total: number;
  selectedCount: number;
  selectionAll: boolean;
  onClearSelection: () => void;
  onSelectAllMatching: () => void;
  query: QueryState;
  onQueryChange: (patch: Partial<QueryState>) => void;
  onKeyword: (kw: string) => void;
  allColumns: BitableColumn[];
  visibleKeys: string[];
  onToggleVisible: (key: string) => void;
  onMoveColumn: (key: string, dir: -1 | 1) => void;
  density: RowDensity;
  onDensity: (d: RowDensity) => void;
  qualityHighlight: boolean;
  onQualityHighlight: (b: boolean) => void;
  qualityPresets: QualityPreset[];
  exportMcpd: boolean;
  onExportMcpd: (b: boolean) => void;
  onExport: (which: 'all' | 'selected') => void;
  exporting: boolean;
  dirtyCount: number;
  onAddField: () => void;
  onClose: () => void;
}

type PanelKey = 'filter' | 'sort' | 'group' | 'density' | 'fields' | 'quality' | 'export' | null;

// ---- 可搜索字段选择器（上千字段不可用原生 select） ----
const FieldPicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
  columns: BitableColumn[];
  placeholder?: string;
  testId?: string;
}> = ({ value, onChange, columns, placeholder, testId }) => {
  const { language } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const cur = columns.find(c => c.key === value);
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const filtered = kw
      ? columns.filter(c => c.label.toLowerCase().includes(kw) || c.key.toLowerCase().includes(kw))
      : columns;
    return filtered.slice(0, 200);
  }, [columns, q]);
  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button type="button" data-testid={testId}
        onClick={() => { setOpen(o => !o); setQ(''); }}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-xs border rounded text-left"
        style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }}>
        <span className="truncate">{cur ? cur.label : (placeholder || '—')}</span>
        <span className="flex-1" />
        <ChevronRight className={`w-3 h-3 opacity-50 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-[70] top-full left-0 mt-1 w-64 max-h-72 overflow-auto rounded-md border shadow-lg"
          style={{ background: 'var(--t-card-bg)', borderColor: 'var(--t-divider)' }}>
          <div className="p-1.5 sticky top-0" style={{ background: 'var(--t-card-bg)' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('bitable.fieldsSearchBox', language)}
              className="w-full px-2 py-1 text-xs border rounded" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }} />
          </div>
          {list.map(c => {
            const m = mcpdOf(c.key);
            return (
              <button key={c.key} type="button" data-pick={c.key}
                onClick={() => { onChange(c.key); setOpen(false); }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-[var(--t-table-hover)]">
                <span className="truncate">{c.label}</span>
                <span className="text-[9px] opacity-50 font-mono truncate">{c.kind === 'base' ? '' : c.key}</span>
                {m && <span className="px-1 rounded-sm text-[8px] font-black shrink-0" style={{ background: 'var(--t-warn-bg)', color: 'var(--t-warn-fg)' }}>MCPD</span>}
                {cur?.key === c.key && <Check className="w-3 h-3 shrink-0" />}
              </button>
            );
          })}
          {!list.length && <p className="px-3 py-2 text-xs opacity-50">—</p>}
        </div>
      )}
    </div>
  );
};

const BitableToolbar: React.FC<Props> = (props) => {
  const { language } = useApp();
  const {
    canEdit, total, selectedCount, selectionAll, onClearSelection, onSelectAllMatching,
    query, onQueryChange, onKeyword, allColumns, visibleKeys, onToggleVisible, onMoveColumn,
    density, onDensity, qualityHighlight, onQualityHighlight, qualityPresets,
    exportMcpd, onExportMcpd, onExport, exporting, dirtyCount, onAddField, onClose,
  } = props;

  const [panel, setPanel] = useState<PanelKey>(null);
  const [kw, setKw] = useState(query.keyword);
  const kwTimer = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panel) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.bt-panel') && !el.closest('.bt-panel-btn')) setPanel(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [panel]);

  const colByKey = useMemo(() => {
    const m: Record<string, BitableColumn> = {};
    for (const c of allColumns) m[c.key] = c;
    return m;
  }, [allColumns]);

  const onKwChange = (v: string) => {
    setKw(v);
    if (kwTimer.current) window.clearTimeout(kwTimer.current);
    kwTimer.current = window.setTimeout(() => onKeyword(v), 300);
  };

  const toggleBtn = (key: PanelKey, icon: React.ReactNode, label: string, badge?: number, align: 'left' | 'right' = 'left', testId?: string) => (
    <div className="relative">
      <button type="button" data-testid={testId}
        onClick={() => setPanel(panel === key ? null : key)}
        className={`bt-panel-btn bt-ghost flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${panel === key ? 'bg-[var(--t-pill-muted-bg)] text-[var(--t-text)]' : 'text-[var(--t-text-soft)] hover:bg-[var(--t-table-hover)]'}`}>
        {icon}{label}
        {badge !== undefined && badge > 0 && (
          <span className="px-1 rounded-full text-[10px] font-black" style={{ background: 'var(--t-accent)', color: 'var(--t-accent-text)' }}>{badge}</span>
        )}
      </button>
      {panel === key && (
        <div className={`bt-panel absolute z-[60] top-full mt-1 w-[400px] max-w-[92vw] rounded-md border shadow-lg p-3 ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ background: 'var(--t-card-bg)', borderColor: 'var(--t-divider)' }} data-testid={`bt-panel-${key}`}>
          {key === 'filter' && <FilterPanel query={query} onQueryChange={onQueryChange} columns={allColumns} />}
          {key === 'sort' && <SortPanel query={query} onQueryChange={onQueryChange} columns={allColumns} />}
          {key === 'group' && <GroupPanel query={query} onQueryChange={onQueryChange} columns={allColumns} />}
          {key === 'density' && (
            <div className="space-y-1">
              {(['compact', 'normal', 'tall'] as RowDensity[]).map(d => (
                <button key={d} type="button" onClick={() => onDensity(d)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-bold hover:bg-[var(--t-table-hover)] ${density === d ? 'bg-[var(--t-table-hover)]' : ''}`}
                  data-testid={`bt-density-${d}`}>
                  <span>{t(`bitable.density.${d}`, language)}</span>
                  <span className="opacity-50">{DENSITY_H[d]}px</span>
                </button>
              ))}
            </div>
          )}
          {key === 'fields' && (
            <FieldsPanel columns={allColumns} visibleKeys={visibleKeys} onToggleVisible={onToggleVisible} onMoveColumn={onMoveColumn} language={language} />
          )}
          {key === 'quality' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                <input type="checkbox" checked={qualityHighlight} onChange={e => onQualityHighlight(e.target.checked)} data-testid="bt-quality-highlight" />
                {t('bitable.qualityHighlight', language)}
              </label>
              <div className="border-t pt-2 space-y-1" style={{ borderColor: 'var(--t-divider)' }}>
                {qualityPresets.map(p => (
                  <button key={p.key} type="button" data-testid={`bt-quality-${p.key}`}
                    onClick={() => onQueryChange({ filters: [...query.filters, { op: 'anyempty', fields: p.fields, labelKey: `bitable.quality.${p.key}` }] })}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-bold hover:bg-[var(--t-table-hover)] text-left">
                    <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />{p.label}
                    <span className="text-[9px] opacity-50 truncate">({p.fields.length} fields)</span>
                  </button>
                ))}
                {!qualityPresets.length && <p className="text-xs opacity-50">{t('bitable.qualityNoFields', language)}</p>}
              </div>
            </div>
          )}
          {key === 'export' && (
            <div className="space-y-2">
              <button type="button" data-testid="bt-export-all" disabled={exporting}
                onClick={() => onExport('all')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-bold hover:bg-[var(--t-table-hover)]">
                <Download className="w-3.5 h-3.5" />{t('bitable.exportAll', language).replace('{n}', String(total))}
              </button>
              <button type="button" data-testid="bt-export-selected" disabled={exporting || (!selectedCount && !selectionAll)}
                onClick={() => onExport('selected')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-bold hover:bg-[var(--t-table-hover)] disabled:opacity-40">
                <Download className="w-3.5 h-3.5" />{t('bitable.exportSelected', language).replace('{n}', selectionAll ? String(total) : String(selectedCount))}
              </button>
              <label className="flex items-center gap-2 text-xs pt-1 cursor-pointer">
                <input type="checkbox" checked={exportMcpd} onChange={e => onExportMcpd(e.target.checked)} data-testid="bt-export-mcpd" />
                {t('bitable.exportMcpd', language)}
              </label>
              <p className="text-[10px] opacity-50">{exporting ? t('bitable.exporting', language) : t('bitable.exportHint', language)}</p>
              {dirtyCount > 0 && <p className="text-[10px] text-amber-600">{t('bitable.exportDirty', language)}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div ref={barRef} className="shrink-0" style={{ background: 'var(--t-card-bg)' }}>
      {/* 行1：视图标签栏（飞书形态：返回 · 文档名 · 视图 tab + 新建视图占位 · 右侧状态区） */}
      <div className="flex items-center gap-1 px-3 h-11 border-b" style={{ borderColor: 'var(--t-divider)' }}>
        <button type="button" onClick={onClose} data-testid="bt-back"
          className="bt-ghost flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-[var(--t-text-soft)] hover:bg-[var(--t-table-hover)]">
          <ChevronLeft className="w-3.5 h-3.5" />{t('bitable.back', language)}
        </button>
        <span className="text-xs font-medium text-[var(--t-text-dim)]">{t('bitable.title', language)}</span>
        <button type="button" data-testid="bt-view-tab"
          className="relative flex items-center gap-1.5 h-11 px-3 text-xs font-medium text-[var(--t-text)]">
          <Table2 className="w-3.5 h-3.5" />{t('bitable.viewGrid', language)}
          <ChevronDown className="w-3 h-3 opacity-50" />
          <span className="absolute bottom-0 left-2 right-2 h-0.5" style={{ background: 'var(--t-accent)' }} />
        </button>
        <button type="button" disabled title={t('bitable.addView', language)}
          className="p-1.5 rounded opacity-40 cursor-not-allowed text-[var(--t-text-dim)]">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <span className="flex-1" />
        {!canEdit && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-[var(--t-text-soft)]" style={{ background: 'var(--t-pill-muted-bg)' }}>
            <Lock className="w-3 h-3" />{t('bitable.readonly', language)}
          </span>
        )}
        <span className="text-[11px] text-[var(--t-text-dim)]">{t('bitable.rowTotal', language).replace('{n}', String(total))}</span>
        {(selectedCount > 0 || selectionAll) && (
          <span className="flex items-center gap-1 text-[11px] font-bold" data-testid="bt-selected-count">
            {selectionAll ? t('bitable.selectedAll', language).replace('{n}', String(total)) : t('bitable.selected', language).replace('{n}', String(selectedCount))}
            <button type="button" onClick={onClearSelection} className="p-0.5 rounded hover:bg-[var(--t-table-hover)]" title={t('bitable.clearSelection', language)}>
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        {!selectionAll && selectedCount > 0 && (
          <button type="button" onClick={onSelectAllMatching} data-testid="bt-select-all-matching"
            className="text-[10px] font-medium underline opacity-70 hover:opacity-100">
            {t('bitable.selectAllMatching', language).replace('{n}', String(total))}
          </button>
        )}
      </div>
      {/* 行2：工具栏（飞书幽灵按钮：无边框，hover 浅底） */}
      <div className="flex items-center gap-2 px-3 h-11 border-b" style={{ borderColor: 'var(--t-divider)' }}>
        {canEdit && (
          <button type="button" onClick={onAddField}
            className="bt-ghost flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-[var(--t-text-soft)] hover:bg-[var(--t-table-hover)]">
            <Plus className="w-3.5 h-3.5" />{t('bitable.addField', language)}
          </button>
        )}
        <span className="flex-1" />
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2 opacity-50" />
          <input value={kw} onChange={e => onKwChange(e.target.value)} placeholder={t('bitable.search', language)}
            data-testid="bt-search"
            className="pl-7 pr-2 py-1.5 w-48 text-xs border rounded-md" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }} />
        </div>
        {toggleBtn('filter', <Filter className="w-3.5 h-3.5" />, t('bitable.filter', language), query.filters.length, 'left', 'bt-filter-btn')}
        {toggleBtn('sort', <ArrowUpDown className="w-3.5 h-3.5" />, t('bitable.sort', language), query.sort.length, 'left', 'bt-sort-btn')}
        {toggleBtn('group', <Layers className="w-3.5 h-3.5" />, t('bitable.group', language), query.groupBy ? 1 : 0, 'left', 'bt-group-btn')}
        {toggleBtn('density', <Rows3 className="w-3.5 h-3.5" />, t('bitable.rowHeight', language), undefined, 'left', 'bt-density-btn')}
        {toggleBtn('fields', <Columns3 className="w-3.5 h-3.5" />, t('bitable.fields', language), undefined, 'right', 'bt-fields-btn')}
        {toggleBtn('quality', <ClipboardCheck className="w-3.5 h-3.5" />, t('bitable.quality', language), undefined, 'right', 'bt-quality-btn')}
        {toggleBtn('export', <Download className="w-3.5 h-3.5" />, t('bitable.export', language), undefined, 'right', 'bt-export-btn')}
      </div>
      {/* 行3：条件 chips（飞书标签样式） */}
      {(query.filters.length > 0 || query.sort.length > 0 || query.groupBy) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b" style={{ borderColor: 'var(--t-divider)' }}>
          {query.filters.map((f, i) => (
            <span key={`f${i}`} data-chip="filter" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border" style={{ background: 'var(--t-pill-muted-bg)', color: 'var(--t-text-soft)', borderColor: 'var(--t-divider)' }}>
              {f.op === 'anyempty' || f.op === 'notanyempty'
                ? <span className="inline-flex items-center gap-0.5"><ClipboardCheck className="w-3 h-3" />{f.labelKey ? t(f.labelKey, language) : t('bitable.filter', language)} · {f.fields?.length}</span>
                : <span className="inline-flex items-center gap-0.5">
                    {colByKey[f.field || '']?.label || f.field} {opLabelOf(f.op, colByKey[f.field || ''], language)}
                    {f.op !== 'empty' && f.op !== 'notempty' ? ` ${f.value}` : ''}
                  </span>}
              <button type="button" onClick={() => onQueryChange({ filters: query.filters.filter((_, j) => j !== i) })}><X className="w-3 h-3" /></button>
            </span>
          ))}
          {query.sort.map((s, i) => (
            <span key={`s${i}`} data-chip="sort" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border" style={{ background: 'var(--t-pill-muted-bg)', color: 'var(--t-text-soft)', borderColor: 'var(--t-divider)' }}>
              {colByKey[s.field]?.label || s.field}
              <button type="button" onClick={() => onQueryChange({ sort: query.sort.map((x, j) => j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x) })}>
                {s.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              </button>
              <button type="button" onClick={() => onQueryChange({ sort: query.sort.filter((_, j) => j !== i) })}><X className="w-3 h-3" /></button>
            </span>
          ))}
          {query.groupBy && (
            <span data-chip="group" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border" style={{ background: 'var(--t-pill-muted-bg)', color: 'var(--t-text-soft)', borderColor: 'var(--t-divider)' }}>
              {t('bitable.group', language)}: {colByKey[query.groupBy]?.label || query.groupBy}
              <button type="button" data-testid="bt-clear-group" onClick={() => onQueryChange({ groupBy: null })}><X className="w-3 h-3" /></button>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ---- 值输入（按列类型） ----
const ValueInput: React.FC<{ col?: BitableColumn | null; value: string; onChange: (v: string) => void }> = ({ col, value, onChange }) => {
  const { language } = useApp();
  if (!col) return <input value={value} onChange={e => onChange(e.target.value)} disabled className="flex-1 px-2 py-1.5 text-xs border rounded opacity-40" style={{ borderColor: 'var(--t-divider)' }} />;
  if (col.type === 'scale') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className="flex-1 px-1.5 py-1.5 text-xs border rounded" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }}>
        <option value="">{t('bitable.value', language)}</option>
        {Object.entries(col.scale || {}).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
      </select>
    );
  }
  const m = mcpdOf(col.key);
  return (
    <input type={col.type === 'number' ? 'number' : 'text'} value={value} onChange={e => onChange(e.target.value)}
      placeholder={t('bitable.value', language)} list={m?.vocab ? `bt-vocab-${col.key}` : undefined}
      className="flex-1 px-2 py-1.5 text-xs border rounded" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }} />
  );
};

// ---- 筛选面板 ----
const FilterPanel: React.FC<{ query: QueryState; onQueryChange: (p: Partial<QueryState>) => void; columns: BitableColumn[] }> = ({ query, onQueryChange, columns }) => {
  const { language } = useApp();
  const colByKey = useMemo(() => Object.fromEntries(columns.map(c => [c.key, c])), [columns]);
  const setRow = (i: number, patch: Partial<BitableFilter>) => {
    onQueryChange({ filters: query.filters.map((f, j) => j === i ? { ...f, ...patch } : f) });
  };
  return (
    <div className="space-y-2">
      {query.filters.map((f, i) => {
        if (f.op === 'anyempty' || f.op === 'notanyempty') {
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <span className="flex-1 px-2 py-1.5 rounded font-bold" style={{ background: 'var(--t-pill-muted-bg)' }}>
                {t('bitable.quality.passport', language)} · {(f.fields || []).map(k => colByKey[k]?.label || k).join(', ').slice(0, 40)}
              </span>
              <button type="button" onClick={() => onQueryChange({ filters: query.filters.filter((_, j) => j !== i) })}><X className="w-3.5 h-3.5" /></button>
            </div>
          );
        }
        const col = colByKey[f.field || ''];
        const noValue = f.op === 'empty' || f.op === 'notempty';
        return (
          <div key={i} className="flex items-center gap-1.5" data-filter-row>
            <FieldPicker value={f.field || ''} columns={columns} testId="bt-filter-field"
              placeholder={t('bitable.fields', language)}
              onChange={v => setRow(i, { field: v, op: opsForColumn(colByKey[v])[0]?.v || 'eq', value: '' })} />
            <select value={f.op} onChange={e => setRow(i, { op: e.target.value })} className="px-1.5 py-1.5 text-xs border rounded" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }}>
              {opsForColumn(col).map(o => <option key={o.v} value={o.v}>{language === 'zh' ? o.zh : o.en}</option>)}
            </select>
            {!noValue && <ValueInput col={col} value={f.value || ''} onChange={v => setRow(i, { value: v })} />}
            <button type="button" onClick={() => onQueryChange({ filters: query.filters.filter((_, j) => j !== i) })}><X className="w-3.5 h-3.5" /></button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" data-testid="bt-add-filter"
          onClick={() => onQueryChange({ filters: [...query.filters, { field: 'primaryId', op: 'contains', value: '' }] })}
          className="flex items-center gap-1 text-xs font-bold opacity-70 hover:opacity-100">
          <Plus className="w-3.5 h-3.5" />{t('bitable.addCondition', language)}
        </button>
        <span className="flex-1" />
        {query.filters.length > 0 && (
          <button type="button" onClick={() => onQueryChange({ filters: [] })} className="text-xs font-bold opacity-50 hover:opacity-100">
            {t('bitable.clearAll', language)}
          </button>
        )}
      </div>
    </div>
  );
};

// ---- 排序面板 ----
const SortPanel: React.FC<{ query: QueryState; onQueryChange: (p: Partial<QueryState>) => void; columns: BitableColumn[] }> = ({ query, onQueryChange, columns }) => {
  const { language } = useApp();
  return (
    <div className="space-y-2">
      {query.sort.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <FieldPicker value={s.field} columns={columns} testId="bt-sort-field"
            onChange={v => onQueryChange({ sort: query.sort.map((x, j) => j === i ? { ...x, field: v } : x) })} />
          <button type="button" onClick={() => onQueryChange({ sort: query.sort.map((x, j) => j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x) })}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-bold border rounded" style={{ borderColor: 'var(--t-divider)' }}>
            {s.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {s.dir === 'asc' ? t('bitable.sortAsc', language) : t('bitable.sortDesc', language)}
          </button>
          <button type="button" onClick={() => onQueryChange({ sort: query.sort.filter((_, j) => j !== i) })}><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        {query.sort.length < 3 && (
          <button type="button" data-testid="bt-add-sort"
            onClick={() => onQueryChange({ sort: [...query.sort, { field: 'primaryId', dir: 'asc' }] })}
            className="flex items-center gap-1 text-xs font-bold opacity-70 hover:opacity-100">
            <Plus className="w-3.5 h-3.5" />{t('bitable.addSort', language)}
          </button>
        )}
        <span className="flex-1" />
        {query.sort.length > 0 && (
          <button type="button" onClick={() => onQueryChange({ sort: [] })} className="text-xs font-bold opacity-50 hover:opacity-100">
            {t('bitable.clearAll', language)}
          </button>
        )}
      </div>
    </div>
  );
};

// ---- 分组面板 ----
const GroupPanel: React.FC<{ query: QueryState; onQueryChange: (p: Partial<QueryState>) => void; columns: BitableColumn[] }> = ({ query, onQueryChange, columns }) => {
  const { language } = useApp();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold shrink-0">{t('bitable.groupField', language)}</span>
        <FieldPicker value={query.groupBy || ''} columns={columns} testId="bt-group-field"
          placeholder={t('bitable.groupNone', language)}
          onChange={v => onQueryChange({ groupBy: v || null })} />
      </div>
      {query.groupBy && (
        <button type="button" onClick={() => onQueryChange({ groupBy: null })} className="text-xs font-bold opacity-50 hover:opacity-100">
          {t('bitable.groupNone', language)}
        </button>
      )}
    </div>
  );
};

// ---- 字段配置面板 ----
const FieldsPanel: React.FC<{
  columns: BitableColumn[];
  visibleKeys: string[];
  onToggleVisible: (key: string) => void;
  onMoveColumn: (key: string, dir: -1 | 1) => void;
  language: Language;
}> = ({ columns, visibleKeys, onToggleVisible, onMoveColumn, language }) => {
  const [q, setQ] = useState('');
  const colByKey = useMemo(() => Object.fromEntries(columns.map(c => [c.key, c])), [columns]);
  const visible = visibleKeys.map(k => colByKey[k]).filter(Boolean);
  // 未显示字段分组
  const hidden = columns.filter(c => !visibleKeys.includes(c.key));
  const kw = q.trim().toLowerCase();
  const match = (c: BitableColumn) => !kw || c.label.toLowerCase().includes(kw) || c.key.toLowerCase().includes(kw);
  const baseHidden = hidden.filter(c => c.kind === 'base' && match(c));
  const stockHidden = hidden.filter(c => c.kind === 'stock' && match(c));
  const passportHidden = hidden.filter(c => c.kind !== 'base' && c.kind !== 'stock' && c.kind !== 'trait' && mcpdOf(c.key) && match(c));
  const otherHidden = hidden.filter(c => c.kind === 'custom' && !mcpdOf(c.key) && match(c));
  const traitHidden = hidden.filter(c => c.kind === 'trait' && match(c));
  const section = (title: string, items: BitableColumn[]) => items.length ? (
    <div key={title}>
      <p className="text-[10px] font-black uppercase tracking-wider opacity-40 px-2 py-1">{title}</p>
      {items.slice(0, 300).map(c => {
        const m = mcpdOf(c.key);
        return (
          <button key={c.key} type="button" data-hidden-field={c.key} onClick={() => onToggleVisible(c.key)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs rounded hover:bg-[var(--t-table-hover)]">
            <Plus className="w-3 h-3 opacity-50 shrink-0" />
            <span className="truncate">{c.label}</span>
            {c.kind !== 'base' && <span className="text-[9px] opacity-40 font-mono truncate">{c.key}</span>}
            {m && <span className="px-1 rounded-sm text-[8px] font-black shrink-0" style={{ background: 'var(--t-warn-bg)', color: 'var(--t-warn-fg)' }}>MCPD</span>}
          </button>
        );
      })}
    </div>
  ) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold">{t('bitable.fieldsShown', language).replace('{n}', String(visible.length)).replace('{m}', String(MAX_VISIBLE_COLS))}</span>
        <span className="flex-1" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('bitable.fieldsSearchBox', language)}
          className="px-2 py-1 w-40 text-xs border rounded" style={{ borderColor: 'var(--t-divider)', background: 'var(--t-input-bg)' }} />
      </div>
      {/* 已显示（可排序/隐藏） */}
      <div className="max-h-44 overflow-auto border rounded" style={{ borderColor: 'var(--t-divider)' }}>
        {visible.map((c, i) => (
          <div key={c.key} data-visible-field={c.key} className="flex items-center gap-1 px-2 py-1 text-xs border-b last:border-b-0" style={{ borderColor: 'var(--t-divider)' }}>
            <span className="truncate flex-1">{c.label} <span className="text-[9px] opacity-40 font-mono">{c.kind === 'base' ? '' : c.key}</span></span>
            <button type="button" disabled={i === 0} onClick={() => onMoveColumn(c.key, -1)} title={t('bitable.moveUp', language)} className="disabled:opacity-20"><ArrowUp className="w-3 h-3" /></button>
            <button type="button" disabled={i === visible.length - 1} onClick={() => onMoveColumn(c.key, 1)} title={t('bitable.moveDown', language)} className="disabled:opacity-20"><ArrowDown className="w-3 h-3" /></button>
            {c.key !== 'primaryId' ? (
              <button type="button" onClick={() => onToggleVisible(c.key)} title={t('bitable.hideField', language)} data-remove={c.key}><X className="w-3 h-3" /></button>
            ) : <Lock className="w-3 h-3 opacity-30" />}
          </div>
        ))}
      </div>
      {/* 未显示 */}
      <div className="max-h-56 overflow-auto">
        {visible.length >= MAX_VISIBLE_COLS && <p className="px-2 py-1 text-[10px] text-amber-600">{t('bitable.fieldsCap', language)}</p>}
        {section(t('bitable.baseFields', language), baseHidden)}
        {section(t('bitable.passportFields', language), passportHidden)}
        {section(t('bitable.stockFields', language), stockHidden)}
        {section(t('bitable.traitsGroup', language), traitHidden)}
        {section(t('bitable.otherFields', language), otherHidden)}
      </div>
    </div>
  );
};

export default BitableToolbar;
