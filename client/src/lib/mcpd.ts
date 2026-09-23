// v2.15：MCPD v2.1（FAO/Bioversity Multi-Crop Passport Descriptors, December 2015）贴合层。
// 用途：多维表格的字段分组/徽标、受控词表编辑、护照完整度检查、标准表头导出。
// 词表逐项核对官方原文（docs 引用：cgspace.cgiar.org MCPD V.2.1, 2015）。

export interface McpdVocabItem { code: string; en: string; zh: string; }

// SAMPSTAT 19. Biological status of accession（分级码，官方原文逐项）
export const SAMPSTAT_VOCAB: McpdVocabItem[] = [
  { code: '100', en: 'Wild', zh: '野生' },
  { code: '110', en: 'Natural', zh: '自然' },
  { code: '120', en: 'Semi-natural/wild', zh: '半自然/野生' },
  { code: '130', en: 'Semi-natural/sown', zh: '半自然/播种' },
  { code: '200', en: 'Weedy', zh: '杂草型' },
  { code: '300', en: 'Traditional cultivar/landrace', zh: '传统品种/地方品种' },
  { code: '400', en: 'Breeding/research material', zh: '育种/研究材料' },
  { code: '410', en: "Breeder's line", zh: '育种家品系' },
  { code: '411', en: 'Synthetic population', zh: '综合群体' },
  { code: '412', en: 'Hybrid', zh: '杂交种' },
  { code: '413', en: 'Founder stock/base population', zh: '基础群体' },
  { code: '414', en: 'Inbred line (parent of hybrid cultivar)', zh: '自交系（杂交种亲本）' },
  { code: '415', en: 'Segregating population', zh: '分离群体' },
  { code: '416', en: 'Clonal selection', zh: '无性系选系' },
  { code: '420', en: 'Genetic stock', zh: '遗传材料' },
  { code: '421', en: 'Mutant (e.g. induced/insertion mutants, tilling populations)', zh: '突变体' },
  { code: '422', en: 'Cytogenetic stocks (e.g. chromosome addition/substitution, aneuploids, amphiploids)', zh: '细胞遗传材料' },
  { code: '423', en: 'Other genetic stocks (e.g. mapping populations)', zh: '其他遗传材料' },
  { code: '500', en: 'Advanced or improved cultivar (conventional breeding methods)', zh: '高代/改良品种（常规育种）' },
  { code: '600', en: 'GMO (by genetic engineering)', zh: '转基因材料' },
  { code: '999', en: 'Other (elaborate in REMARKS field)', zh: '其他（在备注说明）' },
];

// COLLSRC 21. Collecting/acquisition source（分级码，官方原文逐项）
export const COLLSRC_VOCAB: McpdVocabItem[] = [
  { code: '10', en: 'Wild habitat', zh: '野生生境' },
  { code: '11', en: 'Forest or woodland', zh: '森林/林地' },
  { code: '12', en: 'Shrubland', zh: '灌丛' },
  { code: '13', en: 'Grassland', zh: '草地' },
  { code: '14', en: 'Desert or tundra', zh: '荒漠/冻原' },
  { code: '15', en: 'Aquatic habitat', zh: '水生生境' },
  { code: '20', en: 'Farm or cultivated habitat', zh: '农田/栽培生境' },
  { code: '21', en: 'Field', zh: '大田' },
  { code: '22', en: 'Orchard', zh: '果园' },
  { code: '23', en: 'Backyard, kitchen or home garden (urban, peri-urban or rural)', zh: '庭院/菜园' },
  { code: '24', en: 'Fallow land', zh: '休耕地' },
  { code: '25', en: 'Pasture', zh: '牧场' },
  { code: '26', en: 'Farm store', zh: '农家仓储' },
  { code: '27', en: 'Threshing floor', zh: '打谷场' },
  { code: '28', en: 'Park', zh: '公园' },
  { code: '30', en: 'Market or shop', zh: '市场/商店' },
  { code: '40', en: 'Institute, Experimental station, Research organization, Genebank', zh: '研究机构/试验站/种质库' },
  { code: '50', en: 'Seed company', zh: '种子公司' },
  { code: '60', en: 'Weedy, disturbed or ruderal habitat', zh: '杂草/扰动生境' },
  { code: '61', en: 'Roadside', zh: '路边' },
  { code: '62', en: 'Field margin', zh: '田边' },
  { code: '99', en: 'Other (elaborate in REMARKS field)', zh: '其他（在备注说明）' },
];

// MLSSTAT 27. MLS status of the accession（0 未纳入 / 1 已纳入 / 99 其他）
export const MLSSTAT_VOCAB: McpdVocabItem[] = [
  { code: '0', en: 'No (not included)', zh: '否（未纳入）' },
  { code: '1', en: 'Yes (included)', zh: '是（已纳入）' },
  { code: '99', en: "Other (elaborate in REMARKS field, e.g. 'under development')", zh: '其他（在备注说明）' },
];

// 13. ORIGCTY — ISO 3166-1 alpha-3（ISO 官方三位字母码；简称用英文通名）
const COUNTRY_LIST = `AFG Afghanistan|ALB Albania|DZA Algeria|AND Andorra|AGO Angola|ATG Antigua and Barbuda|ARG Argentina|ARM Armenia|AUS Australia|AUT Austria|AZE Azerbaijan|BHS Bahamas|BHR Bahrain|BGD Bangladesh|BRB Barbados|BLR Belarus|BEL Belgium|BLZ Belize|BEN Benin|BTN Bhutan|BOL Bolivia|BIH Bosnia and Herzegovina|BWA Botswana|BRA Brazil|BRN Brunei|BGR Bulgaria|BFA Burkina Faso|BDI Burundi|CPV Cabo Verde|KHM Cambodia|CMR Cameroon|CAN Canada|CAF Central African Republic|TCD Chad|CHL Chile|CHN China|COL Colombia|COM Comoros|COG Congo|COD Congo (DRC)|CRI Costa Rica|CIV Côte d'Ivoire|HRV Croatia|CUB Cuba|CYP Cyprus|CZE Czechia|DNK Denmark|DJI Djibouti|DMA Dominica|DOM Dominican Republic|ECU Ecuador|EGY Egypt|SLV El Salvador|GNQ Equatorial Guinea|ERI Eritrea|EST Estonia|SWZ Eswatini|ETH Ethiopia|FJI Fiji|FIN Finland|FRA France|GAB Gabon|GMB Gambia|GEO Georgia|DEU Germany|GHA Ghana|GRC Greece|GRD Grenada|GTM Guatemala|GIN Guinea|GNB Guinea-Bissau|GUY Guyana|HTI Haiti|HND Honduras|HUN Hungary|ISL Iceland|IND India|IDN Indonesia|IRN Iran|IRQ Iraq|IRL Ireland|ISR Israel|ITA Italy|JAM Jamaica|JPN Japan|JOR Jordan|KAZ Kazakhstan|KEN Kenya|KIR Kiribati|PRK North Korea|KOR South Korea|KWT Kuwait|KGZ Kyrgyzstan|LAO Laos|LVA Latvia|LBN Lebanon|LSO Lesotho|LBR Liberia|LBY Libya|LIE Liechtenstein|LTU Lithuania|LUX Luxembourg|MDG Madagascar|MWI Malawi|MYS Malaysia|MDV Maldives|MLI Mali|MLT Malta|MHL Marshall Islands|MRT Mauritania|MUS Mauritius|MEX Mexico|FSM Micronesia|MDA Moldova|MCO Monaco|MNG Mongolia|MNE Montenegro|MAR Morocco|MOZ Mozambique|MMR Myanmar|NAM Namibia|NRU Nauru|NPL Nepal|NLD Netherlands|NZL New Zealand|NIC Nicaragua|NER Niger|NGA Nigeria|MKD North Macedonia|NOR Norway|OMN Oman|PAK Pakistan|PLW Palau|PAN Panama|PNG Papua New Guinea|PRY Paraguay|PER Peru|PHL Philippines|POL Poland|PRT Portugal|QAT Qatar|ROU Romania|RUS Russia|RWA Rwanda|KNA Saint Kitts and Nevis|LCA Saint Lucia|VCT Saint Vincent and the Grenadines|WSM Samoa|SMR San Marino|STP Sao Tome and Principe|SAU Saudi Arabia|SEN Senegal|SRB Serbia|SYC Seychelles|SLE Sierra Leone|SGP Singapore|SVK Slovakia|SVN Slovenia|SLB Solomon Islands|SOM Somalia|ZAF South Africa|SSD South Sudan|ESP Spain|LKA Sri Lanka|SDN Sudan|SUR Suriname|SWE Sweden|CHE Switzerland|SYR Syria|TWN Taiwan|TJK Tajikistan|TZA Tanzania|THA Thailand|TLS Timor-Leste|TGO Togo|TON Tonga|TTO Trinidad and Tobago|TUN Tunisia|TUR Türkiye|TKM Turkmenistan|TUV Tuvalu|UGA Uganda|UKR Ukraine|ARE United Arab Emirates|GBR United Kingdom|USA United States|URY Uruguay|UZB Uzbekistan|VUT Vanuatu|VAT Holy See|VEN Venezuela|VNM Viet Nam|YEM Yemen|ZMB Zambia|ZWE Zimbabwe`;

export const COUNTRY_VOCAB: McpdVocabItem[] = COUNTRY_LIST.split('|').map(seg => {
  const i = seg.indexOf(' ');
  return { code: seg.slice(0, i), en: seg.slice(i + 1), zh: '' };
});

export const VOCABS: Record<string, McpdVocabItem[]> = {
  sampstat: SAMPSTAT_VOCAB,
  collsrc: COLLSRC_VOCAB,
  mlsstatus: MLSSTAT_VOCAB,
  country: COUNTRY_VOCAB,
};

export interface McpdField {
  mcpd: string;                 // 描述符缩写（如 ACCENUMB）
  num: string;                  // MCPD v2.1 编号
  nameZh: string;
  nameEn: string;
  aliases: string[];            // 小写匹配键（含常见变体/中文键）
  vocab?: keyof typeof VOCABS;
  numeric?: 'lat' | 'lon' | 'elevation' | 'year';
  format?: string;              // 如 YYYYMMDD
}

// MCPD v2.1 描述符注册表（实现贴合常用项；未列描述符按普通文本字段处理）
export const MCPD_FIELDS: McpdField[] = [
  { mcpd: 'PUID', num: '0', nameZh: '永久唯一标识符', nameEn: 'Persistent unique identifier', aliases: ['puid', 'doi', 'persistentidentifier', 'persistent_id', 'globalsystemid'] },
  { mcpd: 'INSTCODE', num: '1', nameZh: '保存机构代码(WIEWS)', nameEn: 'Institute code (FAO WIEWS)', aliases: ['instcode', 'institutecode', 'institute_code', 'wiews', 'wiewscode', 'wiews_code', 'holdinginstitute'], vocab: undefined },
  { mcpd: 'ACCENUMB', num: '2', nameZh: '种质编号', nameEn: 'Accession number', aliases: ['accenumb', 'accessionnumber', 'accession_number', 'accenum', 'accessionno'] },
  { mcpd: 'COLLNUMB', num: '3', nameZh: '采集号', nameEn: 'Collecting number', aliases: ['collnumb', 'collnumber', 'collnum', 'collectingnumber', 'collecting_number'] },
  { mcpd: 'COLLCODE', num: '4', nameZh: '采集机构代码', nameEn: 'Collecting institute code', aliases: ['collcode', 'collectinginstitutecode'] },
  { mcpd: 'GENUS', num: '5', nameZh: '属', nameEn: 'Genus', aliases: ['genus'] },
  { mcpd: 'SPECIES', num: '6', nameZh: '种', nameEn: 'Species', aliases: ['species', 'scientificname', 'latinname'] },
  { mcpd: 'SUBTAXA', num: '8', nameZh: '亚分类群', nameEn: 'Subtaxon', aliases: ['subtaxa', 'subtaxon', 'subspecies'] },
  { mcpd: 'CROPNAME', num: '10', nameZh: '作物名称', nameEn: 'Common crop name', aliases: ['cropname', 'crop_name', 'crop'] },
  { mcpd: 'ACCENAME', num: '11', nameZh: '种质名称', nameEn: 'Accession name', aliases: ['accename', 'accessionname', 'accession_name', 'varietyname'] },
  { mcpd: 'ACQDATE', num: '12', nameZh: '引进日期', nameEn: 'Acquisition date', aliases: ['acqdate', 'acquisitiondate', 'acquisition_date', 'acquiredate', 'acquiredate'], format: 'YYYYMMDD', numeric: 'year' },
  { mcpd: 'ORIGCTY', num: '13', nameZh: '原产国', nameEn: 'Country of origin (ISO 3166-1 alpha-3)', aliases: ['origcty', 'origctry', 'country', 'countryoforigin', 'countryof_origin', 'country_code', 'countrycode', '原产国', '来源国'], vocab: 'country' },
  { mcpd: 'COLLSITE', num: '14', nameZh: '采集地点', nameEn: 'Location of collecting site', aliases: ['collsite', 'collectingsite', 'collecting_site', 'collectionsite', 'collection_site', 'collectinglocation', '采集地点', '采集地'] },
  { mcpd: 'DECLATITUDE', num: '15.1', nameZh: '纬度(十进制度)', nameEn: 'Latitude (decimal degrees)', aliases: ['declatitude', 'latitude', 'lat', 'gpslat', '纬度'], numeric: 'lat' },
  { mcpd: 'DECLONGITUDE', num: '15.3', nameZh: '经度(十进制度)', nameEn: 'Longitude (decimal degrees)', aliases: ['declongitude', 'longitude', 'lon', 'lng', 'gpslon', '经度'], numeric: 'lon' },
  { mcpd: 'COORDUNCERT', num: '15.5', nameZh: '坐标不确定度(m)', nameEn: 'Coordinate uncertainty (m)', aliases: ['coorduncert', 'coordinateuncertainty', 'coorduncertainty'] },
  { mcpd: 'COORDDATUM', num: '15.6', nameZh: '坐标基准', nameEn: 'Coordinate datum', aliases: ['coorddatum', 'coordinatedatum', 'datum'] },
  { mcpd: 'GEOREFMETH', num: '15.7', nameZh: '地理参考方法', nameEn: 'Georeferencing method', aliases: ['georefmeth', 'georeferencingmethod', 'georefmethod'] },
  { mcpd: 'ELEVATION', num: '16', nameZh: '海拔(masl)', nameEn: 'Elevation of collecting site (masl)', aliases: ['elevation', 'altitude', 'elev', 'masl', '海拔'], numeric: 'elevation' },
  { mcpd: 'COLLDATE', num: '17', nameZh: '采集日期', nameEn: 'Collecting date of sample', aliases: ['colldate', 'collectiondate', 'collection_date', 'collectionyear', 'collectyear', 'collectingdate', 'collecting_date', '采集日期', '采集年份'], format: 'YYYYMMDD', numeric: 'year' },
  { mcpd: 'BREDCODE', num: '18', nameZh: '育种机构代码', nameEn: 'Breeding institute code', aliases: ['bredcode', 'breedinginstitutecode'] },
  { mcpd: 'BREDNAME', num: '18.1', nameZh: '育种机构名称', nameEn: 'Breeding institute name', aliases: ['bredname', 'breedinginstitute', 'breeder'] },
  { mcpd: 'SAMPSTAT', num: '19', nameZh: '生物学状态', nameEn: 'Biological status of accession', aliases: ['sampstat', 'biologicalstatus', 'biological_status', 'biostatus', 'bio_status', '样品类型', '生物状态'], vocab: 'sampstat' },
  { mcpd: 'ANCEST', num: '20', nameZh: '系谱', nameEn: 'Ancestral data', aliases: ['ancest', 'ancestraldata', 'pedigree'] },
  { mcpd: 'COLLSRC', num: '21', nameZh: '采集/获取来源', nameEn: 'Collecting/acquisition source', aliases: ['collsrc', 'collectingsource', 'collecting_source', 'source', 'acquisitionsource', '来源'], vocab: 'collsrc' },
  { mcpd: 'DONORCODE', num: '22', nameZh: '供体机构代码', nameEn: 'Donor institute code', aliases: ['donorcode', 'donorinstitutecode'] },
  { mcpd: 'DONORNAME', num: '22.1', nameZh: '供体名称', nameEn: 'Donor name', aliases: ['donorname', 'donor'] },
  { mcpd: 'DONORNUMB', num: '23', nameZh: '供体种质编号', nameEn: 'Donor accession number', aliases: ['donornumb', 'donoraccessionnumber', 'donoraccession'] },
  { mcpd: 'OTHERNUMB', num: '24', nameZh: '其他标识', nameEn: 'Other identifiers', aliases: ['othernumb', 'othernumber', 'otheridentifier', 'otheraccnum'] },
  { mcpd: 'DUPLSITE', num: '25', nameZh: '安全备份地点', nameEn: 'Location of safety duplicates', aliases: ['duplsite', 'duplicatesite', 'safetyduplication', 'safety_duplication', 'backuplocation', '安全备份'] },
  { mcpd: 'DUPLINSTNAME', num: '25.1', nameZh: '备份机构名称', nameEn: 'Name of duplicate institute', aliases: ['duplinstname', 'duplicateinstitute'] },
  { mcpd: 'STORAGE', num: '26', nameZh: '保存方式', nameEn: 'Type of storage', aliases: ['storage', 'storagetype', 'conservationtype', 'storageform'] },
  { mcpd: 'MLSSTAT', num: '27', nameZh: 'MLS 状态', nameEn: 'MLS status of the accession', aliases: ['mlsstat', 'mlsstatus', 'mls_status', 'mls', 'mlsstatusofaccession'], vocab: 'mlsstatus' },
  { mcpd: 'REMARKS', num: '28', nameZh: '备注', nameEn: 'Remarks', aliases: ['remarks', 'remark', 'notes', 'note', '备注'] },
];

// 基础列 → MCPD 映射（列表接口的四个恒有字段）
export const BASE_FIELD_MCPD: Record<string, string> = {
  primaryId: 'ACCENUMB',
  displayName: 'ACCENAME',
  species: 'SPECIES',
  origin: 'ORIGCTY',
};

const BY_MCPD = new Map(MCPD_FIELDS.map(f => [f.mcpd, f]));
const BY_ALIAS = new Map<string, McpdField>();
for (const f of MCPD_FIELDS) for (const a of f.aliases) BY_ALIAS.set(a.toLowerCase(), f);

// 护照核心集（质量检查/完整度）：MCPD 关键描述符
const CORE_MCPD = ['ACCENUMB', 'ACCENAME', 'SPECIES', 'ORIGCTY', 'COLLDATE', 'DECLATITUDE', 'DECLONGITUDE', 'SAMPSTAT'];

// 字段名 → MCPD 描述符（基础列优先；其余按键名/别名小写匹配）
export function mcpdOf(field: string): McpdField | null {
  const f = String(field || '').trim();
  if (!f) return null;
  if (BASE_FIELD_MCPD[f]) return BY_MCPD.get(BASE_FIELD_MCPD[f]) || null;
  return BY_ALIAS.get(f.toLowerCase()) || null;
}

// 可用字段中的护照核心子集（保持 CORE_MCPD 顺序）
export function passportCoreFields(available: string[]): string[] {
  const byMcpd = new Map<string, string>();
  for (const key of available) {
    const m = mcpdOf(key);
    if (m) byMcpd.set(m.mcpd, key);
  }
  return CORE_MCPD.map(code => byMcpd.get(code)).filter((x): x is string => !!x);
}

// 行内护照完整度（0–100，按给定字段集；空值/空白计缺失）
export function passportCompleteness(row: Record<string, any>, fields: string[]): number {
  if (!fields.length) return 100;
  let filled = 0;
  for (const f of fields) {
    const v = row[f];
    if (v !== null && v !== undefined && String(v).trim() !== '') filled++;
  }
  return Math.round((filled / fields.length) * 100);
}

// 数值软校验：返回警告文案（null = 通过）。year 仅对 4 位纯数字校验（YYYYMMDD 等格式放行）。
export function validateNumeric(kind: 'lat' | 'lon' | 'elevation' | 'year', raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (v === '') return null;
  if (kind === 'year') {
    if (!/^\d{4}$/.test(v)) return null;
    const y = Number(v);
    return y >= 1000 && y <= 2100 ? null : '年份超出 1000–2100';
  }
  const n = Number(v);
  if (Number.isNaN(n)) return '不是有效数字';
  if (kind === 'lat') return n >= -90 && n <= 90 ? null : '纬度需在 -90 ~ 90（十进制度）';
  if (kind === 'lon') return n >= -180 && n <= 180 ? null : '经度需在 -180 ~ 180（十进制度）';
  return n >= -500 && n <= 9000 ? null : '海拔超出 -500 ~ 9000 m';
}

// 导出表头：映射字段 → 「MCPD缩写 (名称)」；未映射返回原键
export function mcpdHeader(field: string, labels?: Record<string, string>): string {
  const m = mcpdOf(field);
  const label = labels?.[field] || field;
  if (!m) return label;
  return `${m.mcpd} (${label})`;
}
