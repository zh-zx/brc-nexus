import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { t } from '../utils';
import {
  Plus, Check, Trash2, Send, Pencil, Clock, CheckSquare, AlertTriangle, StickyNote, X,
} from 'lucide-react';
import { STATUS_COLORS, PRIORITY_COLORS, STATUS_KEYS, PRIORITY_KEYS } from '../lib/orderUi';
import FeedbackModal from '../lib/FeedbackModal';
import { marked } from 'marked';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
type TodoSort = 'created' | 'due' | 'priority';
const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];

const NOTE_COLORS: Record<string, { bg: string; title: string; sub: string; chip: string; border: string }> = {
  yellow: { bg: 'linear-gradient(150deg,#fefce8 0%,#fef9c3 45%,#fde68a 100%)', title: '#92400e', sub: '#a16207', chip: 'bg-amber-100 text-amber-800 border-amber-200', border: '#fde68a' },
  green:  { bg: 'linear-gradient(150deg,#f0fdf4 0%,#dcfce7 45%,#bbf7d0 100%)', title: '#166534', sub: '#15803d', chip: 'bg-green-100 text-green-700 border-green-200', border: '#bbf7d0' },
  blue:   { bg: 'linear-gradient(150deg,#eff6ff 0%,#dbeafe 45%,#bfdbfe 100%)', title: '#1e40af', sub: '#1d4ed8', chip: 'bg-blue-100 text-blue-700 border-blue-200', border: '#bfdbfe' },
  pink:   { bg: 'linear-gradient(150deg,#fdf2f8 0%,#fce7f3 45%,#fbcfe8 100%)', title: '#9d174d', sub: '#be185d', chip: 'bg-pink-100 text-pink-700 border-pink-200', border: '#fbcfe8' },
  purple: { bg: 'linear-gradient(150deg,#f5f3ff 0%,#ede9fe 45%,#ddd6fe 100%)', title: '#5b21b6', sub: '#6d28d9', chip: 'bg-violet-100 text-violet-700 border-violet-200', border: '#ddd6fe' },
};

// 便签 Markdown 渲染（marked 同步解析）
const renderMd = (src: string): string => {
  try { return marked.parse(src || '') as string; } catch { return src || ''; }
};

const Todos: React.FC = () => {
  const { user, language } = useApp();
  const [tab, setTab] = useState<'mine' | 'assigned'>('mine');
  const [todos, setTodos] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<any>({ title: '', notes: '', dueDate: '', priority: 'normal', color: 'yellow' });
  const [editId, setEditId] = useState<string | null>(null);
  const [reportOrder, setReportOrder] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [sortBy, setSortBy] = useState<'created' | 'due' | 'priority'>('created');

  const loadTodos = useCallback(async () => {
    try { setTodos((await api.getMyTodos()).todos || []); } catch (e: any) { setMsg(e.message || '加载失败'); }
  }, []);

  const loadOrders = useCallback(async () => {
    try { setOrders((await api.getWorkOrders({ mine: true })).orders || []); } catch (e: any) { setMsg(e.message || '加载失败'); }
  }, []);

  useEffect(() => { loadTodos(); }, [loadTodos]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const openAdd = () => {
    setEditId(null);
    setForm({ title: '', notes: '', dueDate: '', priority: 'normal', color: 'yellow' });
    setShowAdd(true);
  };

  const openEdit = (td: any) => {
    setEditId(td.id);
    setForm({ title: td.title, notes: td.notes || '', dueDate: td.due_date || '', priority: td.priority || 'normal', color: td.color || 'yellow' });
    setShowAdd(true);
  };

  const save = async () => {
    if (!form.title.trim()) return;
    try {
      const payload = { title: form.title, notes: form.notes, dueDate: form.dueDate, priority: form.priority, color: form.color };
      if (editId) await api.updateTodo(editId, payload);
      else await api.createTodo(payload);
      setMsg('✓');
      setShowAdd(false); setEditId(null);
      setForm({ title: '', notes: '', dueDate: '', priority: 'normal', color: 'yellow' });
      loadTodos();
    } catch (e: any) { alert(e.message); }
  };

  const toggle = async (td: any) => {
    try { await api.updateTodo(td.id, { isDone: !td.is_done }); loadTodos(); } catch (e: any) { alert(e.message); }
  };

  const remove = async (td: any) => {
    if (!window.confirm(t('todo.confirmDelete', language))) return;
    try { await api.deleteTodo(td.id); loadTodos(); } catch (e: any) { alert(e.message); }
  };

  const previewHtml = useMemo(() => renderMd(form.notes), [form.notes]);

  // 稳定排序：未完成恒在已完成之上；再按所选键排序，最后以创建时间倒序兜底，杜绝同键抖动
  const sortedTodos = useMemo(() => {
    const byNew = (a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
    return [...todos].sort((a, b) => {
      if (!!a.is_done !== !!b.is_done) return a.is_done ? 1 : -1;
      if (sortBy === 'due') {
        const ad = a.due_date || '', bd = b.due_date || '';
        if (ad !== bd) { if (!ad) return 1; if (!bd) return -1; return ad < bd ? -1 : 1; }
        return byNew(a, b);
      }
      if (sortBy === 'priority') {
        const ar = PRIO_RANK[a.priority] ?? 9, br = PRIO_RANK[b.priority] ?? 9;
        if (ar !== br) return ar - br;
        return byNew(a, b);
      }
      return byNew(a, b);
    });
  }, [todos, sortBy]);

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">TASK BOARD</span>
          <h1 className="t-page-title text-2xl flex items-center gap-2">
            <StickyNote className="w-6 h-6 text-[#2e7d32]" /> {t('todo.title', language)}
          </h1>
        </div>
        {tab === 'mine' && (
          <button onClick={openAdd} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-[#2e7d32]/20">
            <Plus className="w-4 h-4 inline mr-1" />{t('todo.add', language)}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-white/60 p-1 w-fit gap-1 shadow-sm">
        <button onClick={() => setTab('mine')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'mine' ? 'bg-[#2e7d32] text-white shadow-sm' : 'text-gray-500 hover:bg-white'}`}>
          {t('todo.myList', language)} ({todos.filter((x: any) => !x.is_done).length})
        </button>
        <button onClick={() => setTab('assigned')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'assigned' ? 'bg-[#2e7d32] text-white shadow-sm' : 'text-gray-500 hover:bg-white'}`}>
          {t('todo.assigned', language)} ({orders.filter((o: any) => !['done', 'cancelled'].includes(o.status)).length})
        </button>
      </div>

      {/* 排序控制（仅我的清单）：显式键序，杜绝“看似随机” */}
      {tab === 'mine' && todos.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-eyebrow">{t('todo.sort', language)}</span>
          <div className="flex rounded-lg bg-white/60 p-0.5 gap-0.5 shadow-sm">
            {([
              ['created', 'todo.sortCreated'],
              ['due', 'todo.sortDue'],
              ['priority', 'todo.sortPriority'],
            ] as const).map(([key, labelKey]) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${sortBy === key ? 'bg-[#2e7d32] text-white' : 'text-gray-500 hover:bg-white'}`}>
                {t(labelKey, language)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 新建/编辑便签弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="glass-panel rounded-3xl p-6 w-full max-w-2xl shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                <StickyNote className="w-5 h-5 text-[#2e7d32]" /> {editId ? t('todo.editNote', language) : t('todo.add', language)}
              </h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder={`${t('todo.title', language)} *`} className="glass-input rounded-xl p-3 w-full text-sm font-bold" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('todo.notes', language)} · {t('todo.markdownHint', language)}</p>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={7} className="glass-input rounded-xl p-3 w-full text-sm resize-none font-mono leading-relaxed" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('todo.preview', language)}</p>
                  <div
                    className="rounded-xl p-3 w-full text-sm bg-white/70 border border-gray-100 min-h-[178px] overflow-auto custom-scrollbar markdown-body"
                    dangerouslySetInnerHTML={{ __html: previewHtml || '<span class="text-gray-300">…</span>' }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                  className="glass-input rounded-xl p-3 w-full text-sm" />
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="glass-input rounded-xl p-3 w-full text-sm">
                  {PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEYS[p], language)}</option>)}
                </select>
                <button onClick={save} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold">{t('orders.save', language)}</button>
              </div>

              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('todo.colorLabel', language)}</p>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setForm({ ...form, color: c })}
                      className="w-9 h-9 rounded-xl border-2 transition-all flex items-center justify-center shadow-sm"
                      style={{ background: NOTE_COLORS[c].bg, borderColor: form.color === c ? NOTE_COLORS[c].title : 'transparent' }}>
                      {form.color === c && <Check className="w-4 h-4" style={{ color: NOTE_COLORS[c].title }} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 我的清单：便签墙 */}
      {tab === 'mine' && (
        <>
          {todos.length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <StickyNote className="w-8 h-8 opacity-40" />
              {t('todo.noData', language)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
              {sortedTodos.map(td => {
                const c = NOTE_COLORS[td.color] || NOTE_COLORS.yellow;
                return (
                  <div key={td.id}
                    className={`break-inside-avoid rounded-2xl p-4 shadow-lg shadow-black/5 border relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5 ${td.is_done ? 'opacity-50' : ''}`}
                    style={{ background: c.bg, borderColor: c.border }}>
                    {/* 图钉 */}
                    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-gradient-to-br from-red-300 to-red-500 shadow-md ring-2 ring-white/60" />
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-1.5 bg-black/5 rounded-b" />

                    {/* 勾选 */}
                    <button onClick={() => toggle(td)}
                      title={td.is_done ? '' : '✓'}
                      className={`absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${td.is_done ? 'bg-[#2e7d32] border-[#2e7d32] text-white' : 'border-gray-300/70 bg-white/50 hover:bg-white'}`}>
                      {td.is_done && <Check className="w-3.5 h-3.5" />}
                    </button>

                    <p className={`text-sm font-black pt-4 pr-8 break-words leading-snug ${td.is_done ? 'line-through' : ''}`} style={{ color: c.title }}>{td.title}</p>

                    {td.notes && (
                      <div
                        className="mt-2 text-xs leading-relaxed markdown-body break-words"
                        style={{ color: c.sub }}
                        dangerouslySetInnerHTML={{ __html: renderMd(td.notes) }}
                      />
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 mt-3">
                      {td.priority && <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${c.chip}`}>{t(PRIORITY_KEYS[td.priority] || td.priority, language)}</span>}
                      {td.due_date && <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: c.sub }}><Clock className="w-3 h-3" />{td.due_date}</span>}
                    </div>

                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-black/5">
                      <button onClick={() => openEdit(td)} className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" style={{ color: c.sub }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(td)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 派给我的任务 */}
      {tab === 'assigned' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orders.length === 0 && <div className="glass-card rounded-2xl p-10 text-center text-gray-400 text-sm md:col-span-2">{t('orders.noData', language)}</div>}
          {orders.map(o => (
            <div key={o.id} className="glass-card rounded-2xl p-4 border-l-4 transition-all hover:shadow-md"
              style={{ borderLeftColor: o.overdue ? '#ef4444' : o.priority === 'urgent' ? '#f97316' : o.priority === 'high' ? '#fbbf24' : '#34d399' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-gray-400">{o.woNo}</p>
                  <p className="text-sm font-bold text-gray-700 truncate">{o.title}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${STATUS_COLORS[o.status] || ''}`}>
                  {t(STATUS_KEYS[o.status] || o.status, language)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {o.priority && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PRIORITY_COLORS[o.priority] || ''}`}>{t(PRIORITY_KEYS[o.priority] || o.priority, language)}</span>}
                {o.dueDate && <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{t('orders.due', language)} {o.dueDate}</span>}
                {o.overdue && <span className="text-[10px] text-red-500 font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t('orders.overdueTag', language)}</span>}
              </div>
              {(o.targetQty > 0 || o.progress > 0) && (
                <div className="mt-3">
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#2e7d32] rounded-full transition-all" style={{ width: `${Math.min(100, o.progress || 0)}%` }}></div>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{t('orders.progress', language)} {o.progress || 0}%{o.targetQty > 0 ? `（${o.doneQty || 0}/${o.targetQty}）` : ''}</p>
                </div>
              )}
              {!['done', 'cancelled'].includes(o.status) && (
                <button onClick={() => setReportOrder(o)} className="mt-3 w-full px-3 py-1.5 rounded-lg bg-[#2e7d32]/10 text-[#2e7d32] text-xs font-bold hover:bg-[#2e7d32]/20 flex items-center justify-center gap-1">
                  <Send className="w-3.5 h-3.5" />{t('orders.report', language)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {reportOrder && <FeedbackModal order={reportOrder} onClose={() => setReportOrder(null)} onSubmitted={loadOrders} />}
      {msg && <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-2xl animate-fade-in z-50">{msg}</div>}
    </div>
  );
};

export default Todos;
