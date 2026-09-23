import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { LabelTemplate, LabelElement, LabelElementType, LabelSegment } from '../types';
import { generateId, t } from '../utils';
import { LabelCanvas } from '../components/LabelCanvas';
import { ElementProperties } from '../components/ElementProperties';
import { NewLabelWizard } from '../components/NewLabelWizard';
import { IconPicker } from '../components/IconPicker';
import { VariablesManager } from '../components/VariablesManager';
import { RulerH, RulerV, RULER_SIZE } from '../components/Rulers';
import { PrintModal } from '../components/PrintModal';
import { makeEmptyTable, iconDataUrl, legacySegments } from '../lib/labelUtil';
import * as XLSX from 'xlsx';
import {
  Type, AlignLeft, Calendar, Table2, Barcode, QrCode, Square, Circle, Minus, Image, Star,
  Plus, Save, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Copy, Trash2, Printer,
  ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Ungroup, BringToFront, SendToBack,
  Upload, FileSpreadsheet, Database, MousePointer2, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, MoveHorizontal, MoveVertical, FolderOpen, Search, Loader2,
  FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Variable,
} from 'lucide-react';

const rid = () => Math.random().toString(36).slice(2, 8);

const BINDABLE = [LabelElementType.TEXT_STATIC, LabelElementType.TEXT_DYNAMIC, LabelElementType.TEXT_PARAGRAPH, LabelElementType.BARCODE, LabelElementType.QR_CODE];

interface RecentItem { id: string; name: string; ts: number }

const DEFAULT_DATA_COLS = ['cccapNo', 'name', 'species', 'origin'];

export const LabelDesigner: React.FC = () => {
  const { templates, saveTemplate, deleteTemplate, primaryIdColumn, language, selectedPrinter } = useApp();

  /* ---------- 模板与选择状态 ---------- */
  const [template, setTemplateState] = useState<LabelTemplate>({
    id: generateId(), name: 'New Label', width: 50, height: 30, elements: [],
    backgroundColor: '#ffffff', layout: { mode: 'roll', rollCols: 1, rollGapX: 0 },
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(2);

  /* ---------- 历史（撤销/重做） ---------- */
  const historyRef = useRef<LabelTemplate[]>([]);
  const redoRef = useRef<LabelTemplate[]>([]);
  const skipPushRef = useRef(false);
  const lastEditRef = useRef(0);

  const pushHistory = () => {
    historyRef.current.push(template);
    if (historyRef.current.length > 60) historyRef.current.shift();
    redoRef.current = [];
  };
  const setTemplate = (next: LabelTemplate) => {
    const now = Date.now();
    if (!skipPushRef.current && now - lastEditRef.current > 500) pushHistory();
    lastEditRef.current = now;
    skipPushRef.current = false;
    setTemplateState(next);
  };
  const commit = (next: LabelTemplate) => { pushHistory(); setTemplateState(next); };
  const undo = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push(template);
    skipPushRef.current = true;
    setTemplateState(prev);
    setSelectedIds(ids => ids.filter(id => prev.elements.some(e => e.id === id)));
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(template);
    skipPushRef.current = true;
    setTemplateState(next);
    setSelectedIds(ids => ids.filter(id => next.elements.some(e => e.id === id)));
  };
  const loadTemplate = (tpl: LabelTemplate) => {
    historyRef.current = [];
    redoRef.current = [];
    skipPushRef.current = true;
    setTemplateState(tpl);
    setSelectedIds([]);
  };

  /* ---------- 数据源 ---------- */
  const [dataRows, setDataRows] = useState<Record<string, any>[]>([]);
  const [dataCols, setDataCols] = useState<string[]>(DEFAULT_DATA_COLS);
  const [previewRow, setPreviewRow] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  /* ---------- 弹窗 ---------- */
  const [showWizard, setShowWizard] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [imgPickerFor, setImgPickerFor] = useState<string | null>(null);
  const [bgPicker, setBgPicker] = useState(false);

  /* ---------- refs ---------- */
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const spaceRef = useRef(false);
  const clipboardRef = useRef<LabelElement[]>([]);
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const dataFileRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<any>(null);

  /* ---------- 数据源（多 Sheet） ---------- */
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [curSheet, setCurSheet] = useState('');
  const [autoPrefix, setAutoPrefix] = useState(false);

  /* ---------- 派生 ---------- */
  const variableNames = useMemo(() => {
    const s = new Set<string>(['operator', 'medium', 'date', 'serial']);
    for (const k of Object.keys(template.variables || {})) s.add(k);
    for (const el of template.elements) if (el.assignVariable) s.add(el.assignVariable);
    return Array.from(s);
  }, [template.elements, template.variables]);
  const previewData = dataRows[Math.min(previewRow, Math.max(0, dataRows.length - 1))] || {};
  const selectedEls = template.elements.filter(e => selectedIds.includes(e.id));

  /* ---------- 最近模板 ---------- */
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem('brc_recent_templates') || '[]')); } catch {}
  }, []);
  const addRecent = (tpl: LabelTemplate) => {
    try {
      const list: RecentItem[] = JSON.parse(localStorage.getItem('brc_recent_templates') || '[]');
      const next = [{ id: tpl.id, name: tpl.name, ts: Date.now() }, ...list.filter(r => r.id !== tpl.id)].slice(0, 8);
      localStorage.setItem('brc_recent_templates', JSON.stringify(next));
      setRecent(next);
    } catch {}
  };

  const handleSave = async () => {
    try {
      await saveTemplate({ ...template, lastModified: new Date().toISOString() });
      addRecent(template);
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      alert('保存失败：' + (e as any).message);
    }
  };

  /* ---------- 元素操作 ---------- */
  const elDefaults = (type: LabelElementType, field: string, offset: number): LabelElement => {
    const x = Math.min(Math.max(template.width - 8, 3), Math.max(3, 6 + (offset % 8) * 5));
    const y = Math.min(Math.max(template.height - 8, 3), Math.max(3, 6 + (offset % 6) * 4));
    const fseg = (f: string): LabelSegment[] => [{ id: rid(), type: 'field', field: f }];
    const base: LabelElement = { id: generateId(), type, x, y, width: 40, height: 6, fontSize: 9, isBold: false };
    switch (type) {
      case LabelElementType.TEXT_STATIC: return { ...base, content: 'Text', textAlign: 'center', segments: [{ id: rid(), type: 'text', text: 'Text' }] };
      case LabelElementType.TEXT_DYNAMIC: return { ...base, field, textAlign: 'center', segments: fseg(field) };
      case LabelElementType.TEXT_PARAGRAPH: return { ...base, height: 12, fontSize: 8, textAlign: 'left', verticalAlign: 'top', content: 'Paragraph\ntext', segments: [{ id: rid(), type: 'text', text: 'Paragraph\ntext' }] };
      case LabelElementType.DATE: return { ...base, textAlign: 'center', segments: [{ id: rid(), type: 'date', dateFormat: 'YYYY年MM月DD日' }] };
      case LabelElementType.TABLE: return { ...base, width: 30, height: 20, fontSize: 6, table: makeEmptyTable(3, 3), strokeColor: '#666666' };
      case LabelElementType.BARCODE: return { ...base, width: 40, height: 14, barcodeType: 'CODE128', barcodeTextDisplay: 'bottom', segments: fseg(field) };
      case LabelElementType.QR_CODE: return { ...base, width: 20, height: 20, eccLevel: 'M', segments: fseg(field) };
      case LabelElementType.RECTANGLE: return { ...base, width: 30, height: 10, strokeColor: '#000000', strokeWidth: 1, cornerRadius: 0, backgroundColor: 'transparent' };
      case LabelElementType.CIRCLE: return { ...base, width: 18, height: 18, strokeColor: '#000000', strokeWidth: 1 };
      case LabelElementType.LINE: return { ...base, width: 30, height: 1.2, strokeColor: '#000000', strokeWidth: 1.2 };
      case LabelElementType.IMAGE: return { ...base, width: 30, height: 20 };
      case LabelElementType.ICON: return { ...base, width: 10, height: 10, iconName: 'tag', color: '#000000', imageSrc: iconDataUrl('tag', '#000000', 128) };
      default: return base;
    }
  };

  const addElement = (type: LabelElementType) => {
    const el = elDefaults(type, primaryIdColumn, template.elements.length);
    commit({ ...template, elements: [...template.elements, el] });
    setSelectedIds([el.id]);
  };

  const insertField = (col: string) => {
    // “自动加项名”：插入内容自带前缀片段（如 姓名: [姓名]）
    const pre = autoPrefix ? [{ id: rid(), type: 'text', text: `${col}: ` } as LabelSegment] : [];
    if (selectedIds.length === 1) {
      const el = template.elements.find(e => e.id === selectedIds[0]);
      if (el && BINDABLE.includes(el.type)) {
        const segs = (el.segments && el.segments.length ? el.segments : legacySegments(el));
        commit({ ...template, elements: template.elements.map(e => e.id === el.id ? { ...e, segments: [...segs, ...pre, { id: rid(), type: 'field', field: col }] } : e) });
        return;
      }
    }
    const el = { ...elDefaults(LabelElementType.TEXT_DYNAMIC, col, template.elements.length), textAlign: 'left' as const };
    if (autoPrefix) el.segments = [...pre, { id: rid(), type: 'field', field: col }];
    commit({ ...template, elements: [...template.elements, el] });
    setSelectedIds([el.id]);
  };

  const updateSelected = (updates: Record<string, Partial<LabelElement>>) => {
    setTemplate({ ...template, elements: template.elements.map(el => updates[el.id] ? { ...el, ...updates[el.id] } : el) });
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const gids = new Set(template.elements.filter(e => selectedIds.includes(e.id) && e.groupId).map(e => e.groupId));
    const remove = new Set<string>(selectedIds);
    for (const el of template.elements) if (el.groupId && gids.has(el.groupId)) remove.add(el.id);
    commit({ ...template, elements: template.elements.filter(e => !remove.has(e.id)) });
    setSelectedIds([]);
  };

  const duplicate = () => {
    if (!selectedIds.length) return;
    const newEls = template.elements.filter(e => selectedIds.includes(e.id)).map(e => ({ ...e, id: generateId(), x: e.x + 3, y: e.y + 3, segments: e.segments?.map(s => ({ ...s, id: rid() })) }));
    commit({ ...template, elements: [...template.elements, ...newEls] });
    setSelectedIds(newEls.map(e => e.id));
  };

  /* ---------- 剪贴板（Ctrl+C / Ctrl+V，粘贴自动偏移防重叠） ---------- */
  const copySel = () => {
    const ids = new Set(selectedIds);
    clipboardRef.current = template.elements.filter(e => ids.has(e.id)).map(e => ({ ...e, segments: e.segments?.map(s => ({ ...s, id: rid() })) }));
  };
  const paste = () => {
    if (!clipboardRef.current.length) return;
    const newEls = clipboardRef.current.map(e => ({ ...e, id: generateId(), x: e.x + 3, y: e.y + 3 }));
    commit({ ...template, elements: [...template.elements, ...newEls] });
    setSelectedIds(newEls.map(e => e.id));
  };

  /* ---------- 翻转 / 快捷旋转（LabelNova 6.1） ---------- */
  const flipSelected = (axis: 'h' | 'v') => {
    if (!selectedIds.length) return;
    const updates: Record<string, Partial<LabelElement>> = {};
    for (const el of selectedEls) updates[el.id] = axis === 'h' ? { flipH: !el.flipH } : { flipV: !el.flipV };
    updateSelected(updates);
  };
  const rotateSelected = (deg: number) => {
    if (!selectedIds.length) return;
    const updates: Record<string, Partial<LabelElement>> = {};
    for (const el of selectedEls) updates[el.id] = { rotation: (((el.rotation || 0) + deg) % 360 + 360) % 360 };
    updateSelected(updates);
  };

  const moveSelected = (dx: number, dy: number) => {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    updateSelected(Object.fromEntries(template.elements.filter(e => ids.has(e.id)).map(e => [e.id, { x: Math.max(0, +(e.x + dx).toFixed(2)), y: Math.max(0, +(e.y + dy).toFixed(2)) }])));
  };

  /* ---------- 对齐 / 分布 ---------- */
  // 多选：以第一个选中元素为锚点；单选：以整个画布为锚点（绝对居中等，LabelNova 6.3）
  const align = (dir: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    if (selectedEls.length === 0) return;
    const anchor = selectedEls.length >= 2
      ? selectedEls[0]
      : { id: '', x: 0, y: 0, width: template.width, height: template.height };
    const next = template.elements.map(e => {
      if (!selectedIds.includes(e.id) || e.id === anchor.id) return e;
      let x = e.x, y = e.y;
      switch (dir) {
        case 'left': x = anchor.x; break;
        case 'hcenter': x = anchor.x + (anchor.width - e.width) / 2; break;
        case 'right': x = anchor.x + anchor.width - e.width; break;
        case 'top': y = anchor.y; break;
        case 'vcenter': y = anchor.y + (anchor.height - e.height) / 2; break;
        case 'bottom': y = anchor.y + anchor.height - e.height; break;
      }
      return { ...e, x: Math.max(0, +x.toFixed(2)), y: Math.max(0, +y.toFixed(2)) };
    });
    commit({ ...template, elements: next });
  };

  const distribute = (axis: 'h' | 'v') => {
    if (selectedEls.length < 3) return;
    const key = axis === 'h' ? 'x' : 'y';
    const sorted = [...selectedEls].sort((a, b) => a[key] - b[key]);
    const first = sorted[0][key], last = sorted[sorted.length - 1][key];
    const step = (last - first) / (sorted.length - 1);
    const byId = new Map(sorted.map((s, i) => [s.id, first + step * i]));
    const next = template.elements.map(e => {
      const v = byId.get(e.id);
      if (v === undefined) return e;
      return axis === 'h' ? { ...e, x: Math.max(0, +v.toFixed(2)) } : { ...e, y: Math.max(0, +v.toFixed(2)) };
    });
    commit({ ...template, elements: next });
  };

  /* ---------- 图层 ---------- */
  const moveLayer = (dir: 'front' | 'back' | 'forward' | 'backward') => {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    let arr = [...template.elements];
    if (dir === 'front' || dir === 'back') {
      const sel = arr.filter(e => ids.has(e.id));
      const rest = arr.filter(e => !ids.has(e.id));
      arr = dir === 'front' ? [...rest, ...sel] : [...sel, ...rest];
    } else if (dir === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) { [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; }
      }
    } else {
      for (let i = 1; i < arr.length; i++) {
        if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) { [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]; }
      }
    }
    commit({ ...template, elements: arr });
  };

  /* ---------- 编组 ---------- */
  const group = () => {
    if (selectedIds.length < 2) return;
    const existing = template.elements.find(e => selectedIds.includes(e.id) && e.groupId)?.groupId;
    const gid = existing || generateId();
    commit({ ...template, elements: template.elements.map(e => selectedIds.includes(e.id) ? { ...e, groupId: gid } : e) });
  };
  const ungroup = () => {
    const gids = new Set(template.elements.filter(e => selectedIds.includes(e.id) && e.groupId).map(e => e.groupId));
    if (!gids.size) return;
    commit({ ...template, elements: template.elements.map(e => (gids.has(e.groupId) ? { ...e, groupId: undefined } : e)) });
  };

  /* ---------- 缩放 / 平移 ---------- */
  const fit = () => {
    const vw = window.innerWidth - 620, vh = window.innerHeight - 190;
    const s = Math.min(vw / (template.width * 3.7795), vh / (template.height * 3.7795));
    setZoom(Math.min(4, Math.max(0.15, s * 0.92)));
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(z => Math.min(6, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.9))));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const mm = (e: MouseEvent) => {
      const p = panRef.current;
      if (p && viewportRef.current) {
        viewportRef.current.scrollLeft = p.sl - (e.clientX - p.x);
        viewportRef.current.scrollTop = p.st - (e.clientY - p.y);
      }
    };
    const mu = () => { panRef.current = null; };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
  }, []);

  const onViewportMouseDown = (e: React.MouseEvent) => {
    // 空格键按住时左键也可平移（LabelNova 2.3）；或中键平移
    if ((e.button === 1 || (spaceRef.current && e.button === 0)) && viewportRef.current) {
      e.preventDefault();
      panRef.current = { x: e.clientX, y: e.clientY, sl: viewportRef.current.scrollLeft, st: viewportRef.current.scrollTop };
    }
  };

  /* ---------- 空格键平移状态 ---------- */
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const tgt = e.target as HTMLElement;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
        spaceRef.current = true;
      }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    const blur = () => { spaceRef.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); };
  }, []);

  /* ---------- 键盘快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); handleSave(); }
      else if (mod && k === 'p') { e.preventDefault(); setShowPrint(true); }
      else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && k === 'y') { e.preventDefault(); redo(); }
      else if (mod && k === 'c') { e.preventDefault(); copySel(); }
      else if (mod && k === 'v') { e.preventDefault(); paste(); }
      else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
      else if (mod && k === 'a') { e.preventDefault(); setSelectedIds(template.elements.map(el => el.id)); }
      else if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroup() : group(); }
      else if (mod && e.key === '[') { e.preventDefault(); moveLayer('backward'); }
      else if (mod && e.key === ']') { e.preventDefault(); moveLayer('forward'); }
      else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom(z => Math.min(6, z * 1.25)); }
      else if (mod && e.key === '-') { e.preventDefault(); setZoom(z => Math.max(0.2, z * 0.8)); }
      else if (mod && e.key === '0') { e.preventDefault(); fit(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        const s = e.shiftKey ? 10 : 1;
        moveSelected(dx * s, dy * s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- 数据源解析（支持多 Sheet 切换，LabelNova 7.2） ---------- */
  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
    if (!rows.length) { alert('该工作表没有数据行'); return; }
    setDataRows(rows);
    setDataCols(Object.keys(rows[0]));
    setPreviewRow(0);
    setCurSheet(sheetName);
  };

  const parseFile = async (file: File) => {
    try {
      let wb: XLSX.WorkBook;
      if (/\.(csv|txt)$/i.test(file.name)) {
        const text = await file.text();
        wb = XLSX.read(text, { type: 'string' });
      } else {
        wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      }
      workbookRef.current = wb;
      setSheetNames(wb.SheetNames);
      loadSheet(wb, wb.SheetNames[0]);
    } catch (err) {
      alert('解析文件失败: ' + (err as any).message);
    }
  };

  // v2.12：种质库实时加载（标签数据第一来源）；Excel/CSV 路径保留给库外资源
  const [dbLoading, setDbLoading] = useState(false);
  const [dbSearch, setDbSearch] = useState('');
  const [dbHint, setDbHint] = useState('');
  const [traitNames, setTraitNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getTraits().then(r => {
      const m: Record<string, string> = {};
      for (const tr of (r.traits || [])) {
        m[tr.code] = (language === 'zh' ? (tr.nameZh || tr.nameEn) : (tr.nameEn || tr.nameZh)) || tr.code;
      }
      setTraitNames(m);
    }).catch(() => {});
  }, [language]);

  const DB_EXCLUDE_COLS = new Set(['id', '_id', 'stockTotal', 'stockForms', 'stockId', 'lastModifiedAt', 'lastModifiedBy', 'sourceUploadId', 'data_json', 'primary_id', 'display_name', 'last_modified_at', 'last_modified_by']);
  const loadDbAccessions = async (q?: string) => {
    setDbLoading(true);
    try {
      const res = q && q.trim()
        ? await api.searchAccessions(q.trim(), undefined, false, 1)
        : await api.getAccessions(1, 500);
      const rows: Record<string, any>[] = (res.accessions || []).map((a: any) => ({ ...a }));
      if (!rows.length) { alert(t('design.dbEmpty', language)); setDbLoading(false); return; }
      const base = ['primaryId', 'displayName', 'species', 'origin'];
      const extra: string[] = [];
      for (const r of rows) {
        for (const k of Object.keys(r)) {
          if (!base.includes(k) && !extra.includes(k) && !DB_EXCLUDE_COLS.has(k) && r[k] !== null && r[k] !== undefined) extra.push(k);
        }
      }
      workbookRef.current = null;
      setSheetNames([]);
      setCurSheet('');
      setDataRows(rows);
      setDataCols([...base, ...extra]);
      setPreviewRow(0);
      setDbHint(rows.length >= 500 ? t('design.dbCapped', language) : '');
    } catch (e: any) {
      alert(e.message);
    }
    setDbLoading(false);
  };

  /* ---------- 图片选择（自动轻量压缩，LabelNova 5.5） ---------- */
  const compressImage = (file: File, cb: (dataUrl: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      // 小图直接用；大图降采样到最长边 1200px（保持 PNG 透明度）
      if (file.size < 200 * 1024) { cb(src); return; }
      const img = new window.Image();
      img.onload = () => {
        const max = 1200;
        if (Math.max(img.width, img.height) <= max) { cb(src); return; }
        const k = max / Math.max(img.width, img.height);
        const cvs = document.createElement('canvas');
        cvs.width = Math.round(img.width * k);
        cvs.height = Math.round(img.height * k);
        cvs.getContext('2d')!.drawImage(img, 0, 0, cvs.width, cvs.height);
        cb(cvs.toDataURL('image/png'));
      };
      img.onerror = () => cb(src);
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (imgPickerFor && imgFileRef.current) imgFileRef.current.click();
  }, [imgPickerFor]);
  useEffect(() => {
    if (bgPicker && bgFileRef.current) bgFileRef.current.click();
  }, [bgPicker]);

  const onImgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !imgPickerFor) return;
    compressImage(f, dataUrl => {
      updateSelected({ [imgPickerFor]: { imageSrc: dataUrl } });
      setImgPickerFor(null);
    });
  };

  const onBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    compressImage(f, dataUrl => {
      commit({ ...template, backgroundImage: dataUrl });
      setBgPicker(false);
    });
  };

  /* ---------- 图标选择 ---------- */
  const onPickIcon = (name: string) => {
    if (!iconPickerFor) return;
    const el = template.elements.find(e => e.id === iconPickerFor);
    updateSelected({ [iconPickerFor]: { iconName: name, imageSrc: iconDataUrl(name, el?.color || '#000000', 128) } });
    setIconPickerFor(null);
  };

  const onWizardCreate = (tpl: LabelTemplate) => {
    loadTemplate(tpl);
    saveTemplate(tpl).catch(() => {});
    addRecent(tpl);
    setShowWizard(false);
  };

  /* ---------- 工具栏小组件 ---------- */
  const Tb: React.FC<{ onClick?: () => void; disabled?: boolean; title?: string; children: React.ReactNode }> = ({ onClick, disabled, title, children }) => (
    <button onClick={onClick} disabled={disabled} title={title}
      className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-[#2e7d32] disabled:opacity-25 disabled:cursor-not-allowed transition-all active:scale-95">
      {children}
    </button>
  );
  const Div = () => <div className="w-px h-6 bg-gray-200 mx-1" />;

  const TOOLS: { type: LabelElementType; icon: React.ReactNode; label: string; color?: string }[] = [
    { type: LabelElementType.TEXT_STATIC, icon: <Type className="w-5 h-5" />, label: t('design.el.static', language) },
    { type: LabelElementType.TEXT_DYNAMIC, icon: <AlignLeft className="w-5 h-5" />, label: t('design.el.dynamic', language), color: 'text-blue-600' },
    { type: LabelElementType.TEXT_PARAGRAPH, icon: <AlignLeft className="w-5 h-5" />, label: t('design.el.paragraph', language), color: 'text-indigo-500' },
    { type: LabelElementType.DATE, icon: <Calendar className="w-5 h-5" />, label: t('design.el.date', language), color: 'text-orange-500' },
    { type: LabelElementType.TABLE, icon: <Table2 className="w-5 h-5" />, label: t('design.el.table', language), color: 'text-pink-500' },
    { type: LabelElementType.BARCODE, icon: <Barcode className="w-5 h-5" />, label: t('design.el.barcode', language), color: 'text-purple-500' },
    { type: LabelElementType.QR_CODE, icon: <QrCode className="w-5 h-5" />, label: t('design.el.qr', language), color: 'text-teal-600' },
    { type: LabelElementType.RECTANGLE, icon: <Square className="w-5 h-5" />, label: t('design.el.rect', language) },
    { type: LabelElementType.CIRCLE, icon: <Circle className="w-5 h-5" />, label: t('design.el.circle', language) },
    { type: LabelElementType.LINE, icon: <Minus className="w-5 h-5" />, label: t('design.el.line', language) },
    { type: LabelElementType.IMAGE, icon: <Image className="w-5 h-5" />, label: t('design.el.image', language) },
    { type: LabelElementType.ICON, icon: <Star className="w-5 h-5" />, label: t('design.el.icon', language) },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50/50 relative overflow-hidden">
      {/* ============ 顶部工具栏 ============ */}
      <div className="flex items-center gap-1 px-3 py-2 bg-white border-b border-gray-100 shadow-sm z-20 flex-wrap shrink-0">
        <button onClick={() => setShowWizard(true)} className="btn-primary px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-xs shadow-lg shadow-green-900/15 active:scale-95 transition-all">
          <Plus className="w-4 h-4" /> {t('design.newLabel', language)}
        </button>
        <button onClick={handleSave} className="px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-700 hover:border-green-300 active:scale-95 transition-all">
          <Save className="w-4 h-4" /> {savedFlash ? '✓ 已保存' : t('common.save', language)}
        </button>
        <Div />
        <Tb onClick={undo} disabled={!historyRef.current.length} title="撤销 (Ctrl+Z)"><Undo2 className="w-4 h-4" /></Tb>
        <Tb onClick={redo} disabled={!redoRef.current.length} title="重做 (Ctrl+Y)"><Redo2 className="w-4 h-4" /></Tb>
        <Div />
        <Tb onClick={() => setZoom(z => Math.max(0.2, z * 0.8))} title="缩小"><ZoomOut className="w-4 h-4" /></Tb>
        <button onClick={fit} title="适应窗口 (Ctrl+0)" className="px-2 py-1 rounded-lg text-xs font-black text-gray-600 hover:bg-gray-100 min-w-[46px] text-center">{Math.round(zoom * 100)}%</button>
        <Tb onClick={() => setZoom(z => Math.min(6, z * 1.25))} title="放大"><ZoomIn className="w-4 h-4" /></Tb>
        <Tb onClick={fit} title="适应窗口"><Maximize2 className="w-4 h-4" /></Tb>
        <Div />
        <Tb onClick={() => align('left')} disabled={!selectedEls.length} title={`${t('design.alignLeft', language)}${selectedEls.length === 1 ? '（相对画布）' : ''}`}><AlignStartHorizontal className="w-4 h-4" /></Tb>
        <Tb onClick={() => align('hcenter')} disabled={!selectedEls.length} title={`${t('design.alignCenterH', language)}${selectedEls.length === 1 ? '（相对画布）' : ''}`}><AlignCenterHorizontal className="w-4 h-4" /></Tb>
        <Tb onClick={() => align('right')} disabled={!selectedEls.length} title={`${t('design.alignRight', language)}${selectedEls.length === 1 ? '（相对画布）' : ''}`}><AlignEndHorizontal className="w-4 h-4" /></Tb>
        <Tb onClick={() => align('top')} disabled={!selectedEls.length} title={`${t('design.alignTop', language)}${selectedEls.length === 1 ? '（相对画布）' : ''}`}><AlignStartVertical className="w-4 h-4" /></Tb>
        <Tb onClick={() => align('vcenter')} disabled={!selectedEls.length} title={`${t('design.alignCenterV', language)}${selectedEls.length === 1 ? '（相对画布）' : ''}`}><AlignCenterVertical className="w-4 h-4" /></Tb>
        <Tb onClick={() => align('bottom')} disabled={!selectedEls.length} title={`${t('design.alignBottom', language)}${selectedEls.length === 1 ? '（相对画布）' : ''}`}><AlignEndVertical className="w-4 h-4" /></Tb>
        <Tb onClick={() => distribute('h')} disabled={selectedEls.length < 3} title={t('design.distH', language)}><MoveHorizontal className="w-4 h-4" /></Tb>
        <Tb onClick={() => distribute('v')} disabled={selectedEls.length < 3} title={t('design.distV', language)}><MoveVertical className="w-4 h-4" /></Tb>
        <Div />
        <Tb onClick={() => flipSelected('h')} disabled={!selectedIds.length} title={t('design.flipH', language)}><FlipHorizontal className="w-4 h-4" /></Tb>
        <Tb onClick={() => flipSelected('v')} disabled={!selectedIds.length} title={t('design.flipV', language)}><FlipVertical className="w-4 h-4" /></Tb>
        <Tb onClick={() => rotateSelected(-45)} disabled={!selectedIds.length} title={t('design.rotateCCW', language)}><RotateCcw className="w-4 h-4" /></Tb>
        <Tb onClick={() => rotateSelected(45)} disabled={!selectedIds.length} title={t('design.rotateCW', language)}><RotateCw className="w-4 h-4" /></Tb>
        <Div />
        <Tb onClick={() => moveLayer('front')} disabled={!selectedIds.length} title="置顶"><ChevronsUp className="w-4 h-4" /></Tb>
        <Tb onClick={() => moveLayer('forward')} disabled={!selectedIds.length} title={t('design.bringForward', language)}><ChevronUp className="w-4 h-4" /></Tb>
        <Tb onClick={() => moveLayer('backward')} disabled={!selectedIds.length} title={t('design.sendBackward', language)}><ChevronDown className="w-4 h-4" /></Tb>
        <Tb onClick={() => moveLayer('back')} disabled={!selectedIds.length} title="置底"><ChevronsDown className="w-4 h-4" /></Tb>
        <Div />
        <Tb onClick={group} disabled={selectedEls.length < 2} title="编组 (Ctrl+G)"><FolderOpen className="w-4 h-4" /></Tb>
        <Tb onClick={ungroup} disabled={!selectedIds.length} title="取消编组 (Ctrl+Shift+G)"><Ungroup className="w-4 h-4" /></Tb>
        <Tb onClick={duplicate} disabled={!selectedIds.length} title="复制 (Ctrl+D)"><Copy className="w-4 h-4" /></Tb>
        <Tb onClick={deleteSelected} disabled={!selectedIds.length} title={t('design.deleteEl', language)}><Trash2 className="w-4 h-4 text-red-400" /></Tb>
        <Div />
        <Tb onClick={() => setShowVars(true)} title={t('design.variables', language)}><Variable className="w-4 h-4" /></Tb>
        <div className="flex-1" />
        <button onClick={() => setShowPrint(true)} className="btn-primary px-4 py-2 rounded-xl font-black flex items-center gap-1.5 text-xs shadow-lg shadow-green-900/20 active:scale-95 transition-all">
          <Printer className="w-4 h-4" /> {t('design.print', language)}
        </button>
      </div>

      {/* ============ 主体 ============ */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧面板 */}
        <aside className="w-60 shrink-0 border-r border-gray-100 bg-white/80 backdrop-blur flex flex-col overflow-y-auto custom-scrollbar z-10">
          {/* 组件库 */}
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><MousePointer2 className="w-3 h-3" /> {t('design.elements', language)}</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {TOOLS.map(tool => (
                <button key={tool.type} onClick={() => addElement(tool.type)} title={tool.label}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-gray-50 hover:bg-[#e8f5e9] hover:text-[#2e7d32] hover:scale-105 transition-all text-gray-500 border border-gray-100">
                  <span className={`${tool.color || ''}`}>{tool.icon}</span>
                  <span className="text-[9px] font-bold leading-none">{tool.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 数据源 */}
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><FileSpreadsheet className="w-3 h-3" /> {t('design.dataSource', language)}</h3>
            <div className="flex gap-1.5 mb-2">
              <button onClick={() => dataFileRef.current?.click()} className="flex-1 text-[10px] font-bold py-2 rounded-lg bg-[#e8f5e9] hover:bg-green-100 text-[#2e7d32] flex items-center justify-center gap-1">
                <Upload className="w-3 h-3" /> Excel / CSV
              </button>
              <button onClick={() => loadDbAccessions(dbSearch)} disabled={dbLoading} title={t('design.loadDbHint', language)}
                className="flex-1 text-[10px] font-bold py-2 rounded-lg bg-white border border-gray-200 hover:border-green-300 text-gray-600 flex items-center justify-center gap-1 disabled:opacity-50">
                <Database className="w-3 h-3" /> {dbLoading ? '...' : t('design.loadDb', language)}
              </button>
              <input ref={dataFileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) parseFile(f); }} />
            </div>
            <div className="flex gap-1 mb-2">
              <input value={dbSearch} onChange={e => setDbSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadDbAccessions(dbSearch); }}
                placeholder={t('design.dbSearchPh', language)} className="flex-1 glass-input rounded p-1.5 text-[10px]" />
              <button onClick={() => loadDbAccessions(dbSearch)} disabled={dbLoading} className="px-2 rounded bg-gray-100 hover:bg-gray-200 text-[10px] font-bold text-gray-500 disabled:opacity-50">GO</button>
            </div>
            {dbHint && <div className="text-[10px] text-amber-600 mb-1.5">{dbHint}</div>}
            {/* 多工作表切换（LabelNova 7.2） */}
            {sheetNames.length > 1 && (
              <div className="mb-2 flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 font-bold shrink-0">Sheet</span>
                <select
                  value={curSheet}
                  onChange={e => { if (workbookRef.current) loadSheet(workbookRef.current, e.target.value); }}
                  className="flex-1 glass-input rounded p-1.5 text-[10px] bg-white/50">
                  {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {dataRows.length > 0 ? (
              <div className="text-[10px] text-gray-500 mb-1.5 flex items-center justify-between">
                <span>共 <b className="text-[#2e7d32]">{dataRows.length}</b> 条记录</span>
                <button onClick={() => { setDataRows([]); setDataCols(DEFAULT_DATA_COLS); setSheetNames([]); setCurSheet(''); workbookRef.current = null; }} className="text-red-400 hover:text-red-600 font-bold">清除</button>
              </div>
            ) : (
              <div className="text-[10px] text-gray-300 mb-1.5">{t('design.noDataSource', language)}</div>
            )}
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 mb-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={autoPrefix} onChange={e => setAutoPrefix(e.target.checked)} className="w-3.5 h-3.5 rounded text-[#2e7d32] focus:ring-[#2e7d32]" />
              {t('design.autoPrefix', language)}
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {dataCols.map(c => (
                <button key={c} onClick={() => insertField(c)} title={`插入字段: ${c}`}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 hover:scale-105 transition-all border border-blue-100">{traitNames[c] ? `${traitNames[c]} (${c})` : c}</button>
              ))}
            </div>
            {dataRows.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <span>预览行</span>
                <button onClick={() => setPreviewRow(Math.max(0, previewRow - 1))} disabled={previewRow <= 0} className="px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30">−</button>
                <b className="text-[#2e7d32]">{Math.min(previewRow + 1, dataRows.length)} / {dataRows.length}</b>
                <button onClick={() => setPreviewRow(Math.min(dataRows.length - 1, previewRow + 1))} disabled={previewRow >= dataRows.length - 1} className="px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30">+</button>
              </div>
            )}
          </div>

          {/* 最近编辑 */}
          {recent.length > 0 && (
            <div className="p-3 border-b border-gray-100">
              <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{t('recent.title', language)}</h3>
              <div className="space-y-1">
                {recent.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-1 group">
                    <button onClick={() => { const tpl = templates.find(x => x.id === r.id); if (tpl) loadTemplate(tpl); }}
                      className="flex-1 text-left text-[11px] font-bold text-gray-600 hover:text-[#2e7d32] py-1 px-2 rounded hover:bg-[#e8f5e9] truncate">
                      {r.name}
                    </button>
                    <button onClick={() => { const tpl = templates.find(x => x.id === r.id); if (tpl) setShowPrint(true); }}
                      title={t('recent.print', language)} className="p-1 rounded hover:bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100">
                      <Printer className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 模版库 */}
          <div className="p-3 flex-1">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <FolderOpen className="w-3 h-3" /> {t('design.library', language)}
              <span className="ml-auto text-gray-300 font-normal">{templates.length}</span>
            </h3>
            <div className="space-y-1">
              {templates.map(tpl => (
                <div key={tpl.id} className="flex items-center justify-between gap-1 group">
                  <button onClick={() => loadTemplate(tpl)}
                    className={`flex-1 text-left text-[11px] font-bold py-1 px-2 rounded truncate ${tpl.id === template.id ? 'bg-[#e8f5e9] text-[#2e7d32]' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {tpl.name}
                  </button>
                  <button onClick={() => { if (confirm(`删除模版「${tpl.name}」？`)) deleteTemplate(tpl.id); }}
                    className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {templates.length === 0 && <div className="text-[10px] text-gray-300 text-center py-4">{t('design.noDataSource', language)}</div>}
            </div>
          </div>
        </aside>

        {/* 中央画布 */}
        <div ref={viewportRef} onMouseDown={onViewportMouseDown}
          className="flex-1 relative overflow-auto custom-scrollbar bg-gray-100/60"
          style={{ backgroundImage: 'radial-gradient(#d9d9d9 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
          <div className="min-w-full min-h-full flex items-center justify-center p-8">
            {/* 带毫米标尺的画布（LabelNova 2.2） */}
            <div className="shrink-0">
              <div className="flex">
                <div style={{ width: RULER_SIZE, height: RULER_SIZE }} className="bg-white border-b border-r border-gray-300" />
                <RulerH wmm={template.width} pxPerMm={3.7795 * zoom} />
              </div>
              <div className="flex">
                <RulerV hmm={template.height} pxPerMm={3.7795 * zoom} />
                <div className="bg-white shadow-2xl rounded-sm ring-1 ring-black/5 overflow-hidden" style={{ width: template.width * 3.7795 * zoom, height: template.height * 3.7795 * zoom }}>
                  <LabelCanvas
                    template={template}
                    data={previewData}
                    rowIndex={previewRow}
                    primaryIdColumn={primaryIdColumn}
                    scale={zoom}
                    selectedElementIds={selectedIds}
                    onSelectElements={(ids, additive) => {
                      if (additive) setSelectedIds(prev => [...new Set([...prev, ...ids])]);
                      else setSelectedIds(ids);
                    }}
                    onUpdateElements={updateSelected}
                  />
                </div>
              </div>
            </div>
          </div>
          {template.elements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-gray-300">
                <MousePointer2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-bold">点击左侧组件库添加元素</p>
                <p className="text-[11px] mt-1">滚轮缩放 · Ctrl+滚轮 · 中键拖动平移 · Ctrl+Z 撤销</p>
              </div>
            </div>
          )}
        </div>

        {/* 右侧属性 */}
        <aside className="w-72 shrink-0 border-l border-gray-100 bg-white/80 backdrop-blur overflow-y-auto custom-scrollbar z-10">
          <div className="sticky top-0 bg-white/90 backdrop-blur px-4 pt-3 pb-2 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('design.properties', language)}</h2>
            <span className="text-[10px] text-gray-400 font-bold">{selectedEls.length ? `${selectedEls.length} 项选中` : ''}</span>
          </div>
          <div className="p-4">
            <ElementProperties
              language={language}
              template={template}
              selectedIds={selectedIds}
              columns={dataCols.length ? dataCols : DEFAULT_DATA_COLS}
              primaryIdColumn={primaryIdColumn}
              variableNames={variableNames}
              onUpdateTemplate={setTemplate}
              onDeleteSelected={deleteSelected}
              onOpenImagePicker={(id) => setImgPickerFor(id)}
              onOpenIconPicker={(id) => setIconPickerFor(id)}
              onOpenBgImage={() => setBgPicker(true)}
            />
          </div>
        </aside>
      </div>

      {/* ============ 隐藏输入与弹窗 ============ */}
      <input ref={imgFileRef} type="file" accept="image/*" className="hidden" onChange={onImgChange} />
      <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={onBgChange} />

      <NewLabelWizard open={showWizard} language={language} onCancel={() => setShowWizard(false)} onCreate={onWizardCreate} />
      <IconPicker open={!!iconPickerFor} language={language} onCancel={() => setIconPickerFor(null)} onPick={onPickIcon} />
      <VariablesManager
        open={showVars}
        language={language}
        variables={template.variables || {}}
        onChange={vars => setTemplate({ ...template, variables: vars })}
        onCancel={() => setShowVars(false)} />
      <PrintModal open={showPrint} template={template} rows={dataRows.length ? dataRows : [{}]} onClose={() => setShowPrint(false)} />
    </div>
  );
};

export default LabelDesigner;
