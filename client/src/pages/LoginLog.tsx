import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { ScrollText, RefreshCw, LogIn, LogOut, Lock, AlertCircle } from 'lucide-react';

const ACTION_ICONS: Record<string, any> = {
  login: LogIn, logout: LogOut, locked: Lock, login_failed: AlertCircle,
};

const ACTION_COLORS: Record<string, string> = {
  login: 'tone-ok',
  logout: 'tone-neutral',
  locked: 'tone-bad',
  login_failed: 'tone-warn',
};

const LoginLog: React.FC = () => {
  const { language } = useApp();
  const [filters, setFilters] = useState<any>({ from: '', to: '', action: '', user: '' });
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const res = await api.getLoginLog({ ...filters, page, pageSize: 50 });
      setLogs(res.logs || []);
      setTotal(res.total || 0);
    } catch (e) {}
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">AUDIT TRAIL</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-purple-500" /> {t('loginlog.title', language)}
          </h1>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-lg bg-purple-50 text-purple-600 text-xs font-bold hover:bg-purple-100"><RefreshCw className="w-3.5 h-3.5 inline mr-1" /></button>
      </div>

      <div className="glass-card p-4 rounded-2xl flex flex-wrap gap-2 items-center">
        <select value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value, })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('loginlog.action', language)}: ${t('ops.all', language)}`}</option>
          {['login', 'logout', 'login_failed', 'locked'].map(a => <option key={a} value={a}>{t(`loginlog.action.${a}`, language)}</option>)}
        </select>
        <input type="text" value={filters.user} onChange={e => setFilters({ ...filters, user: e.target.value })} placeholder={t('loginlog.user', language)} className="glass-input rounded-lg px-3 py-2 text-sm w-40" />
        <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        {logs.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{t('ops.noData', language)}</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="px-4 py-3 text-left font-bold">{t('loginlog.time', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('loginlog.action', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('loginlog.user', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('loginlog.ip', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('loginlog.detail', language)}</th>
            </tr></thead>
            <tbody>
              {logs.map(l => {
                const Icon = ACTION_ICONS[l.action] || AlertCircle;
                return (
                  <tr key={l.id} className="border-t border-gray-50 hover:bg-purple-50/40">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${ACTION_COLORS[l.action] || 'tone-neutral'}`}><Icon className="w-3 h-3" />{t(`loginlog.action.${l.action}`, language)}</span></td>
                    <td className="px-4 py-3 font-medium text-gray-700">{l.username}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{l.ip || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{l.detail || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="px-4 py-2 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
            <span>{total} 条</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded bg-white border border-gray-100 disabled:opacity-30">‹</button>
              <span className="px-2 py-1">{page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded bg-white border border-gray-100 disabled:opacity-30">›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginLog;
