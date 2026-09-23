import React, { useMemo, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { t, formatDate } from '../utils';
import { api } from '../api';
import { Sprout, Database, Layers, TrendingUp, PieChart, Clock, List } from 'lucide-react';

const Dashboard: React.FC = () => {
  const { language } = useApp();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.getDashboardStats().then(setStats).catch(() => {});
  }, []);

  const total = stats?.totalAccessions || 0;
  const potatoCount = stats?.potatoCount || 0;
  const sweetCount = stats?.sweetPotatoCount || 0;
  const otherCount = stats?.unknownSpecies || 0;
  const invTotal = stats?.totalInventory || 0;
  const roomCount = stats?.totalRooms || 0;
  const recentEvents = stats?.recentEvents || [];

  const potatoPct = total > 0 ? Math.round((potatoCount / total) * 100) : 0;
  const sweetPct = total > 0 ? Math.round((sweetCount / total) * 100) : 0;
  const otherPct = total > 0 ? Math.round((otherCount / total) * 100) : 0;

  return (
    <div className="h-full flex flex-col gap-8 animate-fade-in-up pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <span className="t-eyebrow">OVERVIEW</span>
          <div className="flex items-center gap-3 mb-1 mt-1">
            <div className="w-12 h-12 bg-[#e8f5e9] rounded-2xl flex items-center justify-center text-[#2e7d32]">
              <TrendingUp className="w-6 h-6" />
            </div>
            <h1 className="t-page-title text-3xl">{t('nav.dashboard', language)}</h1>
          </div>
          <p className="text-gray-500 font-medium ml-1">{t('app.subtitle', language)} v2.18 &bull; {formatDate(new Date())}</p>
        </div>
        <div className="bg-white/70 backdrop-blur-md px-6 py-3 rounded-2xl text-sm font-black text-[#2e7d32] shadow-sm border border-white flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          {t('dash.liveData', language)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-panel p-6 rounded-3xl flex items-center gap-5 border-white shadow-sm hover:shadow-xl transition-all group">
          <div className="w-14 h-14 rounded-[1.25rem] bg-green-50 flex items-center justify-center text-[#2e7d32] group-hover:bg-[#2e7d32] group-hover:text-white transition-colors"><Sprout className="w-7 h-7"/></div>
          <div>
            <div className="text-3xl font-black text-gray-800 tracking-tight">{total}</div>
            <div className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-1">{t('dash.accessions', language)}</div>
          </div>
        </div>
        <div className="glass-panel p-6 rounded-3xl flex items-center gap-5 border-white shadow-sm hover:shadow-xl transition-all group">
          <div className="w-14 h-14 rounded-[1.25rem] bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors"><Database className="w-7 h-7"/></div>
          <div>
            <div className="text-3xl font-black text-gray-800 tracking-tight">{invTotal}</div>
            <div className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-1">{t('dash.stock', language)}</div>
          </div>
        </div>
        <div className="glass-panel p-6 rounded-3xl flex items-center gap-5 border-white shadow-sm hover:shadow-xl transition-all group">
          <div className="w-14 h-14 rounded-[1.25rem] bg-orange-50 flex items-center justify-center text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-colors"><Layers className="w-7 h-7"/></div>
          <div>
            <div className="text-3xl font-black text-gray-800 tracking-tight">{roomCount}</div>
            <div className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-1">{t('dash.rooms', language)}</div>
          </div>
        </div>
        <div className="glass-panel p-6 rounded-3xl flex items-center gap-5 border-white shadow-sm hover:shadow-xl transition-all group">
          <div className="w-14 h-14 rounded-[1.25rem] bg-purple-50 flex items-center justify-center text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors"><TrendingUp className="w-7 h-7"/></div>
          <div>
            <div className="text-3xl font-black text-gray-800 tracking-tight">{total > 0 ? 'Active' : '--'}</div>
            <div className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-1">{t('dash.viability', language)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
        <div className="lg:col-span-2 glass-panel rounded-[2rem] p-8 flex flex-col border-white shadow-sm">
          <h3 className="text-xl font-black text-gray-800 mb-8 flex items-center gap-3 uppercase tracking-tight">
            <PieChart className="w-6 h-6 text-[#2e7d32]"/> {t('dash.dist', language)}
          </h3>
          <div className="flex-1 flex flex-col justify-center gap-10 px-4">
            <div>
              <div className="flex justify-between text-xs font-black text-gray-500 mb-3 uppercase tracking-widest">
                <span>{t('dash.potato', language)}</span>
                <span className="text-[#2e7d32]">{potatoCount} ({potatoPct}%)</span>
              </div>
              <div className="h-10 w-full bg-gray-100 rounded-2xl overflow-hidden p-1.5 shadow-inner">
                <div className="h-full bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-xl transition-all duration-1000 shadow-sm" style={{ width: `${Math.max(potatoPct, 2)}%` }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-black text-gray-500 mb-3 uppercase tracking-widest">
                <span>{t('dash.sweetPotato', language)}</span>
                <span className="text-purple-600">{sweetCount} ({sweetPct}%)</span>
              </div>
              <div className="h-10 w-full bg-gray-100 rounded-2xl overflow-hidden p-1.5 shadow-inner">
                <div className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-xl transition-all duration-1000 shadow-sm" style={{ width: `${Math.max(sweetPct, 2)}%` }}></div>
              </div>
            </div>
            {otherCount > 0 && (
              <div>
                <div className="flex justify-between text-xs font-black text-gray-500 mb-3 uppercase tracking-widest">
                  <span>{t('dash.others', language)}</span>
                  <span className="text-gray-500">{otherCount} ({otherPct}%)</span>
                </div>
                <div className="h-10 w-full bg-gray-100 rounded-2xl overflow-hidden p-1.5 shadow-inner">
                  <div className="h-full bg-gradient-to-r from-gray-300 to-gray-400 rounded-xl transition-all duration-1000 shadow-sm" style={{ width: `${Math.max(otherPct, 2)}%` }}></div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-[2rem] p-8 flex flex-col h-full border-white shadow-sm overflow-hidden bg-white/40">
          <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-3 uppercase tracking-tight">
            <Clock className="w-6 h-6 text-[#2e7d32]"/> {t('dash.recent', language)}
          </h3>
          <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
            {recentEvents.length > 0 ? recentEvents.map((event: any, i: number) => (
              <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm animate-fade-in-up">
                <div className="flex justify-between items-start mb-2">
                  <div className="text-[10px] font-black text-[#2e7d32] uppercase tracking-widest">{t('common.printed', language)}</div>
                  <div className="text-[10px] font-bold text-gray-400">{new Date(event.event_at).toLocaleTimeString()}</div>
                </div>
                <div className="text-sm font-black text-gray-800">{event.scanned_id}</div>
                <div className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-tighter">operator: {event.operator || 'N/A'} &bull; {event.copies} copies</div>
              </div>
            )) : (
              <div className="text-center py-20 opacity-20 flex flex-col items-center">
                <List className="w-16 h-16 mb-2" />
                <p className="text-xs font-black uppercase tracking-widest">No recent data</p>
              </div>
            )}
          </div>
          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <div className="text-[9px] font-black text-gray-300 uppercase tracking-[0.4em]">CIP-CCCAP MANAGER &bull; v2.18</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
