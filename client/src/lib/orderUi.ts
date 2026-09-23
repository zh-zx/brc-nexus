// 工单/清单共用 UI 辅助：状态与优先级徽章配色
export const STATUS_COLORS: Record<string, string> = {
  pending: 'tone-warn',
  in_progress: 'tone-info',
  done: 'tone-ok',
  blocked: 'tone-bad',
  cancelled: 'tone-neutral',
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'tone-neutral',
  normal: 'tone-info',
  high: 'tone-warn',
  urgent: 'tone-bad',
};

export const PRIORITY_KEYS: Record<string, string> = {
  low: 'orders.priLow',
  normal: 'orders.priNormal',
  high: 'orders.priHigh',
  urgent: 'orders.priUrgent',
};

export const STATUS_KEYS: Record<string, string> = {
  pending: 'orders.status.pending',
  in_progress: 'orders.status.in_progress',
  done: 'orders.status.done',
  blocked: 'orders.status.blocked',
  cancelled: 'orders.status.cancelled',
};
