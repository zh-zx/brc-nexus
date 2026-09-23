import { run, get, all } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * 预置 CIP 性状字典
 * 来源：genebank data.xlsx「Abbr.」工作表 + Potato 表头（53 项）+ SUMMARY.docx 分类体系（形态 13 项）
 * + potato-catalogue.cipotato.org 的营养性状（3 项）
 * value_type: text | number | scale（等级值）
 */
const CIP_TRAITS = [
  // ---- core 核心收集品 ----
  ['CORE', 'In core collection', '核心收集品', 'core', 'text'],
  // ---- morphology 形态特征（SUMMARY.docx 第 2 章）----
  ['FLW_DEG', 'Flowering degree', '开花程度', 'morphology', 'scale'],
  ['FLW_COL', 'Flower predominant color', '花序主色', 'morphology', 'scale'],
  ['FLW_SHAPE', 'Flower shape', '花形', 'morphology', 'scale'],
  ['PISTIL_PIG', 'Pistil pigmentation', '雌蕊色', 'morphology', 'scale'],
  ['FRUIT_SHAPE', 'Fruit shape', '果形', 'morphology', 'scale'],
  ['LEAF_SHAPE', 'Leaf shape (type of leaf dissection)', '叶形', 'morphology', 'scale'],
  ['STEM_WING', 'Stem wing shape', '茎翼形状', 'morphology', 'scale'],
  ['SPROUT_COL', 'Sprout predominant color', '幼芽主色', 'morphology', 'scale'],
  ['TB_FLESH', 'Tuber flesh predominant color', '块茎肉色', 'morphology', 'scale'],
  ['TB_SHAPE', 'General tuber shape', '块茎形状', 'morphology', 'scale'],
  ['TB_EYE', 'Tuber eye depth', '芽眼深度', 'morphology', 'scale'],
  ['TB_SKIN1', 'Tuber skin predominant color', '块茎皮色', 'morphology', 'scale'],
  ['TB_SKIN2', 'Tuber skin secondary color', '块茎皮次色', 'morphology', 'scale'],
  // ---- adaptation 气候适应 ----
  ['SHADE', 'Adaptation to shade', '耐阴性', 'adaptation', 'text'],
  ['COOL', 'Adaptation to cool tropical climate', '冷凉热带气候适应性', 'adaptation', 'text'],
  ['HOT', 'Adaptation to hot tropical climate', '湿热热带气候适应性', 'adaptation', 'text'],
  ['WARM', 'Adaptation to warm tropical climate', '温暖热带气候适应性', 'adaptation', 'text'],
  ['TEMP', 'Adaptation to normal temperate zone climate', '温带气候适应性', 'adaptation', 'text'],
  ['LONGD', 'Adaptation to long days', '长日适应性', 'adaptation', 'text'],
  ['SHORD', 'Adaptation to short days', '短日适应性', 'adaptation', 'text'],
  // ---- quality 品质与加工 ----
  ['CHIP', 'Chips processing', '炸片加工性', 'quality', 'text'],
  ['DRYMAT', 'Dry matter content', '干物质含量', 'quality', 'number', '%'],
  ['FRY', 'Fry facility', '炸条加工性', 'quality', 'text'],
  ['PROTEIN', 'Protein content', '蛋白含量', 'quality', 'number', '%'],
  ['TBDORM', 'Tuber dormancy', '块茎休眠期', 'quality', 'number', '天'],
  ['TBFLVR', 'Tuber flavor', '块茎风味', 'quality', 'text'],
  ['TBTEXT', 'Tuber texture', '块茎质地', 'quality', 'text'],
  // ---- virus 病毒抗性 ----
  ['APLV', 'Reaction to APLV', 'APLV 病毒抗性', 'virus', 'text'],
  ['APMV', 'Reaction to APMV', 'APMV 病毒抗性', 'virus', 'text'],
  ['PLRV', 'Reaction to PLRV', 'PLRV 卷叶病毒抗性', 'virus', 'text'],
  ['PVS', 'Reaction to PVS', 'PVS 病毒抗性', 'virus', 'text'],
  ['PVX', 'Reaction to PVX', 'PVX 病毒抗性', 'virus', 'text'],
  ['PVY', 'Reaction to PVY', 'PVY 病毒抗性', 'virus', 'text'],
  ['PYVV', 'Reaction to PYVV', 'PYVV 病毒抗性', 'virus', 'text'],
  ['REF_EVAL', 'Reference evaluation', '参考评价', 'virus', 'text'],
  // ---- disease 真菌/细菌抗性 ----
  ['ALTBRA', 'Reaction to Alternaria', '链格孢(早疫)抗性', 'disease', 'text'],
  ['BLKLG', 'Resistance to black leg', '黑胫病抗性', 'disease', 'text'],
  ['BW', 'Reaction to bacterial wilt', '细菌性萎蔫(青枯)抗性', 'disease', 'text'],
  ['CHARCRT', 'Reaction to charcoal rot', '炭腐病抗性', 'disease', 'text'],
  ['FUSAM', 'Reaction to Fusarium spp.', '镰刀菌抗性', 'disease', 'text'],
  ['FUSOL', 'Reaction to Fusarium solani', '茄病镰刀菌抗性', 'disease', 'text'],
  ['LB_LF', 'Reaction to late blight (leaf)', '晚疫病抗性(叶)', 'disease', 'text'],
  ['LB_RR', 'Reaction to late blight', '晚疫病抗性', 'disease', 'text'],
  ['LB_TB', 'Reaction to late blight (tuber)', '晚疫病抗性(块茎)', 'disease', 'text'],
  ['PHOMA', 'Reaction to phoma blight', '茎点霉病抗性', 'disease', 'text'],
  ['PINKRT', 'Reaction to pink rot', '粉红腐病抗性', 'disease', 'text'],
  ['RONA', 'Reaction to roña (common scab)', '锈痂病(rona)抗性', 'disease', 'text'],
  ['SCAB', 'Reaction to scab', '疮痂病抗性', 'disease', 'text'],
  ['SMUT', 'Reaction to smut (Thecaphora solani)', '黑粉病抗性', 'disease', 'text'],
  ['SOFRT', 'Reaction to potato soft rot', '软腐病抗性', 'disease', 'text'],
  ['VERT', 'Reaction to Verticillium', '黄萎病抗性', 'disease', 'text'],
  ['WART', 'Reaction to wart (Synchytrium endobioticum)', '癌肿病抗性', 'disease', 'text'],
  // ---- stress 非生物胁迫 ----
  ['DROUT', 'Reaction to drought', '抗旱性', 'stress', 'text'],
  ['FROST', 'Reaction to frost', '抗霜冻性', 'stress', 'text'],
  ['HAIL', 'Reaction to hail', '抗雹性', 'stress', 'text'],
  ['SALT', 'Reaction to salinity', '耐盐性', 'stress', 'text'],
  // ---- nematode 线虫抗性 ----
  ['GPALL', 'Reaction to Cyst Nematode', '孢囊线虫抗性', 'nematode', 'text'],
  ['GPALL2', 'Reaction to Cyst Nematode race pa2', '孢囊线虫 pa2 小种抗性', 'nematode', 'text'],
  ['GPALL3', 'Reaction to Cyst Nematode race pa3', '孢囊线虫 pa3 小种抗性', 'nematode', 'text'],
  ['GPALLCUS', 'Reaction to Cyst Nematode in Cusco', '库斯科孢囊线虫抗性', 'nematode', 'text'],
  ['GROST', 'Reaction to Golden Nematode', '金线虫抗性', 'nematode', 'text'],
  ['MELOI', 'Reaction to root-knot nematode', '根结线虫抗性', 'nematode', 'text'],
  // ---- pest 虫害抗性 ----
  ['AWEEVL', 'Reaction to Andean potato weevil', '安第斯象甲抗性', 'pest', 'text'],
  ['LFMIN', 'Reaction to leaf miner', '潜叶蝇抗性', 'pest', 'text'],
  ['TMOTH', 'Reaction to potato tuber moth', '块茎蛾抗性', 'pest', 'text'],
  // ---- nutrition 营养成分（potato-catalogue）----
  ['VITC', 'Vitamin C (mg/100g DW)', '维生素C (mg/100g 干重)', 'nutrition', 'number'],
  ['FE', 'Fe content (mg/kg DW)', '铁含量 (mg/kg 干重)', 'nutrition', 'number'],
  ['ZN', 'Zn content (mg/kg DW)', '锌含量 (mg/kg 干重)', 'nutrition', 'number'],
  // ---- other ----
  ['CHRN', 'Chromosome number', '染色体数', 'other', 'number'],
];

export const TRAIT_CATEGORIES = [
  ['core', '核心收集品', 'Core collection'],
  ['morphology', '形态特征', 'Morphological traits'],
  ['adaptation', '气候适应', 'Adaptation'],
  ['quality', '品质与加工', 'Processing & quality'],
  ['virus', '病毒抗性', 'Virus resistance'],
  ['disease', '真菌/细菌抗性', 'Fungal & bacterial resistance'],
  ['stress', '非生物胁迫', 'Stress resistance'],
  ['nematode', '线虫抗性', 'Nematode resistance'],
  ['pest', '虫害抗性', 'Pest resistance'],
  ['nutrition', '营养成分', 'Nutritional traits'],
  ['postharvest', '采后特性', 'Post-harvest characteristics'],
  ['other', '其他', 'Other'],
];

function seedTraitsIfEmpty() {
  const c = get('SELECT COUNT(*) as c FROM trait_def');
  if (c && c.c > 0) return;
  let i = 0;
  for (const [code, nameEn, nameZh, category, valueType, unit] of CIP_TRAITS) {
    run(
      'INSERT OR IGNORE INTO trait_def (id, code, name_en, name_zh, category, value_type, unit, is_system, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      ['sys-' + code.toLowerCase(), code, nameEn, nameZh, category, valueType, unit || null, i++]
    );
  }
  console.log(`Seeded ${CIP_TRAITS.length} CIP trait definitions`);
}

function rowToTrait(r) {
  return {
    id: r.id, code: r.code, nameEn: r.name_en, nameZh: r.name_zh,
    category: r.category, valueType: r.value_type, unit: r.unit,
    scale: r.scale_json ? JSON.parse(r.scale_json) : null,
    illustration: r.illustration || null,
    descZh: r.desc_zh || null,
    descEn: r.desc_en || null,
    isSystem: !!r.is_system, sortOrder: r.sort_order,
  };
}

// v2.10：示意图 dataURL 上限（客户端压缩到 300KB，此处兜底 500k 字符）
const MAX_ILLUSTRATION_CHARS = 500000;

export default async function traitRoutes(fastify) {
  // 首次访问时预置 CIP 字典
  try { seedTraitsIfEmpty(); } catch (e) { console.error('trait seed failed:', e.message); }

  fastify.get('/api/traits', { preHandler: [authMiddleware] }, async () => {
    const rows = all('SELECT * FROM trait_def ORDER BY category, sort_order, code');
    return { traits: rows.map(rowToTrait), categories: TRAIT_CATEGORIES.map(([code, zh, en]) => ({ code, zh, en })) };
  });

  fastify.post('/api/traits', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { code, nameEn, nameZh, category, valueType, unit, scale, illustration, descZh, descEn } = request.body || {};
    if (!code || !String(code).trim()) return reply.status(400).send({ error: '性状代码不能为空' });
    const normCode = String(code).trim();
    if (!/^[A-Za-z0-9_]+$/.test(normCode)) return reply.status(400).send({ error: '性状代码只能用字母/数字/下划线' });
    if (get('SELECT id FROM trait_def WHERE code = ?', [normCode])) {
      return reply.status(409).send({ error: `性状代码 ${normCode} 已存在` });
    }
    if (illustration && String(illustration).length > MAX_ILLUSTRATION_CHARS) {
      return reply.status(400).send({ error: '插图过大（上限 500KB）' });
    }
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    run(
      'INSERT INTO trait_def (id, code, name_en, name_zh, category, value_type, unit, scale_json, illustration, desc_zh, desc_en, is_system, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 999)',
      [id, normCode, nameEn || '', nameZh || '', category || 'other', valueType || 'text', unit || null,
        scale && Object.keys(scale).length ? JSON.stringify(scale) : null,
        illustration || null, descZh || null, descEn || null]
    );
    const row = get('SELECT * FROM trait_def WHERE id = ?', [id]);
    return rowToTrait(row);
  });

  fastify.put('/api/traits/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const old = get('SELECT * FROM trait_def WHERE id = ?', [request.params.id]);
    if (!old) return reply.status(404).send({ error: '未找到性状定义' });
    const b = request.body || {};
    if (b.illustration && String(b.illustration).length > MAX_ILLUSTRATION_CHARS) {
      return reply.status(400).send({ error: '插图过大（上限 500KB）' });
    }
    run(
      'UPDATE trait_def SET name_en = ?, name_zh = ?, category = ?, value_type = ?, unit = ?, scale_json = ?, illustration = ?, desc_zh = ?, desc_en = ? WHERE id = ?',
      [
        b.nameEn !== undefined ? b.nameEn : old.name_en,
        b.nameZh !== undefined ? b.nameZh : old.name_zh,
        b.category !== undefined ? b.category : old.category,
        b.valueType !== undefined ? b.valueType : old.value_type,
        b.unit !== undefined ? b.unit : old.unit,
        b.scale !== undefined ? (b.scale && Object.keys(b.scale).length ? JSON.stringify(b.scale) : null) : old.scale_json,
        b.illustration !== undefined ? (b.illustration || null) : old.illustration,
        b.descZh !== undefined ? (b.descZh || null) : old.desc_zh,
        b.descEn !== undefined ? (b.descEn || null) : old.desc_en,
        request.params.id,
      ]
    );
    const row = get('SELECT * FROM trait_def WHERE id = ?', [request.params.id]);
    return rowToTrait(row);
  });

  fastify.delete('/api/traits/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const old = get('SELECT * FROM trait_def WHERE id = ?', [request.params.id]);
    if (!old) return reply.status(404).send({ error: '未找到性状定义' });
    run('DELETE FROM trait_def WHERE id = ?', [request.params.id]);
    run('INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, username) VALUES (?, ?, ?, ?, NULL, ?, ?)',
      ['trait_def', request.params.id, 'DELETE', JSON.stringify(old), request.user?.id || '', request.user?.username || '']);
    return { success: true };
  });
}
