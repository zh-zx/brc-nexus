import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { Upload, Plus, Trash2, Eye, EyeOff, Link, Globe, Beaker, Printer, Settings, Folder, FileText, Download, Server, KeyRound, RefreshCw, Bot, Copy, SlidersHorizontal, DatabaseBackup, ShieldCheck, Power } from 'lucide-react';
import { t } from '../utils';

const Setup: React.FC = () => {
  const {
    data, setData, columns, hiddenColumns, toggleColumnVisibility,
    operators, addOperator, removeOperator,
    mediaTypes, addMediaType, removeMediaType,
    language, setLanguage,
    setColumnMapping, primaryIdColumn, nameColumn,
    user,
  } = useApp();

  const isAdmin = user?.role === 'admin';
  // v2.12：设置区块可见性矩阵（区块 → 允许的 user_type 列表；admin 角色恒为全可见，矩阵仅约束其他类型）
  const SECTION_KEYS = ['dataSource', 'excelImport', 'columns', 'dict', 'dataSafety', 'ai', 'params', 'connection'] as const;
  const DEFAULT_VIS: Record<string, string[]> = {
    dataSource: ['admin'], excelImport: ['admin'], columns: ['admin'], dict: ['admin'],
    dataSafety: ['admin'], ai: ['admin'], params: ['admin'],
    connection: ['admin', 'approver', 'operator', 'regulator', 'external'],
  };
  const [visMatrix, setVisMatrix] = useState<Record<string, string[]>>(DEFAULT_VIS);
  const [userTypes, setUserTypes] = useState<{ code: string; label: string; label_en?: string }[]>([]);
  const myType = (user?.user_type || '').trim() || 'user';
  const allowedSet = useMemo(() => {
    if (isAdmin) return new Set<string>(SECTION_KEYS);
    const list = visMatrix[myType];
    return new Set<string>(Array.isArray(list) && list.length ? list : ['connection']);
  }, [isAdmin, visMatrix, myType]);
  const can = (k: string) => isAdmin || allowedSet.has(k);

  const [newOpName, setNewOpName] = useState('');
  const [newMediaName, setNewMediaName] = useState('');
  const [excelPreview, setExcelPreview] = useState<any>(null);
  const [excelMapping, setExcelMapping] = useState<any>({});
  const [excelRows, setExcelRows] = useState<any[]>([]);
  const [importMode, setImportMode] = useState<string>('replace');
  const [importResult, setImportResult] = useState<string>('');
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [serverInfo, setServerInfo] = useState<string>('');
  const [dataSourceMode, setDataSourceMode] = useState<string>('local');
  const [ggceUrl, setGgceUrl] = useState<string>('');
  const [labelMode, setLabelMode] = useState<string>('local');
  const [aiToken, setAiToken] = useState<string>('');
  const [showAiToken, setShowAiToken] = useState(false);
  const [copied, setCopied] = useState(false);
  // v2.7: 作用域令牌管理
  const [aiTokens, setAiTokens] = useState<any[]>([]);
  const [showCreateToken, setShowCreateToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenRole, setNewTokenRole] = useState('operator');
  const [newTokenPlain, setNewTokenPlain] = useState<string>('');
  const [tokenCopied, setTokenCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<any[]>([]);

  useEffect(() => {
    api.getUploads().then(res => setUploadHistory(res.uploads || [])).catch(() => {});
    api.getSettings().then(settings => {
      setDataSourceMode(settings.data_source_mode || 'local');
      setGgceUrl(settings.ggce_server_url || '');
      setLabelMode(settings.label_mode || 'local');
      setParams(settings);
      // v2.12：可见性矩阵 + 用户类型清单
      try {
        const m = JSON.parse(settings['setup.section_visibility'] || 'null');
        if (m && typeof m === 'object') setVisMatrix({ ...DEFAULT_VIS, ...m });
      } catch { /* 保持默认 */ }
      try {
        const ut = JSON.parse(settings['auth.user_types_json'] || '[]');
        if (Array.isArray(ut) && ut.length) setUserTypes(ut);
      } catch { /* 保持空 */ }
    }).catch(() => {});
    api.getAiToken().then(r => setAiToken(r.token || '')).catch(() => {});
    api.listAiTokens().then(r => setAiTokens(r.tokens || [])).catch(() => {});
    api.getBackups().then(r => setBackups(r.backups || [])).catch(() => {});
    setServerInfo(`http://${window.location.hostname}:7800`);
  }, []);

  const rotateAiToken = async () => {
    if (!window.confirm(t('ai.rotateConfirm', language))) return;
    try {
      const r = await api.rotateAiToken();
      setAiToken(r.token || '');
      alert('Token 已轮换');
    } catch (e: any) {
      alert('轮换失败: ' + e.message);
    }
  };

  const createScopedToken = async () => {
    if (!newTokenName.trim()) { alert(t('ai.scopeCreateName', language) + ' 不能为空'); return; }
    try {
      const r = await api.createAiToken({ name: newTokenName.trim(), role: newTokenRole });
      setNewTokenPlain(r.token || '');
      setTokenCopied(false);
      setShowCreateToken(false);
      const list = await api.listAiTokens();
      setAiTokens(list.tokens || []);
    } catch (e: any) {
      alert('创建失败: ' + e.message);
    }
  };

  const toggleTokenStatus = async (tok: any) => {
    const action = tok.enabled ? 'revoke' : 'enable';
    if (action === 'revoke' && !window.confirm(t('ai.scopeRevokeConfirm', language))) return;
    try {
      await api.setAiTokenStatus(tok.id, !tok.enabled);
      const list = await api.listAiTokens();
      setAiTokens(list.tokens || []);
    } catch (e: any) {
      alert('操作失败: ' + e.message);
    }
  };

  const copyPlainToken = async () => {
    try {
      await navigator.clipboard.writeText(newTokenPlain);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      window.prompt('复制令牌：', newTokenPlain);
    }
  };

  const copyMcpConfig = async () => {
    const sample = `mcpServers:
  brc:
    command: npx
    args:
      - -y
      - brc-mcp-server
    env:
      BRC_URL: ${serverInfo}
      BRC_TOKEN: ${aiToken}`;
    try {
      await navigator.clipboard.writeText(sample);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('复制以下配置：', sample);
    }
  };

  const saveDataSource = async (mode: string, url: string, lblMode: string) => {
    try {
      await api.updateSettings({
        data_source_mode: mode,
        ggce_server_url: url,
        label_mode: lblMode,
      });
      setDataSourceMode(mode);
      setLabelMode(lblMode);
    } catch (e: any) {
      alert('保存失败: ' + e.message);
    }
  };

  const saveParams = async () => {
    try {
      // v2.12：随参数一并持久化当前可见性矩阵，避免两条保存路径互相覆盖
      await api.updateSettings({ ...params, 'setup.section_visibility': JSON.stringify(visMatrix) });
      alert(t('param.saved', language));
    } catch (e: any) {
      alert('保存失败: ' + e.message);
    }
  };

  // v2.12：可见性矩阵保存（admin 专用）
  const saveVisMatrix = async (next: Record<string, string[]>) => {
    setVisMatrix(next);
    try {
      await api.updateSettings({ 'setup.section_visibility': JSON.stringify(next) });
      setParams(p => ({ ...p, 'setup.section_visibility': JSON.stringify(next) }));
    } catch (e: any) {
      alert('保存失败: ' + e.message);
    }
  };
  const toggleVis = (section: string, type: string) => {
    const cur = visMatrix[section] || [];
    const next = cur.includes(type) ? cur.filter(x => x !== type) : [...cur, type];
    saveVisMatrix({ ...visMatrix, [section]: next });
  };

  const setParam = (key: string, value: string) => setParams(p => ({ ...p, [key]: value }));

  const doBackup = async () => {
    try {
      await api.manualBackup();
      alert(t('param.backup.created', language));
      api.getBackups().then(r => setBackups(r.backups || [])).catch(() => {});
    } catch (e: any) {
      alert('备份失败: ' + e.message);
    }
  };

  // 参数分组定义（number/bool/text）
  const paramGroups = [
    { key: 'op', fields: [
      { k: 'op.overdue_reminder_days', type: 'number' },
      { k: 'op.time_correct_audit', type: 'bool' },
    ]},
    { key: 'work', fields: [
      { k: 'work.overdue_reminder_days', type: 'number' },
      { k: 'work.step_reminder_lead_days', type: 'number' },
    ]},
    { key: 'intro', fields: [
      { k: 'intro.quarantine_reminder_days', type: 'number' },
      { k: 'intro.qualification_expiry_days', type: 'number' },
    ]},
    { key: 'dist', fields: [
      { k: 'dist.tracking_grace_days', type: 'number' },
      { k: 'dist.blacklist_json', type: 'text' },
    ]},
    { key: 'auth', fields: [
      { k: 'auth.session_hours', type: 'number' },
      { k: 'auth.max_login_failures', type: 'number' },
      { k: 'auth.lockout_minutes', type: 'number' },
      { k: 'auth.audit_login', type: 'bool' },
      { k: 'auth.allow_register', type: 'bool' },
      { k: 'auth.register_requires_approval', type: 'bool' },
    ]},
    { key: 'backup', fields: [
      { k: 'backup.enabled', type: 'bool' },
      { k: 'backup.interval_hours', type: 'number' },
      { k: 'backup.retention_days', type: 'number' },
    ]},
    { key: 'upload', fields: [
      { k: 'upload.max_mb', type: 'number' },
    ]},
    { key: 'ui', fields: [
      { k: 'ui.touch_mode', type: 'bool' },
    ]},
    { key: 'notify', fields: [
      { k: 'notify.enabled', type: 'bool' },
    ]},
  ];

  const renderParamField = (k: string, type: string) => {
    const val = params[k] ?? '';
    if (type === 'bool') {
      const checked = val === 'true';
      return (
        <button key={k} onClick={() => setParam(k, String(!checked))}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 transition-all ${checked ? 'bg-[#2e7d32] text-white shadow-sm' : 'bg-white/60 text-gray-500 hover:bg-white'}`}>
          <span>{t(`param.${k}`, language)}</span>
          <span className={`w-8 h-5 rounded-full relative transition-colors ${checked ? 'bg-green-300' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}></span>
          </span>
        </button>
      );
    }
    return (
      <label key={k} className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-gray-500 uppercase">{t(`param.${k}`, language)}</span>
        <input
          type={type === 'number' ? 'number' : 'text'}
          value={val}
          onChange={e => setParam(k, e.target.value)}
          className="glass-input rounded-lg px-3 py-2 text-sm"
        />
      </label>
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.uploadExcel(file);
      setExcelPreview(res);
      setExcelRows(res.rows || []);
      setExcelMapping(res.detected || {});
      setImportResult('');
    } catch (err: any) {
      setImportResult('上传失败: ' + err.message);
    }
  };

  const handleImport = async () => {
    if (!excelRows || excelRows.length === 0) {
      // 不再静默返回：给用户一句白话提示，说明为什么按钮没反应
      setImportResult('没有可导入的数据，请重新上传 Excel 文件后再点导入。');
      return;
    }
    try {
      const res = await api.importExcel(excelRows, excelMapping, importMode);
      setImportResult(`导入完成: ${res.inserted} 条新增, ${res.updated} 条更新, ${res.skipped} 条跳过` + (res.errors?.length > 0 ? `, ${res.errors.length} 条错误` : ''));
      setExcelPreview(null);
      setExcelRows([]);
      api.getUploads().then(r => setUploadHistory(r.uploads || [])).catch(() => {});
    } catch (err: any) {
      setImportResult('导入失败: ' + err.message);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto pb-20">
      <div className="flex justify-between items-center mb-6">
        <div>
          <span className="t-eyebrow">CONTROL CENTER</span>
          <h1 className="t-page-title text-3xl mt-1">{t('setup.title', language)}</h1>
          <p className="text-gray-500 mt-1">Configure your environment preferences</p>
        </div>
        <div className="flex items-center gap-2 glass-panel px-4 py-2 rounded-xl">
          <Globe className="w-4 h-4 text-[#2e7d32]" />
          <select value={language} onChange={(e) => setLanguage(e.target.value as any)} className="bg-transparent text-sm font-medium text-gray-700 outline-none cursor-pointer">
            <option value="zh">中文 (Chinese)</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Server Info */}
      {can('connection') && (
      <div className="glass-card p-4 rounded-2xl bg-blue-50/30 border-blue-100/50">
        <div className="flex items-center gap-3 text-sm text-blue-800">
          <Server className="w-5 h-5 text-blue-600" />
          <span className="font-bold">Server Address:</span>
          <code className="bg-blue-100/50 px-3 py-1 rounded-lg text-xs font-mono">{serverInfo}</code>
          <span className="text-xs text-blue-600">(LAN devices connect here)</span>
        </div>
      </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* v2.12 非管理员说明卡 */}
        {!isAdmin && (
          <div className="glass-card p-5 rounded-2xl md:col-span-2 border-amber-100/60 bg-amber-50/40">
            <p className="text-sm text-amber-700 font-bold flex items-center gap-2"><ShieldCheck className="w-4 h-4" />{t('setup.personalHint', language)}</p>
          </div>
        )}
        {/* Data Source Mode */}
        {can('dataSource') && (
        <section className="glass-card p-6 rounded-2xl md:col-span-2">
          <h2 className="text-lg font-bold mb-2 text-gray-700 flex items-center gap-2">
            <Server className="w-5 h-5 text-[#2e7d32]" /> 数据源模式 / Data Source
          </h2>
          <p className="text-xs text-gray-500 mb-4">选择数据来源：本地独立模式 或 对接 GGCE 服务器（GRIN-Global Community Edition）</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => saveDataSource('local', ggceUrl, labelMode)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${dataSourceMode === 'local' ? 'border-[#2e7d32] bg-green-50' : 'border-gray-200 bg-white/50 hover:border-gray-300'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm text-gray-800">本地独立模式</span>
                {dataSourceMode === 'local' && <span className="text-[10px] bg-[#2e7d32] text-white px-2 py-0.5 rounded-full font-bold">当前</span>}
              </div>
              <p className="text-[11px] text-gray-500">使用内置 sql.js 数据库，无需外部依赖。适合未部署 GGCE 的环境。</p>
            </button>
            <button
              onClick={() => saveDataSource('ggce', ggceUrl, labelMode)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${dataSourceMode === 'ggce' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white/50 hover:border-gray-300'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm text-gray-800">GGCE 对接模式</span>
                {dataSourceMode === 'ggce' && <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">当前</span>}
              </div>
              <p className="text-[11px] text-gray-500">从 GGCE Server 读取种质/库存数据，调用 GGCE 标签生成 API。</p>
            </button>
          </div>

          {dataSourceMode === 'ggce' && (
            <div className="space-y-3 animate-scale-in">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">GGCE Server URL</label>
                <input
                  type="text"
                  value={ggceUrl}
                  onChange={(e) => setGgceUrl(e.target.value)}
                  onBlur={() => saveDataSource('ggce', ggceUrl, labelMode)}
                  placeholder="http://192.168.1.100:8080"
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 text-xs text-yellow-800">
                <strong>GGCE 模式说明：</strong>需先部署 GGCE Server（Java 17 + SQL Server/MySQL）。
                对接后，种质/库存数据从 GGCE 读取，本地数据库仅缓存设置和操作员。
                标签生成可调用 GGCE 的 <code className="bg-yellow-100 px-1 rounded">/api/v2/i/generate-labels</code> 接口获取 ZPL。
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-2">标签生成方式</label>
                <div className="flex gap-2">
                  <button onClick={() => saveDataSource(dataSourceMode, ggceUrl, 'local')} className={`px-4 py-2 rounded-lg text-xs font-bold ${labelMode === 'local' ? 'bg-[#2e7d32] text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>本地 LabelCanvas</button>
                  <button onClick={() => saveDataSource(dataSourceMode, ggceUrl, 'ggce')} className={`px-4 py-2 rounded-lg text-xs font-bold ${labelMode === 'ggce' ? 'bg-blue-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>GGCE ZPL 模板</button>
                </div>
              </div>
            </div>
          )}
        </section>
        )}

        {/* Excel Import */}
        {can('excelImport') && (
        <section className="glass-card p-6 rounded-2xl md:col-span-2">
          <h2 className="text-lg font-bold mb-4 text-gray-700 flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#2e7d32]" /> {t('setup.data', language)}
          </h2>

          {!excelPreview ? (
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center hover:bg-white/40 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-10 h-10 text-[#2e7d32] mb-3" />
              <span className="text-sm font-bold text-gray-600">{t('setup.data.import', language)}</span>
              <span className="text-xs text-gray-400 mt-1">.xlsx, .xls support</span>
              <input type="file" ref={fileInputRef} accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} />
            </div>
          ) : (
            <div className="space-y-4 animate-scale-in">
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <p className="text-sm font-bold text-green-800">
                  Detected {excelPreview.totalRows} rows, {excelPreview.headers?.length} columns
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(excelMapping).filter(([k, v]) => v).map(([key, val]) => (
                    <span key={key} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-medium">
                      {String(val)} → {key}
                    </span>
                  ))}
                </div>
                {/* Column mapping */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {['id', 'name', 'species', 'origin'].map(field => (
                    <div key={field}>
                      <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">{field}</label>
                      <select className="w-full bg-white rounded-lg p-2 text-xs border border-gray-200" value={excelMapping[field] || ''}
                        onChange={e => setExcelMapping({ ...excelMapping, [field]: e.target.value })}>
                        <option value="">-- skip --</option>
                        {excelPreview.headers?.map((h: string) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto bg-white/60 rounded-xl border border-gray-100">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {excelPreview.headers?.slice(0, 6).map((h: string) => (
                        <th key={h} className="px-3 py-2 text-left font-bold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {excelPreview.preview?.map((row: any, i: number) => (
                      <tr key={i} className="border-t border-gray-50">
                        {excelPreview.headers?.slice(0, 6).map((h: string) => (
                          <td key={h} className="px-3 py-2 text-gray-700">{String(row[h] || '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import mode + confirm */}
              <div className="flex flex-wrap gap-3 items-center">
                <select className="bg-white rounded-xl px-4 py-2.5 text-sm font-medium border border-gray-200" value={importMode} onChange={e => setImportMode(e.target.value)}>
                  <option value="replace">覆盖 (Replace)</option>
                  <option value="skip">跳过重复 (Skip)</option>
                  <option value="merge">合并 (Merge)</option>
                </select>
                <button onClick={handleImport} className="btn-primary px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg">
                  Import {excelPreview.totalRows} records
                </button>
                <button onClick={() => { setExcelPreview(null); setExcelRows([]); setImportResult(''); }} className="px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-100 font-medium">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* 导入结果横幅：放在预览卡片外层——导入成功会清掉预览卡，横幅放里面就永远看不见 */}
          {importResult && (
            <div className={`mt-4 rounded-xl p-3 text-sm font-medium border ${importResult.startsWith('导入完成') ? 'bg-green-50 border-green-100 text-green-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
              {importResult}
            </div>
          )}

          {/* Upload history */}
          {uploadHistory.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Import History</h3>
              <div className="flex flex-wrap gap-2">
                {uploadHistory.slice(0, 5).map((u: any) => (
                  <span key={u.id} className="text-[10px] bg-gray-100 px-2 py-1 rounded text-gray-500">
                    {u.filename} ({u.row_count} rows, {new Date(u.uploaded_at).toLocaleDateString()})
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.length > 0 && !excelPreview && (
            <p className="text-center text-xs text-[#2e7d32] font-bold mt-3">{data.length} {t('setup.data.count', language)}</p>
          )}
        </section>
        )}

        {/* Columns */}
        {can('columns') && (
        <section className="glass-card p-6 rounded-2xl md:col-span-2">
          <h2 className="text-lg font-bold mb-4 text-gray-700">{t('setup.columns', language)}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="bg-white/50 p-3 rounded-lg border border-white">
              <label className="text-xs font-bold text-gray-400 block mb-1">ID COLUMN</label>
              <select value={primaryIdColumn} onChange={(e) => setColumnMapping(e.target.value, nameColumn)} className="w-full bg-transparent text-sm font-semibold outline-none text-gray-800">
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="bg-white/50 p-3 rounded-lg border border-white">
              <label className="text-xs font-bold text-gray-400 block mb-1">NAME COLUMN</label>
              <select value={nameColumn} onChange={(e) => setColumnMapping(primaryIdColumn, e.target.value)} className="w-full bg-transparent text-sm font-semibold outline-none text-gray-800">
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {columns.map(col => (
              <button key={col} onClick={() => toggleColumnVisibility(col)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${hiddenColumns.includes(col) ? 'bg-gray-100 text-gray-400' : 'bg-green-100 text-[#2e7d32] shadow-sm'}`}>
                {hiddenColumns.includes(col) ? <EyeOff className="w-3 h-3 inline mr-1" /> : <Eye className="w-3 h-3 inline mr-1" />} {col}
              </button>
            ))}
          </div>
        </section>
        )}

        {/* Operators */}
        {can('dict') && (
        <section className="glass-card p-6 rounded-2xl">
          <h2 className="text-lg font-bold mb-4 text-gray-700">{t('setup.ops', language)}</h2>
          <div className="flex gap-2 mb-3">
            <input type="text" value={newOpName} onChange={(e) => setNewOpName(e.target.value)} placeholder={t('setup.ops.placeholder', language)} className="flex-1 glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => { if (newOpName.trim()) { addOperator(newOpName); setNewOpName(''); } }} className="btn-primary p-2 rounded-lg"><Plus className="w-5 h-5" /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {operators.map((op: any) => (
              <div key={op.id} className="bg-white px-3 py-1.5 rounded-lg shadow-sm text-sm flex items-center gap-2 border border-gray-100">
                {op.name} <button onClick={() => removeOperator(op.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </section>
        )}

        {/* Media Types */}
        {can('dict') && (
        <section className="glass-card p-6 rounded-2xl">
          <h2 className="text-lg font-bold mb-4 text-gray-700 flex items-center gap-2"><Beaker className="w-5 h-5 text-purple-500" /> {t('setup.media', language)}</h2>
          <div className="flex gap-2 mb-3">
            <input type="text" value={newMediaName} onChange={(e) => setNewMediaName(e.target.value)} placeholder={t('setup.media.placeholder', language)} className="flex-1 glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => { if (newMediaName.trim()) { addMediaType(newMediaName); setNewMediaName(''); } }} className="bg-purple-600 text-white hover:bg-purple-700 p-2 rounded-lg transition-colors"><Plus className="w-5 h-5" /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {mediaTypes.map((m: any) => (
              <div key={m.id} className="bg-purple-50 px-3 py-1.5 rounded-lg shadow-sm text-sm flex items-center gap-2 text-purple-900 border border-purple-100">
                {m.name} <button onClick={() => removeMediaType(m.id)} className="text-purple-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </section>
        )}

        {/* Data Export */}
        {can('dataSafety') && (
        <section className="glass-card p-6 rounded-2xl">
          <h2 className="text-lg font-bold mb-4 text-gray-700 flex items-center gap-2">
            <Download className="w-5 h-5 text-[#2e7d32]" /> Data Management
          </h2>
          <div className="flex flex-col gap-3">
            <button onClick={async () => {
              try {
                const data = await api.exportAll();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `brc-backup-${Date.now()}.json`;
                a.click();
              } catch (e: any) { alert('Export failed: ' + e.message); }
            }} className="bg-white/60 border border-white rounded-xl p-3 text-sm font-medium text-gray-700 hover:bg-white transition-all text-left">
              <span className="font-bold">Export All Data (JSON)</span>
              <p className="text-[10px] text-gray-400 mt-1">Download full database as JSON backup</p>
            </button>
            <button onClick={async () => {
              try {
                const res = await api.backup();
                alert('Backup created: ' + res.path);
              } catch (e: any) { alert('Backup failed: ' + e.message); }
            }} className="bg-white/60 border border-white rounded-xl p-3 text-sm font-medium text-gray-700 hover:bg-white transition-all text-left">
              <span className="font-bold">Create Server Backup</span>
              <p className="text-[10px] text-gray-400 mt-1">Trigger SQLite backup on server</p>
            </button>
          </div>
        </section>
        )}

        {/* Printer placeholder */}
        {can('connection') && (
        <section className="glass-card p-6 rounded-2xl">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-700"><Printer className="w-5 h-5 text-[#2e7d32]" /> {t('setup.printer', language)}</h2>
          <p className="text-xs text-gray-500">Print jobs are sent to the server. Install the BRC Print Agent on the Windows PC connected to your label printer.</p>
          <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-100">
            <p className="text-xs text-yellow-700 font-medium">
              Print Agent connects via WebSocket. Download and run <code className="bg-yellow-100 px-1 rounded">print-agent</code> on the PC with your thermal printer.
            </p>
          </div>
        </section>
        )}

        {/* AI Integration */}
        {can('ai') && (
        <section className="glass-card p-6 rounded-2xl md:col-span-2 border-green-200/50">
          <h2 className="text-lg font-bold mb-4 text-gray-700 flex items-center gap-2">
            <Bot className="w-5 h-5 text-[#2e7d32]" /> {t('ai.title', language)}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1 flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5" /> {t('ai.token', language)}
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100/70 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 break-all">
                    {showAiToken ? aiToken : '••••••••••••••••••••••••••••••'}
                  </code>
                  <button onClick={() => setShowAiToken(v => !v)} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-gray-800" title={showAiToken ? t('ai.hide', language) : t('ai.show', language)}>
                    {showAiToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={rotateAiToken} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-red-500" title={t('ai.rotate', language)}>
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-xs text-green-800 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> {t('ai.gateway', language)}</p>
                <p>{t('ai.gatewayDesc', language)}</p>
                <p className="pt-1">{t('ai.mcpDesc', language)}</p>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-gray-500 uppercase block">{t('ai.configHint', language)}</label>
              <pre className="bg-gray-900 text-green-300 rounded-xl p-4 text-[11px] leading-relaxed overflow-x-auto">
{`"mcpServers": {
  "brc": {
    "command": "npx",
    "args": ["-y", "brc-mcp-server"],
    "env": {
      "BRC_URL": "${serverInfo}",
      "BRC_TOKEN": "${aiToken}"
    }
  }
}`}
              </pre>
              <button onClick={copyMcpConfig} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
                <Copy className="w-3.5 h-3.5" /> {copied ? '✓ Copied' : 'Copy config'}
              </button>
            </div>
          </div>

          {/* v2.7: 作用域令牌管理 */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2e7d32]" /> {t('ai.scopedTitle', language)}
              </h3>
              <button onClick={() => { setNewTokenPlain(''); setNewTokenName(''); setNewTokenRole('operator'); setShowCreateToken(v => !v); }}
                className="px-4 py-2 rounded-lg bg-[#2e7d32] text-white text-xs font-bold hover:bg-[#1b5e20] transition-all">
                <Plus className="w-3.5 h-3.5 inline mr-1" />{t('ai.scopeCreate', language)}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">{t('ai.scopedDesc', language)}</p>
            <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 mb-3">{t('setup.mcpTokenHint', language)}</p>

            {/* 新建令牌表单 */}
            {showCreateToken && (
              <div className="mb-4 p-4 bg-green-50/60 border border-green-100 rounded-xl">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input type="text" value={newTokenName} onChange={e => setNewTokenName(e.target.value)}
                    placeholder={t('ai.scopeCreateName', language)}
                    className="flex-1 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm" />
                  <select value={newTokenRole} onChange={e => setNewTokenRole(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm">
                    {['admin', 'approver', 'operator', 'regulator', 'external'].map(r => (
                      <option key={r} value={r}>{t(`ai.role.${r}`, language)}</option>
                    ))}
                  </select>
                  <button onClick={createScopedToken} className="btn-primary px-5 py-2 rounded-xl text-sm font-bold">
                    {t('ai.scopeCreateBtn', language)}
                  </button>
                </div>
              </div>
            )}

            {/* 明文仅显示一次 */}
            {newTokenPlain && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" /> {t('ai.scopeOnce', language)}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 break-all">{newTokenPlain}</code>
                  <button onClick={copyPlainToken} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-[#2e7d32]" title={t('ai.copy', language)}>
                    {tokenCopied ? '✓' : <Copy className="w-4 h-4" />}
                  </button>
                  <button onClick={() => setNewTokenPlain('')} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-gray-600">✕</button>
                </div>
              </div>
            )}

            {/* 令牌列表 */}
            {aiTokens.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">{t('ai.scopeEmpty', language)}</p>
            ) : (
              <div className="space-y-2">
                {aiTokens.map(tok => (
                  <div key={tok.id} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${tok.enabled ? 'bg-white/60 border-white/60' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-700 truncate">{tok.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono truncate">{tok.tokenPrefix}••••••••</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                      {t(`ai.role.${tok.role}`, language)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${tok.enabled ? 'bg-green-50 text-[#2e7d32]' : 'bg-gray-100 text-gray-400'}`}>
                      {tok.enabled ? t('ai.scopeEnabled', language) : t('ai.scopeDisabled', language)}
                    </span>
                    <span className="hidden md:block text-[10px] text-gray-400 shrink-0">
                      {tok.lastUsedAt ? `${t('ai.scopeLastUsed', language)} ${tok.lastUsedAt.slice(0, 10)}` : t('ai.scopeNever', language)}
                    </span>
                    <button onClick={() => toggleTokenStatus(tok)}
                      className={`p-2 rounded-lg border transition-all shrink-0 ${tok.enabled ? 'text-gray-400 hover:text-red-500 border-gray-200 bg-white' : 'text-[#2e7d32] hover:text-green-700 border-green-200 bg-green-50'}`}
                      title={tok.enabled ? t('ai.scopeRevoke', language) : t('ai.scopeEnable', language)}>
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        )}

        {/* 系统参数配置 */}
        {can('params') && (
        <section className="glass-card p-6 rounded-2xl md:col-span-2 border-indigo-200/50">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-indigo-500" /> {t('param.title', language)}
            </h2>
            <button onClick={saveParams} className="btn-primary px-5 py-2 rounded-xl text-sm font-bold">{t('param.save', language)}</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {paramGroups.map(g => (
              <div key={g.key} className="bg-white/50 rounded-xl p-4 border border-white/60">
                <p className="text-xs font-bold text-indigo-600 mb-3 flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5" /> {t(`param.group.${g.key}`, language)}
                </p>
                <div className="space-y-2.5">
                  {g.fields.map(f => renderParamField(f.k, f.type))}
                </div>
              </div>
            ))}
          </div>

          {/* 备份列表 */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2"><DatabaseBackup className="w-4 h-4 text-green-600" /> {t('param.backup.list', language)}</h3>
              <button onClick={doBackup} className="px-4 py-2 rounded-lg bg-green-50 text-[#2e7d32] text-xs font-bold hover:bg-green-100"><DatabaseBackup className="w-3.5 h-3.5 inline mr-1" />{t('param.backup.manual', language)}</button>
            </div>
            {backups.length === 0 ? (
              <p className="text-xs text-gray-400 py-3">{t('param.backup.empty', language)}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {backups.map(b => (
                  <div key={b.filename} className="bg-white/70 border border-gray-100 rounded-xl px-3 py-2 text-xs">
                    <p className="font-mono text-gray-700 truncate">{b.filename}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{t('param.backup.size', language)}: {(b.size / 1024).toFixed(1)} KB · {t('param.backup.time', language)}: {new Date(b.mtime).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        )}

        {/* v2.12：设置可见性矩阵（仅管理员） */}
        {isAdmin && (
          <section className="glass-card p-6 rounded-2xl md:col-span-2 border-purple-200/50">
            <h2 className="text-lg font-bold mb-2 text-gray-700 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-500" /> {t('setup.visMatrix', language)}
            </h2>
            <p className="text-xs text-gray-500 mb-4">{t('setup.visMatrixHint', language)}</p>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-400">
                    <th className="px-3 py-2 text-left font-bold">{t('setup.visSection', language)}</th>
                    {userTypes.map(ut => (
                      <th key={ut.code} className="px-3 py-2 text-center font-bold whitespace-nowrap">{language === 'zh' ? ut.label : (ut.label_en || ut.label)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SECTION_KEYS.map(sk => (
                    <tr key={sk} className="border-t border-gray-50">
                      <td className="px-3 py-2 font-bold text-gray-600">{t(`setup.sec.${sk}`, language)}</td>
                      {userTypes.map(ut => (
                        <td key={ut.code} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={(visMatrix[sk] || []).includes(ut.code)}
                            onChange={() => toggleVis(sk, ut.code)}
                            className="w-4 h-4 rounded text-[#2e7d32] cursor-pointer"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{t('setup.visNote', language)}</p>
          </section>
        )}
      </div>
    </div>
  );
};

export default Setup;
