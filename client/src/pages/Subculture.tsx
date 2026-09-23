import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { Printer, Search, X, List, Play, ShoppingCart, ChevronLeft, ChevronRight, Trash2, Check, AlertTriangle, Target, Camera, Loader2, Eraser, Layers } from 'lucide-react';
import { t, cn } from '../utils';
import { LabelCanvas } from '../components/LabelCanvas';

type Mode = 'direct' | 'queue' | 'batch';

const Subculture: React.FC = () => {
  const { data, templates, operators, mediaTypes, primaryIdColumn, nameColumn, language, selectedPrinter } = useApp();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('brc_last_mode') as Mode) || 'direct');
  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchScope, setSearchScope] = useState<string>('all');
  const [isExactMatch, setIsExactMatch] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<any[]>(() => {
    const saved = localStorage.getItem('brc_print_queue');
    return saved ? JSON.parse(saved) : [];
  });
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const itemsPerPage = 50;

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [selectedOperator, setSelectedOperator] = useState<string>(operators[0]?.name || '');
  const [selectedMedia, setSelectedMedia] = useState<string>(mediaTypes?.[0]?.name || '');
  const [copies, setCopies] = useState<number>(1);
  const [lastPrintedItem, setLastPrintedItem] = useState<any | null>(null);
  const [printStatus, setPrintStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [modalItems, setModalItems] = useState<any[]>([]);

  const printTaskQueue = useRef<any[]>([]);
  const isProcessingQueue = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<any>(null);

  const currentTemplate = templates.find(t => t.id === selectedTemplateId);
  const visibleColumns = ['cccapNo', 'name', 'cipNo', 'species'].filter(c => c !== undefined);

  const refocus = useCallback(() => {
    if (!isPrinting && !isScannerOpen && searchInputRef.current) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
  }, [isPrinting, isScannerOpen]);

  useEffect(() => { refocus(); }, [mode, refocus]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      setSearchTerm(inputValue);
      if (inputValue.trim()) {
        try {
          const res = await api.searchAccessions(inputValue, searchScope !== 'all' ? searchScope : undefined, isExactMatch);
          setFilteredData(res.accessions);
          setTotalResults(res.total);
        } catch { setFilteredData([]); }
      } else if (mode === 'batch') {
        try {
          const res = await api.getAccessions(currentPage, itemsPerPage);
          setFilteredData(res.accessions);
          setTotalResults(res.total);
        } catch { setFilteredData([]); }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, searchScope, isExactMatch, mode, currentPage]);

  const totalPages = Math.ceil(totalResults / itemsPerPage);

  // Camera scanner setup
  useEffect(() => {
    if (isScannerOpen) {
      const timer = setTimeout(async () => {
        try {
          const { Html5QrcodeScanner } = await import('html5-qrcode');
          const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
          scannerRef.current = scanner;
          scanner.render((decodedText: string) => {
            setInputValue(decodedText);
            setIsScannerOpen(false);
            scanner.clear().catch(console.error);
            setTimeout(() => performSearch(decodedText), 100);
          }, () => {});
        } catch (err) { console.error("Scanner init error", err); }
      }, 100);
      return () => clearTimeout(timer);
    }
    return () => {
      if (scannerRef.current) {
        try { scannerRef.current.clear().catch(() => {}); } catch(e) {}
        scannerRef.current = null;
      }
    };
  }, [isScannerOpen]);

  const performSearch = (termRaw: string) => {
    const term = termRaw.trim().toLowerCase();
    if (!term) return;

    // Search using API
    api.searchAccessions(term, searchScope !== 'all' ? searchScope : undefined, isExactMatch).then(res => {
      const match = res.accessions[0];
      if (match) {
        if (mode === 'direct') {
          if (templates.length === 0) { alert(t('sub.noTemplate', language)); return; }
          setLastPrintedItem(match);
          printTaskQueue.current.push(match);
          processPrintQueue();
          setInputValue('');
        } else if (mode === 'queue') {
          setQueue(prev => [...prev, { ...match, _queueId: Date.now() }]);
          setInputValue('');
        }
      }
    }).catch(() => {});
  };

  const processPrintQueue = async () => {
    if (isProcessingQueue.current || printTaskQueue.current.length === 0) return;
    isProcessingQueue.current = true;
    while (printTaskQueue.current.length > 0) {
      const item = printTaskQueue.current.shift();
      await silentPrint([item]);
      await new Promise(r => setTimeout(r, 200));
    }
    isProcessingQueue.current = false;
  };

  const silentPrint = async (items: any[]) => {
    if (isPrinting || !currentTemplate) return;
    setIsPrinting(true);
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      await api.print(items, currentTemplate.id, selectedPrinter || undefined, selectedOperator, selectedMedia, copies);
      setPrintStatus('success');
      setLastPrintedItem(items[items.length - 1]);

      // Update queue if in queue mode
      if (mode === 'queue') {
        setQueue(prev => prev.filter(qi => !items.find(i => i._queueId === qi._queueId)));
      }
    } catch (e) {
      console.error(e);
      setPrintStatus('error');
    } finally {
      setTimeout(() => {
        setIsPrinting(false);
        setPrintStatus('idle');
        setModalItems([]);
        window.focus();
        refocus();
      }, 300);
    }
  };

  const clearQueue = () => {
    if (window.confirm(t('common.clearConfirm', language))) {
      setQueue([]);
      localStorage.removeItem('brc_print_queue');
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') performSearch(inputValue);
  };

  return (
    <div className="h-full flex flex-col gap-5">
      <div className="flex flex-col xl:flex-row gap-4 no-print animate-fade-in-up">
        <div className="glass-panel p-1.5 rounded-2xl flex gap-1 self-start shadow-sm border-white/50">
          {[
            { id: 'direct', label: t('sub.mode.direct', language), icon: Play, color: 'text-[#2e7d32]' },
            { id: 'queue', label: t('sub.mode.queue', language), icon: ShoppingCart, color: 'text-orange-600' },
            { id: 'batch', label: t('sub.mode.batch', language), icon: List, color: 'text-blue-600' },
          ].map((m) => (
            <button key={m.id} onClick={() => { setMode(m.id as Mode); setInputValue(''); }}
              className={cn("flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap active:scale-95",
                mode === m.id ? "bg-white shadow-md " + m.color : "text-gray-400 hover:bg-white/40 hover:text-gray-600"
              )}>
              <m.icon className="w-4 h-4" /> {m.label}
            </button>
          ))}
        </div>
        <div className="flex-1 glass-panel p-1.5 rounded-2xl flex flex-wrap gap-2 items-center shadow-sm border-white/50">
          <div className="flex items-center gap-2 px-3 border-r border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{t('common.template', language)}</span>
            <select className="bg-transparent text-xs font-bold text-gray-700 outline-none max-w-[120px] truncate" value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 px-3 border-r border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{t('common.operator', language)}</span>
            <select className="bg-transparent text-xs font-bold text-gray-700 outline-none" value={selectedOperator} onChange={e => setSelectedOperator(e.target.value)}>
              {operators.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 px-3 border-r border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{t('setup.media', language)}</span>
            <select className="bg-transparent text-xs font-bold text-gray-700 outline-none" value={selectedMedia} onChange={e => setSelectedMedia(e.target.value)}>
              {(mediaTypes || []).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 px-3">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{t('common.copies', language)}</span>
            <input type="number" min="1" className="w-10 bg-transparent text-xs font-bold text-gray-700 outline-none text-center" value={copies} onChange={e => setCopies(Number(e.target.value))} />
          </div>
        </div>
      </div>

      {(mode === 'direct' || mode === 'queue') && (
        <div className="no-print animate-fade-in-up">
          <div className={cn("relative group transition-all duration-500 rounded-3xl p-1 shadow-2xl overflow-hidden",
            isPrinting ? "bg-orange-100" : "bg-gradient-to-r from-[#2e7d32] via-[#4caf50] to-[#2e7d32] p-[2px]"
          )}>
            <div className="bg-white rounded-[22px] flex items-center p-3 sm:p-5 gap-4">
              <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500",
                isPrinting ? "bg-orange-500 text-white animate-pulse" : "bg-[#e8f5e9] text-[#2e7d32]"
              )}>
                {isPrinting ? <Loader2 className="w-7 h-7 animate-spin" /> : <Target className="w-7 h-7" />}
              </div>
              <div className="flex-1 relative">
                <div className="absolute top-[-22px] left-0 text-[10px] font-black text-[#2e7d32] uppercase tracking-[0.2em] animate-pulse">
                  {isPrinting ? "SYSTEM BUSY - PRINTING..." : "SCANNING STATION READY"}
                </div>
                <input ref={searchInputRef} type="text" placeholder={t('sub.searchPlace.id', language)}
                  value={inputValue} onChange={e => setInputValue(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className={cn("w-full bg-transparent border-none outline-none text-xl sm:text-2xl font-bold placeholder-gray-300 transition-opacity", isPrinting ? "opacity-50" : "opacity-100")}
                  disabled={isPrinting} autoFocus />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsExactMatch(!isExactMatch)}
                  className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
                    isExactMatch ? "bg-[#2e7d32] text-white border-[#2e7d32] shadow-lg shadow-green-900/20" : "bg-white text-gray-400 border-gray-200 hover:border-[#2e7d32] hover:text-[#2e7d32]"
                  )}>
                  <Target className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('sub.match.exact', language)}</span>
                </button>
                <button onClick={() => setIsScannerOpen(true)} className="p-3 rounded-xl bg-gray-100 text-gray-500 hover:bg-[#e8f5e9] hover:text-[#2e7d32] transition-all">
                  <Camera className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between px-2">
            <p className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> {isPrinting ? "任务处理中，请稍后再次扫描..." : t('sub.directHint', language)}
            </p>
            {selectedPrinter && (
              <div className="text-[10px] font-bold text-[#2e7d32] flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded border border-green-100">
                <Printer className="w-3 h-3" /> ONLINE: {selectedPrinter}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden gap-6 flex-col lg:flex-row animate-fade-in-up">
        <div className="flex flex-col glass-panel rounded-3xl no-print flex-1 overflow-hidden transition-all duration-500 shadow-sm border-white/50">
          <div className="p-4 flex items-center justify-between gap-4 border-b border-gray-100 bg-white/40">
            {mode === 'batch' ? (
              <div className="flex-1 flex items-center glass-input rounded-xl px-3 py-2">
                <Search className="w-4 h-4 text-gray-400 mr-2" />
                <input type="text" placeholder={t('common.search', language)} className="bg-transparent border-none outline-none text-sm w-full"
                  value={inputValue} onChange={e => setInputValue(e.target.value)} />
              </div>
            ) : (
              <div className="text-sm font-black text-gray-500 uppercase tracking-widest px-2 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#2e7d32]" />
                {t('sub.mode.queue', language)} ({queue.length})
              </div>
            )}
            <div className="flex items-center gap-2">
              {mode === 'queue' && queue.length > 0 && (
                <button onClick={clearQueue} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-red-500 hover:bg-red-50 transition-all border border-transparent hover:border-red-100">
                  <Eraser className="w-4 h-4" /> {t('common.clear', language)}
                </button>
              )}
              {mode === 'batch' && (
                <button onClick={() => { if (selectedIds.size === 0) return alert(t('sub.selectHint', language)); setModalItems(filteredData.filter(d => selectedIds.has(d.id))); setIsPrintModalOpen(true); }}
                  className="btn-primary px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 text-sm shadow-md">
                  <Printer className="w-4 h-4" /> {t('sub.printBtn', language)}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-white/20 custom-scrollbar">
            {mode === 'batch' && (
              <table className="min-w-full">
                <thead className="bg-white/60 sticky top-0 backdrop-blur-md z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-4 text-left w-12"><input type="checkbox" className="rounded text-[#2e7d32]"
                      onChange={() => { const all = filteredData.every(d => selectedIds.has(d.id)); const newSet = new Set(selectedIds); filteredData.forEach(d => all ? newSet.delete(d.id) : newSet.add(d.id)); setSelectedIds(newSet); }}
                      checked={filteredData.length > 0 && filteredData.every(d => selectedIds.has(d.id))} /></th>
                    {visibleColumns.slice(0, 4).map(c => <th key={c} className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredData.map((row) => (
                    <tr key={row.id} className="hover:bg-white/60 transition-colors animate-fade-in-up">
                      <td className="px-6 py-3"><input type="checkbox" className="rounded text-[#2e7d32]" checked={selectedIds.has(row.id)}
                        onChange={() => { const newSet = new Set(selectedIds); newSet.has(row.id) ? newSet.delete(row.id) : newSet.add(row.id); setSelectedIds(newSet); }} /></td>
                      {visibleColumns.slice(0, 4).map(c => <td key={c} className="px-6 py-3 text-sm font-medium text-gray-700">{row[c] || row[primaryIdColumn]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mode === 'direct' && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 select-none p-10">
                <div className="w-40 h-40 bg-white/40 rounded-[2.5rem] flex items-center justify-center mb-8 shadow-inner ring-1 ring-white">
                  <Play className="w-16 h-16 text-gray-200 ml-2" />
                </div>
                <p className="max-w-xs text-center text-base font-bold text-gray-400 mb-2 uppercase tracking-widest">{t('sub.directHint', language)}</p>
                <p className="text-sm text-gray-400 opacity-60">使用扫码枪连续扫码即可自动完成打印</p>
              </div>
            )}
            {mode === 'queue' && (
              <div className="p-6 space-y-3">
                {queue.length > 0 ? queue.map((item, idx) => (
                  <div key={item._queueId} className="flex justify-between items-center p-5 bg-white rounded-2xl shadow-sm border border-gray-100 group animate-fade-in-up">
                    <div className="flex items-center gap-5">
                      <div className="w-10 h-10 bg-[#e8f5e9] rounded-xl flex items-center justify-center text-[#2e7d32] font-black text-sm">{idx + 1}</div>
                      <div>
                        <div className="font-black text-gray-800">{item[primaryIdColumn]}</div>
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-tight">{item[nameColumn]}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => silentPrint([item])} className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:bg-[#e8f5e9] hover:text-[#2e7d32] transition-all"><Printer className="w-5 h-5" /></button>
                      <button onClick={() => setQueue(q => q.filter(i => i._queueId !== item._queueId))} className="p-2.5 rounded-xl bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"><Trash2 className="w-5 h-5" /></button>
                    </div>
                  </div>
                )) : (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                    <ShoppingCart className="w-20 h-20 mb-4 opacity-20" />
                    <p className="font-bold text-sm tracking-widest uppercase">{t('sub.queueEmpty', language)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {mode === 'batch' && (
            <div className="p-4 border-t border-gray-100 bg-white/40 flex justify-between items-center text-xs">
              <span className="font-black text-gray-400 uppercase tracking-widest">Page {currentPage} of {totalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white shadow-sm hover:shadow-md transition-all"><ChevronLeft className="w-5 h-5"/></button>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white shadow-sm hover:shadow-md transition-all"><ChevronRight className="w-5 h-5"/></button>
              </div>
            </div>
          )}
          {mode === 'queue' && queue.length > 0 && (
            <div className="p-4 border-t border-gray-100 bg-white/40 flex gap-3">
              <button onClick={() => { setModalItems(queue); setIsPrintModalOpen(true); }}
                className="flex-1 btn-primary py-4 rounded-2xl font-black text-sm tracking-widest uppercase flex items-center justify-center gap-3 shadow-lg shadow-green-900/10">
                <Printer className="w-5 h-5" /> {t('sub.printQueue', language)} ({queue.length})
              </button>
            </div>
          )}
        </div>

        {mode === 'direct' && (
          <div className="hidden lg:flex w-[380px] glass-panel rounded-3xl p-8 flex-col items-center justify-center no-print relative overflow-hidden shadow-sm border-white/50 shrink-0">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#2e7d32] to-transparent opacity-30 animate-pulse"></div>
            <h3 className="text-gray-400 font-black mb-10 uppercase tracking-[0.2em] text-[10px]">{t('common.preview', language)}</h3>
            <div className="relative group">
              {lastPrintedItem && currentTemplate ? (
                <div className="bg-white p-2 shadow-[0_20px_50px_rgba(0,0,0,0.1)] rounded-sm transform transition-all duration-500 group-hover:scale-110 animate-scale-in">
                  <LabelCanvas template={currentTemplate} data={{ ...lastPrintedItem, operator: selectedOperator, medium: selectedMedia }} primaryIdColumn={primaryIdColumn} scale={2} />
                </div>
              ) : (
                <div className="w-56 h-36 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-300 gap-3">
                  <Loader2 className="w-8 h-8 opacity-20 animate-spin" />
                  <span className="text-xs font-bold uppercase tracking-widest">{t('common.waiting', language)}</span>
                </div>
              )}
              {printStatus === 'success' && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded animate-in fade-in zoom-in duration-300">
                  <div className="w-14 h-14 bg-[#2e7d32] rounded-full flex items-center justify-center text-white shadow-lg shadow-green-900/40">
                    <Check className="w-8 h-8" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Print Preview Modal */}
      {isPrintModalOpen && currentTemplate && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[100] flex items-center justify-center no-print p-4">
          <div className="glass-panel bg-white rounded-[2rem] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-2xl font-black text-gray-800 uppercase tracking-tight">{t('sub.printBtn', language)}</h3>
                <p className="text-sm font-bold text-gray-400 uppercase">{modalItems.length} items</p>
              </div>
              <button onClick={() => setIsPrintModalOpen(false)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white shadow-sm hover:shadow-md transition-all"><X className="w-6 h-6 text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-auto p-10 bg-gray-100/30 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 items-start justify-items-center custom-scrollbar">
              {modalItems.slice(0, 100).map((item, i) => (
                <div key={i} className="shadow-xl bg-white p-3 rounded-md transition-transform hover:scale-105 duration-300">
                  <LabelCanvas template={currentTemplate} data={{...item, operator: selectedOperator, medium: selectedMedia}} primaryIdColumn={primaryIdColumn} scale={1.5} />
                </div>
              ))}
              {modalItems.length > 100 && (
                <div className="col-span-full py-10 text-center text-gray-400 font-black uppercase tracking-widest">... and {modalItems.length - 100} more labels</div>
              )}
            </div>
            <div className="p-8 border-t border-gray-100 flex justify-end gap-4 bg-white">
              <button onClick={() => setIsPrintModalOpen(false)} className="px-8 py-3.5 text-gray-600 font-bold hover:bg-gray-100 rounded-2xl uppercase tracking-widest text-xs">{t('common.cancel', language)}</button>
              <button onClick={() => { setIsPrintModalOpen(false); silentPrint(modalItems); }}
                className="btn-primary px-12 py-3.5 rounded-2xl font-black flex items-center gap-3 uppercase tracking-widest text-xs shadow-xl shadow-green-900/20 active:scale-95 transition-all">
                <Printer className="w-5 h-5" /> {t('sub.printNow', language)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Modal */}
      {isScannerOpen && (
        <div className="fixed inset-0 bg-gray-900/90 backdrop-blur-xl z-[100] flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-[2rem] overflow-hidden relative shadow-2xl">
            <button onClick={() => setIsScannerOpen(false)} className="absolute top-4 right-4 z-[110] w-12 h-12 bg-white/80 backdrop-blur-md rounded-2xl flex items-center justify-center text-gray-700 hover:bg-white transition-all shadow-lg"><X className="w-6 h-6" /></button>
            <div className="p-6 bg-white border-b border-gray-100"><h3 className="text-xl font-black text-center text-gray-800 uppercase tracking-tight">{t('common.scan', language)}</h3></div>
            <div id="reader" className="w-full aspect-square bg-black"></div>
            <div className="p-6 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">{t('sub.scanHint', language)}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Subculture;
