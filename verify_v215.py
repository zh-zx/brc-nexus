# -*- coding: utf-8 -*-
# v2.15 验证（API）：多维表格查询端点 + 自由增键持久化 + 权限 + 回归防护 + 版本 2.15
import requests, json, sqlite3, sys, os, time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://localhost:7800'
ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'server', 'data', 'brc.db')

passed = 0
failed = 0
def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'  [PASS] {name}')
    else:
        failed += 1
        print(f'  [FAIL] {name}  {detail}')

def login(username, password):
    r = requests.post(f'{BASE}/api/auth/login', json={'username': username, 'password': password}, timeout=10)
    r.raise_for_status()
    return r.json()['token']

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}

def bq(body, headers=None, raw=False):
    """bitable-query 简调"""
    r = requests.post(f'{BASE}/api/accessions/bitable-query', headers=headers or AH, json=body, timeout=20)
    return r

def bq_count(body):
    r = bq({**body, 'limit': 1})
    return r.json().get('total') if r.status_code == 200 else None

# ============ 版本 ============
print('== 版本 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
check('V1 /api/health 版本 2.18', r.json().get('version') == '2.18', r.text[:120])

# ============ 准备用户 ============
print('== 准备用户 ==')
for u, disp, ut in [('v215_appr', 'V215审批员', 'approver'), ('v215_reg', 'V215监管方', 'regulator')]:
    r = requests.post(f'{BASE}/api/users', headers=AH, json={'username': u, 'password': 'test123', 'displayName': disp, 'role': 'user', 'userType': ut}, timeout=10)
    ok = r.status_code == 200 or (r.status_code == 400 and '已存在' in r.text)
    check(f'U1 创建/复用 {u} ({ut})', ok, f'{r.status_code} {r.text[:80]}')
appr_token = login('v215_appr', 'test123')
reg_token = login('v215_reg', 'test123')
PH = {'Authorization': f'Bearer {appr_token}'}
RH = {'Authorization': f'Bearer {reg_token}'}

conn = get_conn()

# ============ A. 契约 ============
print('== A. 契约 ==')
r_bq0 = bq({'columns': [], 'limit': 1})
total_bq = r_bq0.json()['total']
r_list = requests.get(f'{BASE}/api/accessions?page=1&limit=1', headers=AH, timeout=10)
check('A1 无筛选 total == /api/accessions', total_bq == r_list.json()['total'], f'{total_bq} vs {r_list.json()["total"]}')

r_cap = bq({'columns': [], 'limit': 9999})
check('A2 limit 9999 → 截断 500', r_cap.status_code == 200 and r_cap.json()['pageSize'] == 500, str(r_cap.json().get('pageSize')))

r_keys = bq({'columns': ['cccapNo', 'VITC', 'stockTotal'], 'limit': 3})
row0 = r_keys.json()['rows'][0]
expect_keys = {'id', 'primaryId', 'displayName', 'species', 'origin', 'cccapNo', 'VITC', 'stockTotal'}
check('A3 行键集 == 基础 4 列 + 请求列', set(row0.keys()) == expect_keys, str(sorted(row0.keys())))
check('A3b fieldMeta 含类型信息', {m['field']: m['type'] for m in r_keys.json()['fieldMeta']}.get('VITC') == 'number', str(r_keys.json()['fieldMeta']))

r_over = bq({'columns': ['c%d' % i for i in range(61)]})
check('A4 61 列 → 400', r_over.status_code == 400, str(r_over.status_code))
r_badf = bq({'filters': [{'field': 'bad key!', 'op': 'eq', 'value': 'x'}]})
check('A4b 非法筛选字段 → 400', r_badf.status_code == 400, str(r_badf.status_code))
r_bads = bq({'sort': [{'field': 'bad key!', 'dir': 'asc'}]})
check('A4c 非法排序字段 → 400', r_bads.status_code == 400, str(r_bads.status_code))

# ============ B. 筛选（与 sqlite 直查对照） ============
print('== B. 筛选 ==')
def sql_count(sql, params=()):
    return conn.execute(sql, params).fetchone()[0]

b1 = bq_count({'filters': [{'field': 'species', 'op': 'contains', 'value': 'Solanum'}]})
b1_sql = sql_count("SELECT COUNT(*) FROM accession WHERE species LIKE '%Solanum%'")
check('B1 text contains', b1 == b1_sql, f'{b1} vs {b1_sql}')

b2 = bq_count({'filters': [{'field': 'species', 'op': 'eq', 'value': 'Solanum tuberosum'}]})
b2_sql = sql_count("SELECT COUNT(*) FROM accession WHERE species = 'Solanum tuberosum'")
check('B2 text eq', b2 == b2_sql, f'{b2} vs {b2_sql}')

b3 = bq_count({'filters': [{'field': 'VITC', 'op': 'gt', 'value': '10'}]})
b3_sql = sql_count("SELECT COUNT(*) FROM accession WHERE CAST(json_extract(data_json,'$.\"VITC\"') AS REAL) > 10")
check('B3 number gt（CAST REAL）', b3 == b3_sql, f'{b3} vs {b3_sql}')

b4 = bq_count({'filters': [{'field': 'VITC', 'op': 'empty'}]})
b4_sql = sql_count("SELECT COUNT(*) FROM accession WHERE json_extract(data_json,'$.\"VITC\"') IS NULL OR json_extract(data_json,'$.\"VITC\"') = ''")
check('B4 empty', b4 == b4_sql, f'{b4} vs {b4_sql}')

b5 = bq_count({'filters': [{'field': 'VITC', 'op': 'notempty'}]})
b5_sql = sql_count("SELECT COUNT(*) FROM accession WHERE json_extract(data_json,'$.\"VITC\"') IS NOT NULL AND json_extract(data_json,'$.\"VITC\"') != ''")
check('B5 notempty', b5 == b5_sql, f'{b5} vs {b5_sql}')

b6 = bq_count({'keyword': 'CIP-1'})
b6_sql = sql_count("SELECT COUNT(*) FROM accession WHERE primary_id LIKE '%CIP-1%' OR display_name LIKE '%CIP-1%' OR species LIKE '%CIP-1%'")
check('B6 keyword', b6 == b6_sql, f'{b6} vs {b6_sql}')

b7 = bq_count({'filters': [{'field': 'cccapNo', 'op': 'contains', 'value': 'CIP-0'}]})
b7_sql = sql_count("SELECT COUNT(*) FROM accession WHERE json_extract(data_json,'$.\"cccapNo\"') LIKE '%CIP-0%'")
check('B7 任意 JSON 键 contains', b7 == b7_sql, f'{b7} vs {b7_sql}')

b8 = bq_count({'filters': [{'op': 'anyempty', 'fields': ['cccapNo', 'VITC']}]})
b8_sql = sql_count("SELECT COUNT(*) FROM accession WHERE (json_extract(data_json,'$.\"cccapNo\"') IS NULL OR json_extract(data_json,'$.\"cccapNo\"')='' OR json_extract(data_json,'$.\"VITC\"') IS NULL OR json_extract(data_json,'$.\"VITC\"')='')")
check('B8 anyempty（护照不完整类）', b8 == b8_sql, f'{b8} vs {b8_sql}')

b9 = bq_count({'filters': [{'field': 'stockTotal', 'op': 'gt', 'value': '0'}]})
b9_sql = sql_count("SELECT COUNT(*) FROM accession a WHERE (SELECT COALESCE(SUM(i.quantity),0) FROM inventory i WHERE i.accession_id=a.id) > 0")
check('B9 stockTotal gt 0（库存可用性）', b9 == b9_sql, f'{b9} vs {b9_sql}')

b10 = bq_count({'filters': [{'field': 'primaryId', 'op': 'in', 'value': 'CIP-001,CIP-002'}]})
check('B10 in 集合查询', b10 == 2, str(b10))

# ============ C. 排序 ============
print('== C. 排序 ==')
r_c1 = bq({'sort': [{'field': 'VITC', 'dir': 'desc'}], 'columns': ['VITC'], 'limit': 50})
vals = [x['VITC'] for x in r_c1.json()['rows']]
maxv = conn.execute("SELECT MAX(CAST(json_extract(data_json,'$.\"VITC\"') AS REAL)) FROM accession").fetchone()[0]
nonempty_first = [v for v in vals if v is not None and str(v) != '']
check('C1 数字降序首行 == sqlite max', nonempty_first and float(nonempty_first[0]) == float(maxv), f'{nonempty_first[:1]} vs {maxv}')

r_c2 = bq({'sort': [{'field': 'VITC', 'dir': 'asc'}], 'columns': ['VITC'], 'limit': 50})
v2 = [x['VITC'] for x in r_c2.json()['rows']]
idx_first_empty = next((i for i, v in enumerate(v2) if v is None or str(v) == ''), len(v2))
check('C2 空值恒排最后', all((v is not None and str(v) != '') for v in v2[:idx_first_empty]) and all((v is None or str(v) == '') for v in v2[idx_first_empty:]), str(v2))

r_c3 = bq({'sort': [{'field': 'species', 'dir': 'asc'}, {'field': 'VITC', 'dir': 'desc'}, {'field': 'primaryId', 'dir': 'asc'}]})
check('C3 三级排序 200', r_c3.status_code == 200, str(r_c3.status_code))

r_c4a = bq({'sort': [{'field': 'species', 'dir': 'asc'}], 'limit': 5, 'page': 1})
r_c4b = bq({'sort': [{'field': 'species', 'dir': 'asc'}], 'limit': 5, 'page': 2})
pids_a = [x['primaryId'] for x in r_c4a.json()['rows']]
pids_b = [x['primaryId'] for x in r_c4b.json()['rows']]
check('C4 跨页无重复', len(set(pids_a) & set(pids_b)) == 0, f'{pids_a} / {pids_b}')
sql_order = [r0[0] for r0 in conn.execute("SELECT primary_id FROM accession ORDER BY species COLLATE NOCASE ASC, created_at DESC, id DESC LIMIT 10")]
check('C4b 跨页顺序与 sqlite 一致', pids_a + pids_b == sql_order, f'{pids_a+pids_b} vs {sql_order}')

# ============ D. 分组 ============
print('== D. 分组 ==')
r_d = bq({'groupBy': 'species', 'limit': 1})
items = r_d.json()['groups']['items']
check('D1 组计数和 == total', sum(i['count'] for i in items) == r_d.json()['total'], f'{sum(i["count"] for i in items)} vs {r_d.json()["total"]}')
sql_groups = {r0[0]: r0[1] for r0 in conn.execute("SELECT species, COUNT(*) FROM accession GROUP BY species")}
check('D2 分组值与 sqlite 一致', {i['value']: i['count'] for i in items} == sql_groups, f'{items} vs {sql_groups}')

r_d3 = bq({'groupBy': 'VITC', 'limit': 1})
d3_items = r_d3.json()['groups']['items']
last = d3_items[-1] if d3_items else None
check('D3 空值组排最后', last is not None and (last['value'] is None or last['value'] == ''), str(d3_items))

gv = 'Solanum tuberosum'
gcount = sql_groups.get(gv, 0)
r_d4a = bq({'filters': [{'field': 'species', 'op': 'eq', 'value': gv}], 'limit': 1, 'page': 1})
r_d4b = bq({'filters': [{'field': 'species', 'op': 'eq', 'value': gv}], 'limit': 1, 'page': 2})
check('D4 组内分页 total==组计数', r_d4a.json()['total'] == gcount == r_d4b.json()['total'], f'{r_d4a.json()["total"]}/{gcount}')
p1 = r_d4a.json()['rows'][0]['primaryId']; p2 = r_d4b.json()['rows'][0]['primaryId']
check('D4b 组内分页不重复', p1 != p2, f'{p1} vs {p2}')

# ============ E. 权限 ============
print('== E. 权限 ==')
r_e1 = bq({'columns': ['VITC'], 'limit': 1}, headers=RH)
check('E1 regulator 查询 200（只读可用）', r_e1.status_code == 200, str(r_e1.status_code))
r_e2 = requests.post(f'{BASE}/api/accessions/batch-update', headers=RH, json={'rows': [{'primaryId': 'CIP-001', 'updates': {'displayName': 'x'}}]}, timeout=10)
check('E2 regulator 写入 403（全局只读）', r_e2.status_code == 403, str(r_e2.status_code))

# ============ F. 自由增键持久化（approver） ============
print('== F. 自由增键持久化 ==')
# 备份 CIP-002 的原值以便还原
orig_cip2 = json.loads(conn.execute("SELECT data_json FROM accession WHERE primary_id='CIP-002'").fetchone()[0])
r_f1 = requests.post(f'{BASE}/api/accessions/batch-update', headers=PH, json={
    'mode': 'replace', 'allowCustomKeys': True,
    'rows': [{'primaryId': 'CIP-002', 'updates': {'v215_note': 'hello', 'v215_num': '12'}}],
}, timeout=10)
f1j = r_f1.json()
check('F1 approver 置 allowCustomKeys 写入新键', r_f1.status_code == 200 and 'v215_note' in (f1j.get('customKeys') or []), json.dumps(f1j, ensure_ascii=False)[:120])
r_f2 = bq({'filters': [{'field': 'primaryId', 'op': 'eq', 'value': 'CIP-002'}], 'columns': ['v215_note', 'v215_num'], 'limit': 1})
f2row = r_f2.json()['rows'][0]
check('F2 bitable-query 读回', f2row.get('v215_note') == 'hello' and f2row.get('v215_num') == '12', json.dumps(f2row, ensure_ascii=False))
r_fields = requests.get(f'{BASE}/api/accessions/fields', headers=AH, timeout=10)
check('F3 fields 端点包含新键', 'v215_note' in (r_fields.json().get('fields') or []), '')
f3sql = conn.execute("SELECT json_extract(data_json,'$.\"v215_note\"') FROM accession WHERE primary_id='CIP-002'").fetchone()[0]
check('F4 sqlite 直查落库', f3sql == 'hello', str(f3sql))
# 清空（null → 删键）
r_f5 = requests.post(f'{BASE}/api/accessions/batch-update', headers=PH, json={
    'mode': 'replace', 'allowCustomKeys': True,
    'rows': [{'primaryId': 'CIP-002', 'updates': {'v215_note': None, 'v215_num': None}}],
}, timeout=10)
r_f6 = bq({'filters': [{'field': 'primaryId', 'op': 'eq', 'value': 'CIP-002'}], 'columns': ['v215_note', 'v215_num'], 'limit': 1})
f6row = r_f6.json()['rows'][0]
f6sql = conn.execute("SELECT json_extract(data_json,'$.\"v215_note\"'), json_extract(data_json,'$.\"v215_num\"') FROM accession WHERE primary_id='CIP-002'").fetchone()
check('F5 null 清空键（读回+sqlite 均空）', r_f5.status_code == 200 and f6row.get('v215_note') is None and f6sql[0] is None and f6sql[1] is None, f'{f6row} / {tuple(f6sql)}')

# ============ G. 回归防护（Excel 流程不受影响） ============
print('== G. 回归防护 ==')
r_g1 = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH, json={
    'mode': 'replace',
    'rows': [{'primaryId': 'CIP-002', 'updates': {'v215_shouldSkip': 'x'}}],
}, timeout=10)
g1j = r_g1.json()
check('G1 不置标志 → 未知表头被跳过', 'v215_shouldSkip' in (g1j.get('unknownHeaders') or []) and not g1j.get('customKeys'), json.dumps(g1j, ensure_ascii=False)[:120])
g1sql = conn.execute("SELECT json_extract(data_json,'$.\"v215_shouldSkip\"') FROM accession WHERE primary_id='CIP-002'").fetchone()[0]
check('G2 sqlite 确认未写入', g1sql is None, str(g1sql))

# ============ H. 性状值写路径（含还原） ============
print('== H. 性状写路径 ==')
orig_vitc = orig_cip2.get('VITC')
r_h1 = requests.post(f'{BASE}/api/accessions/batch-update', headers=PH, json={
    'mode': 'replace',
    'rows': [{'primaryId': 'CIP-002', 'updates': {'VITC': '99.9'}}],
}, timeout=10)
r_h2 = bq({'filters': [{'field': 'primaryId', 'op': 'eq', 'value': 'CIP-002'}], 'columns': ['VITC'], 'limit': 1})
check('H1 approver 经性状 code 写值', r_h1.status_code == 200 and str(r_h2.json()['rows'][0].get('VITC')) == '99.9', json.dumps(r_h2.json()['rows'][0]))
restore = {'VITC': str(orig_vitc) if orig_vitc is not None else None}
requests.post(f'{BASE}/api/accessions/batch-update', headers=PH, json={'mode': 'replace', 'rows': [{'primaryId': 'CIP-002', 'updates': restore}]}, timeout=10)
r_h3 = bq({'filters': [{'field': 'primaryId', 'op': 'eq', 'value': 'CIP-002'}], 'columns': ['VITC'], 'limit': 1})
check('H2 原值已还原', str(r_h3.json()['rows'][0].get('VITC')) == (str(orig_vitc) if orig_vitc is not None else 'None'), str(r_h3.json()['rows'][0].get('VITC')))

conn.close()

print(f'\n==== v2.15 API checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
