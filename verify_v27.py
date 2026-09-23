# -*- coding: utf-8 -*-
# v2.7 验证：AI 权限隔离 + DB 稳定性(node:sqlite/WAL/索引/备份) + 侧边栏偏好持久化
# 前置：server 已在 :7800 运行（v2.7 代码）
import requests, json, sqlite3, sys, os

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

print('== C. AI 权限隔离 ==')
admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}

r = requests.get(f'{BASE}/api/ai/tokens', headers=AH, timeout=10)
tokens = r.json().get('tokens', [])
check('C1 admin 可列出作用域令牌', r.status_code == 200 and isinstance(tokens, list), r.text[:200])

r = requests.post(f'{BASE}/api/ai/tokens', headers=AH, json={'name': 'v27-op-test', 'role': 'operator'}, timeout=10)
check('C2 创建 operator 令牌成功且返回明文', r.status_code == 200 and r.json().get('token'), r.text[:200])
op_token = r.json()['token']
op_id = r.json()['id']

r = requests.post(f'{BASE}/api/ai/query', headers={'Authorization': f'Bearer {op_token}'},
                  json={'tool': 'search_accessions', 'params': {}}, timeout=10)
check('C3 operator 可调用基础工具 search_accessions', r.status_code == 200 and r.json().get('ok'), r.text[:200])

for tool in ['get_login_log', 'get_messages', 'export_accessions']:
    r = requests.post(f'{BASE}/api/ai/query', headers={'Authorization': f'Bearer {op_token}'},
                      json={'tool': tool, 'params': {}}, timeout=10)
    check(f'C4 operator 调用 {tool} 被服务端拒绝 403', r.status_code == 403, r.text[:200])

r = requests.get(f'{BASE}/api/ai/tools', headers={'Authorization': f'Bearer {op_token}'}, timeout=10)
op_tools = [x['name'] for x in r.json().get('tools', [])]
check('C5 operator 的 /api/ai/tools 不含管理工具',
      all(x not in op_tools for x in ('get_login_log', 'get_messages', 'export_accessions')), str(op_tools))

legacy = requests.get(f'{BASE}/api/ai/token', headers=AH, timeout=10).json().get('token', '')
r = requests.get(f'{BASE}/api/ai/tools', headers={'Authorization': f'Bearer {legacy}'}, timeout=10)
admin_tools = [x['name'] for x in r.json().get('tools', [])]
check('C6 legacy admin token 作用域含全部工具', 'get_login_log' in admin_tools and 'get_messages' in admin_tools, str(admin_tools))

r = requests.post(f'{BASE}/api/ai/query', headers={'Authorization': f'Bearer {legacy}'},
                  json={'tool': 'get_login_log', 'params': {'limit': 3}}, timeout=10)
check('C7 legacy admin 可调用 get_login_log', r.status_code == 200 and r.json().get('ok'), r.text[:200])

r = requests.post(f'{BASE}/api/ai/tokens/{op_id}/status', headers=AH, json={'enabled': False}, timeout=10)
check('C8 吊销 operator 令牌成功', r.status_code == 200 and r.json().get('enabled') is False, r.text[:200])
r = requests.post(f'{BASE}/api/ai/query', headers={'Authorization': f'Bearer {op_token}'},
                  json={'tool': 'search_accessions', 'params': {}}, timeout=10)
check('C9 吊销后 operator 令牌调查询得 401', r.status_code == 401, r.text[:200])

op2_token = login('op2', 'test123')
r = requests.get(f'{BASE}/api/ai/tokens', headers={'Authorization': f'Bearer {op2_token}'}, timeout=10)
check('C10 非管理员访问令牌列表被拒 403', r.status_code == 403, r.text[:200])

print('== B. DB 稳定性 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
check('B1 /api/health 正常', r.status_code == 200 and r.json().get('status') == 'ok', r.text[:200])

r = requests.post(f'{BASE}/api/backup', headers=AH, timeout=30)
check('B2 手动备份成功 (VACUUM INTO)', r.status_code == 200 and r.json().get('success'), r.text[:200])
if r.status_code == 200:
    bpath = r.json().get('path')
    try:
        con = sqlite3.connect(bpath)
        n = con.execute('SELECT COUNT(*) FROM accession').fetchone()[0]
        con.close()
        check('B3 备份文件可被独立 SQLite 打开且含数据', n > 0, f'accessions={n}')
    except Exception as e:
        check('B3 备份文件可被独立 SQLite 打开且含数据', False, str(e))

try:
    con = sqlite3.connect(DB_PATH)
    wal = con.execute('PRAGMA journal_mode').fetchone()[0]
    check('B4 数据库为 WAL 模式', str(wal).lower() == 'wal', str(wal))
    expected = {
        'idx_upload_ref': 'upload_file',
        'idx_upload_created': 'upload_file',
        'idx_audit_table_record': 'audit_log',
        'idx_sys_message_user_read': 'sys_message',
        'idx_op_module_step': 'operation_record',
        'idx_fs_box': 'freezer_sample',
        'idx_cryo_event_type': 'cryo_record',
        'idx_ai_token_role': 'ai_token',
    }
    for name, tbl in expected.items():
        row = con.execute("SELECT name FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone()
        check(f'B5 索引 {name} 存在({tbl})', row is not None, str(row))
    ai_row = con.execute("SELECT role, name FROM ai_token WHERE name='默认管理员令牌'").fetchone()
    check('B6 ai_token 已播种默认管理员令牌', ai_row is not None and ai_row[0] == 'admin', str(ai_row))
    con.close()
except Exception as e:
    check('B4-B6 数据库检查', False, str(e))

print(f'\n==== v2.7 API/DB checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
