# -*- coding: utf-8 -*-
# v2.9 验证：种质网格编辑清空语义(batch-update null) + DB 管理台行级增删改(/api/dbadmin/row) + 版本 2.9.0
# 前置：server 已在 :7800 运行（v2.9 代码，已构建 client）
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

admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}

def dbrow(table, mode, row=None, key=None, confirm=True):
    body = {'table': table, 'mode': mode}
    if row is not None: body['row'] = row
    if key is not None: body['key'] = key
    body['confirm'] = confirm
    return requests.post(f'{BASE}/api/dbadmin/row', headers=AH, json=body, timeout=10)

def find_acc(pid, limit=500):
    r = requests.get(f'{BASE}/api/accessions?page=1&limit={limit}', headers=AH, timeout=10)
    for a in r.json().get('accessions', []):
        if a.get('primaryId') == pid:
            return a
    return None

# ============ 版本 ============
print('== 版本 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
check('V1 /api/health 版本 2.9.0', r.json().get('version') == '2.9.0', r.text[:200])

# ============ A. batch-update：null=清空 / ''=跳过 / primaryId 不可清空 ============
print('== A. 网格编辑服务端语义 (batch-update) ==')
conn = get_conn()
traits = conn.execute("SELECT code FROM trait_def WHERE name_zh IS NOT NULL AND name_zh != '' ORDER BY sort_order, code LIMIT 2").fetchall()
conn.close()
if len(traits) < 2:
    print('  [WARN] trait_def 中带中文名的性状不足 2 个，改用任意 code')
    conn = get_conn()
    traits = conn.execute('SELECT code FROM trait_def ORDER BY sort_order, code LIMIT 2').fetchall()
    conn.close()
codeA = traits[0][0]
codeB = traits[1][0]

conn = get_conn()
row = conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()
orig_json = json.loads(row['data_json'])
origA = orig_json.get(codeA, '')
origB = orig_json.get(codeB, '')
conn.close()

newA = 'v29A-' + TS
newB = 'v29B-' + TS
# A1 设置值
r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                  json={'rows': [{'primaryId': 'CIP-001', 'updates': {codeA: newA}}], 'mode': 'replace'}, timeout=10)
conn = get_conn()
after = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
conn.close()
check('A1 值写入成功', r.json().get('updated') == ['CIP-001'] and after.get(codeA) == newA, f"{r.text[:150]} / {after.get(codeA)}")

# A2 '' 跳过（Excel 兼容）：不删不写，值保持
r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                  json={'rows': [{'primaryId': 'CIP-001', 'updates': {codeA: ''}}], 'mode': 'replace'}, timeout=10)
j = r.json()
conn = get_conn()
after = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
conn.close()
check('A2 空串跳过(不删不写)', 'CIP-001' not in j.get('updated', []) and after.get(codeA) == newA, f"{r.text[:200]} / {after.get(codeA)}")

# A3 清空 primaryId 被拒
r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                  json={'rows': [{'primaryId': 'CIP-001', 'updates': {'primaryId': None}}], 'mode': 'replace'}, timeout=10)
j = r.json()
check('A3 清空种质编号被拒', any('编号' in (f.get('reason') or '') for f in j.get('failed', [])), r.text[:200])

# A4 一行同时改值 + 清空：codeA 改 newB，codeB 清空
r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                  json={'rows': [{'primaryId': 'CIP-001', 'updates': {codeA: newB, codeB: None}}], 'mode': 'replace'}, timeout=10)
conn = get_conn()
after = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
conn.close()
check('A4a 改值生效', r.json().get('updated') == ['CIP-001'] and after.get(codeA) == newB, f"{r.text[:150]} / {after.get(codeA)}")
check('A4b 清空键已删除', codeB not in after, f"codeB 仍存在: {after.get(codeB)!r}")
conn = get_conn()
aud = conn.execute("SELECT before_json FROM audit_log WHERE action = 'BATCH_UPDATE' AND table_name = 'accession' ORDER BY rowid DESC LIMIT 1").fetchone()
conn.close()
check('A4c 审计含 cleared 字段', aud is not None and 'cleared' in (aud['before_json'] or ''), str(aud and aud['before_json'])[:200])

# 还原 CIP-001
restore = {}
if origA != '': restore[codeA] = origA
if origB != '': restore[codeB] = origB
if restore:
    r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                      json={'rows': [{'primaryId': 'CIP-001', 'updates': restore}], 'mode': 'replace'}, timeout=10)
else:
    conn = get_conn()
    data = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
    data.pop(codeA, None); data.pop(codeB, None)
    conn.execute('UPDATE accession SET data_json = ?, last_modified_at = datetime(\'now\') WHERE primary_id = ?',
                 [json.dumps(data, ensure_ascii=False), 'CIP-001'])
    conn.commit(); conn.close()
conn = get_conn()
after = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
conn.close()
check('A5 原值还原', after.get(codeA, '') == (origA or '') and after.get(codeB, '') == (origB or ''),
      f"{after.get(codeA)!r}/{after.get(codeB)!r} vs {origA!r}/{origB!r}")

# ============ B. /api/dbadmin/row 行级增删改 ============
print('== B. 数据库管理台行级增删改 ==')
# B1 无 confirm → WRITE_CONFIRM_REQUIRED
r = dbrow('room', 'insert', {'name': 'x'}, confirm=False)
check('B1 无 confirm → 400 WRITE_CONFIRM_REQUIRED', r.status_code == 400 and r.json().get('error') == 'WRITE_CONFIRM_REQUIRED', r.text[:200])

# B2 DENY 表 → 403
r = dbrow('user', 'insert', {'username': 'evil'})
check('B2 DENY 表 user → 403 TABLE_DENIED', r.status_code == 403 and r.json().get('error') == 'TABLE_DENIED', r.text[:200])

# B3 新建 room（后续更新/删除测试）
r = dbrow('room', 'insert', {'name': 'v29-r-' + TS})
room_id = r.json().get('recordId')
check('B3 新建 room 成功', r.status_code == 200 and room_id, r.text[:200])

# B4 未知列 → UNKNOWN_COLUMN
r = dbrow('room', 'update', {'bogus_col': 'x'}, {'col': 'id', 'value': room_id})
check('B4 未知列 → 400 UNKNOWN_COLUMN', r.status_code == 400 and r.json().get('error') == 'UNKNOWN_COLUMN', r.text[:200])

# B5 敏感列不可写
r = dbrow('room', 'update', {'token_hash': 'x'}, {'col': 'id', 'value': room_id})
check('B5 写 token_hash → 400 SENSITIVE_COLUMN', r.status_code == 400 and r.json().get('error') == 'SENSITIVE_COLUMN', r.text[:200])

# B6/B7 注入字符串原样入库（参数化）
inj = "x' OR 1=1 --"
r = dbrow('room', 'update', {'name': inj}, {'col': 'id', 'value': room_id})
check('B6 注入字符串更新成功', r.status_code == 200, r.text[:200])
rr = requests.get(f'{BASE}/api/dbadmin/tables/room', headers=AH, timeout=10)
found = [x for x in rr.json().get('rows', []) if x.get('id') == room_id]
check('B7 注入字符串原样存储(未注入)', len(found) == 1 and found[0].get('name') == inj, str(found)[:200])

# B8/B9 FK_BLOCKED：建 room + 引用它的 inventory → 删除被拦
r = dbrow('room', 'insert', {'name': 'v29-fk-' + TS})
fk_room_id = r.json().get('recordId')
r = dbrow('inventory', 'insert', {'room_id': fk_room_id})
inv_id = r.json().get('recordId')
check('B8 建引用 room 的 inventory', r.status_code == 200 and inv_id, r.text[:200])
r = dbrow('room', 'delete', None, {'col': 'id', 'value': fk_room_id})
j = r.json()
check('B9 删除被引用 room → FK_BLOCKED',
      r.status_code == 400 and j.get('error') == 'FK_BLOCKED'
      and any(x.get('child') == 'inventory' and x.get('count', 0) >= 1 for x in j.get('references', [])), r.text[:200])

# B10/B11 非唯一 key → NON_UNIQUE_KEY
dup = 'v29-dupe-' + TS
r1 = dbrow('room', 'insert', {'name': dup})
r2 = dbrow('room', 'insert', {'name': dup})
check('B10 创建两条同名 room', r1.status_code == 200 and r2.status_code == 200, f'{r1.status_code}/{r2.status_code}')
r = dbrow('room', 'update', {'name': 'x'}, {'col': 'name', 'value': dup})
check('B11 非唯一键 → 400 NON_UNIQUE_KEY', r.status_code == 400 and r.json().get('error') == 'NON_UNIQUE_KEY', r.text[:200])

# B12 正常 update room
new_name = 'v29-renamed-' + TS
r = dbrow('room', 'update', {'name': new_name}, {'col': 'id', 'value': room_id})
check('B12 更新 room 成功', r.status_code == 200, r.text[:200])

# B13/B14 审计 ROW_INSERT / ROW_UPDATE
conn = get_conn()
ins_aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'ROW_INSERT' AND after_json LIKE ?", [f'%{room_id}%']).fetchone()['c']
upd_aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'ROW_UPDATE' AND after_json LIKE ?", [f'%{room_id}%']).fetchone()['c']
conn.close()
check('B13 审计 ROW_INSERT 已记录', ins_aud >= 1, str(ins_aud))
check('B14 审计 ROW_UPDATE 已记录', upd_aud >= 1, str(upd_aud))

# B15-B19 accession 行级增删改（含性状 null 清空、display_name 直列生效）
acc_pid = 'V29-ROW-' + TS
r = dbrow('accession', 'insert', {'primary_id': acc_pid, 'display_name': 'Row 种质', 'species': 'Solanum tuberosum', 'origin': 'v29', codeA: 'rowA'})
acc_id = r.json().get('recordId')
check('B15 accession 插入成功', r.status_code == 200 and acc_id, r.text[:200])
a = find_acc(acc_pid)
check('B16 插入后 GET 可读扁平(直列+性状)', a is not None and a.get('primaryId') == acc_pid
      and a.get('displayName') == 'Row 种质' and a.get(codeA) == 'rowA', str(a)[:200])
r = dbrow('accession', 'update', {'display_name': 'Row 改', codeA: None}, {'col': 'id', 'value': acc_id})
check('B17 accession 更新成功(直列改+性状清空)', r.status_code == 200, r.text[:200])
a = find_acc(acc_pid)
check('B18 更新后扁平可见：display_name 改 + 性状清空', a is not None and a.get('displayName') == 'Row 改'
      and a.get(codeA) in (None, ''), str(a)[:300])
r = dbrow('accession', 'delete', None, {'col': 'id', 'value': acc_id})
check('B19 删除 accession 成功', r.status_code == 200, r.text[:200])

# B20-B24 清理 + ROW_DELETE 审计
r = dbrow('inventory', 'delete', None, {'col': 'id', 'value': inv_id})
check('B20 删除 inventory 成功', r.status_code == 200, r.text[:200])
r = dbrow('room', 'delete', None, {'col': 'id', 'value': fk_room_id})
check('B21 删除 fk room 成功(引用已清)', r.status_code == 200, r.text[:200])
r = dbrow('room', 'delete', None, {'col': 'id', 'value': room_id})
check('B22 删除临时 room 成功', r.status_code == 200, r.text[:200])
d1 = r1.json().get('recordId'); d2 = r2.json().get('recordId')
if d1 and d2:
    dbrow('room', 'delete', None, {'col': 'id', 'value': d1})
    dbrow('room', 'delete', None, {'col': 'id', 'value': d2})
conn = get_conn()
del_aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'ROW_DELETE' AND after_json LIKE ?", [f'%{room_id}%']).fetchone()['c']
conn.close()
check('B23 审计 ROW_DELETE 已记录', del_aud >= 1, str(del_aud))
check('B24 清理同名 room', bool(d1 and d2), f'{d1}/{d2}')

# B25/B26 非法 mode / 表不存在
r = dbrow('room', 'bogus', {})
check('B25 非法 mode → 400 INVALID_MODE', r.status_code == 400 and r.json().get('error') == 'INVALID_MODE', r.text[:200])
r = dbrow('no_such_table_v29', 'insert', {'x': 'y'})
check('B26 表不存在 → 404 TABLE_NOT_FOUND', r.status_code == 404 and r.json().get('error') == 'TABLE_NOT_FOUND', r.text[:200])

# B27 非 admin → 403
op2_token = login('op2', 'test123')
r = requests.post(f'{BASE}/api/dbadmin/row', headers={'Authorization': f'Bearer {op2_token}'},
                  json={'table': 'room', 'mode': 'insert', 'row': {'name': 'x'}, 'confirm': True}, timeout=10)
check('B27 非 admin 访问 /row → 403', r.status_code == 403, r.text[:200])

print(f'\n==== v2.9 checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
