// v2.16：多维表格网格——飞书形态（悬停显现勾选/展开、列头悬停菜单、列分隔线、裸“+”加字段）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { t } from '../../utils';
import {
  ChevronDown, ChevronRight, Type, Hash, ListChecks,
  MoreVertical, Plus, Maximize2, Loader2, Filter, ArrowUp, ArrowDown, EyeOff, Pencil, AlertTriangle,
} from 'lucide-react';
import {
  BitableColumn, GUTTER_W, PRIMARY_W, DEFAULT_COL_W,
  chipColor, isUrlLike,
} from './types';
import { mcpdOf, passportCompleteness, validateNumeric, VOCABS } from '../../lib/mcpd';

export interface GridGroupItem { value: string | null; count: number }
export interface GridGroups { field: string; truncated: boolean; items: GridGroupItem[] }

interface Props {
  canEdit: boolean;
  columns: BitableColumn[];                 // 可见列（含 primaryId）
  densityH: number;
  total: number;
  getRow: (i: number) => any | undefined;
  onNeedRange: (start: number, end: number) => void;
  cellValue: (row: any, key: string) => string;
  cellDirty: (row: any, key: string) => boolean;
  onCellChange: (row: any, key: string, raw: string) => void;
  selected: Set<string>;
  onToggleSelect: (pid: string) => void;
  onToggleSelectAll: () => void;
  allLoadedSelected: boolean;
  onOpenDetail: (id: string) => void;
  onSort: (field: string, dir: 'asc' | 'desc') => void;
  onHide: (key: string) => void;
  onFilterBy: (key: string) => void;
  onRenameTrait: (traitId: string, nameZh: string, nameEn: string) => Promise<void> | void;
  widths: Record<string, number>;
  onResize: (key: string, w: number) => void;
  groups: GridGroups | null;
  collapsed: Set<string>;
  onToggleGroup: (gkey: string) => void;
  groupRows: (gkey: string) => { rows: any[]; loaded: boolean };
  onLoadMoreGroup: (gkey: string) => void;
  qualityHighlight: boolean;
  coreFields: string[];
  onAddField: () => void;
}

const GROUP_NONE = '__none__';
const OVERSCAN = 8;

const BitableGrid: React.FC<Props> = (props) => {
  const { language } = useApp();
  const {
    canEdit, columns, densityH, total, getRow, onNeedRange, cellValue, cellDirty, onCellChange,
    selected, onToggleSelect, onToggleSelectAll, allLoadedSelected, onOpenDetail,
    onSort, onHide, onFilterBy, onRenameTrait, widths, onResize,
    groups, collapsed, onToggleGroup, groupRows, onLoadMoreGroup,
    qualityHighlight, coreFields, onAddField,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ pid: string; key: string; draft: string; row: any } | null>(null);
  const [renameCol, setRenameCol] = useState<BitableColumn | null>(null);
  const [renameZh, setRenameZh] = useState('');
  const [renameEn, setRenameEn] = useState('');
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const primaryCol = columns.find(c => c.key === 'primaryId');
  const restCols = columns.filter(c => c.key !== 'primaryId');
  const colW = (c: BitableColumn) => widths[c.key] || (c.kind === 'base' ? PRIMARY_W : DEFAULT_COL_W) || DEFAULT_COL_W;
  const contentW = GUTTER_W + (primaryCol ? colW(primaryCol) : 0) + restCols.reduce((s, c) => s + colW(c), 0) + (canEdit ? 44 : 24);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 窗口化：滚动/视口变化 → 请求缺失页
  useEffect(() => {
    if (groups) return;
    const start = Math.max(0, Math.floor(scrollTop / densityH) - OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop + viewportH) / densityH) + OVERSCAN);
    if (end > start) onNeedRange(start, end);
  }, [scrollTop, viewportH, densityH, total, groups, onNeedRange]);

  // 拖动调宽（window 级事件，避免快速拖动丢指针）
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      onResize(r.key, Math.max(80, r.startW + (e.clientX - r.startX)));
    };
    const up = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [onResize]);

  // 列菜单外点关闭
  useEffect(() => {
    if (!menuCol) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.bt-col-menu') && !el.closest('.bt-menu-btn')) setMenuCol(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuCol]);

  const start = groups ? 0 : Math.max(0, Math.floor(scrollTop / densityH) - OVERSCAN);
  const end = groups ? 0 : Math.min(total, Math.ceil((scrollTop + viewportH) / densityH) + OVERSCAN);

  const pidOf = (row: any) => String(row?.primaryId ?? row?.primary_id ?? '');
  const wrapStyle = (c: BitableColumn): React.CSSProperties => {
    const w = c.key === 'primaryId' ? (widths[c.key] || PRIMARY_W) : colW(c);
    return { width: w, minWidth: w, maxWidth: w };
  };

  const commitEdit = (row: any, key: string, draft: string) => {
    onCellChange(row, key, draft);
    setEdit(null);
  };

  // ---- 单元格内容 ----
  const renderCellInner = (row: any, c: BitableColumn, val: string) => {
    const editing = edit && edit.pid === pidOf(row) && edit.key === c.key && edit.row === row;
    const m = mcpdOf(c.key);
    if (editing) {
      if (c.type === 'scale') {
        return (
          <select
            autoFocus
            value={val}
            onChange={e => commitEdit(row, c.key, e.target.value)}
            onBlur={() => setEdit(null)}
            data-testid={`bt-edit-${c.key}`}
            className="w-full bg-transparent border-0 text-xs outline-none"
          >
            <option value="">{t('bitable.emptyCell', language)}</option>
            {Object.entries(c.scale || {}).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
        );
      }
      const numericKind = m?.numeric;
      const warn = numericKind && val.trim() !== '' ? validateNumeric(numericKind, val) : null;
      return (
        <input
          autoFocus
          type={c.type === 'number' ? 'number' : 'text'}
          value={edit.draft}
          list={c.type === 'text' && m?.vocab ? `bt-vocab-${c.key}` : undefined}
          onChange={e => setEdit({ ...edit, draft: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') commitEdit(row, c.key, edit.draft);
            if (e.key === 'Escape') setEdit(null);
          }}
          onBlur={() => commitEdit(row, c.key, edit.draft)}
          data-testid={`bt-edit-${c.key}`}
          title={warn || undefined}
          className={`w-full bg-transparent border-0 text-xs outline-none ${warn ? 'text-amber-700' : ''}`}
        />
      );
    }
    if (val === '' || val === null || val === undefined) {
      const qEmpty = qualityHighlight && m && !c.readonly && !c.key.startsWith('stock');
      return qEmpty
        ? <span className="block w-full h-3 rounded-sm border border-dashed border-amber-400/80" title={t('bitable.qEmptyHint', language)} />
        : <span className="text-[var(--t-text-mute)]"></span>;
    }
    if (c.type === 'scale') {
      const label = c.scale?.[val];
      const cc = chipColor(val);
      return (
        <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[10px] font-bold truncate max-w-full"
          style={{ background: cc.bg, color: cc.fg }} title={`${val}${label ? ' · ' + label : ''}`}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cc.fg }} />
          {val}{label ? ` · ${label}` : ''}
        </span>
      );
    }
    if (isUrlLike(val)) {
      const href = /^10\./.test(val.trim()) ? `https://doi.org/${val.trim()}` : val.trim();
      return <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline truncate block"
        onClick={e => e.stopPropagation()} title={val}>{val}</a>;
    }
    const m2 = mcpdOf(c.key);
    const warn = m2?.numeric ? validateNumeric(m2.numeric, val) : null;
    return (
      <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
        <span className="truncate">{val}</span>
        {warn && <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" aria-label={warn} />}
      </span>
    );
  };

  const renderRow = (row: any | undefined, seq: number, key: React.Key) => {
    if (!row) {
      return (
        <div key={key} className="flex" style={{ height: densityH, borderBottom: '1px solid var(--t-divider)' }} data-testid="bt-skeleton">
          <div className="sticky left-0 z-20 flex items-center px-2 shrink-0" style={{ width: GUTTER_W, background: 'var(--t-card-bg)', borderRight: '1px solid var(--t-divider)' }} />
          {columns.map(c => (
            <div key={c.key} className="flex items-center px-2" style={wrapStyle(c)}>
              <div className="h-2.5 w-2/3 rounded-sm bg-[var(--ash-200)] animate-pulse" />
            </div>
          ))}
        </div>
      );
    }
    const pid = pidOf(row);
    const checked = selected.has(pid);
    const pct = coreFields.length ? passportCompleteness(row, coreFields) : 100;
    return (
      <div key={key} data-pid={pid}
        className={`flex group/row ${checked ? 'bg-[var(--t-table-hover)]' : 'hover:bg-[var(--t-table-hover)]'}`}
        style={{ height: densityH, borderBottom: '1px solid var(--t-divider)' }}>
        {/* 行号栏（冻结；飞书形态：默认行号，悬停显现勾选+展开） */}
        <div className="sticky left-0 z-20 flex items-center gap-1 px-1.5 shrink-0 bg-[var(--t-card-bg)] group-hover/row:bg-[var(--t-table-hover)]"
          style={{ width: GUTTER_W, borderRight: '1px solid var(--t-divider)' }}>
          {qualityHighlight ? (
            <span className="w-4 text-[9px] font-bold text-center rounded"
              style={{ color: pct === 100 ? 'var(--t-quality-ok)' : pct >= 50 ? 'var(--t-quality-mid)' : 'var(--t-quality-bad)' }}
              title={t('bitable.completeness', language).replace('{n}', String(pct))}>{pct === 100 ? '✓' : pct}</span>
          ) : (
            <span className={`w-4 text-[10px] text-[var(--t-text-mute)] text-center transition-opacity ${checked ? 'opacity-0' : 'opacity-100 group-hover/row:opacity-0'}`}>{seq + 1}</span>
          )}
          <input type="checkbox" checked={checked} onChange={() => onToggleSelect(pid)}
            className={`w-3 h-3 transition-opacity ${checked ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`} data-testid="bt-row-check" />
          <button className={`p-0.5 rounded hover:bg-[var(--t-table-hover)] text-[var(--t-text-dim)] transition-opacity ${checked ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus:opacity-100'}`}
            onClick={() => onOpenDetail(row.id)} title={t('bitable.expand', language)}>
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
        {/* 数据列 */}
        {columns.map(c => {
          const isPrimary = c.key === 'primaryId';
          const v = cellValue(row, c.key);
          const dirty = cellDirty(row, c.key);
          const cellStyle: React.CSSProperties = isPrimary
            ? { ...wrapStyle(c), position: 'sticky', left: GUTTER_W, zIndex: 20, borderRight: '1px solid var(--t-divider)' }
            : { ...wrapStyle(c), borderRight: '1px solid var(--t-divider)' };
          const editable = canEdit && !c.readonly;
          return (
            <div
              key={c.key}
              data-cell={c.key}
              style={cellStyle}
              className={`flex items-center px-2 min-w-0 text-xs ${isPrimary ? 'font-medium bg-[var(--t-card-bg)] group-hover/row:bg-[var(--t-table-hover)]' : ''} ${dirty ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''} ${editable ? 'cursor-text' : ''}`}
              onClick={() => {
                if (!editable) return;
                const switching = edit && (edit.pid !== pid || edit.key !== c.key);
                if (switching) onCellChange(edit.row, edit.key, edit.draft);   // 提交上一格再切走
                if (!edit || switching) setEdit({ pid, key: c.key, draft: v, row });
              }}
            >
              {isPrimary ? <span className="truncate">{v || '-'}</span> : renderCellInner(row, c, v)}
            </div>
          );
        })}
      </div>
    );
  };

  // ---- 表头 ----
  const typeIcon = (c: BitableColumn) =>
    c.type === 'number' ? <Hash className="w-3 h-3" /> : c.type === 'scale' ? <ListChecks className="w-3 h-3" /> : <Type className="w-3 h-3" />;

  const renderHeaderCell = (c: BitableColumn, stickyPrimary: boolean) => {
    const w = c.key === 'primaryId' ? (widths[c.key] || PRIMARY_W) : colW(c);
    const m = mcpdOf(c.key);
    const stickyStyle: React.CSSProperties = stickyPrimary
      ? { position: 'sticky', left: GUTTER_W, background: 'var(--t-card-bg)', zIndex: 41, width: w, minWidth: w, maxWidth: w, borderRight: '1px solid var(--t-divider)' }
      : { width: w, minWidth: w, maxWidth: w, borderRight: '1px solid var(--t-divider)' };
    return (
      <div key={c.key} data-col={c.key}
        style={stickyStyle}
        className="relative flex items-center gap-1 px-2 shrink-0 text-xs font-medium text-[var(--t-text)] group/hd"
        title={m ? `${m.mcpd} · ${m.nameZh}（MCPD v2.1 #${m.num}）` : c.key}>
        <span className="shrink-0 text-[var(--t-text-mute)]">{typeIcon(c)}</span>
        <span className="truncate">{c.label}</span>
        {m && <span data-testid={`bt-mcpd-${c.key}`} className="shrink-0 px-1 rounded-sm text-[8px] font-black"
          style={{ background: 'var(--t-warn-bg)', color: 'var(--t-warn-fg)' }}>MCPD</span>}
        <span className="flex-1" />
        <button className={`bt-menu-btn p-0.5 rounded hover:bg-[var(--t-table-hover)] shrink-0 transition-opacity ${menuCol === c.key ? 'opacity-100' : 'opacity-0 group-hover/hd:opacity-100 focus:opacity-100'}`}
          onClick={() => setMenuCol(menuCol === c.key ? null : c.key)}>
          <MoreVertical className="w-3 h-3" />
        </button>
        {menuCol === c.key && (
          <div className="bt-col-menu absolute top-full right-0 z-50 mt-1 py-1 w-40 rounded-md shadow-lg border text-[11px] font-medium normal-case tracking-normal"
            style={{ background: 'var(--t-card-bg)', borderColor: 'var(--t-divider)' }}>
            <button className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--t-table-hover)]"
              onClick={() => { onSort(c.key, 'asc'); setMenuCol(null); }}><ArrowUp className="w-3 h-3" />{t('bitable.sortAsc', language)}</button>
            <button className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--t-table-hover)]"
              onClick={() => { onSort(c.key, 'desc'); setMenuCol(null); }}><ArrowDown className="w-3 h-3" />{t('bitable.sortDesc', language)}</button>
            <button className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--t-table-hover)]"
              onClick={() => { onFilterBy(c.key); setMenuCol(null); }}><Filter className="w-3 h-3" />{t('bitable.filterBy', language)}</button>
            {c.key !== 'primaryId' && (
              <button className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--t-table-hover)]"
                onClick={() => { onHide(c.key); setMenuCol(null); }}><EyeOff className="w-3 h-3" />{t('bitable.hideField', language)}</button>
            )}
            {c.kind === 'trait' && (
              <button className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--t-table-hover)]"
                onClick={() => { setRenameZh(c.nameZh || ''); setRenameEn(c.nameEn || ''); setRenameCol(c); setMenuCol(null); }}>
                <Pencil className="w-3 h-3" />{t('bitable.rename', language)}</button>
            )}
          </div>
        )}
        {/* 拖拽调宽把手 */}
        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--moss)]/40"
          onMouseDown={e => { e.preventDefault(); resizeRef.current = { key: c.key, startX: e.clientX, startW: w }; }} />
      </div>
    );
  };

  const headerRow = (
    <div className="sticky top-0 z-40 flex" style={{ height: 40, background: 'var(--t-card-bg)', borderBottom: '1px solid var(--t-divider)', borderTop: '1px solid var(--t-divider)' }}>
      <div className="sticky left-0 z-50 flex items-center px-2 shrink-0" style={{ width: GUTTER_W, background: 'var(--t-card-bg)', borderRight: '1px solid var(--t-divider)' }}>
        <input type="checkbox" checked={allLoadedSelected} onChange={onToggleSelectAll} className="w-3 h-3"
          title={t('bitable.selectAllLoaded', language)} data-testid="bt-select-all" />
      </div>
      {primaryCol && renderHeaderCell(primaryCol, true)}
      {restCols.map(c => renderHeaderCell(c, false))}
      {canEdit && (
        <div className="flex items-center justify-center shrink-0" style={{ width: 44 }}>
          <button onClick={onAddField} data-testid="bt-add-field" title={t('bitable.addField', language)}
            className="bt-ghost flex items-center justify-center w-9 h-7 rounded text-[var(--t-text-dim)] hover:bg-[var(--t-table-hover)]">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  // ---- 分组模式 ----
  const groupHeader = (gkey: string, label: string, count: number, isCollapsed: boolean) => (
    <div key={`h-${gkey}`} className="flex" style={{ height: Math.max(34, densityH), borderBottom: '1px solid var(--t-divider)', background: 'var(--t-table-stripe)' }}>
      <div className="sticky left-0 z-20 flex items-center gap-1.5 px-2 shrink-0"
        style={{ width: GUTTER_W + PRIMARY_W, background: 'var(--t-card-bg)' }}>
        <button onClick={() => onToggleGroup(gkey)} className="p-0.5 rounded hover:bg-[var(--t-table-hover)]">
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <span className="text-xs font-semibold truncate max-w-[140px]" title={label}>{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'var(--t-pill-muted-bg)', color: 'var(--t-text-soft)' }}>{count}</span>
      </div>
      <div className="flex-1" />
    </div>
  );

  let body: React.ReactNode;
  if (groups) {
    body = (
      <>
        {groups.items.map(g => {
          const gkey = g.value === null || g.value === '' ? GROUP_NONE : g.value;
          const isCollapsed = collapsed.has(gkey);
          const gcol = columns.find(c => c.key === groups.field);
          const label = g.value === null || g.value === '' ? t('bitable.emptyGroup', language)
            : gcol?.scale?.[g.value] ? `${g.value} · ${gcol.scale[g.value]}` : g.value;
          const gr = groupRows(gkey);
          return (
            <div key={gkey} data-group={gkey}>
              {groupHeader(gkey, label, g.count, isCollapsed)}
              {!isCollapsed && (
                <>
                  {gr.rows.map((row, j) => renderRow(row, j, `${gkey}-${j}`))}
                  {gr.rows.length < g.count && (
                    <div className="flex justify-center py-2" style={{ borderBottom: '1px solid var(--t-divider)' }}>
                      <button onClick={() => onLoadMoreGroup(gkey)} data-testid={`bt-group-more-${gkey}`}
                        className="px-3 py-1 rounded text-[11px] font-bold border hover:bg-[var(--t-table-hover)]"
                        style={{ borderColor: 'var(--t-divider)' }}>
                        {t('bitable.loadMore', language).replace('{a}', String(gr.rows.length)).replace('{b}', String(g.count))}
                      </button>
                    </div>
                  )}
                  {!gr.loaded && (
                    <div className="flex items-center justify-center py-3 text-[var(--t-text-dim)]"><Loader2 className="w-4 h-4 animate-spin" /></div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {groups.truncated && (
          <div className="px-4 py-2 text-[11px] font-medium" style={{ background: 'var(--t-warn-bg)', color: 'var(--t-warn-fg)' }}>{t('bitable.groupTruncated', language)}</div>
        )}
      </>
    );
  } else {
    const rows: React.ReactNode[] = [];
    for (let i = start; i < end; i++) rows.push(renderRow(getRow(i), i, i));
    body = (
      <>
        <div style={{ height: start * densityH }} />
        {rows}
        <div style={{ height: Math.max(0, (total - end)) * densityH }} />
      </>
    );
  }

  return (
    <div ref={scrollRef} data-testid="bitable-grid" className="flex-1 min-h-0 overflow-auto custom-scrollbar"
      onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
      <div style={{ width: contentW, minWidth: '100%' }}>
        {headerRow}
        {body}
        {!groups && total === 0 && (
          <div className="flex items-center justify-center py-24 text-sm text-[var(--t-text-dim)]">{t('bitable.noData', language)}</div>
        )}
      </div>
      {/* 词表 datalist（受控词表字段的搜索建议） */}
      {columns.map(c => {
        const m = mcpdOf(c.key);
        if (!m?.vocab) return null;
        return (
          <datalist key={c.key} id={`bt-vocab-${c.key}`}>
            {(VOCABS[m.vocab] || []).map(v => (
              <option key={v.code} value={v.code}>{`${v.code} · ${language === 'zh' && v.zh ? v.zh : v.en}`}</option>
            ))}
          </datalist>
        );
      })}
      {/* 性状重命名弹窗 */}
      {renameCol && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20" onClick={() => setRenameCol(null)} />
          <div className="relative w-full max-w-xs p-4 shadow-xl" style={{ background: 'var(--t-card-bg)', borderRadius: 'var(--t-card-radius)' }} data-testid="bt-rename-dialog">
            <p className="text-sm font-bold mb-3">{t('bitable.rename', language)} · <span className="font-mono">{renameCol.key}</span></p>
            <label className="text-[10px] font-bold opacity-60 block mb-1">{t('bitable.nameZh', language)}</label>
            <input value={renameZh} onChange={e => setRenameZh(e.target.value)} data-testid="bt-rename-zh"
              className="w-full mb-3 px-2 py-1.5 text-sm border rounded" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
            <label className="text-[10px] font-bold opacity-60 block mb-1">{t('bitable.nameEn', language)}</label>
            <input value={renameEn} onChange={e => setRenameEn(e.target.value)} data-testid="bt-rename-en"
              className="w-full mb-4 px-2 py-1.5 text-sm border rounded" style={{ background: 'var(--t-input-bg)', borderColor: 'var(--t-divider)' }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenameCol(null)} className="px-3 py-1.5 text-xs font-bold rounded border" style={{ borderColor: 'var(--t-divider)' }}>{t('common.cancel', language)}</button>
              <button data-testid="bt-rename-ok"
                onClick={async () => { if (renameCol.traitId) await onRenameTrait(renameCol.traitId, renameZh, renameEn); setRenameCol(null); }}
                className="btn-primary px-3 py-1.5 text-xs font-bold rounded">{t('common.save', language)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BitableGrid;
