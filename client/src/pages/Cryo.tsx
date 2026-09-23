import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Snowflake, Plus, BellRing, Download, History, X, Clock, CheckCircle2, AlertTriangle, Thermometer, Gauge } from 'lucide-react';

const Cryo: React.FC = () => {
  const { language, user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [status, setStatus] = useState<any>({ devices: [], eventTypes: [], eventLabels: {} });
  const [records, setRecords] = useState<any[]>([]);
  const [alarms, setAlarms] = useState<any[]>([]);
  const [recFilters, setRecFilters] = useState<any>({ device: '', eventType: '', from: '', to: '' });
  const [showDevice, setShowDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState<any>({ name: '', nameEn: '', location: '', capacity: '', note: '' });
  const [showQuick, setShowQuick] = useState(false);
  const [recForm, setRecForm] = useState<any>({ deviceId: '', eventType: 'lid_open', detail: '', temp: '', level: '', occurredAt: '' });
  const [showAlarm, setShowAlarm] = useState(false);
  const [alarmForm, setAlarmForm] = useState<any>({ deviceId: '', alarmType: '', severity: 'medium' });
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});
  const [correctForm, setCorrectForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const loadStatus = useCallback(async () => {
    try { setStatus(await api.getCryoStatus()); } catch (e) {}
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const res = await api.getCryoRecords(recFilters);
      setRecords(res.records || []);
    } catch (e) {}
  }, [recFilters]);

  const loadAlarms = useCallback(async () => {
    try {
      const res = await api.getCryoAlarms({});
      setAlarms(res.alarms || []);
    } catch (e) {}
  }, []);

  useEffect(() => { loadStatus(); loadRecords(); loadAlarms(); }, [loadStatus, loadRecords, loadAlarms]);

  const openAlarms = alarms.filter(a => a.status === 'open');

  const addDevice = async () => {
    if (!deviceForm.name) { alert(t('cryo.device.name', language) + ' *'); return; }
    try {
      await api.createCryoDevice(deviceForm);
      setShowDevice(false); setDeviceForm({ name: '', nameEn: '', location: '', capacity: '', note: '' });
      loadStatus();
    } catch (e: any) { alert(e.message); }
  };

  const delDevice = async (id: string) => {
    if (!window.confirm(t('common.deleteConfirm', language))) return;
    try { await api.deleteCryoDevice(id); loadStatus(); } catch (e: any) { alert(e.message); }
  };

  const submitRecord = async () => {
    if (!recForm.deviceId) { alert(t('cryo.record.device', language) + ' *'); return; }
    try {
      await api.createCryoRecord({
        ...recForm,
        temp: recForm.temp === '' ? undefined : Number(recForm.temp),
        level: recForm.level === '' ? undefined : Number(recForm.level),
        occurredAt: recForm.occurredAt || undefined,
      });
      setMsg(`✓ ${t('cryo.record.submit', language)}`);
      setShowQuick(false);
      setRecForm({ deviceId: '', eventType: 'lid_open', detail: '', temp: '', level: '', occurredAt: '' });
      loadRecords(); loadStatus();
    } catch (e: any) { alert(e.message); }
  };

  const submitAlarm = async () => {
    if (!alarmForm.deviceId || !alarmForm.alarmType) { alert(t('cryo.alarm.type', language) + ' *'); return; }
    try {
      await api.createCryoAlarm(alarmForm);
      setMsg(`✓ ${t('cryo.alarm.add', language)}`);
      setShowAlarm(false); setAlarmForm({ deviceId: '', alarmType: '', severity: 'medium' });
      loadAlarms(); loadStatus();
    } catch (e: any) { alert(e.message); }
  };

  const resolveAlarm = async (id: string) => {
    try {
      await api.resolveCryoAlarm(id, resolveNotes[id] || '');
      loadAlarms(); loadStatus();
    } catch (e: any) { alert(e.message); }
  };

  const correctTime = async (id: string) => {
    const newAt = correctForm[id];
    if (!newAt) return;
    try {
      await api.correctCryoTime(id, new Date(newAt).toISOString());
      setMsg(`✓ ${t('cryo.record.correctTime', language)}`);
      setCorrectForm({ ...correctForm, [id]: '' });
      loadRecords();
    } catch (e: any) { alert(e.message); }
  };

  const doExport = async () => {
    try {
      const blob = await api.exportCryoExcel(recFilters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'cryo_records.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { alert(e.message); }
  };

  const deviceName = (id: string) => status.devices.find((d: any) => d.id === id)?.name || id;
  const eventLabel = (k: string) => (status.eventLabels && status.eventLabels[k]) || k;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">CRYOGENIC STORE</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <Snowflake className="w-6 h-6 text-sky-600" /> {t('cryo.title', language)}
          </h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowQuick(v => !v)} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold"><Plus className="w-4 h-4 inline mr-1" />{t('cryo.quickRecord', language)}</button>
          <button onClick={() => setShowAlarm(v => !v)} className="px-4 py-2 rounded-xl text-sm font-bold bg-red-50 text-red-600 hover:bg-red-100"><BellRing className="w-4 h-4 inline mr-1" />{t('cryo.alarm.add', language)}</button>
          <button onClick={doExport} className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-50 text-blue-700 hover:bg-blue-100"><Download className="w-4 h-4 inline mr-1" />{t('cryo.export', language)}</button>
        </div>
      </div>

      {/* 设备列表 */}
      <div className="glass-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-700 flex items-center gap-2"><History className="w-4 h-4 text-sky-600" /> {t('cryo.devices', language)}</h2>
          {isAdmin && <button onClick={() => setShowDevice(v => !v)} className="px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700 text-xs font-bold hover:bg-sky-100"><Plus className="w-3.5 h-3.5 inline mr-1" />{t('cryo.device.add', language)}</button>}
        </div>
        {status.devices.length === 0 ? <div className="py-8 text-center text-gray-400 text-sm">{t('cryo.noDevices', language)}</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {status.devices.map((d: any) => (
              <div key={d.id} className="bg-white/70 border border-gray-100 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-gray-800">{d.name}</p>
                    {d.nameEn && <p className="text-[10px] text-gray-400">{d.nameEn}</p>}
                  </div>
                  {d.openAlarms > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600"><BellRing className="w-3 h-3 inline mr-0.5" />{d.openAlarms}</span>}
                  {isAdmin && <button onClick={() => delDevice(d.id)} className="text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>}
                </div>
                <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                  {d.location && <p>📍 {d.location}</p>}
                  {d.capacity && <p>{t('cryo.device.capacity', language)}: {d.capacity}</p>}
                  {d.note && <p className="text-gray-400">{d.note}</p>}
                </div>
                <div className="mt-3 pt-2 border-t border-gray-50 text-xs">
                  {d.lastRecord ? (
                    <p className="text-gray-500"><span className="text-gray-400">{t('cryo.lastRecord', language)}:</span> {eventLabel(d.lastRecord.event_type)} · {new Date(d.lastRecord.occurred_at).toLocaleString()}</p>
                  ) : <p className="text-gray-300">{t('cryo.lastRecord', language)}: -</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        {showDevice && (
          <div className="mt-4 bg-white/70 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
            <input type="text" value={deviceForm.name} onChange={e => setDeviceForm({ ...deviceForm, name: e.target.value })} placeholder={`${t('cryo.device.name', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={deviceForm.nameEn} onChange={e => setDeviceForm({ ...deviceForm, nameEn: e.target.value })} placeholder={t('cryo.device.nameEn', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={deviceForm.location} onChange={e => setDeviceForm({ ...deviceForm, location: e.target.value })} placeholder={t('cryo.device.location', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={deviceForm.capacity} onChange={e => setDeviceForm({ ...deviceForm, capacity: e.target.value })} placeholder={t('cryo.device.capacity', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={addDevice} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold">{t('common.save', language)}</button>
          </div>
        )}
      </div>

      {/* 快速记录 */}
      {showQuick && (
        <div className="glass-card p-5 rounded-2xl border-sky-200/50 animate-scale-in">
          <h2 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Snowflake className="w-4 h-4 text-sky-600" /> {t('cryo.quickRecord', language)}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <select value={recForm.deviceId} onChange={e => setRecForm({ ...recForm, deviceId: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
              <option value="">{`${t('cryo.record.device', language)} *`}</option>
              {status.devices.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={recForm.eventType} onChange={e => setRecForm({ ...recForm, eventType: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
              {(status.eventTypes || []).map((k: string) => <option key={k} value={k}>{eventLabel(k)}</option>)}
            </select>
            <input type="text" value={recForm.detail} onChange={e => setRecForm({ ...recForm, detail: e.target.value })} placeholder={t('cryo.record.detail', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={recForm.temp} onChange={e => setRecForm({ ...recForm, temp: e.target.value })} placeholder={t('cryo.record.temp', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={recForm.level} onChange={e => setRecForm({ ...recForm, level: e.target.value })} placeholder={t('cryo.record.level', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="datetime-local" value={recForm.occurredAt} onChange={e => setRecForm({ ...recForm, occurredAt: e.target.value })} placeholder={t('cryo.record.time', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={submitRecord} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold"><Snowflake className="w-4 h-4 inline mr-1" />{t('cryo.record.submit', language)}</button>
          </div>
          <p className="mt-2 text-[10px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{t('cryo.record.immutable', language)}</p>
        </div>
      )}

      {/* 报警 */}
      <div className="glass-card p-5 rounded-2xl">
        <h2 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><BellRing className="w-4 h-4 text-red-500" /> {t('cryo.alarms', language)}</h2>
        {openAlarms.length === 0 ? <div className="py-4 text-center text-gray-300 text-sm">{t('msg.noUnread', language)}</div> : (
          <div className="space-y-2">
            {openAlarms.map(a => (
              <div key={a.id} className="bg-red-50/70 border border-red-100 rounded-xl p-3 flex items-center gap-3 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">{a.alarm_type}</span>
                <span className="text-xs text-gray-600">{deviceName(a.device_id)}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{a.severity}</span>
                <span className="text-xs text-gray-400 ml-auto">{new Date(a.triggered_at).toLocaleString()}</span>
                <input type="text" value={resolveNotes[a.id] || ''} onChange={e => setResolveNotes({ ...resolveNotes, [a.id]: e.target.value })} placeholder={t('cryo.alarm.resolveNotes', language)} className="glass-input rounded-lg px-3 py-1.5 text-xs w-48" />
                <button onClick={() => resolveAlarm(a.id)} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700"><CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{t('cryo.alarm.resolve', language)}</button>
              </div>
            ))}
          </div>
        )}
        {showAlarm && (
          <div className="mt-4 bg-white/70 rounded-xl p-4 flex flex-wrap gap-2">
            <select value={alarmForm.deviceId} onChange={e => setAlarmForm({ ...alarmForm, deviceId: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
              <option value="">{`${t('cryo.record.device', language)} *`}</option>
              {status.devices.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input type="text" value={alarmForm.alarmType} onChange={e => setAlarmForm({ ...alarmForm, alarmType: e.target.value })} placeholder={`${t('cryo.alarm.type', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" />
            <select value={alarmForm.severity} onChange={e => setAlarmForm({ ...alarmForm, severity: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
              {['low', 'medium', 'high', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={submitAlarm} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-bold hover:bg-red-600">{t('common.save', language)}</button>
          </div>
        )}
      </div>

      {/* 记录表 */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-4 flex flex-wrap gap-2 items-center border-b border-gray-50">
          <select value={recFilters.device} onChange={e => setRecFilters({ ...recFilters, device: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
            <option value="">{t('cryo.record.device', language)}: {t('ops.all', language)}</option>
            {status.devices.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={recFilters.eventType} onChange={e => setRecFilters({ ...recFilters, eventType: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
            <option value="">{t('cryo.record.type', language)}: {t('ops.all', language)}</option>
            {(status.eventTypes || []).map((k: string) => <option key={k} value={k}>{eventLabel(k)}</option>)}
          </select>
          <input type="date" value={recFilters.from} onChange={e => setRecFilters({ ...recFilters, from: e.target.value })} placeholder={t('cryo.from', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={recFilters.to} onChange={e => setRecFilters({ ...recFilters, to: e.target.value })} placeholder={t('cryo.to', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
        </div>
        {records.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{t('ops.noData', language)}</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.time', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.device', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.type', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.operator', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.temp', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.level', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.detail', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('cryo.record.correctTime', language)}</th>
            </tr></thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} className="border-t border-gray-50 hover:bg-sky-50/40">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-gray-700">{deviceName(r.device_id)}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700">{eventLabel(r.event_type)}</span></td>
                  <td className="px-4 py-3 text-gray-600">{r.operator}</td>
                  <td className="px-4 py-3 text-gray-600">{r.device_temp != null ? `${r.device_temp}℃` : '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.device_level != null ? `${r.device_level}%` : '-'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{r.detail?.text || JSON.stringify(r.detail || {})}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <input type="datetime-local" value={correctForm[r.id] || ''} onChange={e => setCorrectForm({ ...correctForm, [r.id]: e.target.value })} className="glass-input rounded-lg px-2 py-1 text-xs" />
                      <button onClick={() => correctTime(r.id)} disabled={!correctForm[r.id]} className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-bold hover:bg-amber-100 disabled:opacity-40"><Clock className="w-3 h-3" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default Cryo;
