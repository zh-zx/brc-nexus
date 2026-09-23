import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api';
import { t } from '../utils';
import { useApp } from '../context/AppContext';
import { X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onDone?: () => void;
}

interface ParsedRow {
  primaryId: string;
  updates: Record<string, string>;
}

// 批量修改种质信息弹窗：上传 Excel → 预览 → 选择模式 → 应用
const BatchEditModal: React.FC<Props> = ({ onClose, onDone }) => {
  const { language } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const parseFile = (file: File) => {
    setError('');
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('文件为空');
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!aoa.length) throw new Error('文件为空');
        const headers = aoa[0].map((h: any) => String(h ?? '').trim());
        // 定位 primaryId 列
        let idIdx = headers.findIndex(h => /primaryid|primary_id|种质编号|编号/i.test(h));
        if (idIdx < 0) throw new Error(t('acc.batchEditUploadHint', language) + ' (primaryId)');
        const parsed: ParsedRow[] = [];
        for (let i = 1; i < aoa.length; i++) {
          const row = aoa[i];
          const primaryId = String(row[idIdx] ?? '').trim();
          if (!primaryId) continue;
          const updates: Record<string, string> = {};
          headers.forEach((h, ci) => {
            if (ci === idIdx || !h) return;
            const v = String(row[ci] ?? '').trim();
            if (v !== '') updates[h] = v;
          });
          parsed.push({ primaryId, updates });
        }
        if (!parsed.length) throw new Error(t('acc.batchEditNoRows', language));
        setRows(parsed);
      } catch (err: any) {
        setError(err.message || '解析失败');
        setRows([]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadTemplate = async () => {
    try {
      const blob = await api.getBatchTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'accessions-batch-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || '下载失败');
    }
  };

  const apply = async () => {
    if (!rows.length) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.batchUpdateAccessions({ rows, mode });
      setResult(res);
      onDone?.();
    } catch (e: any) {
      setError(e.message || '应用失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-gray-800 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#2e7d32]" /> {t('acc.batchEditTitle', language)}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 border-[#2e7d32] text-[#2e7d32] hover:bg-green-50 transition-colors">
              <Download className="w-4 h-4" /> {t('acc.batchEditDownload', language)}
            </button>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* Upload */}
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-green-300 rounded-2xl p-8 flex flex-col items-center gap-2 hover:bg-green-50/50 transition-colors"
            >
              <Upload className="w-8 h-8 text-[#2e7d32]" />
              <span className="text-sm font-bold text-gray-600">{fileName || t('acc.batchEditUpload', language)}</span>
              <span className="text-xs text-gray-400">{t('acc.batchEditUploadHint', language)}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ''; }}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 font-bold">{error}</p>
            </div>
          )}

          {/* Preview */}
          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-black text-gray-500 uppercase tracking-widest">{t('acc.batchEditPreview', language)}</span>
                <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-bold">{rows.length} 条</span>
                <div className="flex-1" />
                <select value={mode} onChange={e => setMode(e.target.value as any)} className="glass-input rounded-xl px-3 py-2 text-xs font-bold">
                  <option value="replace">{t('acc.batchEditModeReplace', language)}</option>
                  <option value="merge">{t('acc.batchEditModeMerge', language)}</option>
                </select>
              </div>
              <div className="glass-panel rounded-2xl overflow-hidden border-white/50 max-h-72 overflow-y-auto custom-scrollbar">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-100">
                      <th className="px-4 py-2 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">primaryId</th>
                      {Object.keys(rows[0]?.updates || {}).slice(0, 5).map(k => (
                        <th key={k} className="px-4 py-2 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{k}</th>
                      ))}
                      {Object.keys(rows[0]?.updates || {}).length > 5 && (
                        <th className="px-4 py-2 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">…</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => {
                      const keys = Object.keys(r.updates);
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-4 py-2 font-bold text-gray-800">{r.primaryId}</td>
                          {keys.slice(0, 5).map(k => (
                            <td key={k} className="px-4 py-2 text-xs text-gray-600 max-w-[140px] truncate">{r.updates[k]}</td>
                          ))}
                          {keys.length > 5 && <td className="px-4 py-2 text-xs text-gray-300">+{keys.length - 5}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length > 100 && (
                <p className="text-xs text-gray-400">… 仅显示前 100 条，共 {rows.length} 条</p>
              )}
            </>
          )}

          {/* Result */}
          {result && (
            <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-2">
              <p className="text-sm font-black text-green-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> {t('acc.batchEditResult', language)}
              </p>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="bg-green-600 text-white px-2.5 py-1 rounded-full">{t('acc.batchEditUpdated', language)}: {result.updated?.length || 0}</span>
                <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">{t('acc.batchEditNotFound', language)}: {result.notFound?.length || 0}</span>
                <span className="bg-red-100 text-red-700 px-2.5 py-1 rounded-full">{t('acc.batchEditFailed', language)}: {result.failed?.length || 0}</span>
              </div>
              {result.unknownHeaders?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-1">
                  <p className="text-xs font-black text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />{t('acc.batchEditUnknownHeaders', language)}
                  </p>
                  <p className="text-xs text-amber-600 pt-1 break-words">{result.unknownHeaders.join('、')}</p>
                  <p className="text-[10px] text-amber-500 pt-1">{t('acc.batchEditUnknownHint', language)}</p>
                </div>
              )}
              {result.notFound?.length > 0 && (
                <p className="text-xs text-amber-600 pt-1 break-words">{t('acc.batchEditUnmatched', language)}: {result.notFound.join(', ')}</p>
              )}
              {result.failed?.length > 0 && (
                <p className="text-xs text-red-500 pt-1 break-words">{result.failed.map((f: any) => `${f.primaryId}(${f.reason})`).join(', ')}</p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-6 py-4 flex items-center gap-3 justify-end">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">{t('common.cancel', language) || '取消'}</button>
          {rows.length > 0 && !result && (
            <button
              onClick={apply}
              disabled={busy}
              className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {busy ? '...' : t('acc.batchEditApply', language)}
            </button>
          )}
          {result && (
            <button onClick={onClose} className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold">完成</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BatchEditModal;
