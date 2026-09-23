// v2.10：性状查询操作符（Accessions 查询面板 / FindGermplasm 向导共用）
export interface OpItem { v: string; zh: string; en: string; }

export const opsFor = (tr: any): OpItem[] => {
  const common: OpItem[] = [
    { v: 'eq', zh: '等于', en: '=' },
    { v: 'neq', zh: '不等于', en: '≠' },
    { v: 'empty', zh: '为空', en: 'empty' },
    { v: 'notempty', zh: '不为空', en: 'not empty' },
  ];
  if (tr?.valueType === 'number') {
    return [
      { v: 'gt', zh: '大于', en: '>' },
      { v: 'gte', zh: '大于等于', en: '≥' },
      { v: 'lt', zh: '小于', en: '<' },
      { v: 'lte', zh: '小于等于', en: '≤' },
      ...common,
    ];
  }
  if (tr?.valueType === 'scale') {
    return common.filter(o => o.v === 'eq' || o.v === 'empty' || o.v === 'notempty');
  }
  return [{ v: 'contains', zh: '包含', en: 'contains' }, ...common];
};

// 语言取操作符显示文本
export const opLabel = (op: OpItem, language: string) => (language === 'zh' ? op.zh : op.en);
