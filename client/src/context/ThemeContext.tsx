import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from './AppContext';

// v2.14 主题系统：brutalist（硬边黄黑）/ classic（CCCAP 绿柔卡）
// 状态：保存到 user_setting 'ui.theme'，运行时通过 document.documentElement.dataset.theme 切换 CSS 变量

export type ThemeName = 'brutalist' | 'classic';
const DEFAULT: ThemeName = 'brutalist';
const KEY = 'ui.theme';

interface ThemeCtx {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: DEFAULT, setTheme: () => {}, toggle: () => {} });

export const useTheme = () => useContext(Ctx);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useApp();
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT);

  // 用户登录后从服务端读持久化设置；游客保持默认
  useEffect(() => {
    if (!user) {
      // 切回默认主题（清本地残留）
      document.documentElement.dataset.theme = DEFAULT;
      setThemeState(DEFAULT);
      return;
    }
    api.getMySettings().then(s => {
      const t = s[KEY] === 'classic' ? 'classic' : DEFAULT;
      document.documentElement.dataset.theme = t;
      setThemeState(t);
    }).catch(() => {
      document.documentElement.dataset.theme = DEFAULT;
      setThemeState(DEFAULT);
    });
  }, [user?.id]);

  // 跨标签页同步（同一用户多 tab 切主题）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === `brc.theme.${user?.id || ''}` && (e.newValue === 'brutalist' || e.newValue === 'classic')) {
        document.documentElement.dataset.theme = e.newValue;
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id]);

  const setTheme = (t: ThemeName) => {
    document.documentElement.dataset.theme = t;
    setThemeState(t);
    api.putMySettings(KEY, t).catch(() => {});
    try { localStorage.setItem(`brc.theme.${user?.id || ''}`, t); } catch {}
  };
  const toggle = () => setTheme(theme === 'brutalist' ? 'classic' : 'brutalist');

  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>;
};
