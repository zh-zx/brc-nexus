import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Snowflake, ScanLine, ChevronRight, ChevronLeft, Package, Plus, ArrowUpFromLine, Move, ClipboardCheck, Save, X, History, Settings } from 'lucide-react';

const Freezer: React.FC = () => {
  const { language, user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [cfg, setCfg] = useState<any>(null);
  const [scanInput, setScanInput] = useState('');
  const [view, setView] = useState<'browse' | 'box'>('browse');
  const [freezer, setFreezer] = useState(1);
  const [shelf, setShelf] = useState(1);
  const [drawer, setDrawer] = useState(1);
  const [boxList, setBoxList] = useState<any[]>([]);
  const [box, setBox] = useState<any>(null);
  const [grid, setGrid] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [selPos, setSelPos] = useState<number | null>(null);
  const [modal, setModal] = useState<null | 'in' | 'out' | 'move' | 'count' | 'cfg'>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  // modal inputs
  const [mSampleCode, setMSampleCode] = useState('');
  const [mQty, setMQty] = useState('1');
  const [mPosition, setMPosition] = useState('');
  const [mTargetBox, setMTargetBox] = useState('');
  const [mTargetPos, setMTargetPos] = useState('');
  const [mReason, setMReason] = useState('');
  const [mDestination, setMDestination] = useState('');
  const [mNote, setMNote] = useState('');
  const [mExpected, setMExpected] = useState<Record<number, string>>({});
  const [cfgForm, setCfgForm] = useState<any>({});

  const loadCfg = useCallback(async () => {
    const res = await api.getFreezerConfig();
    setCfg(res.config);
    setCfgForm(res.config);
  }, []);

  const loadMovements = useCallback(async () => {
    try {
      const res = await api.getFreezerMovements({ limit: 30 });
      setMovements(res.movements || []);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { loadCfg(); loadMovements(); }, [loadCfg, loadMovements]);

  const loadBoxes = useCallback(async () => {
    const res = await api.getFreezerBoxes(freezer, shelf, drawer);
    setBoxList(res.boxes || []);
  }, [freezer, shelf, drawer]);

  useEffect(() => {
    if (view === 'browse') loadBoxes();
  }, [view, loadBoxes]);

  const openBox = async (boxNo: number) => {
    const res = await api.getFreezerBox(boxNo);
    setBox(res.box);
    setGrid(res.grid || []);
    setSelected(null);
    setSelPos(null);
    setView('box');
  };

  const handleScan = async () => {
    try {
      const res = await api.scanFreezerBox(scanInput);
      setBox(res.box);
      setGrid(res.grid || []);
      setSelected(null);
      setSelPos(null);
      setView('box');
      setScanInput('');
    } catch (e: any) { alert(t('frz.barcodeNotFound', language) + ': ' + e.message); }
  };

  const clickCell = (g: any) => {
    setSelPos(g.position);
    setSelected(g.sample);
  };

  const doCheckin = async () => {
    if (!mSampleCode.trim()) { alert(t('frz.sampleCode', language) + ' ' + t('frz.required', language)); return; }
    try {
      const res = await api.freezerCheckin({
        boxNo: box.boxNo, sampleCode: mSampleCode,
        position: mPosition || undefined, quantity: parseFloat(mQty) || 1,
      });
      setMsg(`✓ ${t('frz.operationDone', language)} @ ${res.location}`);
      setModal(null); setMSampleCode(''); setMQty('1'); setMPosition('');
      const reload = await api.getFreezerBox(box.boxNo);
      setGrid(reload.grid || []); loadMovements();
    } catch (e: any) { alert(t('frz.operationFailed', language) + ': ' + e.message); }
  };

  const doCheckout = async () => {
    if (!selected) return;
    try {
      await api.freezerCheckout({ sampleId: selected.id, quantity: parseFloat(mQty) || 1, destination: mDestination || undefined });
      setMsg(`✓ ${t('frz.operationDone', language)}`);
      setModal(null); setMQty('1'); setMDestination('');
      const reload = await api.getFreezerBox(box.boxNo);
      setGrid(reload.grid || []); setSelected(null); loadMovements();
    } catch (e: any) { alert(t('frz.operationFailed', language) + ': ' + e.message); }
  };

  const doMove = async () => {
    if (!selected) return;
    try {
      const res = await api.freezerMove({ sampleId: selected.id, targetBoxNo: parseInt(mTargetBox), targetPosition: parseInt(mTargetPos), reason: mReason });
      setMsg(`✓ ${t('frz.operationDone', language)}: ${res.from} → ${res.to}`);
      setModal(null); setMTargetBox(''); setMTargetPos(''); setMReason('');
      const reload = await api.getFreezerBox(box.boxNo);
      setGrid(reload.grid || []); setSelected(null); loadMovements();
    } catch (e: any) { alert(t('frz.operationFailed', language) + ': ' + e.message); }
  };

  const doCount = async () => {
    try {
      const results = Object.entries(mExpected).map(([position, expected]) => ({ position: parseInt(position), expected }));
      const res = await api.freezerCount({ boxNo: box.boxNo, results });
      setMsg(res.normal ? `✓ ${t('frz.normal', language)}` : `⚠ ${t('frz.diff', language)} ${res.differences.length} ${t('frz.occurrences', language)}`);
      setModal(null); setMExpected({}); loadMovements();
    } catch (e: any) { alert(t('frz.operationFailed', language) + ': ' + e.message); }
  };

  const saveCfg = async () => {
    try {
      await api.updateFreezerConfig(cfgForm);
      setMsg(`✓ ${t('frz.saveCfg', language)}`);
      setModal(null); loadCfg();
    } catch (e: any) { alert(e.message); }
  };

  if (!cfg) return <div className="text-center text-gray-400 py-20">{t('frz.title', language)}...</div>;

  const rowCount = cfg.rowCount, colCount = cfg.colCount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">FREEZER RACK</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <Snowflake className="w-6 h-6 text-blue-500" /> {t('frz.title', language)}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 bg-white border border-gray-100 rounded-lg px-3 py-1.5">
            {cfg.freezerCount}×{cfg.shelfPerFreezer}×{cfg.drawerPerShelf}×{cfg.boxPerDrawer}×{rowCount}×{colCount}
          </span>
          {isAdmin && (
            <button onClick={() => setModal('cfg')} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
              <Settings className="w-4 h-4 inline mr-1" />{t('frz.config', language)}
            </button>
          )}
        </div>
      </div>

      {/* Scan bar */}
      <div className="glass-card p-4 rounded-2xl flex gap-2">
        <ScanLine className="w-5 h-5 text-blue-500 shrink-0 self-center" />
        <input
          type="text" value={scanInput} onChange={e => setScanInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleScan()}
          placeholder={`${t('frz.scan', language)} (${t('frz.boxNoExample', language)})`} className="flex-1 glass-input rounded-lg px-3 py-2 text-sm"
        />
        <button onClick={handleScan} className="btn-primary px-5 py-2 rounded-lg text-sm font-bold">{t('frz.go', language)}</button>
      </div>

      {view === 'browse' && (
        <>
          {/* Drilldown */}
          <div className="glass-card p-5 rounded-2xl">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-2">{t('frz.freezer', language)}</span>
              {Array.from({ length: cfg.freezerCount }, (_, i) => i + 1).map(f => (
                <button key={f} onClick={() => { setFreezer(f); setShelf(1); setDrawer(1); }} className={`px-3 py-1.5 rounded-lg font-bold ${freezer === f ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>C{f}</button>
              ))}
              <ChevronRight className="w-4 h-4 text-gray-300" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-1">{t('frz.shelf', language)}</span>
              <select value={shelf} onChange={e => { setShelf(parseInt(e.target.value)); setDrawer(1); }} className="glass-input rounded-lg px-2 py-1.5 text-sm">
                {Array.from({ length: cfg.shelfPerFreezer }, (_, i) => i + 1).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronRight className="w-4 h-4 text-gray-300" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-1">{t('frz.drawer', language)}</span>
              <select value={drawer} onChange={e => setDrawer(parseInt(e.target.value))} className="glass-input rounded-lg px-2 py-1.5 text-sm">
                {Array.from({ length: cfg.drawerPerShelf }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Box list */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {boxList.map(b => (
                <button key={b.boxNo} onClick={() => openBox(b.boxNo)}
                  className={`rounded-xl border p-3 text-left transition-all hover:shadow-md ${b.occupied > 0 ? 'bg-blue-50/70 border-blue-200' : 'bg-white/50 border-gray-200 hover:border-gray-300'}`}>
                  <p className="font-bold text-gray-800 text-sm">{t('frz.boxes', language)} #{b.boxNo}</p>
                  <p className="text-[10px] text-gray-500 mt-1 flex items-center gap-1">
                    <Package className="w-3 h-3" /> {b.occupied}/{b.positions} {t('frz.occupied', language)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Movements */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-4 py-3 font-bold text-gray-700 flex items-center gap-2 border-b border-gray-50"><History className="w-4 h-4 text-blue-500" /> {t('frz.movements', language)}</div>
            {movements.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">{t('ops.noData', language)}</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-gray-400">
                    <th className="px-4 py-2 text-left font-bold">{t('frz.eventAt', language)}</th>
                    <th className="px-4 py-2 text-left font-bold">{t('frz.action', language)}</th>
                    <th className="px-4 py-2 text-left font-bold">{t('frz.fromLoc', language)}</th>
                    <th className="px-4 py-2 text-left font-bold">{t('frz.toLoc', language)}</th>
                    <th className="px-4 py-2 text-left font-bold">{t('ops.operator', language)}</th>
                  </tr></thead>
                  <tbody>
                    {movements.map(m => (
                      <tr key={m.id} className="border-t border-gray-50 text-gray-600">
                        <td className="px-4 py-2 whitespace-nowrap">{new Date(m.event_at).toLocaleString()}</td>
                        <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.action === 'IN' ? 'bg-green-100 text-green-700' : m.action === 'OUT' ? 'bg-red-100 text-red-600' : m.action === 'MOVE' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{m.action}</span></td>
                        <td className="px-4 py-2 font-mono">{m.from_loc || '-'}</td>
                        <td className="px-4 py-2 font-mono">{m.to_loc || '-'}</td>
                        <td className="px-4 py-2">{m.operator}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {view === 'box' && (
        <div className="glass-card p-5 rounded-2xl">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button onClick={() => setView('browse')} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
            <h2 className="font-bold text-gray-800">{t('frz.freezer', language)} C{box.freezerNo} · {t('frz.shelf', language)} {box.shelfNo} · {t('frz.drawer', language)} {box.drawerNo} · {t('frz.boxes', language)} #{box.boxNo}</h2>
            <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded">QR: {box.qr}</span>
            <button onClick={() => setModal('count')} className="ml-auto px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"><ClipboardCheck className="w-4 h-4 inline mr-1" />{t('frz.count', language)}</button>
            <button onClick={() => { setSelected(null); setModal('in'); }} className="btn-primary px-3 py-2 rounded-lg text-xs font-bold"><Plus className="w-4 h-4 inline mr-1" />{t('frz.checkin', language)}</button>
          </div>

          {/* Grid */}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))` }}>
            {grid.map(g => {
              const occupied = !!g.sample;
              const isSel = selPos === g.position;
              return (
                <button key={g.position} onClick={() => clickCell(g)}
                  className={`aspect-square rounded-lg border text-center flex flex-col items-center justify-center overflow-hidden transition-all ${
                    occupied ? 'bg-blue-100 border-blue-300 hover:bg-blue-200' : 'bg-white/40 border-gray-200 hover:border-gray-400'
                  } ${isSel ? 'ring-2 ring-blue-500' : ''}`}>
                  <span className="text-[9px] font-bold text-gray-400">{g.label}</span>
                  {g.sample ? (
                    <span className="text-[9px] font-bold text-blue-800 px-1 leading-tight truncate w-full">{g.sample.sample_code}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Selected sample panel */}
          <div className="mt-5 bg-gray-50/70 rounded-xl p-4">
            {!selected ? (
              <p className="text-xs text-gray-400 text-center">{t('frz.noSelection', language)}</p>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">{t('frz.selected', language)}</p>
                  <p className="font-bold text-gray-800 text-lg">{selected.sample_code}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{t('frz.position', language)} {selPos} · {t('frz.sampleQty', language)}: {selected.quantity} · {t('frz.accession', language)}: {selected.accession_id || '-'}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setMQty('1'); setModal('out'); }} className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100"><ArrowUpFromLine className="w-4 h-4 inline mr-1" />{t('frz.checkout', language)}</button>
                  <button onClick={() => { setModal('move'); }} className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100"><Move className="w-4 h-4 inline mr-1" />{t('frz.move', language)}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">
                {modal === 'in' && `${t('frz.checkin', language)} · ${t('frz.boxNo', language)} #${box?.boxNo}`}
                {modal === 'out' && t('frz.checkout', language)}
                {modal === 'move' && t('frz.move', language)}
                {modal === 'count' && `${t('frz.count', language)} · ${t('frz.boxNo', language)} #${box?.boxNo}`}
                {modal === 'cfg' && t('frz.config', language)}
              </h3>
              <button onClick={() => setModal(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>

            {modal === 'in' && (
              <div className="space-y-3">
                <input type="text" value={mSampleCode} onChange={e => setMSampleCode(e.target.value)} placeholder={t('frz.sampleCode', language)} className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" value={mQty} onChange={e => setMQty(e.target.value)} placeholder={t('frz.sampleQty', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                  <input type="number" value={mPosition} onChange={e => setMPosition(e.target.value)} placeholder={`${t('frz.positionNo', language)} (${t('frz.autoFirst', language)})`} className="glass-input rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={doCheckin} className="w-full btn-primary py-2.5 rounded-lg text-sm font-bold"><Save className="w-4 h-4 inline mr-1" />{t('frz.checkin', language)}</button>
              </div>
            )}

            {modal === 'out' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{t('frz.selected', language)}: <strong>{selected?.sample_code}</strong></p>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" value={mQty} onChange={e => setMQty(e.target.value)} placeholder={t('frz.sampleQty', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                  <input type="text" value={mDestination} onChange={e => setMDestination(e.target.value)} placeholder={t('frz.destination', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={doCheckout} className="w-full bg-red-500 text-white py-2.5 rounded-lg text-sm font-bold">{t('frz.checkout', language)}</button>
              </div>
            )}

            {modal === 'move' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{t('frz.selected', language)}: <strong>{selected?.sample_code}</strong> @ {selPos}</p>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" value={mTargetBox} onChange={e => setMTargetBox(e.target.value)} placeholder={t('frz.targetBox', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                  <input type="number" value={mTargetPos} onChange={e => setMTargetPos(e.target.value)} placeholder={t('frz.targetPosition', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
                </div>
                <input type="text" value={mReason} onChange={e => setMReason(e.target.value)} placeholder={t('frz.reason', language)} className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                <button onClick={doMove} className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-bold">{t('frz.move', language)}</button>
              </div>
            )}

            {modal === 'count' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{t('frz.results', language)}</p>
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-auto">
                  {grid.map(g => (
                    <div key={g.position} className="flex items-center gap-2 text-xs">
                      <span className="w-6 font-bold text-gray-400">{g.label}</span>
                      <input type="text" value={mExpected[g.position] || ''} onChange={e => setMExpected({ ...mExpected, [g.position]: e.target.value })} placeholder={g.sample?.sample_code || ''} className="flex-1 glass-input rounded-lg px-2 py-1.5 text-sm" />
                    </div>
                  ))}
                </div>
                <button onClick={doCount} className="w-full bg-amber-500 text-white py-2.5 rounded-lg text-sm font-bold"><ClipboardCheck className="w-4 h-4 inline mr-1" />{t('frz.count', language)}</button>
              </div>
            )}

            {modal === 'cfg' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{t('frz.configHint', language)}</p>
                <div className="grid grid-cols-3 gap-3">
                  {[['freezerCount', cfgForm.freezerCount], ['shelfPerFreezer', cfgForm.shelfPerFreezer], ['drawerPerShelf', cfgForm.drawerPerShelf], ['boxPerDrawer', cfgForm.boxPerDrawer], ['rowCount', cfgForm.rowCount], ['colCount', cfgForm.colCount]].map(([k, v]) => (
                    <div key={k as string}>
                      <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('frz.' + k, language)}</label>
                      <input type="number" value={v as any} onChange={e => setCfgForm({ ...cfgForm, [k]: parseInt(e.target.value) || 1 })} className="w-full glass-input rounded-lg px-2 py-2 text-sm" />
                    </div>
                  ))}
                </div>
                <button onClick={saveCfg} className="w-full btn-primary py-2.5 rounded-lg text-sm font-bold"><Save className="w-4 h-4 inline mr-1" />{t('frz.saveCfg', language)}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default Freezer;
