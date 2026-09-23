import React, { useEffect, useRef, useState } from 'react';

// v2.17 工作台控制室动效原语
// 性能预算：持续动效只用 transform / opacity；rAF 一次性计数完成即停（无常驻循环）；
// 实时钟是唯一常驻定时器。全部走 --t-* token，两主题一致。

export const prefersReduced = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 一次性数字计数：0→target，easeOutCubic，完成即停；reduced 或 target<1 直接落值
export function useCountUp(target: number, duration = 650): number {
  const safe = Number.isFinite(target) ? target : 0;
  const [val, setVal] = useState(() => (prefersReduced() || safe < 1 ? safe : 0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReduced() || safe < 1) { setVal(safe); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(safe * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [safe, duration]);

  return val;
}

export const CountUp: React.FC<{ value: number; className?: string }> = ({ value, className }) => {
  const v = useCountUp(value);
  return <span className={className}>{v}</span>;
};

// 1Hz 本地时钟，独立叶子组件（只它 setState，不牵动父树）
export const LiveClock: React.FC<{ className?: string }> = ({ className }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    <span className={`cr-tabnum ${className || ''}`} data-testid="live-clock">
      {`${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`}
    </span>
  );
};

// 手绘 SVG 折线（一次性描边 cr-draw），颜色走 --t-accent
export const Sparkline: React.FC<{ data: number[]; width?: number; height?: number }> = ({
  data, width = 240, height = 46,
}) => {
  const n = data.length;
  if (n === 0) return null;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = (max - min) || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (n - 1 || 1);
  const pts = data.map((v, i) =>
    [pad + i * stepX, height - pad - ((v - min) / range) * (height - pad * 2)] as [number, number]);
  const line = pts.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${(width - pad).toFixed(1)},${height - pad}`;
  const len = pts.slice(1).reduce((a, q, i) => { const r = pts[i]; return a + Math.hypot(q[0] - r[0], q[1] - r[1]); }, 0) || 1;
  const lineStyle = { strokeDasharray: len, '--cr-len': len } as React.CSSProperties;
  return (
    <svg data-testid="cr-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" style={{ overflow: 'visible' }}>
      <polygon points={area} fill="var(--t-accent)" opacity={0.12} />
      <polyline className="cr-draw" points={line} fill="none" stroke="var(--t-accent)"
        strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={lineStyle} />
    </svg>
  );
};

// 吞吐趋势芯片（span，非实心 button）：近段 cur vs 前段 prev
export const DeltaChip: React.FC<{ cur: number; prev: number; upLabel: string; downLabel: string; flatLabel: string }> = ({
  cur, prev, upLabel, downLabel, flatLabel,
}) => {
  const color = cur > prev ? 'var(--t-quality-ok)' : cur < prev ? 'var(--t-quality-bad)' : 'var(--t-text-dim)';
  const arrow = cur === prev ? '→' : cur > prev ? '▲' : '▼';
  const label = cur === prev ? flatLabel : cur > prev ? upLabel : downLabel;
  return (
    <span data-testid="cr-delta" className="inline-flex items-center gap-1.5 text-xs font-bold cr-tabnum" style={{ color }}>
      <span aria-hidden>{arrow}</span><span>{cur}</span><span className="opacity-70">{label}</span>
    </span>
  );
};

// 纯 CSS 迷你条（一次性宽度过渡）
export const MiniBar: React.FC<{ value: number; max: number; danger?: boolean }> = ({ value, max, danger }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const bg = danger && value > 0 ? 'var(--t-quality-bad)' : 'var(--t-accent)';
  return (
    <div className="h-1.5 w-full overflow-hidden" style={{ background: 'var(--t-pill-muted-bg)' }}>
      <div className="h-full" style={{ width: `${pct}%`, background: bg, transition: 'width .6s ease' }} />
    </div>
  );
};
