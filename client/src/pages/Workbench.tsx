import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import {
  LayoutDashboard, ClipboardList, AlertTriangle, Clock, CheckSquare, Send,
  Users, ArrowRight, BellRing, Inbox, PackageSearch, Briefcase, ShieldCheck,
  Printer, SlidersHorizontal, X, Loader2, Zap, Activity, Target,
} from 'lucide-react';
import FeedbackModal from '../lib/FeedbackModal';
import OrderLabelPrintModal from '../lib/OrderLabelPrintModal';
import { CountUp, LiveClock, Sparkline, DeltaChip, MiniBar } from '../lib/controlFx';
import { STATUS_COLORS, PRIORITY_COLORS, STATUS_KEYS, PRIORITY_KEYS } from '../lib/orderUi';

// v2.13：工作台视觉重塑（硬边黄黑 brutalist）+ 快速任务（自然语言解析）
// 功能逻辑完全保留：模块注册表、自定义、角色化视图、自定义弹窗

const MODULE_REGISTRY: { id: string; roles: string[] }[] = [
  { id: 'productionBoard', roles: ['admin'] },
  { id: 'teamLoad', roles: ['admin'] },
  { id: 'recentFeedback', roles: ['admin'] },
  { id: 'myTodos', roles: ['admin', 'operator', 'approver'] },
  { id: 'today', roles: ['operator'] },
  { id: 'approvals', roles: ['approver'] },
  { id: 'readonly', roles: ['regulator'] },
  { id: 'myRequests', roles: ['external'] },
];

// v2.13：自然语言解析——从描述里抽 dueDate/priority/assignee，提取剩余作 title
// 支持 明天/今天/后天/今晚/上午N/下午N/紧急/重要/普通/@username；解析失败降级为纯文本
const parseQuickTask = (raw: string) => {
  let text = raw.trim();
  if (!text) return null;
  let priority = 'normal';
  let assignee: string | null = null;
  let dueDate: string | null = null;

  if (/紧急|urgent/i.test(text)) { priority = 'urgent'; text = text.replace(/紧急|urgent/gi, '').trim(); }
  else if (/重要|high/i.test(text)) { priority = 'high'; text = text.replace(/重要|high/gi, '').trim(); }
  else if (/普通|low/i.test(text)) { priority = 'low'; text = text.replace(/普通|low/gi, '').trim(); }

  const at = text.match(/@([a-zA-Z0-9_一-龥]+)/);
  if (at) { assignee = at[1]; text = text.replace(at[0], '').trim(); }

  const now = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  if (/今天|today/i.test(text)) { dueDate = ymd(now); text = text.replace(/今天|today/gi, '').trim(); }
  else if (/明天|tomorrow/i.test(text)) { const d = new Date(now.getTime() + 86400000); dueDate = ymd(d); text = text.replace(/明天|tomorrow/gi, '').trim(); }
  else if (/后天/i.test(text)) { const d = new Date(now.getTime() + 2 * 86400000); dueDate = ymd(d); text = text.replace(/后天/g, '').trim(); }
  else if (/今晚|tonight/i.test(text)) { dueDate = ymd(now); text = text.replace(/今晚|tonight/gi, '').trim(); }
  else {
    const hm = text.match(/(上午|下午)?\s*(\d{1,2})[点:：](\d{1,2})?(分)?/);
    if (hm) {
      const hour = parseInt(hm[2], 10);
      const minute = hm[3] ? parseInt(hm[3], 10) : 0;
      const ampm = hm[1];
      let h = hour;
      if (ampm === '下午' && hour < 12) h += 12;
      if (ampm === '上午' && hour === 12) h = 0;
      text = text.replace(hm[0], '').trim();
    }
  }
  const title = text.replace(/\s+/g, ' ').trim();
  return { title: title || raw, priority, dueDate, assignee, parsed: !!dueDate || priority !== 'normal' || !!assignee };
};

const Workbench: React.FC = () => {
  const { user, language } = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [reportOrder, setReportOrder] = useState<any>(null);
  const [printLabelOrder, setPrintLabelOrder] = useState<any>(null);
  const [printWoBusy, setPrintWoBusy] = useState(false);
  const [mods, setMods] = useState<string[] | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [draftMods, setDraftMods] = useState<string[]>([]);
  // v2.13：快速任务
  const [quickTask, setQuickTask] = useState('');
  const [quickHint, setQuickHint] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setData(await api.getWorkbench());
      setError('');
    } catch (e: any) {
      setError(e.message || '加载失败');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.getMySettings().then(s => {
      const saved = s['wb.modules'];
      if (Array.isArray(saved) && saved.length) setMods(saved);
      else setMods(null);
    }).catch(() => setMods(null));
  }, []);

  // 角色派生（每次 render 都算，不引入 hook）
  const isAdmin = user?.role === 'admin';
  const ut = data?.user?.userType || user?.user_type || 'operator';
  const roleKey = isAdmin ? 'admin' : ut;
  const wb = (key: string) => t(`workbench.${key}`, language);

  // v2.13：所有 hooks 必须在早返回之前——useMemo 依赖 data，data 可能 null 故兜底 0
  const keyNumber = useMemo(() => {
    if (!data) return 0;
    if (isAdmin) return (data.productionBoard?.pending || 0) + (data.productionBoard?.in_progress || 0);
    if (ut === 'operator') return (data.myToday || []).length;
    if (ut === 'approver') return (data.pendingApprovals?.introPending || 0) + (data.pendingApprovals?.distPending || 0);
    if (ut === 'regulator') return data.readOnlyOverview?.board ? Object.values(data.readOnlyOverview.board).reduce((a: any, b: any) => a + (b || 0), 0) : 0;
    if (ut === 'external') return (data.myDistRequests || []).length;
    return 0;
  }, [data, isAdmin, ut]);

  if (error) {
    return <div className="glass-panel p-8 text-red-600 text-sm font-bold">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-2 border-ink border-t-transparent animate-spin"></div>
      </div>
    );
  }

  const roleMods = MODULE_REGISTRY.filter(m => m.roles.includes(roleKey)).map(m => m.id);
  const show = (id: string) => mods === null ? true : mods.includes(id);

  // v2.13：硬边大数字（greeting 不再需要 useMemo，只是即时计算）
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 11) return wb('greeting.morning');
    if (h < 18) return wb('greeting.afternoon');
    return wb('greeting.evening');
  })();
  const keyStatLabel = wb(`keyStat.${roleKey}`);
  const roleLabel = isAdmin ? wb('role.admin') : wb(`role.${ut}`);
  const todayStr = new Date().toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  // v2.17 控制室：逾期数（用于状态灯/告警脉冲）+ 7 日活跃度/完成率/吞吐（admin）
  const overdueN = isAdmin ? (data.productionBoard?.overdue ?? 0)
    : ut === 'operator' ? (data.myToday || []).filter((o: any) => o.overdue).length : 0;
  const actArr: number[] = ((data.activity7d || []) as any[]).map((x) => x.c || 0);
  const pb = data.productionBoard || {};
  const nonCancel = (pb.pending || 0) + (pb.in_progress || 0) + (pb.done || 0) + (pb.blocked || 0);
  const completionPct = nonCancel > 0 ? Math.round(((pb.done || 0) / nonCancel) * 100) : 0;
  const sumFrom = (a: number[], s: number, e: number) => a.slice(s, e).reduce((x, y) => x + y, 0);
  const actPrev = sumFrom(actArr, 0, 4), actCur = sumFrom(actArr, 4, 7);
  const teamMax = Math.max(1, ...((data.teamLoad || []) as any[]).map((m) => m.activeCount || 0));

  // v2.13：快速任务提交
  const submitQuickTask = async () => {
    const raw = quickTask.trim();
    if (!raw) return;
    const parsed = parseQuickTask(raw);
    try {
      // 先按 username 找用户 id（仅 admin/operator/approver 场景，API 会忽略）
      await api.createTodo({
        title: parsed?.title || raw,
        priority: parsed?.priority || 'normal',
        due_date: parsed?.dueDate || null,
      });
      setQuickHint(`${t('workbench.quickTaskSuccess', language)}${parsed?.parsed ? ` · ${parsed.dueDate ? parsed.dueDate + ' · ' : ''}pri=${parsed.priority}` : ''}`);
      setQuickTask('');
      setTimeout(() => setQuickHint(''), 3500);
      load();
    } catch (e: any) {
      setQuickHint(t('workbench.quickTaskFail', language) + ': ' + (e.message || ''));
      setTimeout(() => setQuickHint(''), 5000);
    }
  };

  const printWorkOrder = async (o: any) => {
    setPrintWoBusy(true);
    try {
      const accRows = (o.accessions || []).map((a: any, i: number) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${i + 1}</td><td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold;">${a.primaryId || ''}</td><td style="padding:6px 10px;border:1px solid #ddd;">${a.displayName || ''}</td><td style="padding:6px 10px;border:1px solid #ddd;">${a.species || ''}</td></tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:24px;color:#222;}h1{font-size:20px;margin:0 0 4px;}h2{font-size:14px;margin:16px 0 6px;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px;}table{border-collapse:collapse;width:100%;font-size:12px;} .meta{display:flex;gap:24px;font-size:12px;color:#555;margin-top:8px;flex-wrap:wrap;}</style></head><body>
        <h1>工单 ${o.woNo || ''} · ${o.title || ''}</h1>
        <div class="meta">
          <span>状态：${o.status || ''}</span><span>优先级：${o.priority || ''}</span><span>截止：${o.dueDate || '-'}</span><span>进度：${o.progress || 0}%</span>
          ${o.currentStep ? `<span>当前步骤：${o.currentStep.title || ''}</span>` : ''}
        </div>
        ${o.description ? `<p style="font-size:12px;color:#444;margin-top:10px;">${o.description}</p>` : ''}
        <h2>目标种质（${(o.accessions || []).length}）</h2>
        <table><tr><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">#</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">种质编号</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">名称</th><th style="padding:6px 10px;border:1px solid #ddd;background:#f0f0f0;">物种</th></tr>${accRows}</table>
        <p style="font-size:11px;color:#999;margin-top:16px;">打印时间：${new Date().toLocaleString()}</p>
      </body></html>`;
      await api.print([{ primaryId: o.woNo || o.title || 'workorder' }], '', undefined, undefined, undefined, 1, html);
      setError('');
    } catch (e: any) {
      alert(e.message || '打印失败');
    } finally {
      setPrintWoBusy(false);
    }
  };

  const saveMods = async () => {
    const list = roleMods.filter(m => draftMods.includes(m));
    try {
      await api.putMySettings('wb.modules', list);
      setMods(list);
      setShowCustomize(false);
    } catch (e: any) {
      alert(e.message || '保存失败');
    }
  };

  const todoRow = (todo: any) => (
    <div key={todo.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ash-100 transition-colors border-b border-ash-200 last:border-b-0">
      <button
        onClick={async () => { await api.updateTodo(todo.id, { isDone: true }).catch(() => {}); load(); }}
        className="w-5 h-5 border-2 border-ink hover:bg-acid flex items-center justify-center shrink-0">
      </button>
      <span className="text-sm text-ink flex-1 truncate">{todo.title}</span>
      {todo.due_date && <span className="text-[10px] text-ink/50 font-mono">{todo.due_date}</span>}
    </div>
  );

  const orderCard = (o: any) => (
    <div key={o.id} className="glass-card p-4 border-l-4 transition-all hover:shadow-hard"
      style={{ borderLeftColor: o.overdue ? '#ef4444' : o.priority === 'urgent' ? '#f97316' : o.priority === 'high' ? '#fbbf24' : '#34d399' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-mono text-ink/50">{o.woNo}</p>
          <p className="text-sm font-bold text-ink truncate uppercase tracking-wide">{o.title}</p>
        </div>
        {o.overdue && (
          <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-black uppercase whitespace-nowrap flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />{t('orders.overdueTag', language)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {o.status && <span className={`px-2 py-0.5 text-[10px] font-black uppercase border-2 border-ink ${STATUS_COLORS[o.status] || ''}`}>{t(STATUS_KEYS[o.status] || o.status, language)}</span>}
        {o.priority && <span className={`px-2 py-0.5 text-[10px] font-black uppercase border-2 border-ink ${PRIORITY_COLORS[o.priority] || ''}`}>{t(PRIORITY_KEYS[o.priority] || o.priority, language)}</span>}
        {o.dueDate && <span className="text-[10px] text-ink/60 font-bold flex items-center gap-1"><Clock className="w-3 h-3" />{t('orders.due', language)} {o.dueDate}</span>}
      </div>
      {(o.targetQty > 0 || o.progress > 0) && (
        <div className="mt-3">
          <div className="h-1.5 bg-ash-200 overflow-hidden">
            <div className="h-full bg-ink transition-all" style={{ width: `${Math.min(100, o.progress || 0)}%` }}></div>
          </div>
          <p className="text-[10px] text-ink/50 mt-1 font-bold uppercase">{t('orders.progress', language)} {o.progress || 0}% {o.targetQty > 0 ? `（${o.doneQty || 0}/${o.targetQty}）` : ''}</p>
        </div>
      )}
      {o.currentStep && (
        <p className="text-[10px] text-ink bg-acid/20 border-l-4 border-ink px-2 py-1 mt-2 inline-flex items-center gap-1 font-bold">
          {t('orders.currentStep', language)}: {o.currentStep.title || o.currentStep.code}{o.currentStepDue ? ` · ${t('orders.stepChainDue', language)} ${o.currentStepDue}` : ''}
        </p>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={() => setPrintLabelOrder(o)} disabled={(o.accessions || []).length === 0} className="flex-1 px-3 py-1.5 bg-ash-100 text-ink text-xs font-black uppercase border-2 border-ink hover:bg-acid flex items-center justify-center gap-1 disabled:opacity-40">
          <Printer className="w-3.5 h-3.5" />{t('orders.printLabels', language)}
        </button>
        <button onClick={() => printWorkOrder(o)} disabled={printWoBusy} className="flex-1 px-3 py-1.5 bg-ash-100 text-ink text-xs font-black uppercase border-2 border-ink hover:bg-acid flex items-center justify-center gap-1 disabled:opacity-40">
          {printWoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
          {t('orders.printWo', language)}
        </button>
        <button onClick={() => setReportOrder(o)} className="flex-1 px-3 py-1.5 bg-acid text-ink text-xs font-black uppercase border-2 border-ink  flex items-center justify-center gap-1">
          <Send className="w-3.5 h-3.5" />{wb('quickReport')}
        </button>
      </div>
      <a href="#/orders" className="mt-2 flex items-center justify-center gap-1 text-[10px] font-black uppercase text-ink/50 hover:text-ink">
        {wb('viewAll')}<ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );

  const statCard = (icon: React.ReactNode, num: number, label: string, opts: { acid?: boolean; spark?: number[]; alert?: boolean } = {}) => (
    <div className="t-pod p-5 flex items-center gap-4">
      <div className="relative shrink-0">
        {opts.alert && num > 0 && <span className="cr-ping absolute -inset-1" style={{ background: 'rgba(220,38,38,0.35)' }} />}
        <div className="relative w-12 h-12 flex items-center justify-center"
          style={{
            background: opts.acid ? 'var(--t-pill-muted-bg)' : 'var(--t-pill-muted-bg)',
            color: 'var(--t-text)', border: '1.5px solid var(--ink)',
            ...(opts.alert && num > 0 ? { borderColor: 'var(--t-quality-bad)' } : {}),
          }}>{icon}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="t-stat text-3xl">{typeof num === 'number' ? <CountUp value={num} /> : num}</div>
        <div className="text-[10px] t-stat-label uppercase font-black tracking-widest mt-1 truncate">{label}</div>
      </div>
      {opts.spark && opts.spark.length > 1 && (
        <div className="shrink-0 self-center opacity-90"><Sparkline data={opts.spark} width={72} height={30} /></div>
      )}
    </div>
  );

  const sectionTitle = (icon: React.ReactNode, text: string) => (
    <h2 className="t-section-title mb-3">
      {icon}<span>{text}</span>
    </h2>
  );

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in-up pb-10">
      {/* ================= v2.13 头部：硬边欢迎 + 大数字 ================= */}
      <div className="glass-panel p-6 flex flex-col md:flex-row items-stretch gap-6">
        <div className="flex-1 flex flex-col justify-center gap-1.5">
          <p className="t-eyebrow">CCCAP BRC · v2.18 · {wb('commandCenter')}</p>
          <h1 className="t-page-title text-2xl md:text-3xl">
            {greeting}, {user?.display_name || user?.username}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="text-xs uppercase tracking-wider font-bold" style={{ color: 'var(--t-text-soft)' }}>{roleLabel} · {todayStr}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-black cr-tabnum px-2 py-0.5" style={{ color: 'var(--t-text-soft)', border: '1px solid var(--t-divider)', background: 'var(--t-pill-muted-bg)' }}>
              <Clock className="w-3 h-3" /><LiveClock />
            </span>
            <span data-testid="cr-status" className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-1" style={{ color: overdueN > 0 ? 'var(--t-quality-bad)' : 'var(--t-quality-ok)', border: '1.5px solid var(--ink)' }}>
              <span className="relative flex h-2 w-2">
                <span className="cr-ping absolute inline-flex h-full w-full" style={{ background: overdueN > 0 ? 'var(--t-quality-mid)' : 'var(--t-quality-ok)' }} />
                <span className="relative inline-flex h-2 w-2" style={{ background: overdueN > 0 ? 'var(--t-quality-bad)' : 'var(--t-quality-ok)' }} />
              </span>
              {overdueN > 0 ? wb('overdueAlert') : wb('liveStatus')}
            </span>
          </div>
        </div>
        <div className="text-left md:text-right md:border-l-2 md:pl-6 flex md:flex-col justify-center" style={{ borderColor: 'var(--t-divider)' }}>
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--t-text-dim)' }}>{keyStatLabel}</p>
          <p className="brutal-number text-7xl leading-none mt-1 cr-tabnum" style={{ color: 'var(--t-text)' }}><CountUp value={keyNumber} /></p>
        </div>
        <div className="flex md:flex-col gap-2 md:justify-center">
          <button onClick={() => { setDraftMods(mods === null ? roleMods : roleMods.filter(m => mods.includes(m))); setShowCustomize(true); }}
            className="btn-acid px-4 py-2 text-xs whitespace-nowrap flex items-center gap-1">
            <SlidersHorizontal className="w-3.5 h-3.5" />{t('workbench.customize', language)}
          </button>
          <a href="#/todos" className="glass-card px-4 py-2 text-xs text-center uppercase tracking-wider font-bold flex items-center justify-center gap-1">
            <CheckSquare className="w-3.5 h-3.5" />{t('nav.todos', language)}
          </a>
        </div>
      </div>

      {/* ================= v2.13 快速任务（自然语言解析） · v2.17 命令行观感 ================= */}
      <div className="glass-card accent-bar-top p-4 flex items-center gap-3 flex-wrap" style={{ background: 'var(--t-card-bg)', borderColor: 'var(--t-divider)' }}>
        <div className="flex items-center gap-1.5 shrink-0" style={{ color: 'var(--t-accent)' }}>
          <Zap className="w-4 h-4" />
          <span className="text-[10px] font-black uppercase tracking-widest">{t('workbench.quickTaskLabel', language)}</span>
        </div>
        <div className="flex-1 min-w-[200px] flex items-center gap-2 glass-input px-3 py-2">
          <span data-testid="cr-cmd-caret" aria-hidden className="text-sm font-black leading-none select-none cr-tabnum" style={{ color: 'var(--t-accent)' }}>&gt;_</span>
          <input
            type="text"
            value={quickTask}
            onChange={e => setQuickTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitQuickTask(); }}
            placeholder={t('workbench.quickTaskPh', language)}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm p-0"
            style={{ color: 'var(--t-text)' }}
          />
        </div>
        <button onClick={submitQuickTask} disabled={!quickTask.trim()} className="btn-acid px-4 py-2 text-xs whitespace-nowrap disabled:opacity-40">
          {t('workbench.quickTaskSubmit', language)}
        </button>
        {quickHint && <div className="basis-full text-[11px] font-bold text-ink/70 px-1">→ {quickHint}</div>}
      </div>

      {/* ================= 管理员：生产看板 + 团队负载 ================= */}
      {isAdmin && show('productionBoard') && (
        <>
          {/* v2.17 指挥台：7 日活跃度折线 / 吞吐趋势 / 完成率（一次性描边动效） */}
          <div className="t-pod p-6 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-4 min-w-[260px]">
              <div className="w-11 h-11 flex items-center justify-center shrink-0" style={{ background: 'var(--t-pill-muted-bg)', color: 'var(--t-text)', border: '1.5px solid var(--ink)' }}><Activity className="w-5 h-5" /></div>
              <div>
                <div className="text-[10px] uppercase tracking-widest font-black" style={{ color: 'var(--t-text-dim)' }}>{wb('activity7d')}</div>
                <div className="mt-1"><Sparkline data={actArr.length ? actArr : [0, 0, 0, 0, 0, 0, 0]} width={200} height={44} /></div>
              </div>
              <div className="ml-1"><DeltaChip cur={actCur} prev={actPrev} upLabel={wb('trendUp')} downLabel={wb('trendDown')} flatLabel={wb('trendFlat')} /></div>
            </div>
            <div className="h-10 w-px shrink-0 hidden sm:block" style={{ background: 'var(--t-divider)' }} />
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 flex items-center justify-center shrink-0" style={{ background: 'var(--t-pill-muted-bg)', color: 'var(--t-text)', border: '1.5px solid var(--ink)' }}><Target className="w-5 h-5" /></div>
              <div>
                <div className="text-[10px] uppercase tracking-widest font-black" style={{ color: 'var(--t-text-dim)' }}>{wb('completionRate')}</div>
                <div className="t-stat text-2xl"><CountUp value={completionPct} />%</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCard(<Briefcase className="w-5 h-5" />, (data.productionBoard?.pending || 0) + (data.productionBoard?.in_progress || 0), wb('activeCount'), { acid: true, spark: actArr })}
            {statCard(<AlertTriangle className="w-5 h-5" />, data.productionBoard?.overdue ?? 0, wb('overdue'), { alert: true })}
            {statCard(<Clock className="w-5 h-5" />, data.todayCount ?? 0, wb('todayCount'), {})}
            {statCard(<ShieldCheck className="w-5 h-5" />, (data.pendingApprovals?.introPending ?? 0) + (data.pendingApprovals?.distPending ?? 0), wb('pendingApprovals'), {})}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {(show('productionBoard') || show('teamLoad')) && (
            <div className="lg:col-span-2 glass-panel p-6">
              {show('productionBoard') && (<>
              {sectionTitle(<ClipboardList className="w-4 h-4" />, wb('productionBoard'))}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.keys(STATUS_COLORS).filter(s => s !== 'cancelled').map(s => {
                  const cnt = data.productionBoard?.[s] ?? 0;
                  return (
                    <a key={s} href="#/orders" className="bg-ash-100 p-4 hover:bg-ash-200 transition-colors accent-bar-top">
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase border-2 border-ink ${STATUS_COLORS[s]}`}>{t(STATUS_KEYS[s], language)}</span>
                        <span className="brutal-number text-xl text-ink">{cnt}</span>
                      </div>
                      <div className="mt-2 h-1 bg-ash-300 overflow-hidden">
                        <div className="h-full" style={{ width: `${cnt > 0 ? 100 : 0}%`, background: s === 'blocked' ? '#ef4444' : s === 'in_progress' ? '#3b82f6' : s === 'done' ? '#22c55e' : '#f59e0b' }}></div>
                      </div>
                    </a>
                  );
                })}
              </div>
              </>)}
              {show('teamLoad') && (<>
              {sectionTitle(<Users className="w-4 h-4" />, wb('teamLoad'))}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] text-ink/50 uppercase font-black tracking-widest border-b-2 border-ink">
                    <th className="py-2">{t('users.displayName', language)}</th>
                    <th className="py-2">{wb('activeCount')}</th>
                    <th className="py-2">{wb('overdue')}</th>
                    <th className="py-2">{wb('inFlight')}</th>
                  </tr></thead>
                  <tbody>
                    {(data.teamLoad || []).map((m: any) => (
                      <tr key={m.userId} className="border-b border-ash-200 hover:bg-ash-100">
                        <td className="py-2 font-bold text-ink">{m.displayName}</td>
                        <td className="py-2 text-ink/70 t-stat">{m.activeCount}</td>
                        <td className={`py-2 font-black t-stat ${m.overdueCount > 0 ? 'text-red-600' : 'text-ink/40'}`}>{m.overdueCount}</td>
                        <td className="py-2 pr-2 w-32"><MiniBar value={m.activeCount} max={teamMax} danger={m.overdueCount > 0} /></td>
                      </tr>
                    ))}
                    {(data.teamLoad || []).length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-xs text-ink/40 uppercase font-bold">{t('orders.noData', language)}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              </>)}
            </div>
            )}

            <div className="flex flex-col gap-5">
              {show('recentFeedback') && (
              <div className="glass-panel p-6">
                {sectionTitle(<BellRing className="w-4 h-4" />, wb('recentFeedback'))}
                <div className="space-y-2">
                  {(data.recentFeedback || []).map((f: any, i: number) => (
                    <div key={i} className="px-3 py-2 bg-ash-100 text-xs">
                      <p className="text-ink"><span className="font-black text-ink">{f.username}</span> · {f.order_title || f.wo_no}</p>
                      <p className="text-ink/50 mt-0.5 truncate">{t(`orders.kind.${f.kind}`, language)}{f.qty ? ` · ${f.qty}` : ''}{f.content ? ` · ${f.content}` : ''}</p>
                    </div>
                  ))}
                  {(data.recentFeedback || []).length === 0 && <p className="text-xs text-ink/40 py-3 text-center font-bold uppercase">{wb('noTasks')}</p>}
                </div>
              </div>
              )}
              {show('myTodos') && (
              <div className="glass-panel p-6">
                {sectionTitle(<CheckSquare className="w-4 h-4" />, wb('myTodos'))}
                <div className="divide-y divide-ash-200">
                  {(data.myTodos || []).length === 0 ? <p className="text-xs text-ink/40 py-3">{wb('todoEmpty')}</p> : data.myTodos.map(todoRow)}
                </div>
              </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ================= 操作员：今日任务 ================= */}
      {!isAdmin && ut === 'operator' && (
        <>
          {show('today') && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {statCard(<Briefcase className="w-5 h-5" />, (data.myToday || []).length, wb('activeCount'), { acid: true })}
            {statCard(<AlertTriangle className="w-5 h-5" />, (data.myToday || []).filter((o: any) => o.overdue).length, wb('overdue'), { alert: true })}
            {show('myTodos') && statCard(<CheckSquare className="w-5 h-5" />, (data.myTodos || []).length, wb('myTodos'), {})}
          </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {show('today') && (
            <div className="lg:col-span-2">
              <h2 className="t-section-title mb-3">
                <ClipboardList className="w-4 h-4" />{wb('myToday')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(data.myToday || []).length === 0
                  ? <div className="glass-panel p-10 text-center text-ink/40 text-sm uppercase font-bold lg:col-span-2">{wb('noTasks')}</div>
                  : data.myToday.map(orderCard)}
              </div>
            </div>
            )}
            {show('myTodos') && (
            <div className="glass-panel p-6 h-fit">
              {sectionTitle(<CheckSquare className="w-4 h-4" />, wb('myTodos'))}
              <div className="divide-y divide-ash-200">
                {(data.myTodos || []).length === 0 ? <p className="text-xs text-ink/40 py-3">{wb('todoEmpty')}</p> : data.myTodos.map(todoRow)}
              </div>
              <a href="#/todos" className="mt-3 flex items-center justify-center gap-1 text-xs font-black uppercase text-ink hover:underline">
                {wb('viewAll')}<ArrowRight className="w-3 h-3" />
              </a>
            </div>
            )}
          </div>
        </>
      )}

      {/* ================= 审批人员：审批队列 ================= */}
      {!isAdmin && ut === 'approver' && (
        <>
          {show('approvals') && (
          <>
          <h2 className="t-section-title mb-3">
            <ShieldCheck className="w-4 h-4" />{wb('approvalQueue')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-panel p-6">
            {sectionTitle(<ShieldCheck className="w-4 h-4" />, wb('introPending') + ` (${data.approvalQueue?.introPending ?? 0})`)}
            <div className="space-y-2">
              {(data.approvalQueue?.introList || []).map((r: any) => (
                <a key={r.id} href="#/intro" className="block px-4 py-3 bg-ash-100 hover:bg-ash-200 transition-colors accent-bar-left">
                  <p className="text-sm font-bold text-ink">{r.req_no} · {r.applicant_org || '-'}</p>
                  <p className="text-xs text-ink/50 mt-0.5">{r.resource_type} × {r.qty} · {t('orders.status.in_progress', language)} #{r.current_stage}</p>
                </a>
              ))}
              {(data.approvalQueue?.introList || []).length === 0 && <p className="text-xs text-ink/40 py-3">{wb('noTasks')}</p>}
            </div>
          </div>
          <div className="glass-panel p-6">
            {sectionTitle(<PackageSearch className="w-4 h-4" />, wb('distPending') + ` (${data.approvalQueue?.distPending ?? 0})`)}
            <div className="space-y-2">
              {(data.approvalQueue?.distList || []).map((r: any) => (
                <a key={r.id} href="#/dist" className="block px-4 py-3 bg-ash-100 hover:bg-ash-200 transition-colors accent-bar-left">
                  <p className="text-sm font-bold text-ink">{r.req_no} · {r.applicant || '-'}</p>
                  <p className="text-xs text-ink/50 mt-0.5">{r.resource_type} × {r.qty} · {t('orders.status.in_progress', language)} #{r.current_stage}</p>
                </a>
              ))}
              {(data.approvalQueue?.distList || []).length === 0 && <p className="text-xs text-ink/40 py-3">{wb('noTasks')}</p>}
            </div>
          </div>
        </div>
          </>
          )}
          {show('myTodos') && (
          <div className="glass-panel p-6">
            {sectionTitle(<CheckSquare className="w-4 h-4" />, wb('myTodos'))}
            <div className="divide-y divide-ash-200">
              {(data.myTodos || []).length === 0 ? <p className="text-xs text-ink/40 py-3">{wb('todoEmpty')}</p> : data.myTodos.map(todoRow)}
            </div>
          </div>
          )}
        </>
      )}

      {/* ================= 监管方：只读概览 ================= */}
      {!isAdmin && ut === 'regulator' && show('readonly') && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Object.keys(STATUS_COLORS).filter(s => s !== 'cancelled').map(s => (
              <div key={s} className="glass-panel p-5 accent-bar-top">
                <span className={`px-2 py-0.5 text-[10px] font-black uppercase border-2 border-ink ${STATUS_COLORS[s]}`}>{t(STATUS_KEYS[s], language)}</span>
                <div className="brutal-number text-3xl text-ink mt-2">{data.readOnlyOverview?.board?.[s] ?? 0}</div>
              </div>
            ))}
          </div>
          <div className="glass-panel p-6">
            {sectionTitle(<Inbox className="w-4 h-4" />, wb('readonlyOverview') + ' · ' + t('orders.title', language))}
            <div className="space-y-2">
              {(data.readOnlyOverview?.recentOrders || []).map((o: any) => (
                <a key={o.id} href="#/orders" className="block px-4 py-3 bg-ash-100 hover:bg-ash-200 transition-colors accent-bar-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-ink truncate uppercase tracking-wide">{o.woNo} · {o.title}</p>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase whitespace-nowrap border-2 border-ink ${STATUS_COLORS[o.status] || ''}`}>{t(STATUS_KEYS[o.status] || o.status, language)}</span>
                  </div>
                  <p className="text-xs text-ink/50 mt-0.5">{o.purpose ? o.purpose : ''}{o.dueDate ? ` · ${t('orders.due', language)} ${o.dueDate}` : ''}</p>
                </a>
              ))}
              {(data.readOnlyOverview?.recentOrders || []).length === 0 && <p className="text-xs text-ink/40 py-3">{wb('noTasks')}</p>}
            </div>
          </div>
        </>
      )}

      {/* ================= 外部用户：我的分发申请 ================= */}
      {!isAdmin && ut === 'external' && show('myRequests') && (
        <div className="glass-panel p-6 max-w-2xl accent-bar-left">
          {sectionTitle(<PackageSearch className="w-4 h-4" />, wb('myRequests'))}
          <div className="space-y-2">
            {(data.myDistRequests || []).map((r: any) => (
              <a key={r.id} href="#/dist" className="block px-4 py-3 bg-ash-100 hover:bg-ash-200 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-ink">{r.req_no}</p>
                  <span className={`px-2 py-0.5 text-[10px] font-black uppercase border-2 border-ink ${STATUS_COLORS[r.status === 'approved' ? 'done' : r.status] || 'bg-ash-200 text-ink'}`}>{r.status}</span>
                </div>
                <p className="text-xs text-ink/50 mt-0.5">{r.resource_type} × {r.qty} · {r.created_at?.slice(0, 10)}</p>
              </a>
            ))}
            {(data.myDistRequests || []).length === 0 && <p className="text-xs text-ink/40 py-3">{wb('noTasks')}</p>}
          </div>
        </div>
      )}

      {reportOrder && <FeedbackModal order={reportOrder} onClose={() => setReportOrder(null)} onSubmitted={load} />}
      {printLabelOrder && <OrderLabelPrintModal order={printLabelOrder} onClose={() => setPrintLabelOrder(null)} onSubmitted={load} />}

      {/* 自定义工作台弹窗（硬边风） */}
      {showCustomize && (
        <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCustomize(false)}>
          <div className="glass-panel p-6 w-full max-w-md shadow-hard-lg animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black uppercase tracking-widest text-ink flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5" />{t('workbench.customizeTitle', language)}
              </h3>
              <button onClick={() => setShowCustomize(false)} className="p-1.5 hover:bg-ash-200 text-ink"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-ink/60 mb-3 uppercase tracking-wider font-bold">{t('workbench.customizeHint', language)}</p>
            <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar mb-4">
              {roleMods.map(mid => (
                <label key={mid} className="flex items-center gap-3 px-4 py-2.5 bg-ash-100 cursor-pointer hover:bg-ash-200">
                  <input
                    type="checkbox"
                    checked={draftMods.includes(mid)}
                    onChange={e => setDraftMods(prev => e.target.checked ? [...prev, mid] : prev.filter(x => x !== mid))}
                    className="w-4 h-4 accent-ink"
                  />
                  <span className="text-sm font-bold text-ink uppercase tracking-wide">{t(`workbench.module.${mid}`, language)}</span>
                </label>
              ))}
            </div>
            <button onClick={saveMods} className="btn-primary w-full py-3 text-sm uppercase tracking-widest font-black">{t('workbench.customizeSave', language)}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workbench;
