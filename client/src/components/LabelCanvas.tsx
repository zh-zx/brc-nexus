import React, { useState, useEffect, useRef } from 'react';
import { LabelTemplate, LabelElement } from '../types';
import { mmToPx, findValue, hasData, resolveSegments, elementInnerHtml } from '../lib/labelUtil';

interface LabelCanvasProps {
  template: LabelTemplate;
  data?: Record<string, any>;
  rowIndex?: number;
  primaryIdColumn?: string;
  scale?: number;                        // 显示倍率（CSS transform scale）
  variables?: Record<string, any>;
  // 交互（设计器传入后启用拖拽/缩放/多选）
  selectedElementIds?: string[];
  onSelectElements?: (ids: string[], additive?: boolean) => void;
  onUpdateElements?: (updates: Record<string, Partial<LabelElement>>) => void;
  // 兼容旧接口
  selectedElementId?: string;
  onSelectElement?: (id: string) => void;
  onUpdateElement?: (id: string, updates: Partial<LabelElement>) => void;
  className?: string;
}

const PX_PER_MM = 3.7795275591;

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState {
  mode: 'move' | 'resize' | 'rotate' | 'box';
  startX: number;
  startY: number;
  startGeoms: Record<string, { x: number; y: number; w: number; h: number; rot: number }>;
  handleDir?: HandleDir;
  boxStartMm?: { x: number; y: number };
  boxEndMm?: { x: number; y: number };
  additive?: boolean;
}

export const LabelCanvas: React.FC<LabelCanvasProps> = ({
  template, data = {}, rowIndex = 0, primaryIdColumn = 'cccapNo', scale = 1,
  variables, selectedElementIds = [], onSelectElements, onUpdateElements,
  selectedElementId, onSelectElement, onUpdateElement,
  className
}) => {
  const zoom = scale;
  const interactive = !!(onSelectElements && onUpdateElements);
  const widthPx = mmToPx(template.width) * zoom;
  const heightPx = mmToPx(template.height) * zoom;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [boxRect, setBoxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // 兼容旧接口：如果没有新版多选 props，退化为单选
  const effSelected = onSelectElements ? selectedElementIds : (selectedElementId ? [selectedElementId] : []);

  const resolveText = (el: LabelElement): { text: string; isError: boolean } => {
    const fieldName = el.field || (el.type === 'QR_CODE' || el.type === 'BARCODE' ? primaryIdColumn : '');
    const vars = { operator: (data as any)?.operator, medium: (data as any)?.medium, ...(template.variables || {}), ...(variables || {}) };
    const resolved = resolveSegments(el, { data, rowIndex, variables: vars });
    let text = resolved.text;
    let isError = resolved.isError;
    // 旧字段兼容
    if (!el.segments || el.segments.length === 0) {
      if (el.type === 'TEXT_DYNAMIC' || el.type === 'BARCODE') {
        const v = findValue(data, fieldName);
        if (hasData(data) && (v === undefined || v === '')) isError = true;
      }
      if (el.type === 'QR_CODE') {
        const v = findValue(data, fieldName);
        if (hasData(data) && (v === undefined || v === '')) { text = 'NO-DATA'; isError = true; }
      }
      if (el.type === 'TEXT_STATIC') text = el.content || '';
      if (el.type === 'DATE') text = resolveSegments(el, { data, rowIndex, variables: vars }).text;
    }
    return { text, isError };
  };

  // 计算被拖动的元素集合（含编组成员）
  const getMoveIds = (ids: string[]): string[] => {
    const out = new Set<string>(ids);
    for (const el of template.elements) {
      if (el.groupId && ids.some(id => template.elements.find(e => e.id === id)?.groupId === el.groupId)) out.add(el.id);
    }
    return Array.from(out);
  };

  const screenToMm = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / (PX_PER_MM * zoom),
      y: (clientY - rect.top) / (PX_PER_MM * zoom),
    };
  };

  const selectIds = (ids: string[], additive: boolean) => {
    if (onSelectElements) {
      onSelectElements(ids, additive);
    } else if (onSelectElement) {
      onSelectElement(ids[0] || '');
    }
  };

  const applyUpdates = (updates: Record<string, Partial<LabelElement>>) => {
    if (onUpdateElements) onUpdateElements(updates);
    else if (onUpdateElement) {
      const entry = Object.entries(updates)[0];
      if (entry) onUpdateElement(entry[0], entry[1]);
    }
  };

  /* ---------- 元素按下：选择 + 开始移动 ---------- */
  const handleElementMouseDown = (e: React.MouseEvent, el: LabelElement) => {
    if (!interactive) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const moveIds = getMoveIds([el.id]);
    // 选中（点击未选中元素 = 单选）
    if (!additive && !(effSelected.includes(el.id) || (el.groupId && effSelected.some(id => template.elements.find(x => x.id === id)?.groupId === el.groupId)))) {
      selectIds(moveIds, false);
    } else if (additive) {
      const already = effSelected.some(id => moveIds.includes(id));
      if (already) selectIds(effSelected.filter(id => !moveIds.includes(id)), false);
      else selectIds([...new Set([...effSelected, ...moveIds])], false);
    }
    // 开始移动
    const start = screenToMm(e.clientX, e.clientY);
    const geoms: DragState['startGeoms'] = {};
    for (const id of moveIds) {
      const m = template.elements.find(x => x.id === id);
      if (m) geoms[id] = { x: m.x, y: m.y, w: m.width, h: m.height, rot: m.rotation || 0 };
    }
    dragRef.current = { mode: 'move', startX: start.x, startY: start.y, startGeoms: geoms };
  };

  /* ---------- 控制点 ---------- */
  const startResize = (e: React.MouseEvent, dir: HandleDir) => {
    if (!interactive) return;
    e.stopPropagation();
    const id = effSelected[0];
    const el = template.elements.find(x => x.id === id);
    if (!el) return;
    const start = screenToMm(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'resize', startX: start.x, startY: start.y, handleDir: dir,
      startGeoms: { [id]: { x: el.x, y: el.y, w: el.width, h: el.height, rot: el.rotation || 0 } },
    };
  };

  const startRotate = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    const id = effSelected[0];
    const el = template.elements.find(x => x.id === id);
    if (!el) return;
    dragRef.current = {
      mode: 'rotate', startX: 0, startY: 0,
      startGeoms: { [id]: { x: el.x, y: el.y, w: el.width, h: el.height, rot: el.rotation || 0 } },
    };
  };

  /* ---------- 画布空白：框选 ---------- */
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (!interactive) return;
    // 中键（或任意带 data-pan 的父级平移手柄）交给父级处理平移
    if (e.button === 1) return;
    const start = screenToMm(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'box', startX: start.x, startY: start.y,
      startGeoms: {},
      boxStartMm: start, boxEndMm: start,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    };
  };

  /* ---------- 全局移动/抬起 ---------- */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'move') {
        const cur = screenToMm(e.clientX, e.clientY);
        const dx = cur.x - d.startX;
        const dy = cur.y - d.startY;
        const updates: Record<string, Partial<LabelElement>> = {};
        for (const [id, g] of Object.entries(d.startGeoms)) {
          updates[id] = { x: Math.max(0, Number((g.x + dx).toFixed(2))), y: Math.max(0, Number((g.y + dy).toFixed(2))) };
        }
        applyUpdates(updates);
      } else if (d.mode === 'resize' && d.handleDir && d.startGeoms) {
        const cur = screenToMm(e.clientX, e.clientY);
        const dx = cur.x - d.startX;
        const dy = cur.y - d.startY;
        const [id, g] = Object.entries(d.startGeoms)[0];
        const dir = d.handleDir;
        let x = g.x, y = g.y, w = g.w, h = g.h;
        const min = 2;
        if (dir.includes('e')) w = Math.max(min, g.w + dx);
        if (dir.includes('s')) h = Math.max(min, g.h + dy);
        if (dir.includes('w')) { w = Math.max(min, g.w - dx); x = g.x + (g.w - w); }
        if (dir.includes('n')) { h = Math.max(min, g.h - dy); y = g.y + (g.h - h); }
        applyUpdates({ [id]: { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), width: Number(w.toFixed(2)), height: Number(h.toFixed(2)) } });
      } else if (d.mode === 'rotate' && d.startGeoms) {
        const [id, g] = Object.entries(d.startGeoms)[0];
        const cur = screenToMm(e.clientX, e.clientY);
        const cx = g.x + g.w / 2;
        const cy = g.y + g.h / 2;
        let ang = (Math.atan2(cur.y - cy, cur.x - cx) * 180 / Math.PI) + 90;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        ang = Math.round(ang);
        applyUpdates({ [id]: { rotation: ((ang % 360) + 360) % 360 } });
      } else if (d.mode === 'box' && d.boxStartMm) {
        const cur = screenToMm(e.clientX, e.clientY);
        d.boxEndMm = cur;
        setBoxRect({
          x: Math.min(d.boxStartMm.x, cur.x),
          y: Math.min(d.boxStartMm.y, cur.y),
          w: Math.abs(cur.x - d.boxStartMm.x),
          h: Math.abs(cur.y - d.boxStartMm.y),
        });
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'box' && d.boxStartMm && d.boxEndMm && onSelectElements) {
        const x0 = Math.min(d.boxStartMm.x, d.boxEndMm.x);
        const y0 = Math.min(d.boxStartMm.y, d.boxEndMm.y);
        const x1 = Math.max(d.boxStartMm.x, d.boxEndMm.x);
        const y1 = Math.max(d.boxStartMm.y, d.boxEndMm.y);
        const hit = template.elements
          .filter(el => {
            const ex0 = el.x, ey0 = el.y, ex1 = el.x + el.width, ey1 = el.y + el.height;
            return ex0 <= x1 && ex1 >= x0 && ey0 <= y1 && ey1 >= y0;
          })
          .map(el => el.id);
        if (hit.length > 0) {
          const additive = d.additive;
          onSelectElements(additive ? [...new Set([...effSelected, ...hit])] : hit, false);
        } else if (!d.additive) {
          onSelectElements([], false);
        }
      }
      setBoxRect(null);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [interactive, zoom, template.elements]);

  /* ---------- 渲染 ---------- */
  const selected = new Set(effSelected);

  return (
    <div ref={containerRef} data-pan className={`relative ${className}`}
      style={{ width: widthPx, height: heightPx }}
      onMouseDown={interactive ? handleCanvasMouseDown : undefined}
      onClick={() => { if (interactive && !dragRef.current) selectIds([], false); }}>
      <div style={{
        width: `${template.width}mm`, height: `${template.height}mm`,
        transform: `scale(${zoom})`, transformOrigin: '0 0',
        position: 'absolute', top: 0, left: 0,
      }}>
        {/* 背景 */}
        {template.backgroundColor && (
          <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: template.backgroundColor }} />
        )}
        {template.backgroundImage && (
          <img src={template.backgroundImage} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {/* 元素 */}
        {template.elements.map((el) => {
          const isSel = selected.has(el.id);
          const { text, isError } = resolveText(el);
          const content = elementInnerHtml(el, text, isError);
          return (
            <div key={el.id}
              onMouseDown={interactive ? (e) => handleElementMouseDown(e, el) : undefined}
              onClick={(e) => { e.stopPropagation(); }}
              className={isSel && interactive ? 'outline outline-2 outline-blue-500' : ''}
              style={{
                position: 'absolute',
                left: `${el.x}mm`, top: `${el.y}mm`,
                width: `${el.width}mm`, height: `${el.height}mm`,
                transform: el.rotation || el.flipH || el.flipV
                  ? `${el.rotation ? `rotate(${el.rotation}deg) ` : ''}${el.flipH ? 'scaleX(-1) ' : ''}${el.flipV ? 'scaleY(-1)' : ''}`.trim()
                  : undefined,
                cursor: interactive ? 'move' : 'default',
                overflow: 'hidden',
                zIndex: 10,
              }}>
              <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: content }} />
            </div>
          );
        })}

        {/* 多选框 */}
        {boxRect && (
          <div style={{
            position: 'absolute', left: `${boxRect.x}mm`, top: `${boxRect.y}mm`,
            width: `${boxRect.w}mm`, height: `${boxRect.h}mm`,
            border: '0.2mm dashed #2563eb', background: 'rgba(37,99,235,0.08)', zIndex: 999, pointerEvents: 'none',
          }} />
        )}

        {/* 选中控制点（单元素） */}
        {interactive && selected.size === 1 && (() => {
          const el = template.elements.find(x => x.id === effSelected[0]);
          if (!el) return null;
          const hs = 1.6; // 控制点边长 mm
          const pos: Record<HandleDir, { x: number; y: number }> = {
            nw: { x: el.x, y: el.y },
            n: { x: el.x + el.width / 2, y: el.y },
            ne: { x: el.x + el.width, y: el.y },
            e: { x: el.x + el.width, y: el.y + el.height / 2 },
            se: { x: el.x + el.width, y: el.y + el.height },
            s: { x: el.x + el.width / 2, y: el.y + el.height },
            sw: { x: el.x, y: el.y + el.height },
            w: { x: el.x, y: el.y + el.height / 2 },
          };
          const cursors: Record<HandleDir, string> = {
            nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
            e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
            sw: 'nesw-resize', w: 'ew-resize',
          };
          return (
            <>
              {/* 旋转手柄 */}
              <div style={{ position: 'absolute', left: `${el.x + el.width / 2}mm`, top: `${el.y - 3}mm`, width: 0, height: 3, borderLeft: '0.15mm dashed #2563eb' }} />
              <div
                onMouseDown={startRotate}
                style={{
                  position: 'absolute', left: `${el.x + el.width / 2 - hs / 2}mm`, top: `${el.y - 3 - hs / 2}mm`,
                  width: `${hs}mm`, height: `${hs}mm`, background: '#fff', border: '0.25mm solid #2563eb',
                  borderRadius: '50%', cursor: 'grab', zIndex: 1000,
                }} />
              {Object.entries(pos).map(([dir, p]) => (
                <div key={dir}
                  onMouseDown={(e) => startResize(e, dir as HandleDir)}
                  style={{
                    position: 'absolute',
                    left: `${p.x - hs / 2}mm`, top: `${p.y - hs / 2}mm`,
                    width: `${hs}mm`, height: `${hs}mm`,
                    background: '#fff', border: '0.2mm solid #2563eb', cursor: cursors[dir as HandleDir], zIndex: 1000,
                  }} />
              ))}
            </>
          );
        })()}

        {/* 多选外框 */}
        {interactive && selected.size > 1 && (() => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const el of template.elements) {
            if (!selected.has(el.id)) continue;
            x0 = Math.min(x0, el.x); y0 = Math.min(y0, el.y);
            x1 = Math.max(x1, el.x + el.width); y1 = Math.max(y1, el.y + el.height);
          }
          if (x0 === Infinity) return null;
          return (
            <div style={{
              position: 'absolute', left: `${x0}mm`, top: `${y0}mm`,
              width: `${x1 - x0}mm`, height: `${y1 - y0}mm`,
              border: '0.2mm dashed #2563eb', pointerEvents: 'none', zIndex: 900,
            }} />
          );
        })()}
      </div>
    </div>
  );
};
