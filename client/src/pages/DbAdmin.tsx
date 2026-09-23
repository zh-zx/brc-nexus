import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Database, Table2, Terminal, HardDriveDownload, HardDrive, ShieldCheck, RefreshCw, Play, AlertTriangle, CheckCircle2, X, ChevronRight, Wrench } from 'lucide-react';
import VisualDbBrowser from '../lib/VisualDbBrowser';

const DbAdmin: React.FC = () => {
  const { language } = useApp();
  // v2.9：专业 / 可视化双模式（状态互不干扰）
  const [visual, setVisual] = useState(false);
  const [tab, setTab] = useState<'tables' | 'sql' | 'backup' | 'integrity'>('tables');
  const [tables, setTables] = useState<{ name: string; rows: number }[]>([]);
  const [dbSize, setDbSize] = useState(0);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ columns: string[]; rows: any[]; total: number } | null>(null);
  const [sql, setSql] = useState('');
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlError, setSqlError] = useState('');
  const [pendingSql, setPendingSql] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadTables = async () => {
    try {
      const r = await api.dbTables();
      setTables(r.tables);
      setDbSize(r.size);
    } catch (e: any) { setMsg(e.message); }
  };
  useEffect(() => { loadTables(); }, []);

  const openTable = async (name: string) => {
    setActiveTable(name);
    setPreview(null);
    try {
      const r = await api.dbTablePreview(name);
      setPreview(r);
    } catch (e: any) { setMsg(e.message); }
  };

  const runSql = async (withConfirm: boolean) => {
    setSqlError(''); setSqlResult(null); setPendingSql(null);
    if (!sql.trim()) return;
    setBusy(true);
    try {
      const r = await api.dbQuery(sql, withConfirm);
      if (r.error === 'WRITE_CONFIRM_REQUIRED') {
        setPendingSql(sql);
      } else {
        setSqlResult(r);
      }
    } catch (e: any) {
      setSqlError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doBackup = async () => {
    setBusy(true);
    try {
      const r = await api.dbBackup();
      setMsg(t('dbadmin.backupOk', language) + ': ' + r.filename);
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const doMaintenance = async () => {
    setBusy(true);
    try {
      await api.dbMaintenance();
      setMsg(t('dbadmin.maintenanceOk', language));
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const runIntegrity = async () => {
    setBusy(true);
    try {
      const r = await api.dbIntegrity();
      setIntegrity(r);
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const tabs = [
    { id: 'tables' as const, label: t('dbadmin.tablesTab', language), icon: Table2 },
    { id: 'sql' as const, label: t('dbadmin.sqlTab', language), icon: Terminal },
    { id: 'backup' as const, label: t('dbadmin.backupTab', language), icon: HardDriveDownload },
    { id: 'integrity' as const, label: t('dbadmin.integrityTab', language), icon: ShieldCheck },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">DATABASE ADMIN</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <Database className="w-6 h-6 text-[#2e7d32]" /> {t('nav.database', language)}
          </h1>
        </div>
        {!visual && (
          <button onClick={loadTables} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5 inline mr-1" />{t('dbadmin.refresh', language)}
          </button>
        )}
      </div>

      {/* v2.9 双模式切换 */}
      <div className="flex gap-1.5 p-1 bg-white/70 border border-gray-200 rounded-xl w-fit">
        <button onClick={() => setVisual(false)}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${!visual ? 'bg-[#2e7d32] text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}>
          {t('dbadmin.modePro', language)}
        </button>
        <button onClick={() => setVisual(true)}
          className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${visual ? 'bg-[#2e7d32] text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}>
          {t('dbadmin.modeVisual', language)}
        </button>
      </div>

      {visual ? (
        <VisualDbBrowser onMsg={setMsg} />
      ) : (
        <>
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab === tb.id ? 'bg-[#2e7d32] text-white shadow' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <tb.icon className="w-3.5 h-3.5 inline mr-1" />{tb.label}
          </button>
        ))}
      </div>

      {msg && <div className="px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm font-medium">{msg}</div>}

      {/* 数据表 */}
      {tab === 'tables' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass-card rounded-2xl overflow-hidden lg:col-span-1">
            <div className="px-4 py-3 font-bold text-gray-700 border-b border-gray-50 flex items-center justify-between">
              <span className="flex items-center gap-2"><Table2 className="w-4 h-4 text-[#2e7d32]" />{t('dbadmin.tablesList', language)}</span>
              <span className="text-[10px] text-gray-400">{dbSize > 0 ? (dbSize / 1024 / 1024).toFixed(1) + ' MB' : ''}</span>
            </div>
            <div className="max-h-[480px] overflow-auto custom-scrollbar">
              {tables.map(tb => (
                <button key={tb.name} onClick={() => openTable(tb.name)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm border-b border-gray-50 hover:bg-white/60 transition-all ${activeTable === tb.name ? 'bg-[#e8f5e9] text-[#2e7d32] font-bold' : 'text-gray-600'}`}>
                  <span className="font-mono text-xs">{tb.name}</span>
                  <span className="text-[10px] text-gray-400">{tb.rows.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="glass-card rounded-2xl overflow-hidden lg:col-span-2">
            <div className="px-4 py-3 font-bold text-gray-700 border-b border-gray-50 flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-[#2e7d32]" />{activeTable || t('dbadmin.selectTable', language)}
              {preview && <span className="text-[10px] text-gray-400 font-normal ml-auto">{t('dbadmin.totalRows', language)}: {preview.total}</span>}
            </div>
            {preview ? (
              <div className="overflow-auto max-h-[480px] custom-scrollbar">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-gray-400 sticky top-0">
                    {preview.columns.map(c => <th key={c} className="px-3 py-2 text-left font-bold whitespace-nowrap">{c}</th>)}
                  </tr></thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-50 text-gray-600">
                        {preview.columns.map(c => <td key={c} className="px-3 py-2 whitespace-nowrap max-w-[240px] truncate">{r[c] === null || r[c] === undefined ? 'NULL' : String(r[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-gray-400 text-sm">{t('dbadmin.selectTableHint', language)}</div>
            )}
          </div>
        </div>
      )}

      {/* SQL 控制台 */}
      {tab === 'sql' && (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <p className="text-xs text-gray-500">{t('dbadmin.sqlHint', language)}</p>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">{t('dbadmin.sqlNote', language)}</p>
          <textarea value={sql} onChange={e => setSql(e.target.value)} rows={6}
            placeholder="SELECT * FROM accession LIMIT 10;"
            className="w-full font-mono text-xs glass-input rounded-xl px-4 py-3" />
          <div className="flex gap-3">
            <button onClick={() => runSql(false)} disabled={busy} className="btn-primary px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-60">
              <Play className="w-4 h-4 inline mr-1" />{t('dbadmin.run', language)}
            </button>
            <button onClick={() => setSql('')} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">{t('dbadmin.clear', language)}</button>
          </div>

          {sqlError && <div className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{sqlError}</div>}

          {sqlResult && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              {sqlResult.kind === 'read' ? (
                sqlResult.rows.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">{t('dbadmin.noRows', language)}</div>
                ) : (
                  <div className="overflow-auto max-h-[400px] custom-scrollbar">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-gray-50 text-gray-400">
                        {Object.keys(sqlResult.rows[0]).map(c => <th key={c} className="px-3 py-2 text-left font-bold whitespace-nowrap">{c}</th>)}
                      </tr></thead>
                      <tbody>
                        {sqlResult.rows.map((r, i) => (
                          <tr key={i} className="border-t border-gray-50 text-gray-600">
                            {Object.entries(r).map(([k, v]) => <td key={k} className="px-3 py-2 whitespace-nowrap max-w-[240px] truncate">{v === null || v === undefined ? 'NULL' : String(v)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="px-4 py-3 text-sm text-green-700 font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />{t('dbadmin.changed', language)}: {sqlResult.changes ?? 0} {sqlResult.lastInsertRowid != null ? ` · lastID=${sqlResult.lastInsertRowid}` : ''}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 备份与维护 */}
      {tab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-card rounded-2xl p-5">
            <h3 className="font-bold text-gray-700 flex items-center gap-2 mb-2"><HardDriveDownload className="w-4 h-4 text-[#2e7d32]" />{t('dbadmin.backupTitle', language)}</h3>
            <p className="text-xs text-gray-500 mb-4">{t('dbadmin.backupHint', language)}</p>
            <div className="flex gap-3">
              <button onClick={doBackup} disabled={busy} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60"><HardDrive className="w-4 h-4 inline mr-1" />{t('dbadmin.backupNow', language)}</button>
              <button onClick={() => api.dbExport().then(() => setMsg(t('dbadmin.exportOk', language))).catch((e: any) => setMsg(e.message))} className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50"><HardDriveDownload className="w-4 h-4 inline mr-1" />{t('dbadmin.exportDb', language)}</button>
            </div>
          </div>
          <div className="glass-card rounded-2xl p-5">
            <h3 className="font-bold text-gray-700 flex items-center gap-2 mb-2"><Wrench className="w-4 h-4 text-[#2e7d32]" />{t('dbadmin.maintenanceTitle', language)}</h3>
            <p className="text-xs text-gray-500 mb-4">{t('dbadmin.maintenanceHint', language)}</p>
            <button onClick={doMaintenance} disabled={busy} className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50 disabled:opacity-60"><Wrench className="w-4 h-4 inline mr-1" />{t('dbadmin.maintenanceRun', language)}</button>
          </div>
        </div>
      )}

      {/* 完整性 */}
      {tab === 'integrity' && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={runIntegrity} disabled={busy} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60"><ShieldCheck className="w-4 h-4 inline mr-1" />{t('dbadmin.checkNow', language)}</button>
          </div>
          {integrity && (
            <div className="space-y-3">
              <div className={`px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 ${integrity.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                {integrity.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {integrity.ok ? t('dbadmin.integrityOk', language) : t('dbadmin.integrityWarn', language)}
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 mb-1.5">PRAGMA integrity_check</p>
                <div className="flex flex-wrap gap-2">
                  {integrity.integrity.map((line: string, i: number) => (
                    <span key={i} className={`px-2 py-1 rounded-lg text-[10px] font-mono ${line === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{line}</span>
                  ))}
                </div>
              </div>
              {integrity.orphans.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 mb-1.5">{t('dbadmin.orphans', language)}</p>
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 text-gray-400">
                      <th className="px-3 py-2 text-left font-bold">{t('dbadmin.childTable', language)}</th>
                      <th className="px-3 py-2 text-left font-bold">{t('dbadmin.fkCol', language)}</th>
                      <th className="px-3 py-2 text-left font-bold">{t('dbadmin.parentTable', language)}</th>
                      <th className="px-3 py-2 text-left font-bold">{t('dbadmin.orphanCount', language)}</th>
                    </tr></thead>
                    <tbody>
                      {integrity.orphans.map((o: any, i: number) => (
                        <tr key={i} className="border-t border-gray-50 text-gray-600">
                          <td className="px-3 py-2 font-mono">{o.child}</td>
                          <td className="px-3 py-2 font-mono">{o.col}</td>
                          <td className="px-3 py-2 font-mono">{o.parent}</td>
                          <td className="px-3 py-2 font-bold text-amber-600">{o.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 写操作二次确认弹窗 */}
      {pendingSql && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 animate-scale-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-red-600 flex items-center gap-2"><AlertTriangle className="w-5 h-5" />{t('dbadmin.confirmTitle', language)}</h3>
              <button onClick={() => setPendingSql(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-3">{t('dbadmin.confirmHint', language)}</p>
            <pre className="bg-gray-50 rounded-xl p-3 text-xs font-mono text-gray-700 overflow-auto max-h-40 mb-5">{pendingSql}</pre>
            <div className="flex gap-3">
              <button onClick={() => setPendingSql(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">{t('nav.cancel', language)}</button>
              <button onClick={() => runSql(true)} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold disabled:opacity-60">{t('dbadmin.confirmExecute', language)}</button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default DbAdmin;
