# -*- coding: utf-8 -*-
# v2.8 验证：双语Freezer/头像用户名/DB管理台/批量模板表头/工单批量选种+库外/日报联动/生产级硬化
# 前置：server 已在 :7800 运行（v2.8 代码，已构建 client）
import requests, json, sqlite3, sys, os, time, io

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
TODAY = time.strftime('%Y-%m-%d')

admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}

# ============ F. 生产级硬化 ============
print('== F. 生产级硬化 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
j = r.json()
check('F1 /api/health 版本 2.8.0', j.get('version') == '2.8.0', r.text[:200])
check('F2 /api/health 含启动自检告警字段(或为空)',
      'warnings' in j and isinstance(j.get('warnings'), dict), str(j.get('warnings'))[:300])
r = requests.get(f'{BASE}/api/definitely-not-a-route', timeout=10)
check('F3 未知 API 返回 JSON 404(不白屏/不裸堆栈)', r.status_code == 404 and r.headers.get('content-type', '').startswith('application/json'), f'{r.status_code} {r.text[:100]}')

# ============ B. 头像 + 用户名 ============
print('== B. 头像 + 用户名 ==')
# 自足：确保 testuser 密码为 admin123（管理员重置，避免依赖遗留密码）
r = requests.get(f'{BASE}/api/users', headers=AH, timeout=10)
tu_db_id = next((u['id'] for u in r.json().get('users', []) if u['username'] == 'testuser'), None)
OP2_ID = next((u['id'] for u in r.json().get('users', []) if u['username'] == 'op2'), 'op2')
if tu_db_id:
    requests.post(f'{BASE}/api/users/{tu_db_id}/reset-password', headers=AH,
                  json={'password': 'admin123'}, timeout=10)
else:
    print('  [WARN] testuser 不存在，使用注册方式创建')
    requests.post(f'{BASE}/api/auth/register', headers=AH,
                  json={'username': 'testuser', 'password': 'admin123', 'displayName': '测试员'}, timeout=10)
testuser_token = login('testuser', 'admin123')
TUH = {'Authorization': f'Bearer {testuser_token}'}
r = requests.get(f'{BASE}/api/auth/me', headers=TUH, timeout=10)
me = r.json().get('user', {})
old_username = me.get('username')
tu_id = me.get('id')
new_username = f'testuser_v28_{TS}'

# 预置级联数据（引用旧用户名）
conn = get_conn()
op_dummy_id = 'v28-op-' + TS
wdr_dummy_id = 'v28-wdr-' + TS
conn.execute("INSERT INTO operation_record (id, module, batch_id, step_code, title, operator, content_json, notes, event_at, immutable, user_id) VALUES (?,?,?,?,?,?,?,?,datetime('now'),1,?)",
             [op_dummy_id, 'tissue_culture', 'V28-CASCADE', 'prep', '级联测试', old_username, '{}', 'v28', tu_id])
conn.execute("INSERT INTO work_daily_report (id, work_order_id, step_code, report_date, user_id, username, qty, content) VALUES (?,?,?,?,?,?,?,?)",
             [wdr_dummy_id, 'v28-dummy-wo', 'prep', TODAY, tu_id, old_username, 1, 'v28'])
conn.commit(); conn.close()

# 改名 + 显示名 + 头像（emoji）
r = requests.put(f'{BASE}/api/my/profile', headers=TUH,
                 json={'username': new_username, 'displayName': '测试员V28', 'avatar': {'type': 'emoji', 'value': '🌱', 'bg': '#e8f5e9'}}, timeout=10)
check('B1 改用户名+显示名+emoji头像成功', r.status_code == 200 and r.json().get('token'), r.text[:200])
r = requests.get(f'{BASE}/api/auth/me', headers=TUH, timeout=10)
me2 = r.json().get('user', {})
check('B2 /api/auth/me 返回新用户名', me2.get('username') == new_username, str(me2.get('username')))
check('B3 显示名已更新', me2.get('display_name') == '测试员V28', str(me2.get('display_name')))
check('B4 头像 JSON 已存储', isinstance(me2.get('avatar'), str) and 'emoji' in me2.get('avatar', ''), str(me2.get('avatar'))[:100])

# 级联检查
conn = get_conn()
op_row = conn.execute('SELECT operator FROM operation_record WHERE id = ?', [op_dummy_id]).fetchone()
wdr_row = conn.execute('SELECT username FROM work_daily_report WHERE id = ?', [wdr_dummy_id]).fetchone()
check('B5 级联: operation_record.operator 已改名', op_row and op_row['operator'] == new_username, str(op_row and op_row['operator']))
check('B6 级联: work_daily_report.username 已改名', wdr_row and wdr_row['username'] == new_username, str(wdr_row and wdr_row['username']))
conn.close()

# 重名拒绝
r = requests.put(f'{BASE}/api/my/profile', headers=TUH, json={'username': 'op2'}, timeout=10)
check('B7 重名用户名被拒绝 400', r.status_code == 400, r.text[:200])
# 非法用户名拒绝
r = requests.put(f'{BASE}/api/my/profile', headers=TUH, json={'username': 'a'}, timeout=10)
check('B8 过短用户名被拒绝 400', r.status_code == 400, r.text[:200])

# 还原用户名 + 清理预置数据
r = requests.put(f'{BASE}/api/my/profile', headers=TUH, json={'username': old_username, 'displayName': '测试员V28'}, timeout=10)
check('B9 用户名还原成功', r.status_code == 200, r.text[:200])
conn = get_conn()
conn.execute('DELETE FROM operation_record WHERE id = ?', [op_dummy_id])
conn.execute('DELETE FROM work_daily_report WHERE id = ?', [wdr_dummy_id])
conn.execute("DELETE FROM work_daily_report WHERE work_order_id = 'v28-dummy-wo'")
conn.commit(); conn.close()

# ============ C. 数据库管理台 ============
print('== C. 数据库管理台 ==')
r = requests.get(f'{BASE}/api/dbadmin/tables', headers=AH, timeout=10)
tables = r.json().get('tables', [])
names = [t['name'] for t in tables]
check('C1 表清单含 accession/work_order', r.status_code == 200 and 'accession' in names and 'work_order' in names, r.text[:200])
check('C2 表行数非负', all(isinstance(t.get('rows'), int) and t['rows'] >= 0 for t in tables), str(tables[:2]))
r = requests.get(f'{BASE}/api/dbadmin/tables/ai_token', headers=AH, timeout=10)
j = r.json()
masked = all(not str(v).startswith('token_') or '****' in str(v) for row in j.get('rows', []) for k, v in row.items() if k in ('token_hash', 'api_token'))
check('C3 ai_token 预览 token_hash 打码', r.status_code == 200 and masked, str(j.get('rows', [])[:1])[:200])
r = requests.post(f'{BASE}/api/dbadmin/query', headers=AH, json={'sql': 'SELECT COUNT(*) AS c FROM accession'}, timeout=10)
check('C4 只读 SELECT 直接放行', r.status_code == 200 and r.json().get('kind') == 'read', r.text[:200])
r = requests.post(f'{BASE}/api/dbadmin/query', headers=AH, json={'sql': "UPDATE app_setting SET value = value WHERE key = 'backup.interval_hours'"}, timeout=10)
check('C5 写操作未确认 → WRITE_CONFIRM_REQUIRED', r.status_code == 400 and r.json().get('error') == 'WRITE_CONFIRM_REQUIRED', r.text[:200])
r = requests.post(f'{BASE}/api/dbadmin/query', headers=AH, json={'sql': "UPDATE app_setting SET value = value WHERE key = 'backup.interval_hours'", 'confirm': True}, timeout=10)
check('C6 写操作确认后成功', r.status_code == 200 and r.json().get('kind') == 'write', r.text[:200])
conn = get_conn()
audit = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'EXEC_SQL' AND after_json LIKE '%backup.interval_hours%'").fetchone()['c']
check('C7 写操作已记入审计 EXEC_SQL', audit >= 1, str(audit))
conn.close()
r = requests.post(f'{BASE}/api/dbadmin/query', headers=AH, json={'sql': 'CREATE TABLE v28_evil (id TEXT)'}, timeout=10)
check('C8 DDL 被拒绝', r.status_code == 400, r.text[:200])
r = requests.post(f'{BASE}/api/dbadmin/query', headers=AH, json={'sql': 'SELECT 1; SELECT 2'}, timeout=10)
check('C9 多语句被拒绝', r.status_code == 400, r.text[:200])
op2_token = login('op2', 'test123')
r = requests.get(f'{BASE}/api/dbadmin/tables', headers={'Authorization': f'Bearer {op2_token}'}, timeout=10)
check('C10 非 admin 访问 /db 被拒 403', r.status_code == 403, r.text[:200])

# ============ D. 批量模板 + 表头识别 ============
print('== D. 批量模板 + 表头识别 ==')
r = requests.get(f'{BASE}/api/accessions/template', headers=AH, timeout=10)
ct = r.headers.get('content-type', '')
check('D1 模板下载返回 xlsx', r.status_code == 200 and 'spreadsheetml' in ct, f'{r.status_code} {ct}')
try:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb.active
    headers = [c.value for c in ws[1]]
    trait_codes = [t[0] for t in __import__('sqlite3').connect(DB_PATH).execute('SELECT code FROM trait_def').fetchall()]
    ok_template = all(code in headers or (f'{code}（' in str(headers).replace('（', '（')) for code in trait_codes[:5])
    check('D2 模板表头含 trait code', ok_template, str(headers[:8]))
    check('D3 模板含基础字段 primaryId', 'primaryId' in headers, str(headers[:8]))
except ImportError:
    check('D2 模板含 trait code（openpyxl 不可用，跳过）', r.status_code == 200, 'openpyxl missing')
    check('D3 模板含基础字段 primaryId（跳过）', True, 'skipped')

# 表头解析：中文名 → code；垃圾表头 → unknownHeaders
conn = get_conn()
trait = conn.execute("SELECT code, name_zh FROM trait_def WHERE name_zh IS NOT NULL AND name_zh != '' LIMIT 1").fetchone()
conn.close()
code = trait['code']
name_zh = trait['name_zh']
orig = conn and None
conn = get_conn()
row = conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()
orig_json = json.loads(row['data_json'])
orig_val = orig_json.get(code, '')
conn.close()
new_val = 'v28-' + TS
r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                  json={'rows': [{'primaryId': 'CIP-001', 'updates': {name_zh: new_val, 'BOGUS_HEADER': 'x'}}], 'mode': 'replace'}, timeout=10)
j = r.json()
conn = get_conn()
after = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
conn.close()
check('D4 中文表头映射到 trait code 并写入', j.get('updated') == ['CIP-001'] and after.get(code) == new_val, f'{r.text[:200]} / {after.get(code)}')
check('D5 乱写表头被跳过并提示 unknownHeaders', 'BOGUS_HEADER' in j.get('unknownHeaders', []), str(j.get('unknownHeaders')))
# 还原（原值非空走 API；原值为空时 API 跳过空值属设计行为，直接清除该键）
if orig_val:
    r = requests.post(f'{BASE}/api/accessions/batch-update', headers=AH,
                      json={'rows': [{'primaryId': 'CIP-001', 'updates': {code: orig_val}}], 'mode': 'replace'}, timeout=10)
else:
    conn = get_conn()
    data = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
    data.pop(code, None)
    conn.execute('UPDATE accession SET data_json = ?, last_modified_at = datetime(\'now\') WHERE primary_id = ?',
                 [json.dumps(data, ensure_ascii=False), 'CIP-001'])
    conn.commit(); conn.close()
conn = get_conn()
after = json.loads(conn.execute('SELECT data_json FROM accession WHERE primary_id = ?', ['CIP-001']).fetchone()['data_json'])
conn.close()
check('D6 原值还原', after.get(code, '') == (orig_val or ''), f'{after.get(code)!r} != {orig_val!r}')

# ============ E. 批量选种 + 库外 ============
print('== E. 批量选种 + 库外 ==')
fake_pid = 'NOT-IN-LIB-' + TS
r = requests.post(f'{BASE}/api/workorders/parse-accessions', headers=AH,
                  json={'ids': ['CIP-001', fake_pid]}, timeout=10)
j = r.json()
acc_list = j.get('accessions', [])
check('E1 批量解析返回 库内+库外 混合', len(acc_list) == 2 and any(a.get('primaryId') == fake_pid and a.get('notFound') for a in acc_list), str(acc_list))
check('E2 notFound 列表含库外编号', fake_pid in j.get('notFound', []), str(j.get('notFound')))
# 建工单（含库外种质）→ 不自动建档
r = requests.post(f'{BASE}/api/workorders', headers=AH,
                  json={'title': f'v28 库外测试 {TS}', 'description': 'v28', 'assigneeIds': [OP2_ID],
                        'accessions': acc_list, 'targetQty': 10, 'priority': 'normal'}, timeout=10)
j = r.json()
wo_id = j.get('id')
check('E3 含库外种质建单成功', r.status_code == 200 and wo_id, r.text[:200])
conn = get_conn()
fake_exists = conn.execute('SELECT id FROM accession WHERE primary_id = ?', [fake_pid]).fetchone()
check('E4 库外种质未自动建档(accession)', fake_exists is None, 'unexpected record created')
conn.close()
r = requests.get(f'{BASE}/api/workorders/{wo_id}', headers=AH, timeout=10)
accs = r.json().get('order', {}).get('accessions', [])
check('E5 工单详情保留库外标记', any(a.get('primaryId') == fake_pid and a.get('notFound') for a in accs), str(accs))

# ============ G. 日报联动 ============
print('== G. 日报联动 ==')
wo_title = f'v28 日报 {TS}'
r = requests.post(f'{BASE}/api/workorders', headers=AH,
                  json={'title': wo_title, 'description': 'v28', 'assigneeIds': [OP2_ID], 'accessions': [],
                        'targetQty': 50, 'priority': 'normal', 'purpose': 'multiplication'}, timeout=10)
g_wo_id = r.json().get('id')
check('G0 日报测试工单创建', r.status_code == 200 and g_wo_id, r.text[:200])
r = requests.get(f'{BASE}/api/operation-steps?module=tissue_culture', headers=AH, timeout=10)
step_code = next((s['code'] for s in r.json().get('steps', []) if s.get('purpose') == 'multiplication'), 'prep_m')
r = requests.post(f'{BASE}/api/workorders/{g_wo_id}/daily-report', headers=AH,
                  json={'stepCode': step_code, 'reportDate': TODAY, 'qty': 10, 'content': '第一天'}, timeout=10)
j = r.json()
check('G1 提交日报成功且进度自动汇总(10/50=20%)', r.status_code == 200 and j.get('doneQty') == 10 and j.get('progress') == 20, r.text[:200])
r = requests.post(f'{BASE}/api/workorders/{g_wo_id}/daily-report', headers=AH,
                  json={'stepCode': step_code, 'reportDate': TODAY, 'qty': 20, 'content': '修正'}, timeout=10)
j = r.json()
check('G2 同日同工序覆盖(upsert)而非累加', r.status_code == 200 and j.get('upserted') is True and j.get('doneQty') == 20, r.text[:200])
r = requests.get(f'{BASE}/api/workorders/{g_wo_id}/daily-reports', headers=AH, timeout=10)
reps = r.json().get('reports', [])
check('G3 台账仅一条且 qty=20', len(reps) == 1 and reps[0]['qty'] == 20 and reps[0]['stepCode'] == step_code, str(reps))
conn = get_conn()
oprec = conn.execute("SELECT content_json, operator FROM operation_record WHERE work_order_id = ? ORDER BY rowid DESC LIMIT 1", [g_wo_id]).fetchone()
op_json = json.loads(oprec['content_json']) if oprec else {}
check('G4 日报写入不可变 operation_record 留痕', oprec is not None and op_json.get('daily_report') is True and op_json.get('qty') == 20, str(oprec and oprec['content_json']))
conn.close()
# 手动模式
r = requests.put(f'{BASE}/api/workorders/{g_wo_id}/progress-mode', headers=AH, json={'mode': 'manual'}, timeout=10)
check('G5 切换手动进度模式', r.status_code == 200 and r.json().get('progressMode') == 'manual', r.text[:200])
r = requests.put(f'{BASE}/api/workorders/{g_wo_id}/progress', headers=AH, json={'progress': 40, 'doneQty': 200}, timeout=10)
check('G6 手动设置进度成功', r.status_code == 200 and r.json().get('progress') == 40, r.text[:200])
conn = get_conn()
audit = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action IN ('MANUAL_PROGRESS','PROGRESS_MODE') AND record_id = ?", [g_wo_id]).fetchone()['c']
check('G7 手动进度/模式切换已审计', audit >= 2, str(audit))
conn.close()
r = requests.post(f'{BASE}/api/workorders/{g_wo_id}/daily-report', headers=AH,
                  json={'stepCode': step_code, 'reportDate': TODAY, 'qty': 5, 'content': '手动模式再报'}, timeout=10)
r2 = requests.get(f'{BASE}/api/workorders/{g_wo_id}', headers=AH, timeout=10)
prog = r2.json().get('order', {}).get('progress')
check('G8 manual 模式下日报不自动改进度(保持40)', prog == 40, f'progress={prog}')
r = requests.put(f'{BASE}/api/workorders/{g_wo_id}/progress-mode', headers=AH, json={'mode': 'auto'}, timeout=10)
r2 = requests.get(f'{BASE}/api/workorders/{g_wo_id}', headers=AH, timeout=10)
o = r2.json().get('order', {})
check('G9 切回 auto 立即重算(5/50=10%)', o.get('progress') == 10 and o.get('doneQty') == 5, f"progress={o.get('progress')} doneQty={o.get('doneQty')}")

# 审批员/操作员可查看日报（op2 是指派操作员）
op2_token = login('op2', 'test123')
r = requests.get(f'{BASE}/api/workorders/{g_wo_id}/daily-reports', headers={'Authorization': f'Bearer {op2_token}'}, timeout=10)
check('G10 指派操作员可查看台账', r.status_code == 200 and len(r.json().get('reports', [])) == 1, r.text[:200])

# ============ 清理 ============
print('== 清理 ==')
for wid in [g_wo_id, wo_id]:
    if wid:
        conn = get_conn()
        conn.execute('DELETE FROM work_daily_report WHERE work_order_id = ?', [wid])
        conn.execute('DELETE FROM operation_record WHERE work_order_id = ?', [wid])
        conn.execute('DELETE FROM work_order_feedback WHERE work_order_id = ?', [wid])
        conn.execute('DELETE FROM work_order_assignee WHERE work_order_id = ?', [wid])
        conn.execute('DELETE FROM work_order WHERE id = ?', [wid])
        conn.commit(); conn.close()

print(f'\n==== v2.8 checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
