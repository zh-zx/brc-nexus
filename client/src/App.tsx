import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import Dashboard from './pages/Dashboard';
import Accessions from './pages/Accessions';
import Subculture from './pages/Subculture';
import LabelDesigner from './pages/LabelDesigner';
import Inventory from './pages/Inventory';
import Setup from './pages/Setup';
import LoginPage from './pages/LoginPage';
import Operations from './pages/Operations';
import Freezer from './pages/Freezer';
import IntroApproval from './pages/IntroApproval';
import Distribution from './pages/Distribution';
import Cryo from './pages/Cryo';
import Messages from './pages/Messages';
import Statistics from './pages/Statistics';
import Users from './pages/Users';
import LoginLog from './pages/LoginLog';
import Workbench from './pages/Workbench';
import Orders from './pages/Orders';
import Todos from './pages/Todos';
import Inspection from './pages/Inspection';
import DbAdmin from './pages/DbAdmin';
import FindGermplasm from './pages/FindGermplasm';
import Avatar from './components/Avatar';
import ProfileModal from './components/ProfileModal';
import ErrorBoundary from './components/ErrorBoundary';
import { Tag, Package, Settings, Sprout, LayoutDashboard, Database, LogOut, Globe, ClipboardList, Snowflake, ArrowDownToLine, ArrowUpFromLine, Bell, BarChart3, MessageSquareText, UserCog, ScrollText, ClipboardCheck, CheckSquare, ChevronLeft, ChevronRight, GripVertical, SlidersHorizontal, X, Search } from 'lucide-react';
import { t } from './utils';
import { api } from './api';

const RouterContext = React.createContext<{ path: string }>({ path: '/' });

const Router: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState(window.location.hash.slice(1) || '/');
  React.useEffect(() => {
    // 挂载后重新同步一次：登录流程中 hash 可能在 Router 挂载前的渲染阶段被修改
    //（例如 LoginPage 在 isAuthenticated 时于渲染期间把 hash 置为 '/'），此时 hashchange
    // 事件在监听器挂上之前就已触发而被错过，导致 path 卡在旧值（如 '/login'）。
    setPath(window.location.hash.slice(1) || '/');
    const onHashChange = () => setPath(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return <RouterContext.Provider value={{ path }}>{children}</RouterContext.Provider>;
};

const useLocation = () => {
  const { path } = React.useContext(RouterContext);
  return { pathname: path };
};

const Routes: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { path } = React.useContext(RouterContext);
  let element: React.ReactNode = null;
  React.Children.forEach(children, (child) => {
    if (element) return;
    if (React.isValidElement(child)) {
      const props = child.props as { path?: string; element?: React.ReactNode };
      if (props.path === path) element = props.element;
    }
  });
  return <>{element}</>;
};

const Route: React.FC<{ path: string; element: React.ReactNode }> = () => null;

const Link: React.FC<{ to: string; className?: string; title?: string; children: React.ReactNode }> = ({ to, className, title, children }) => (
  <a href={`#${to}`} className={className} title={title}>{children}</a>
);

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { language, logout, setLanguage, user } = useApp();
  const { theme, setTheme } = useTheme();
  const [dataSourceMode, setDataSourceMode] = useState<string>('local');
  const [unread, setUnread] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navOrder, setNavOrder] = useState<string[] | null>(null);
  const [showReorder, setShowReorder] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [draftNav, setDraftNav] = useState<{ path: string; label: string; icon: any }[]>([]);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    const refreshUnread = () => {
      if (user) api.getUnreadCount().then(r => setUnread(r.unread || 0)).catch(() => {});
    };
    refreshUnread();
    const iv = setInterval(refreshUnread, 60000);
    window.addEventListener('hashchange', refreshUnread);
    // v2.12：消息页标记已读/全部已读后立即刷新徽标
    window.addEventListener('brc:unread-refresh', refreshUnread);
    return () => {
      clearInterval(iv);
      window.removeEventListener('hashchange', refreshUnread);
      window.removeEventListener('brc:unread-refresh', refreshUnread);
    };
  }, [user]);

  useEffect(() => {
    api.getSettings().then(s => setDataSourceMode(s.data_source_mode || 'local')).catch(() => {});
    const onHashChange = () => {
      api.getSettings().then(s => setDataSourceMode(s.data_source_mode || 'local')).catch(() => {});
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // v2.7: 每用户侧边栏折叠/排序偏好
  useEffect(() => {
    if (!user) return;
    api.getMySettings().then(s => {
      const sb = s['ui.sidebar'];
      if (sb && typeof sb.collapsed === 'boolean') setSidebarCollapsed(sb.collapsed);
      if (Array.isArray(s['ui.navOrder'])) setNavOrder(s['ui.navOrder'] as string[]);
    }).catch(() => {});
  }, [user]);

  const isOrderRole = user?.role === 'admin' || user?.user_type === 'operator' || user?.user_type === 'regulator';

  // v2.11：默认导航按业务流排序（navOrder 用户自定义排序不受影响）：
  // 入口与沟通 → 资产与检索 → 保藏作业流（繁殖→入库→监测→记录→标签）→ 材料流转与任务 → 分析 → 系统管理
  const navItems = [
    { path: '/', label: t('nav.workbench', language), icon: LayoutDashboard },
    { path: '/todos', label: t('nav.todos', language), icon: CheckSquare },
    { path: '/messages', label: t('nav.messages', language), icon: MessageSquareText },
    { path: '/accessions', label: t('nav.accessions', language), icon: Database },
    { path: '/find', label: t('nav.find', language), icon: Search },
    { path: '/sub', label: t('nav.subculture', language), icon: Sprout },
    { path: '/inventory', label: t('nav.inventory', language), icon: Package },
    { path: '/freezer', label: t('nav.freezer', language), icon: Snowflake },
    { path: '/cryo', label: t('nav.cryo', language), icon: Snowflake },
    { path: '/operations', label: t('nav.operations', language), icon: ClipboardList },
    { path: '/design', label: t('nav.design', language), icon: Tag },
    { path: '/intro', label: t('nav.intro', language), icon: ArrowDownToLine },
    { path: '/dist', label: t('nav.dist', language), icon: ArrowUpFromLine },
    ...(isOrderRole ? [
      { path: '/orders', label: t('nav.orders', language), icon: ClipboardCheck },
      { path: '/inspection', label: t('nav.inspection', language), icon: ClipboardCheck },
    ] : []),
    { path: '/statistics', label: t('nav.statistics', language), icon: BarChart3 },
    ...(user?.role === 'admin' ? [
      { path: '/dashboard', label: t('nav.dashboard', language), icon: LayoutDashboard },
      { path: '/users', label: t('nav.users', language), icon: UserCog },
      { path: '/loginlog', label: t('nav.loginlog', language), icon: ScrollText },
      { path: '/db', label: t('nav.database', language), icon: Database },
    ] : []),
    ...(user?.user_type === 'external' ? [] : [
      { path: '/setup', label: t('nav.setup', language), icon: Settings },
    ]),
  ];

  // v2.7: 按用户保存的顺序排序（未保存的项排最后）
  const orderedNav = navOrder
    ? [...navItems].sort((a, b) => {
        const ia = navOrder.indexOf(a.path);
        const ib = navOrder.indexOf(b.path);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
    : navItems;

  const toggleCollapse = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    api.putMySettings('ui.sidebar', { collapsed: next }).catch(() => {});
  };

  const openReorder = () => {
    setDraftNav(orderedNav.map(n => ({ path: n.path, label: n.label, icon: n.icon })));
    setShowReorder(true);
  };

  const saveNavOrder = () => {
    const order = draftNav.map(n => n.path);
    setNavOrder(order);
    setShowReorder(false);
    api.putMySettings('ui.navOrder', order).catch(() => {});
  };

  return (
    <div className="app-top-gradient flex flex-col lg:flex-row h-screen overflow-hidden bg-paper">
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex relative ${sidebarCollapsed ? 'w-16' : 'w-64'} flex-col glass-panel accent-bar-right m-4 z-20 transition-all duration-300 no-print shrink-0 animate-fade-in-up`}>
        <div className={`${sidebarCollapsed ? 'p-3' : 'p-6'} flex flex-col items-center border-b border-ink/10 relative transition-all duration-300`}>
          <button onClick={toggleCollapse}
            title={sidebarCollapsed ? t('nav.expand', language) : t('nav.collapse', language)}
            className="absolute top-2 right-2 z-10 p-1.5 text-ink/50 hover:text-ink hover:bg-ash-200 transition-all">
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          <div className={`${sidebarCollapsed ? 'w-10 h-10' : 'w-16 h-16'} bg-acid border-2 border-ink flex items-center justify-center mb-3 transition-all duration-300`}>
            <Sprout className={`${sidebarCollapsed ? 'w-6 h-6' : 'w-8 h-8'} text-ink transition-all duration-300`} />
          </div>
          {!sidebarCollapsed && (
            <>
              <h1 className="text-lg font-black tracking-widest text-ink text-center uppercase">{t('app.title', language)}</h1>
              <p className="text-[10px] text-ink/60 mt-1 uppercase tracking-widest text-center font-bold">{t('app.concept', language)}</p>
            </>
          )}
        </div>
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto custom-scrollbar">
          {orderedNav.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}
                title={sidebarCollapsed ? item.label : undefined}
                data-active={isActive ? 'true' : 'false'}
                className={`t-nav-item ${sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'}`}>
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className={`${sidebarCollapsed ? 'p-3' : 'p-4'} border-t-2 border-ink/15 space-y-2 transition-all duration-300`}>
          <button onClick={openReorder}
            title={t('nav.reorderTitle', language)}
            className={`t-btn t-btn-ghost w-full ${sidebarCollapsed ? 'justify-center' : 'gap-2'} text-xs`}>
            <SlidersHorizontal className="w-4 h-4 shrink-0" /> {!sidebarCollapsed && t('nav.reorder', language)}
          </button>
          <button onClick={() => { logout(); window.location.hash = '/login'; }}
            title="退出登录"
            className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2 px-3'} py-2 w-full rounded-xl text-gray-400 hover:text-red-500 hover:bg-white/40 transition-all text-xs`}>
            <LogOut className="w-4 h-4 shrink-0" /> {!sidebarCollapsed && '退出登录'}
          </button>
          {!sidebarCollapsed && <div className="text-[10px] text-gray-400 text-center leading-tight">{t('app.copyright', language)}</div>}
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-4 left-4 right-4 h-16 glass-panel rounded-2xl z-50 flex items-center justify-around shadow-2xl animate-fade-in-up">
        {orderedNav.slice(0, 6).map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path}
              className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-300 ${
                isActive ? 'text-[#2e7d32] bg-green-50 scale-110 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>
              <Icon className="w-6 h-6" />
              <span className="text-[9px] font-medium mt-0.5">{item.label}</span>
            </Link>
          );
        })}
        <button onClick={() => { logout(); window.location.hash = '/login'; }}
          className="t-btn t-btn-ghost flex-col items-center justify-center w-14 h-14 p-0">
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] font-medium mt-0.5">退出</span>
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative m-0 lg:m-4 lg:ml-0 rounded-none lg:rounded-2xl overflow-hidden glass-card min-w-0 pb-24 lg:pb-0 transition-all">
        <header className="hidden lg:flex h-16 items-center px-8 border-b-2 border-ink/15 bg-paper/80 backdrop-blur-md no-print z-10 sticky top-0 shrink-0">
          <h2 className="text-xl font-black text-ink tracking-widest uppercase flex items-center gap-3 animate-fade-in-up">
            <span className="w-1.5 h-6 bg-acid block"></span>
            {navItems.find(i => i.path === location.pathname)?.label}
          </h2>
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={() => setShowProfile(true)} title={t('profile.title', language)}
              className="t-btn t-btn-ghost gap-2 pr-3 p-1.5 max-w-[160px]">
              <Avatar user={user} size={28} />
              <span className="text-xs font-bold truncate">{user?.display_name || user?.username}</span>
            </button>
            <a href="#/messages" className="t-btn t-btn-ghost p-2 relative">
              <Bell className="w-5 h-5" />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 t-pill animate-pulse" style={{ background: 'var(--ink)', color: 'var(--acid)', border: 0 }}>{unread > 99 ? '99+' : unread}</span>
              )}
            </a>
            <span className="t-pill gap-1.5" style={{ background: dataSourceMode === 'ggce' ? 'var(--ash-200)' : 'var(--acid)' }}>
              <span className="w-2 h-2 bg-ink animate-pulse" />
              {dataSourceMode === 'ggce' ? 'GGCE' : '本地'}
            </span>
            <div className="t-theme-toggle" title={t('theme.hint', language)}>
              <button onClick={() => setTheme('brutalist')} data-active={theme === 'brutalist' ? 'true' : 'false'}>{t('theme.brutalist', language)}</button>
              <button onClick={() => setTheme('classic')} data-active={theme === 'classic' ? 'true' : 'false'}>{t('theme.classic', language)}</button>
            </div>
            <button onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')} className="t-btn t-btn-ghost text-xs">
              <Globe className="w-4 h-4" /> {language === 'zh' ? 'EN' : '中'}
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 lg:p-6 custom-scrollbar animate-fade-in-up bg-paper">
          {children}
        </div>
      </main>

      {/* v2.8: 个人资料弹窗 */}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

      {/* v2.7: 侧边栏排序弹窗 */}
      {showReorder && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowReorder(false)}>
          <div className="glass-panel rounded-3xl p-6 w-full max-w-md shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-[#2e7d32]" />{t('nav.reorderTitle', language)}
              </h3>
              <button onClick={() => setShowReorder(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-3">{t('nav.reorderHint', language)}</p>
            <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar mb-4">
              {draftNav.map((item, i) => (
                <div key={item.path}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx === null || dragIdx === i) return;
                    const next = [...draftNav];
                    const [moved] = next.splice(dragIdx, 1);
                    next.splice(i, 0, moved);
                    setDraftNav(next);
                    setDragIdx(null);
                  }}
                  onDragEnd={() => setDragIdx(null)}
                  className={`flex items-center gap-3 px-4 py-2.5 bg-white/60 rounded-xl cursor-grab active:cursor-grabbing transition-all ${
                    dragIdx === i ? 'border border-[#2e7d32] bg-[#e8f5e9] shadow-sm' : 'hover:bg-white'
                  }`}>
                  <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                  <item.icon className="w-4 h-4 text-[#2e7d32] shrink-0" />
                  <span className="text-sm font-bold text-gray-700">{item.label}</span>
                  <span className="ml-auto text-[10px] text-gray-300 font-mono">{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowReorder(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-all">
                {t('nav.cancel', language)}
              </button>
              <button onClick={saveNavOrder} className="btn-primary flex-1 py-2.5 rounded-xl text-sm font-bold">
                {t('nav.save', language)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Workbench />} />
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/orders" element={<Orders />} />
    <Route path="/inspection" element={<Inspection />} />
    <Route path="/todos" element={<Todos />} />
    <Route path="/accessions" element={<Accessions />} />
    <Route path="/find" element={<FindGermplasm />} />
    <Route path="/sub" element={<Subculture />} />
    <Route path="/design" element={<LabelDesigner />} />
    <Route path="/inventory" element={<Inventory />} />
    <Route path="/operations" element={<Operations />} />
    <Route path="/freezer" element={<Freezer />} />
    <Route path="/cryo" element={<Cryo />} />
    <Route path="/intro" element={<IntroApproval />} />
    <Route path="/dist" element={<Distribution />} />
    <Route path="/statistics" element={<Statistics />} />
    <Route path="/messages" element={<Messages />} />
    <Route path="/users" element={<Users />} />
    <Route path="/loginlog" element={<LoginLog />} />
    <Route path="/db" element={<DbAdmin />} />
    <Route path="/setup" element={<Setup />} />
    <Route path="/login" element={<LoginPage />} />
  </Routes>
);

const AppContent = () => {
  const { isAuthenticated, needsSetup } = useApp();
  if (!isAuthenticated && !needsSetup) {
    window.location.hash = '/login';
  }
  if (!isAuthenticated) {
    return <LoginPage />;
  }
  return (
    <Router>
      <ErrorBoundary>
        <Layout>
          <AppRoutes />
        </Layout>
      </ErrorBoundary>
    </Router>
  );
};

export default function App() {
  return (
    <AppProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </AppProvider>
  );
}
