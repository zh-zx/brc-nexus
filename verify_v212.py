# -*- coding: utf-8 -*-
# v2.12 验证：服务端权限收紧(8端点) + 消息 per-user 已读 + 可见性矩阵设置 + 版本 2.12.0
import requests, json, sqlite3, sys, os, time, uuid

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

TS = str(int(time.time()))
admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}
op2_token = login('op2', 'test123')   # operator 类型
OH = {'Authorization': f'Bearer {op2_token}'}

# ============ 版本 ============
print('== 版本 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
check('V1 /api/health 版本 2.12.0', r.json().get('version') == '2.12.0', r.text[:120])

# ============ A. 服务端权限收紧 ============
print('== A. 服务端权限收紧（op2 → 403 / admin → 正常）==')
# excel（multipart 上传用一个假 xlsx 文件流；import/uploads 直接调）
r = requests.post(f'{BASE}/api/excel/upload', headers=OH, files={'file': ('t.xlsx', b'fake', 'application/vnd.ms-excel')}, timeout=10)
check('A1 op2 excel/upload → 403', r.status_code == 403, r.text[:100])
r = requests.post(f'{BASE}/api/excel/import', headers=OH, json={'rows': [], 'mapping': {}, 'mode': 'replace'}, timeout=10)
check('A2 op2 excel/import → 403', r.status_code == 403, r.text[:100])
r = requests.get(f'{BASE}/api/excel/uploads', headers=OH, timeout=10)
check('A3 op2 excel/uploads → 403', r.status_code == 403, r.text[:100])
r = requests.get(f'{BASE}/api/export', headers=OH, timeout=10)
check('A4 op2 export(整库) → 403', r.status_code == 403, r.text[:100])
r = requests.post(f'{BASE}/api/backup', headers=OH, timeout=10)
check('A5 op2 backup → 403', r.status_code == 403, r.text[:100])
r = requests.post(f'{BASE}/api/operators', headers=OH, json={'name': '黑客'}, timeout=10)
check('A6 op2 operators POST → 403', r.status_code == 403, r.text[:100])
r = requests.delete(f'{BASE}/api/operators/x', headers=OH, timeout=10)
check('A7 op2 operators DELETE → 403', r.status_code == 403, r.text[:100])
r = requests.post(f'{BASE}/api/media-types', headers=OH, json={'name': '黑客培养基'}, timeout=10)
check('A8 op2 media-types POST → 403', r.status_code == 403, r.text[:100])
r = requests.delete(f'{BASE}/api/media-types/x', headers=OH, timeout=10)
check('A9 op2 media-types DELETE → 403', r.status_code == 403, r.text[:100])

# admin 正常路径
r = requests.get(f'{BASE}/api/export', headers=AH, timeout=30)
check('A10 admin export → 200', r.status_code == 200, r.status_code)
r = requests.get(f'{BASE}/api/operators', headers=OH, timeout=10)
check('A11 op2 GET operators → 200(组培下拉需要)', r.status_code == 200, r.text[:80])
r = requests.get(f'{BASE}/api/media-types', headers=OH, timeout=10)
check('A12 op2 GET media-types → 200', r.status_code == 200, r.text[:80])
r = requests.put(f'{BASE}/api/settings', headers=OH, json={'ui.touch_mode': 'false'}, timeout=10)
check('A13 op2 PUT settings → 403(回归确认)', r.status_code == 403, r.text[:80])
r = requests.get(f'{BASE}/api/accessions?page=1&limit=3', headers=OH, timeout=10)
check('A14 op2 GET accessions → 200(标签实时源)', r.status_code == 200, r.text[:80])

# ============ B. 消息 per-user 已读 ============
print('== B. 消息 per-user 已读 ==')
# 造一条广播消息（user_id=NULL, role=NULL → admin 可见；op2 不可见广播？广播只对 admin 可见）
# 分别给 admin 与 op2 各造一条定向消息
conn = get_conn()
mid_admin = str(uuid.uuid4()); mid_op2 = str(uuid.uuid4())
conn.execute("INSERT INTO sys_message (id, user_id, type, title, body, is_read) VALUES (?,?,?,?,?,0)",
             [mid_admin, conn.execute("SELECT id FROM user WHERE username='admin'").fetchone()[0], 'test', f'v212测试-管理员 {TS}', 'x'])
conn.execute("INSERT INTO sys_message (id, user_id, type, title, body, is_read) VALUES (?,?,?,?,?,0)",
             [mid_op2, conn.execute("SELECT id FROM user WHERE username='op2'").fetchone()[0], 'test', f'v212测试-操作员 {TS}', 'x'])
conn.commit(); conn.close()

# op2 未读数 >0 且含自己的
r = requests.get(f'{BASE}/api/messages/unread-count', headers=OH, timeout=10)
before_op2 = r.json().get('unread', 0)
check('B1 op2 未读数 >0', before_op2 > 0, str(before_op2))
# op2 标记自己的已读
r = requests.post(f'{BASE}/api/messages/{mid_op2}/read', headers=OH, timeout=10)
check('B2 op2 markRead → success', r.status_code == 200 and r.json().get('success'), r.text[:80])
r = requests.get(f'{BASE}/api/messages', headers=OH, timeout=10)
mine = next((m for m in r.json().get('messages', []) if m['id'] == mid_op2), None)
check('B3 op2 视角该消息 is_read=1', mine is not None and mine.get('is_read') == 1, str(mine)[:100])
# admin 视角同一条 op2 的消息不受影响（per-user 语义）
r = requests.get(f'{BASE}/api/messages?pageSize=200', headers=AH, timeout=10)
adm_view = next((m for m in r.json().get('messages', []) if m['id'] == mid_op2), None)
check('B4 广播隔离：admin 不因 op2 已读而变', adm_view is None or adm_view.get('is_read') == 0, str(adm_view)[:100])
# read-all 只影响自己
r = requests.post(f'{BASE}/api/messages/read-all', headers=OH, timeout=10)
r = requests.get(f'{BASE}/api/messages/unread-count', headers=OH, timeout=10)
check('B5 op2 read-all 后未读=0', r.json().get('unread') == 0, r.text[:60])
# admin 的未读数不因 op2 read-all 变化
r = requests.get(f'{BASE}/api/messages/unread-count', headers=AH, timeout=10)
check('B6 admin 未读数独立', r.json().get('unread', 0) >= 1, r.text[:60])

# ============ C. 可见性矩阵设置 ============
print('== C. 可见性矩阵 ==')
r = requests.get(f'{BASE}/api/settings', headers=AH, timeout=10)
seed = r.json().get('setup.section_visibility')
check('C1 种子 setup.section_visibility 存在', seed is not None and 'connection' in seed, str(seed)[:80])
r = requests.put(f'{BASE}/api/settings', headers=OH, json={'setup.section_visibility': '{}'}, timeout=10)
check('C2 op2 改矩阵 → 403', r.status_code == 403, r.text[:80])
new_matrix = json.loads(seed)
new_matrix['params'] = ['admin', 'approver']
r = requests.put(f'{BASE}/api/settings', headers=AH, json={'setup.section_visibility': json.dumps(new_matrix)}, timeout=10)
check('C3 admin 改矩阵 → 200', r.status_code == 200, r.text[:80])
r = requests.get(f'{BASE}/api/settings', headers=AH, timeout=10)
now = json.loads(r.json().get('setup.section_visibility') or '{}')
check('C4 矩阵改动已持久化', now.get('params') == ['admin', 'approver'], str(now.get('params')))
# 还原默认
new_matrix['params'] = ['admin']
requests.put(f'{BASE}/api/settings', headers=AH, json={'setup.section_visibility': json.dumps(new_matrix)}, timeout=10)

# ============ 清理 ============
print('== 清理 ==')
conn = get_conn()
conn.execute('DELETE FROM sys_message WHERE id IN (?, ?)', [mid_admin, mid_op2])
conn.execute('DELETE FROM sys_message_read WHERE message_id IN (?, ?)', [mid_admin, mid_op2])
conn.commit()
left = conn.execute("SELECT COUNT(*) FROM sys_message WHERE title LIKE 'v212测试-%'").fetchone()[0]
conn.close()
check('Z1 测试消息已清理', left == 0, str(left))

print(f'\n==== v2.12 checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
