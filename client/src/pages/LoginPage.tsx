import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import { Sprout, Lock, User, Shield, Globe, Mail, Building2, UserPlus } from 'lucide-react';

const LoginPage: React.FC = () => {
  const { login, setup, needsSetup, isAuthenticated, language, setLanguage } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [allowRegister, setAllowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ username: '', password: '', displayName: '', org: '', email: '' });

  useEffect(() => {
    if (!needsSetup) {
      api.checkSetup().then(r => setAllowRegister(!!r.allowRegister)).catch(() => {});
    }
  }, [needsSetup]);

  if (isAuthenticated) {
    window.location.hash = '/';
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    try {
      if (needsSetup) {
        await setup(username, password);
      } else {
        await login(username, password);
      }
      window.location.hash = '/';
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!regForm.username || !regForm.password) { setError(t('login.registerRequired', language)); return; }
    try {
      const res = await api.register(regForm);
      if (res.pending) {
        setInfo(t('login.registerPending', language));
        setMode('login');
      } else {
        setInfo(t('login.registerDone', language));
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message || '注册失败');
    }
  };

  const fieldCls = "bg-transparent border-none outline-none text-sm flex-1 p-3";
  const wrapCls = "glass-input rounded-xl p-1 flex items-center gap-2 focus-within:ring-2 focus-within:ring-green-200 transition-all";

  return (
    <div className="app-top-gradient h-screen w-screen flex items-center justify-center bg-paper">
      <div className="glass-panel p-10 w-full max-w-md mx-4 relative z-10 shadow-hard-lg border-2 border-ink">
        <div className="absolute top-4 right-4">
          <button onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')} className="flex items-center gap-1.5 px-3 py-1.5 bg-ash-100 hover:bg-acid border-2 border-ink text-xs font-black uppercase tracking-widest text-ink transition-all">
            <Globe className="w-3.5 h-3.5" /> {language === 'zh' ? 'EN' : '中'}
          </button>
        </div>

        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-acid border-2 border-ink flex items-center justify-center mx-auto mb-4 shadow-hard">
            <Sprout className="w-10 h-10 text-ink" />
          </div>
          <h1 className="text-4xl font-black text-ink tracking-widest uppercase">BRC Nexus</h1>
          <p className="text-ink text-sm font-black uppercase tracking-widest mt-2">CCCAP · {t('app.slogan', language)}</p>
          <p className="text-ink/60 mt-3 text-xs font-bold uppercase tracking-wider">
            {needsSetup ? t('login.firstRun', language) : t('login.title', language)}
          </p>
        </div>

        {mode === 'login' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm p-3 rounded-xl flex items-center gap-2">
                <Shield className="w-4 h-4" /> {error}
              </div>
            )}
            {info && (
              <div className="bg-green-50 border border-green-100 text-green-700 text-sm p-3 rounded-xl flex items-center gap-2">
                <Shield className="w-4 h-4" /> {info}
              </div>
            )}
            <div className={wrapCls}>
              <User className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="text"
                placeholder={t('login.username', language)}
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={fieldCls}
                autoFocus
              />
            </div>
            <div className={wrapCls}>
              <Lock className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="password"
                placeholder={t('login.password', language)}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={fieldCls}
              />
            </div>
            <button type="submit" className="btn-acid w-full py-4 text-base tracking-widest uppercase">
              {needsSetup ? t('login.createAdmin', language) : t('login.submit', language)}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm p-3 rounded-xl flex items-center gap-2">
                <Shield className="w-4 h-4" /> {error}
              </div>
            )}
            <div className={wrapCls}>
              <User className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="text"
                placeholder={`${t('login.username', language)} *`}
                value={regForm.username}
                onChange={e => setRegForm({ ...regForm, username: e.target.value })}
                className={fieldCls}
                autoFocus
              />
            </div>
            <div className={wrapCls}>
              <Lock className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="password"
                placeholder={`${t('login.password', language)} *`}
                value={regForm.password}
                onChange={e => setRegForm({ ...regForm, password: e.target.value })}
                className={fieldCls}
              />
            </div>
            <div className={wrapCls}>
              <UserPlus className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="text"
                placeholder={t('users.displayName', language)}
                value={regForm.displayName}
                onChange={e => setRegForm({ ...regForm, displayName: e.target.value })}
                className={fieldCls}
              />
            </div>
            <div className={wrapCls}>
              <Building2 className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="text"
                placeholder={t('users.org', language)}
                value={regForm.org}
                onChange={e => setRegForm({ ...regForm, org: e.target.value })}
                className={fieldCls}
              />
            </div>
            <div className={wrapCls}>
              <Mail className="w-5 h-5 text-gray-400 ml-3" />
              <input
                type="text"
                placeholder={t('users.email', language)}
                value={regForm.email}
                onChange={e => setRegForm({ ...regForm, email: e.target.value })}
                className={fieldCls}
              />
            </div>
            <button type="submit" className="btn-acid w-full py-4 text-base tracking-widest uppercase">
              {t('login.registerSubmit', language)}
            </button>
          </form>
        )}

        {!needsSetup && (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm">
            {mode === 'login' ? (
              allowRegister && (
                <>
                  <span className="text-gray-400 text-xs">{t('login.noAccount', language)}</span>
                  <button onClick={() => { setMode('register'); setError(''); setInfo(''); }} className="text-[#2e7d32] font-bold hover:underline">
                    {t('login.register', language)}
                  </button>
                </>
              )
            ) : (
              <button onClick={() => { setMode('login'); setError(''); setInfo(''); }} className="text-gray-500 font-bold hover:underline text-xs">
                ← {t('login.back', language)}
              </button>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">
          BRC Nexus v2.18 &copy; CIP-CCCAP
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
