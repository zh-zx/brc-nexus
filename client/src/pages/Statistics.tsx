import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { BarChart3, ArrowDownToLine, ArrowUpFromLine, ClipboardList, Snowflake, RefreshCw } from 'lucide-react';

// 纯 SVG 横向柱状图
const HBars: React.FC<{ data: { label: string; value: number }[]; color?: string; emptyText?: string }> = ({ data, color = '#2e7d32', emptyText }) => {
  const max = Math.max(1, ...data.map(d => d.value));
  if (data.length === 0) return <div className="py-6 text-center text-gray-300 text-xs">{emptyText || '—'}</div>;
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-32 truncate text-gray-500 text-right shrink-0">{d.label}</span>
          <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
            <div className="h-full rounded flex items-center justify-end pr-1.5 text-white text-[10px] font-bold transition-all duration-500"
              style={{ width: `${Math.max(4, (d.value / max) * 100)}%`, background: color }}>
              {d.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// 月度趋势（SVG 折线+柱）
const Monthly: React.FC<{ data: { ym: string; c: number }[] }> = ({ data }) => {
  if (data.length === 0) return <div className="py-6 text-center text-gray-300 text-xs">{'—'}</div>;
  const max = Math.max(1, ...data.map(d => d.c));
  const W = 560, H = 140, pad = 28;
  const bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map(g => (
        <line key={g} x1={pad} x2={W - pad} y1={H - pad - (H - pad * 2) * g} y2={H - pad - (H - pad * 2) * g} stroke="#f0f0f0" strokeDasharray="3 3" />
      ))}
      {data.map((d, i) => {
        const h = ((d.c / max) * (H - pad * 2 - 10));
        const x = pad + i * bw + bw * 0.2;
        const y = H - pad - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw * 0.6} height={h} rx={3} fill="#2e7d32" opacity={0.85}>
              <title>{`${d.ym}: ${d.c}`}</title>
            </rect>
            <text x={x + bw * 0.3} y={y - 4} textAnchor="middle" fontSize="9" fill="#666" fontWeight="bold">{d.c}</text>
            <text x={x + bw * 0.3} y={H - pad + 12} textAnchor="middle" fontSize="8" fill="#999">{d.ym.slice(2)}</text>
          </g>
        );
      })}
    </svg>
  );
};

const StatCard: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-white/70 border border-gray-100 rounded-xl p-4">
    <p className="text-[10px] font-bold text-gray-400 uppercase">{label}</p>
    <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
    {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
  </div>
);

const Statistics: React.FC = () => {
  const { language } = useApp();
  const [range, setRange] = useState<any>({ from: '', to: '' });
  const [stats, setStats] = useState<any>(null);
  const [tab, setTab] = useState('intro');

  const load = useCallback(async () => {
    try {
      const res = await api.getStatsOverview(range.from || undefined, range.to || undefined);
      setStats(res);
    } catch (e) {}
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: 'intro', label: t('stats.intro', language), icon: ArrowDownToLine, color: '#2e7d32' },
    { key: 'dist', label: t('stats.dist', language), icon: ArrowUpFromLine, color: '#1976d2' },
    { key: 'ops', label: t('stats.ops', language), icon: ClipboardList, color: '#e65100' },
    { key: 'cryo', label: t('stats.cryo', language), icon: Snowflake, color: '#0288d1' },
  ];

  const active = tabs.find(x => x.key === tab);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">ANALYTICS</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-500" /> {t('stats.title', language)}
          </h1>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm" title={t('stats.from', language)} />
          <span className="text-gray-300">—</span>
          <input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm" title={t('stats.to', language)} />
          <button onClick={load} className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-bold hover:bg-indigo-100"><RefreshCw className="w-3.5 h-3.5 inline mr-1" /></button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map(x => {
          const Icon = x.icon;
          return (
            <button key={x.key} onClick={() => setTab(x.key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${tab === x.key ? 'text-white shadow-sm' : 'bg-white/60 text-gray-500 hover:bg-white'}`}
              style={tab === x.key ? { background: x.color } : undefined}>
              <Icon className="w-4 h-4" /> {x.label}
            </button>
          );
        })}
      </div>

      {!stats ? <div className="glass-card rounded-2xl p-16 text-center text-gray-300 text-sm">{t('stats.noData', language)}</div> : (
        <div className="glass-card p-5 rounded-2xl animate-scale-in">
          {tab === 'intro' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label={t('stats.total', language)} value={stats.intro.total} />
                <StatCard label={t('stats.approved', language)} value={stats.intro.approved} />
                <StatCard label={t('stats.rejected', language)} value={stats.intro.rejected} />
                <StatCard label={t('stats.successRate', language)} value={`${stats.intro.successRate}%`} />
              </div>
              <div className="grid lg:grid-cols-2 gap-5">
                <div className="bg-white/50 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.byStatus', language)}</p>
                  <HBars data={(stats.intro.byStatus || []).map((x: any) => ({ label: x.status, value: x.c }))} color={active?.color} />
                </div>
                <div className="bg-white/50 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.byType', language)}</p>
                  <HBars data={(stats.intro.byType || []).map((x: any) => ({ label: x.resource_type, value: x.c }))} color={active?.color} />
                </div>
              </div>
              <div className="bg-white/50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.monthly', language)}</p>
                <Monthly data={stats.intro.monthly || []} />
              </div>
            </div>
          )}

          {tab === 'dist' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <StatCard label={t('stats.total', language)} value={stats.dist.total} />
                <StatCard label={t('stats.avgDuration', language)} value={stats.dist.avgDurationDays ?? '—'} />
              </div>
              <div className="bg-white/50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.byStatus', language)}</p>
                <HBars data={(stats.dist.byStatus || []).map((x: any) => ({ label: x.status, value: x.c }))} color={active?.color} />
              </div>
              <div className="bg-white/50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.monthly', language)}</p>
                <Monthly data={stats.dist.monthly || []} />
              </div>
            </div>
          )}

          {tab === 'ops' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <StatCard label={t('stats.total', language)} value={stats.ops.total} />
              </div>
              <div className="grid lg:grid-cols-2 gap-5">
                <div className="bg-white/50 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.byOperator', language)}</p>
                  <HBars data={(stats.ops.byOperator || []).map((x: any) => ({ label: x.operator, value: x.c }))} color={active?.color} />
                </div>
                <div className="bg-white/50 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.byStep', language)}</p>
                  <HBars data={(stats.ops.byStep || []).map((x: any) => ({ label: x.step_code, value: x.c }))} color={active?.color} />
                </div>
              </div>
            </div>
          )}

          {tab === 'cryo' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label={t('stats.total', language)} value={stats.cryo.total} />
              </div>
              <div className="bg-white/50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.byType', language)}</p>
                <HBars data={(stats.cryo.byType || []).map((x: any) => ({ label: x.event_type, value: x.c }))} color={active?.color} />
              </div>
              <div className="bg-white/50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 mb-2">{t('stats.monthly', language)}</p>
                <Monthly data={stats.cryo.monthly || []} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Statistics;
