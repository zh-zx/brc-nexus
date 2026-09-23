import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Users as UsersIcon, Check, Ban, Power, KeyRound, Plus, Trash2, RefreshCw } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  active: 'tone-ok',
  pending: 'tone-warn',
  disabled: 'tone-neutral',
};

const Users: React.FC = () => {
  const { language, user: me } = useApp();
  const [filters, setFilters] = useState<any>({ type: '', status: '', q: '' });
  const [users, setUsers] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<any>({ username: '', password: '', displayName: '', role: 'user', userType: 'operator', org: '', email: '' });
  const [resetPw, setResetPw] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const [u, ty] = await Promise.all([api.getUsers(filters), api.getUserTypes()]);
      setUsers(u.users || []);
      setTypes(ty.types || []);
    } catch (e) {}
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const typeLabel = (code: string) => {
    const found = types.find((x: any) => x.code === code);
    if (!found) return t(`users.type.${code}`, language) || code;
    return language === 'zh' ? found.label : found.label_en || found.label;
  };

  const update = async (id: string, data: any) => {
    try { await api.updateUser(id, data); setMsg('✓'); load(); } catch (e: any) { alert(e.message); }
  };

  const doReset = async (id: string) => {
    const pw = resetPw[id];
    if (!pw || pw.length < 6) { alert('密码至少6位'); return; }
    try { await api.resetPassword(id, pw); setMsg('✓'); setResetPw({ ...resetPw, [id]: '' }); } catch (e: any) { alert(e.message); }
  };

  const doDelete = async (id: string) => {
    if (!window.confirm(t('common.deleteConfirm', language))) return;
    try { await api.deleteUser(id); load(); } catch (e: any) { alert(e.message); }
  };

  const create = async () => {
    if (!newForm.username || !newForm.password) { alert('用户名和密码必填'); return; }
    try {
      await api.createUser({ ...newForm, userType: newForm.userType });
      setMsg('✓');
      setShowNew(false);
      setNewForm({ username: '', password: '', displayName: '', role: 'user', userType: 'operator', org: '', email: '' });
      load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">ACCESS CONTROL</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-teal-600" /> {t('users.title', language)}
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-lg bg-teal-50 text-teal-600 text-xs font-bold hover:bg-teal-100"><RefreshCw className="w-3.5 h-3.5 inline mr-1" /></button>
          <button onClick={() => setShowNew(v => !v)} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold"><Plus className="w-4 h-4 inline mr-1" />{t('users.newUser', language)}</button>
        </div>
      </div>

      <div className="glass-card p-4 rounded-2xl flex flex-wrap gap-2 items-center">
        <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('users.userType', language)}: ${t('ops.all', language)}`}</option>
          {types.map((x: any) => <option key={x.code} value={x.code}>{language === 'zh' ? x.label : x.label_en || x.label}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
          <option value="">{`${t('users.status', language)}: ${t('ops.all', language)}`}</option>
          {['active', 'pending', 'disabled'].map(s => <option key={s} value={s}>{t(`users.status.${s}`, language)}</option>)}
        </select>
        <input type="text" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder={t('users.search', language)} className="flex-1 min-w-[200px] glass-input rounded-lg px-3 py-2 text-sm" />
      </div>

      {showNew && (
        <div className="glass-card p-5 rounded-2xl border-teal-200/50 animate-scale-in">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="text" value={newForm.username} onChange={e => setNewForm({ ...newForm, username: e.target.value })} placeholder={`${t('users.username', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="password" value={newForm.password} onChange={e => setNewForm({ ...newForm, password: e.target.value })} placeholder={`${t('users.resetPw', language)} *`} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={newForm.displayName} onChange={e => setNewForm({ ...newForm, displayName: e.target.value })} placeholder={t('users.displayName', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <select value={newForm.role} onChange={e => setNewForm({ ...newForm, role: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
              <option value="user">{t('users.role.user', language)}</option>
              <option value="admin">{t('users.role.admin', language)}</option>
            </select>
            <select value={newForm.userType} onChange={e => setNewForm({ ...newForm, userType: e.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm">
              {types.map((x: any) => <option key={x.code} value={x.code}>{language === 'zh' ? x.label : x.label_en || x.label}</option>)}
            </select>
            <input type="text" value={newForm.org} onChange={e => setNewForm({ ...newForm, org: e.target.value })} placeholder={t('users.org', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={newForm.email} onChange={e => setNewForm({ ...newForm, email: e.target.value })} placeholder={t('users.email', language)} className="glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={create} className="btn-primary px-4 py-2 rounded-lg text-sm font-bold">{t('common.save', language)}</button>
          </div>
        </div>
      )}

      <div className="glass-card rounded-2xl overflow-hidden">
        {users.length === 0 ? <div className="p-10 text-center text-gray-400 text-sm">{t('ops.noData', language)}</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="px-4 py-3 text-left font-bold">{t('users.username', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.role', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.userType', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.status', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.org', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.email', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.lastLogin', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('users.createdAt', language)}</th>
              <th className="px-4 py-3 text-left font-bold">{t('common.actions', language)}</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-gray-50 hover:bg-teal-50/40">
                  <td className="px-4 py-3">
                    <p className="font-bold text-gray-800">{u.username}</p>
                    {u.display_name && u.display_name !== u.username && <p className="text-[10px] text-gray-400">{u.display_name}</p>}
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{t(`users.role.${u.role}`, language)}</span></td>
                  <td className="px-4 py-3">
                    <select value={u.user_type || 'operator'} disabled={u.role === 'admin' && u.id !== me?.id ? false : false}
                      onChange={e => update(u.id, { userType: e.target.value })}
                      className="glass-input rounded-lg px-2 py-1 text-xs">
                      {types.map((x: any) => <option key={x.code} value={x.code}>{language === 'zh' ? x.label : x.label_en || x.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[u.status] || 'tone-neutral'}`}>{t(`users.status.${u.status}`, language)}</span></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{u.org || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{u.email || '-'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {u.status === 'pending' && (
                        <>
                          <button onClick={() => update(u.id, { status: 'active' })} className="px-2 py-1 rounded-lg bg-green-50 text-green-700 text-[10px] font-bold hover:bg-green-100"><Check className="w-3 h-3 inline mr-0.5" />{t('users.approve', language)}</button>
                          <button onClick={() => update(u.id, { status: 'disabled' })} className="px-2 py-1 rounded-lg bg-red-50 text-red-600 text-[10px] font-bold hover:bg-red-100"><Ban className="w-3 h-3 inline mr-0.5" />{t('users.reject', language)}</button>
                        </>
                      )}
                      {u.status === 'active' && (
                        <button onClick={() => update(u.id, { status: 'disabled' })} disabled={u.id === me?.id} className="px-2 py-1 rounded-lg bg-gray-50 text-gray-600 text-[10px] font-bold hover:bg-gray-100 disabled:opacity-40"><Power className="w-3 h-3 inline mr-0.5" />{t('users.disable', language)}</button>
                      )}
                      {u.status === 'disabled' && (
                        <button onClick={() => update(u.id, { status: 'active' })} className="px-2 py-1 rounded-lg bg-green-50 text-green-700 text-[10px] font-bold hover:bg-green-100"><Power className="w-3 h-3 inline mr-0.5" />{t('users.enable', language)}</button>
                      )}
                      <div className="flex items-center gap-1">
                        <input type="password" value={resetPw[u.id] || ''} onChange={e => setResetPw({ ...resetPw, [u.id]: e.target.value })} placeholder={t('users.resetPw', language)} className="glass-input rounded-lg px-2 py-1 text-[10px] w-24" />
                        <button onClick={() => doReset(u.id)} disabled={!resetPw[u.id]} className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-bold hover:bg-amber-100 disabled:opacity-40"><KeyRound className="w-3 h-3" /></button>
                      </div>
                      <button onClick={() => doDelete(u.id)} disabled={u.id === me?.id} className="px-2 py-1 rounded-lg text-red-400 hover:bg-red-50 text-[10px] disabled:opacity-40"><Trash2 className="w-3 h-3" /></button>
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

export default Users;
