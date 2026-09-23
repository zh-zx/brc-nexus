// v2.15：多维表格（Bitable）共享类型/常量/小工具。
import { McpdField, mcpdOf } from '../../lib/mcpd';

export type RowDensity = 'compact' | 'normal' | 'tall';
export const DENSITY_H: Record<RowDensity, number> = { compact: 32, normal: 42, tall: 58 };
export const GUTTER_W = 64;
export const DEFAULT_COL_W = 164;
export const PRIMARY_W = 150;
export const MAX_VISIBLE_COLS = 50;
export const FLAT_PAGE = 100;
export const GROUP_PAGE = 50;
export const EXPORT_CAP = 20000;

export interface BitableColumn {
  key: string;
  kind: 'base' | 'trait' | 'custom' | 'stock';
  type: 'text' | 'number' | 'scale';
  label: string;
  scale?: Record<string, string> | null;
  readonly?: boolean;
  traitId?: string;
  category?: string;
  nameZh?: string;
  nameEn?: string;
}

export interface BitableFilter { field?: string; op: string; value?: string; fields?: string[]; labelKey?: string }
export interface BitableSort { field: string; dir: 'asc' | 'desc' }
export interface QueryState { keyword: string; filters: BitableFilter[]; sort: BitableSort[]; groupBy: string | null }

export interface OpItem { v: string; zh: string; en: string }

// 与 traitOps.opsFor 同语义，另加 base/custom 文本字段的 neq/notcontains
export function opsForColumn(col?: BitableColumn | null): OpItem[] {
  const common: OpItem[] = [
    { v: 'eq', zh: '等于', en: '=' },
    { v: 'neq', zh: '不等于', en: '≠' },
    { v: 'empty', zh: '为空', en: 'empty' },
    { v: 'notempty', zh: '不为空', en: 'not empty' },
  ];
  if (col?.type === 'number') {
    return [
      { v: 'gt', zh: '大于', en: '>' },
      { v: 'gte', zh: '大于等于', en: '≥' },
      { v: 'lt', zh: '小于', en: '<' },
      { v: 'lte', zh: '小于等于', en: '≤' },
      ...common,
    ];
  }
  if (col?.type === 'scale') return common;
  return [
    { v: 'contains', zh: '包含', en: 'contains' },
    { v: 'notcontains', zh: '不包含', en: 'not contain' },
    ...common,
  ];
}

export function opLabelOf(op: string, col: BitableColumn | null | undefined, language: string): string {
  const item = opsForColumn(col).find(o => o.v === op);
  if (!item) return op;
  return language === 'zh' ? item.zh : item.en;
}

// scale 选项 chip 色板（内联色，两主题一致；按选项键哈希取色）
const CHIP_PALETTE: { bg: string; fg: string }[] = [
  { bg: '#FDE68A', fg: '#78350F' },
  { bg: '#BFDBFE', fg: '#1E3A8A' },
  { bg: '#BBF7D0', fg: '#14532D' },
  { bg: '#FBCFE8', fg: '#831843' },
  { bg: '#DDD6FE', fg: '#4C1D95' },
  { bg: '#FED7AA', fg: '#7C2D12' },
  { bg: '#A5F3FC', fg: '#164E63' },
  { bg: '#FECACA', fg: '#7F1D1D' },
  { bg: '#D9F99D', fg: '#365314' },
  { bg: '#E5E7EB', fg: '#374151' },
];
export function chipColor(key: string): { bg: string; fg: string } {
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
}

export function isUrlLike(v: string): boolean {
  return /^(https?:\/\/|doi:|10\.\d{4,}\/)/i.test(String(v || '').trim());
}

// 已知字段清单 → MCPD 映射信息（基础列 + 性状 + 自定义键）
export function mcpdMapOf(fields: string[]): Record<string, McpdField> {
  const m: Record<string, McpdField> = {};
  for (const f of fields) {
    const d = mcpdOf(f);
    if (d) m[f] = d;
  }
  return m;
}
