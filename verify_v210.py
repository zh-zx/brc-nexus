# -*- coding: utf-8 -*-
# v2.10 验证：性状示意图/说明(trait_def 三字段) + query 库存可用性 + 空条件放行
#             + dist accessions_json/source + 35 上限服务端强制 + 版本 2.10.0
# 前置：server 已在 :7800 运行（v2.10 代码，已构建 client）
import requests, json, sqlite3, sys, os, time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://localhost:7800'
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server', 'data', 'brc.db')

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

TS = str(int(time.time()))
# 1x1 像素 PNG dataURL
TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}

def dbrow(table, mode, row=None, key=None, confirm=True):
    body = {'table': table, 'mode': mode}
    if row is not None: body['row'] = row
    if key is not None: body['key'] = key
    body['confirm'] = confirm
    return requests.post(f'{BASE}/api/dbadmin/row', headers=AH, json=body, timeout=10)

# ============ 版本 ============
print('== 版本 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
check('V1 /api/health 版本 2.10.0', r.json().get('version') == '2.10.0', r.text[:200])
r = requests.get(f'{BASE}/api/settings', headers=AH, timeout=10)
check('V2 参数 dist.max_accessions=35', r.json().get('dist.max_accessions') == '35', r.text[:120])

# ============ A. 性状示意图 + 说明 ============
print('== A. 性状示意图/说明 (trait_def) ==')
code = 'V210ILLU'
r = requests.post(f'{BASE}/api/traits', headers=AH, json={
    'code': code, 'nameZh': 'v210示意性状', 'nameEn': 'v210 illus trait',
    'category': 'other', 'valueType': 'scale',
    'scale': {'1': '低', '9': '高'},
    'illustration': TINY_PNG, 'descZh': '测试中文说明', 'descEn': 'test en desc',
}, timeout=10)
j = r.json()
trait_id = j.get('id')
check('A1 创建带插图/说明的性状', r.status_code == 200 and trait_id
      and j.get('illustration') == TINY_PNG and j.get('descZh') == '测试中文说明' and j.get('descEn') == 'test en desc', r.text[:200])

r = requests.get(f'{BASE}/api/traits', headers=AH, timeout=10)
tr = next((x for x in r.json().get('traits', []) if x.get('code') == code), None)
check('A2 GET 回读插图/说明一致', tr is not None and tr.get('illustration') == TINY_PNG
      and tr.get('descZh') == '测试中文说明', str(tr)[:150] if tr else 'not found')

r = requests.put(f'{BASE}/api/traits/{trait_id}', headers=AH, json={'descZh': '改后说明', 'illustration': None}, timeout=10)
j = r.json()
check('A3 PUT 更新说明 + 清空插图', r.status_code == 200 and j.get('descZh') == '改后说明' and j.get('illustration') is None
      and j.get('descEn') == 'test en desc', r.text[:200])

# 超大插图 → 400
r = requests.post(f'{BASE}/api/traits', headers=AH, json={
    'code': 'V210BIG', 'illustration': 'data:image/png;base64,' + 'A' * 500001,
}, timeout=30)
check('A4 超大插图 → 400', r.status_code == 400 and '插图' in r.json().get('error', ''), r.text[:120])

r = requests.delete(f'{BASE}/api/traits/{trait_id}', headers=AH, timeout=10)
conn = get_conn()
aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action='DELETE' AND table_name='trait_def' AND before_json LIKE ?", [f'%{code}%']).fetchone()['c']
conn.close()
check('A5 删除性状 + 审计', r.status_code == 200 and aud >= 1, f'{r.text[:80]} aud={aud}')

# ============ B. query 库存可用性 + 空条件 ============
print('== B. 检索内核：库存可用性 + 空条件 ==')
conn = get_conn()
acc = conn.execute("SELECT id FROM accession WHERE primary_id = 'CIP-001'").fetchone()
acc_id = acc['id'] if acc else None
conn.close()
room_id = None; inv_id = None
if acc_id:
    r = dbrow('room', 'insert', {'name': 'v210-r-' + TS})
    room_id = r.json().get('recordId')
    r = dbrow('inventory', 'insert', {'accession_id': acc_id, 'room_id': room_id, 'germplasm_name': 'CIP-001', 'quantity': 7, 'form': '试管苗'})
    inv_id = r.json().get('recordId')

r = requests.post(f'{BASE}/api/accessions/query', headers=AH, json={'conditions': [], 'page': 1, 'limit': 200}, timeout=10)
j = r.json()
check('B1 空条件 → 200 放行', r.status_code == 200 and isinstance(j.get('accessions'), list), r.text[:150])
row = next((x for x in j.get('accessions', []) if x.get('primaryId') == 'CIP-001'), None)
check('B2 行含 stockTotal/stockForms', row is not None and 'stockTotal' in row and 'stockForms' in row, str(row)[:120] if row else 'CIP-001 not in results')
if inv_id:
    check('B3 CIP-001 库存汇总 >0 且形态正确', row is not None and row.get('stockTotal', 0) >= 7
          and any('试管苗' in str(f) for f in row.get('stockForms', [])), f"stock={row.get('stockTotal') if row else None} forms={row.get('stockForms') if row else None}")
else:
    check('B3 CIP-001 库存汇总字段存在', row is not None and row.get('stockTotal') == 0, 'no inventory created')

# 性状条件查询仍正常（notempty）
r = requests.post(f'{BASE}/api/accessions/query', headers=AH, json={'conditions': [{'traitCode': 'FLW_COL', 'op': 'notempty', 'value': ''}], 'page': 1, 'limit': 50}, timeout=10)
check('B4 notempty 条件查询正常', r.status_code == 200 and r.json().get('total', 0) >= 0, r.text[:150])

# ============ C. dist accessions_json / source / 35 上限 ============
print('== C. 分发申请清单 + 35 上限 ==')
accs10 = [{'id': f'fake-{i}', 'code': f'CIP-9{i:02d}', 'name': f'v210-{i}'} for i in range(10)]
r = requests.post(f'{BASE}/api/dist/requests', headers=AH, json={
    'applicant': 'v210测试', 'applicantOrg': 'v210 org', 'purpose': 'wizard 测试',
    'resourceType': '试管苗', 'qty': 10, 'durationDays': 30,
    'accessions': accs10, 'source': 'wizard',
}, timeout=10)
j = r.json()
req_id_1 = j.get('id')
check('C1 创建带清单+来源 wizard', r.status_code == 200 and req_id_1, r.text[:200])

r = requests.get(f'{BASE}/api/dist/requests', headers=AH, timeout=10)
req = next((x for x in r.json().get('requests', []) if x.get('id') == req_id_1), None)
check('C2 回读清单 10 条且含 id/code/name', req is not None and len(req.get('accessionsJson', [])) == 10
      and all(('id' in a and 'code' in a and 'name' in a) for a in req.get('accessionsJson', [])), str(req)[:150] if req else 'not found')
check('C3 source=wizard', req is not None and req.get('source') == 'wizard', str(req and req.get('source')))

accs36 = [{'id': f'fake-{i}', 'code': f'C{i}', 'name': f'n{i}'} for i in range(36)]
r = requests.post(f'{BASE}/api/dist/requests', headers=AH, json={
    'applicant': 'v210超限', 'resourceType': '试管苗', 'qty': 36, 'accessions': accs36, 'source': 'wizard',
}, timeout=10)
j = r.json()
check('C4 36 个 → 400 TOO_MANY_ACCESSIONS + max=35', r.status_code == 400 and j.get('error') == 'TOO_MANY_ACCESSIONS' and j.get('max') == 35, r.text[:200])

r = requests.post(f'{BASE}/api/dist/requests', headers=AH, json={
    'applicant': 'v210旧格式', 'resourceType': '试管苗', 'qty': 1,
}, timeout=10)
j = r.json()
req_id_2 = j.get('id')
r = requests.get(f'{BASE}/api/dist/requests', headers=AH, timeout=10)
req2 = next((x for x in r.json().get('requests', []) if x.get('id') == req_id_2), None)
check('C5 旧格式兼容 source=manual 清单空', req2 is not None and req2.get('source') == 'manual' and req2.get('accessionsJson') == [],
      str(req2)[:120] if req2 else 'not found')

# PUT 更新清单（pending 状态可编辑）
r = requests.put(f'{BASE}/api/dist/requests/{req_id_2}', headers=AH, json={'accessions': accs10[:3], 'source': 'wizard'}, timeout=10)
r = requests.get(f'{BASE}/api/dist/requests', headers=AH, timeout=10)
req2 = next((x for x in r.json().get('requests', []) if x.get('id') == req_id_2), None)
check('C6 PUT 更新清单/来源', req2 is not None and len(req2.get('accessionsJson', [])) == 3 and req2.get('source') == 'wizard', str(req2)[:120])

# 清理测试申请
for rid in [req_id_1, req_id_2]:
    if rid:
        requests.delete(f'{BASE}/api/dist/requests/{rid}', headers=AH, timeout=10)

# 清理库存/房间
if inv_id:
    dbrow('inventory', 'delete', None, {'col': 'id', 'value': inv_id})
if room_id:
    dbrow('room', 'delete', None, {'col': 'id', 'value': room_id})
conn = get_conn()
left = conn.execute("SELECT COUNT(*) AS c FROM dist_request WHERE applicant LIKE 'v210%'").fetchone()['c']
conn.close()
check('C7 测试申请已清理', left == 0, f'left={left}')

print(f'\n==== v2.10 checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
