import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Bell, CheckCheck, MailOpen, Trash2, RefreshCw } from 'lucide-react';

const Messages: React.FC = () => {
  const { language, user } = useApp();
  const isAdmin = user?.role === 'admin';
  const [filter, setFilter] = useState(''); // '' | 'unread'
  const [messages, setMessages] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  const flash = (s: string) => { setMsg(s); window.setTimeout(() => setMsg(''), 2600); };

  const load = useCallback(async () => {
    try {
      const res = await api.getMessages({ unread: filter === 'unread' });
      setMessages(res.messages || []);
    } catch (e: any) { flash(e.message || '加载失败'); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // v2.12：操作后广播事件，让顶栏未读徽标立即刷新
  const notifyBadge = () => window.dispatchEvent(new Event('brc:unread-refresh'));

  const markRead = async (id: string) => {
    try { await api.markMessageRead(id); await load(); notifyBadge(); } catch (e: any) { flash(e.message || '操作失败'); }
  };

  const readAll = async () => {
    try { await api.markAllRead(); await load(); notifyBadge(); } catch (e: any) { flash(e.message || '操作失败'); }
  };

  const del = async (id: string) => {
    if (!window.confirm(t('common.deleteConfirm', language))) return;
    try { await api.deleteMessage(id); await load(); notifyBadge(); } catch (e: any) { alert(e.message); }
  };

  const titleOf = (m: any) => (language === 'zh' ? m.title : m.title_en || m.title) || m.title || '';
  const bodyOf = (m: any) => (language === 'zh' ? m.body : m.body_en || m.body) || m.body || '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">NOTIFICATIONS</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <Bell className="w-6 h-6 text-amber-500" /> {t('msg.title', language)}
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl text-xs font-bold bg-white/60 hover:bg-white text-gray-500"><RefreshCw className="w-3.5 h-3.5 inline mr-1" /></button>
          <button onClick={readAll} className="px-4 py-2 rounded-xl text-sm font-bold bg-amber-50 text-amber-700 hover:bg-amber-100"><CheckCheck className="w-4 h-4 inline mr-1" />{t('msg.readAll', language)}</button>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setFilter('')} className={`px-4 py-2 rounded-xl text-sm font-bold ${filter === '' ? 'bg-[#e8f5e9] text-[#2e7d32]' : 'bg-white/60 text-gray-500 hover:bg-white'}`}>{t('msg.all', language)}</button>
        <button onClick={() => setFilter('unread')} className={`px-4 py-2 rounded-xl text-sm font-bold ${filter === 'unread' ? 'bg-[#e8f5e9] text-[#2e7d32]' : 'bg-white/60 text-gray-500 hover:bg-white'}`}>{t('msg.unread', language)}</button>
      </div>

      {messages.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center text-gray-300">
          <MailOpen className="w-12 h-12 mx-auto mb-3" />
          <p className="text-sm">{filter === 'unread' ? t('msg.noUnread', language) : t('msg.empty', language)}</p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-gray-50">
          {messages.map(m => (
            <div key={m.id} className={`p-4 flex items-start gap-3 ${m.is_read ? 'bg-white/30' : 'bg-amber-50/50'}`}>
              <div className={`mt-1 p-2 rounded-lg ${m.is_read ? 'bg-gray-100 text-gray-400' : 'bg-amber-100 text-amber-600'}`}>
                <Bell className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`font-bold text-sm ${m.is_read ? 'text-gray-600' : 'text-gray-800'}`}>{titleOf(m)}</p>
                  {!m.is_read && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>}
                  <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</span>
                </div>
                {bodyOf(m) && <p className="text-xs text-gray-500 mt-1 break-words">{bodyOf(m)}</p>}
                <div className="mt-1.5 flex gap-2">
                  {!m.is_read && (
                    <button onClick={() => markRead(m.id)} className="text-[10px] font-bold text-amber-600 hover:text-amber-700"><MailOpen className="w-3 h-3 inline mr-0.5" />{t('msg.read', language)}</button>
                  )}
                  {isAdmin && (
                    <button onClick={() => del(m.id)} className="text-[10px] font-bold text-red-400 hover:text-red-600"><Trash2 className="w-3 h-3 inline mr-0.5" />{t('users.delete', language)}</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default Messages;
