import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Language } from '../types';
import {
  Table2, Plus, RefreshCw, HardDrive, HardDriveDownload, Wrench, ShieldCheck,
  Lock, ChevronLeft, ChevronRight, Edit3, Trash2, Loader2,
} from 'lucide-react';
import RowEditModal from './RowEditModal';

// v2.9：数据库管理台「可视化模式」——表列表 + 数据浏览（accession 性状展开为列）+ 行级增删改
// 只读表（安全限制）：user / ai_token / login_log / audit_log / login_lock
const READONLY_TABLES = new Set(['user', 'ai_token', 'login_log', 'audit_log', 'login_lock']);
const ACC_PAGE_SIZE = 50;

interface Props {
  onMsg?: (m: string) => void;
}

// 表/列中文标签：缺失时回退原名（t() 缺失键返回 key 本身）
const tableLabel = (name: string, language: Language) => {
  const v = t(`dbadmin.table.${name}`, language);
  return v === `dbadmin.table.${name}` ? name : v;
};
const colLabel = (table: string, col: string, language: Language) => {
  const tv = t(`dbadmin.col.${table}.${col}`, language);
  if (tv !== `dbadmin.col.${table}.${col}`) return tv;
  const gv = t(`dbadmin.col.${col}`, language);
  return gv === `dbadmin.col.${col}` ? col : gv;
};

const VisualDbBrowser: React.FC<Props> = ({ onMsg }) => {
  const { language } = useApp();
  const [tables, setTables] = useState<{ name: string; rows: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ columns: string[]; rows: any[]; total: number } | null>(null);
  const [traits, setTraits] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ code: string; zh: string; en: string }[]>([]);
  const [accRows, setAccRows] = useState<any[]>([]);
  const [accTotal, setAccTotal] = useState(0);
  const [accPage, setAccPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ mode: 'insert' | 'update' | 'delete'; row?: any } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const showMsg = (m: string) => { setMsg(m); onMsg?.(m); };

  const loadTables = useCallback(async () => {
    try {
      const r = await api.dbTables();
      setTables(r.tables);
    } catch (e: any) { showMsg(e.message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);

  const loadTable = useCallback(async (name: string) => {
    setActive(name);
    setModal(null);
    setMsg('');
    setLoading(true);
    try {
      if (name === 'accession') {
        const [accRes, trRes] = await Promise.all([api.getAccessions(1, ACC_PAGE_SIZE), api.getTraits()]);
        setAccRows((accRes.accessions || []).map(normalizeAcc));
        setAccTotal(accRes.total || 0);
        setAccPage(1);
        setTraits(trRes.traits || []);
        setCategories(trRes.categories || []);
        setPreview(null);
      } else {
        const r = await api.dbTablePreview(name);
        setPreview(r);
        setAccRows([]);
      }
    } catch (e: any) { showMsg(e.message); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAccPage = async (p: number) => {
    setLoading(true);
    try {
      const res = await api.getAccessions(p, ACC_PAGE_SIZE);
      setAccRows((res.accessions || []).map(normalizeAcc));
      setAccTotal(res.total || 0);
      setAccPage(p);
    } catch (e: any) { showMsg(e.message); }
    setLoading(false);
  };

  const refresh = () => { if (active) loadTable(active); else loadTables(); };

  const doBackup = async () => {
    setBusy(true);
    try { const r = await api.dbBackup(); showMsg(t('dbadmin.backupOk', language) + ': ' + r.filename); }
    catch (e: any) { showMsg(e.message); } finally { setBusy(false); }
  };
  const doExport = async () => {
    setBusy(true);
    try { await api.dbExport(); showMsg(t('dbadmin.exportOk', language)); }
    catch (e: any) { showMsg(e.message); } finally { setBusy(false); }
  };
  const doMaintenance = async () => {
    if (!window.confirm(t('dbadmin.opMaintenanceConfirm', language))) return;
    setBusy(true);
    try { await api.dbMaintenance(); showMsg(t('dbadmin.maintenanceOk', language)); }
    catch (e: any) { showMsg(e.message); } finally { setBusy(false); }
  };
  const doIntegrity = async () => {
    setBusy(true);
    try {
      const r = await api.dbIntegrity();
      showMsg(r.ok ? t('dbadmin.integrityOk', language) : t('dbadmin.integrityWarn', language));
    } catch (e: any) { showMsg(e.message); } finally { setBusy(false); }
  };

  const traitByCode = useMemo(() => {
    const m: Record<string, any> = {};
    for (const tr of traits) m[tr.code] = tr;
    return m;
  }, [traits]);
  const traitLabel = (tr: any) => language === 'zh' ? (tr.nameZh || tr.nameEn || tr.code) : (tr.nameEn || tr.nameZh || tr.code);

  // GET /api/accessions 扁平化返回 camelCase(primaryId/displayName)；本视图按 snake_case 直列展示，
  // 故归一化补齐两种键名，确保「专业/可视化」看到同一份数据（种质编号、名称、种质库 id）。
  const normalizeAcc = (a: any) => ({
    ...a,
    primaryId: a.primaryId ?? a.primary_id,
    primary_id: a.primary_id ?? a.primaryId,
    displayName: a.displayName ?? a.display_name,
    display_name: a.display_name ?? a.displayName,
  });

  // accession 展示列：id + 基础 3 列 + 全部性状（按 sort_order 排序）
  const accColumns = useMemo(() => {
    const basic = ['id', 'primary_id', 'display_name', 'species', 'origin'];
    const sorted = [...traits].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
    return [...basic, ...sorted.map(tr => tr.code)];
  }, [traits]);

  const readonly = active ? READONLY_TABLES.has(active) : false;
  const totalPages = Math.max(1, Math.ceil(accTotal / ACC_PAGE_SIZE));

  const editableColumns = useMemo(() => {
    if (!active) return [];
    if (active === 'accession') return ['primary_id', 'display_name', 'species', 'origin', ...traits.map(tr => tr.code)];
    return (preview?.columns || []).filter(c => !['token_hash', 'password_hash', 'api_token'].includes(c));
  }, [active, preview, traits]);

  return (
    <div className="space-y-4">
      {msg && <div className="px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm font-medium">{msg}</div>}

      {/* 常用操作面板 */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-1">Ops</span>
        <button onClick={doBackup} disabled={busy} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <HardDrive className="w-3.5 h-3.5 inline mr-1" />{t('dbadmin.opBackup', language)}
        </button>
        <button onClick={doExport} disabled={busy} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <HardDriveDownload className="w-3.5 h-3.5 inline mr-1" />{t('dbadmin.opExport', language)}
        </button>
        <button onClick={doMaintenance} disabled={busy} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <Wrench className="w-3.5 h-3.5 inline mr-1" />{t('dbadmin.opMaintenance', language)}
        </button>
        <button onClick={doIntegrity} disabled={busy} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <ShieldCheck className="w-3.5 h-3.5 inline mr-1" />{t('dbadmin.opIntegrity', language)}
        </button>
        <div className="flex-1" />
        <button onClick={refresh} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
          <RefreshCw className="w-3.5 h-3.5 inline mr-1" />{t('dbadmin.refresh', language)}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左：表列表 */}
        <div className="glass-card rounded-2xl overflow-hidden lg:col-span-1">
          <div className="px-4 py-3 font-bold text-gray-700 border-b border-gray-50 flex items-center justify-between">
            <span className="flex items-center gap-2"><Table2 className="w-4 h-4 text-[#2e7d32]" />{t('dbadmin.tablesList', language)}</span>
            <span className="text-[10px] text-gray-400">{tables.length}</span>
          </div>
          <div className="max-h-[460px] overflow-auto custom-scrollbar">
            {tables.map(tb => (
              <button key={tb.name} onClick={() => loadTable(tb.name)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm border-b border-gray-50 hover:bg-white/60 transition-all ${active === tb.name ? 'bg-[#e8f5e9] text-[#2e7d32] font-bold' : 'text-gray-600'}`}>
                <span className="text-xs font-medium flex items-center gap-1.5">
                  {tableLabel(tb.name, language)}
                  {READONLY_TABLES.has(tb.name) && <Lock className="w-3 h-3 text-gray-300" />}
                </span>
                <span className="text-[10px] text-gray-400">{tb.rows.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 右：数据浏览 */}
        <div className="glass-card rounded-2xl overflow-hidden lg:col-span-2 flex flex-col">
          <div className="px-4 py-3 font-bold text-gray-700 border-b border-gray-50 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#2e7d32]">{active ? tableLabel(active, language) : t('dbadmin.selectTable', language)}</span>
            {active && (
              <span className="text-[10px] text-gray-400 font-normal">
                {active === 'accession' ? `${t('dbadmin.totalRows', language)}: ${accTotal}` : preview ? `${t('dbadmin.totalRows', language)}: ${preview.total}` : ''}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {active && !readonly && (
                <button onClick={() => setModal({ mode: 'insert' })} className="px-3 py-1.5 rounded-lg bg-[#2e7d32] text-white text-xs font-bold flex items-center gap-1 hover:bg-green-700 transition-colors">
                  <Plus className="w-3.5 h-3.5" />{t('dbadmin.rowNew', language)}
                </button>
              )}
              {readonly && (
                <span className="flex items-center gap-1 text-[10px] text-gray-400 font-bold"><Lock className="w-3 h-3" />{t('dbadmin.rowReadonly', language)}</span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline text-[#2e7d32]" /></div>
          ) : active === null ? (
            <div className="p-10 text-center text-gray-400 text-sm">{t('dbadmin.selectTableHint', language)}</div>
          ) : active === 'accession' ? (
            <>
              <div className="overflow-auto flex-1 custom-scrollbar">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-gray-400 sticky top-0">
                    <th className="px-3 py-2 text-left font-bold whitespace-nowrap">#</th>
                    {accColumns.map(c => (
                      <th key={c} className="px-3 py-2 text-left font-bold whitespace-nowrap">
                        {c === 'id' || c === 'primary_id' || c === 'display_name' || c === 'species' || c === 'origin'
                          ? colLabel('accession', c, language)
                          : <span>{traitLabel(traitByCode[c])} <span className="text-gray-300 font-normal">{c}</span></span>}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-bold whitespace-nowrap">{t('dbadmin.rowEdit', language)}</th>
                  </tr></thead>
                  <tbody>
                    {accRows.map((r, i) => (
                      <tr key={r.id || i} className="border-t border-gray-50 text-gray-600">
                        <td className="px-3 py-2 text-gray-400">{(accPage - 1) * ACC_PAGE_SIZE + i + 1}</td>
                        {accColumns.map(c => (
                          <td key={c} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">
                            {r[c] === null || r[c] === undefined || r[c] === '' ? <span className="text-gray-300">-</span> : String(r[c])}
                          </td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap flex gap-1">
                          <button onClick={() => setModal({ mode: 'update', row: r })} className="px-2 py-1 rounded-lg bg-green-50 text-[#2e7d32] text-[10px] font-bold hover:bg-green-100" title={t('dbadmin.rowEdit', language)}>
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button onClick={() => setModal({ mode: 'delete', row: r })} className="px-2 py-1 rounded-lg bg-red-50 text-red-500 text-[10px] font-bold hover:bg-red-100" title={t('dbadmin.rowDelete', language)}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {accTotal > ACC_PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-white/50">
                  <span className="text-[10px] text-gray-400">{accPage} / {totalPages}</span>
                  <div className="flex gap-1">
                    <button disabled={accPage <= 1} onClick={() => loadAccPage(accPage - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                    <button disabled={accPage >= totalPages} onClick={() => loadAccPage(accPage + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                </div>
              )}
            </>
          ) : preview ? (
            <>
              <div className="overflow-auto flex-1 custom-scrollbar">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-gray-400 sticky top-0">
                    {preview.columns.map(c => <th key={c} className="px-3 py-2 text-left font-bold whitespace-nowrap">{colLabel(active, c, language)}</th>)}
                    <th className="px-3 py-2 text-left font-bold whitespace-nowrap">{t('dbadmin.rowEdit', language)}</th>
                  </tr></thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-50 text-gray-600">
                        {preview.columns.map(c => (
                          <td key={c} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">
                            {r[c] === null || r[c] === undefined ? <span className="text-gray-400">NULL</span> : String(r[c])}
                          </td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap flex gap-1">
                          {!readonly && (
                            <>
                              <button onClick={() => setModal({ mode: 'update', row: r })} className="px-2 py-1 rounded-lg bg-green-50 text-[#2e7d32] text-[10px] font-bold hover:bg-green-100" title={t('dbadmin.rowEdit', language)}>
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button onClick={() => setModal({ mode: 'delete', row: r })} className="px-2 py-1 rounded-lg bg-red-50 text-red-500 text-[10px] font-bold hover:bg-red-100" title={t('dbadmin.rowDelete', language)}>
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* 行级增删改弹窗 */}
      {modal && active && (
        <RowEditModal
          table={active}
          mode={modal.mode}
          columns={editableColumns}
          row={modal.row}
          traits={active === 'accession' ? traits : []}
          categories={active === 'accession' ? categories : []}
          keyColOverride={active === 'accession' ? 'id' : undefined}
          onClose={() => setModal(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
};

export default VisualDbBrowser;
