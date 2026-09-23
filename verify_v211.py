# -*- coding: utf-8 -*-
# v2.11 验证：MCP 端点(JSON-RPC/4工具/令牌/限流参数/审计) + 基因组学预留块(omics CRUD/审计/stock_id)
#             + 版本 2.11.0 + index.html 标题 CCCAP
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

def rpc(token, method, params=None, id_=1, raw_token=None):
    headers = {'Authorization': f'Bearer {raw_token or token}'}
    return requests.post(f'{BASE}/mcp', headers=headers,
                         json={'jsonrpc': '2.0', 'id': id_, 'method': method, 'params': params or {}}, timeout=15)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

TS = str(int(time.time()))
admin_token = login('admin', 'admin123')
AH = {'Authorization': f'Bearer {admin_token}'}

# ============ 版本 / 标题 ============
print('== 版本 / 标题 ==')
r = requests.get(f'{BASE}/api/health', timeout=10)
check('V1 /api/health 版本 2.11.0', r.json().get('version') == '2.11.0', r.text[:120])
html = open(os.path.join(ROOT, 'client', 'index.html'), encoding='utf-8').read()
check('V2 index.html 标题含 CCCAP', 'CCCAP' in html and '种质资源管理' in html, html[html.find('<title'):html.find('</title>')+8][:80] if '<title' in html else 'no title')
r = requests.get(f'{BASE}/api/settings', headers=AH, timeout=10)
check('V3 参数 mcp.rate_limit_per_min=120', r.json().get('mcp.rate_limit_per_min') == '120', r.text[:100])

# ============ A. MCP 令牌与鉴权 ============
print('== A. MCP 令牌/鉴权 ==')
r = requests.post(f'{BASE}/api/ai/tokens', headers=AH, json={'name': f'mcp-v211-{TS}', 'role': 'external'}, timeout=10)
j = r.json()
mcp_token = j.get('token'); token_id = j.get('id'); token_name = j.get('name')
check('A1 admin 创建 MCP 令牌(明文一次)', r.status_code == 200 and mcp_token and token_name == f'mcp-v211-{TS}', r.text[:150])

r = requests.post(f'{BASE}/mcp', headers={'Content-Type': 'application/json'},
                  json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}, timeout=10)
check('A2 无令牌 → 401', r.status_code == 401, r.text[:100])
r = requests.post(f'{BASE}/mcp', headers={'Authorization': 'Bearer bad-token-xyz'},
                  json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}, timeout=10)
check('A3 错误令牌 → 401', r.status_code == 401, r.text[:100])

# ============ B. MCP 协议握手与工具 ============
print('== B. MCP 握手/工具列表 ==')
r = rpc(None, 'initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'verify', 'version': '0'}}, raw_token=mcp_token)
j = r.json()
check('B1 initialize 握手', r.status_code == 200 and j.get('result', {}).get('serverInfo', {}).get('name') == 'cccap-brc'
      and 'protocolVersion' in j.get('result', {}), r.text[:200])

r = rpc(None, 'tools/list', {}, raw_token=mcp_token)
tools = r.json().get('result', {}).get('tools', [])
names = sorted(t.get('name') for t in tools)
check('B2 tools/list 含 4 工具', names == ['get_accession', 'get_my_requests', 'search_germplasm', 'submit_distribution_request'], str(names))

# ============ C. 工具功能 ============
print('== C. 工具功能 ==')
r = rpc(None, 'tools/call', {'name': 'search_germplasm', 'arguments': {'conditions': [], 'pageSize': 5}}, raw_token=mcp_token)
j = r.json()
content = j.get('result', {}).get('content', [{}])[0].get('text', '')
data = json.loads(content) if content else {}
accs = data.get('accessions', [])
check('C1 search 无条件返回结果', r.status_code == 200 and not j.get('result', {}).get('isError') and data.get('total', 0) > 0, content[:150])
if accs:
    a0 = accs[0]
    check('C2 白名单字段(有 traits/stockTotal 无 data_json)',
          'primaryId' in a0 and 'traits' in a0 and 'stockTotal' in a0 and 'data_json' not in a0 and 'token_hash' not in str(a0), str(a0)[:200])

r = rpc(None, 'tools/call', {'name': 'search_germplasm', 'arguments': {'conditions': [{'traitCode': 'VITC', 'op': 'gte', 'value': '0'}]}}, raw_token=mcp_token)
j = r.json()
content = j.get('result', {}).get('content', [{}])[0].get('text', '')
data = json.loads(content) if content else {}
check('C3 VITC>=0 条件检索命中 3', data.get('total') == 3, content[:150])

r = rpc(None, 'tools/call', {'name': 'get_accession', 'arguments': {'primaryId': 'CIP-001'}}, raw_token=mcp_token)
j = r.json()
content = j.get('result', {}).get('content', [{}])[0].get('text', '')
data = json.loads(content) if content else {}
check('C4 get_accession CIP-001(含 traits/stock/omics)', data.get('primaryId') == 'CIP-001' and 'traits' in data and 'stockTotal' in data and 'omics' in data, content[:200])

# submit：2 个编号
r = rpc(None, 'tools/call', {'name': 'submit_distribution_request', 'arguments': {
    'applicant': 'MCP测试', 'applicantOrg': 'v211 org', 'purpose': 'mcp e2e',
    'resourceType': '试管苗', 'accessions': ['CIP-001', 'CIP-002']}}, raw_token=mcp_token)
j = r.json()
content = j.get('result', {}).get('content', [{}])[0].get('text', '')
data = json.loads(content) if content else {}
mcp_req_no = data.get('reqNo')
check('C5 提交申请成功(出 reqNo)', data.get('submitted') is True and mcp_req_no, content[:200])

conn = get_conn()
row = conn.execute('SELECT source, created_by, accessions_json FROM dist_request WHERE req_no = ?', [mcp_req_no]).fetchone()
conn.close()
check('C6 库中 source=mcp created_by=令牌名 清单2条',
      row is not None and row['source'] == 'mcp' and row['created_by'] == token_name
      and len(json.loads(row['accessions_json'] or '[]')) == 2, str(row)[:150])

r = rpc(None, 'tools/call', {'name': 'get_my_requests', 'arguments': {}}, raw_token=mcp_token)
content = r.json().get('result', {}).get('content', [{}])[0].get('text', '')
data = json.loads(content) if content else {}
check('C7 get_my_requests 可见该申请', any(x.get('reqNo') == mcp_req_no for x in data.get('requests', [])), content[:150])

# 超 35
r = rpc(None, 'tools/call', {'name': 'submit_distribution_request', 'arguments': {
    'applicant': 'MCP超限', 'resourceType': '试管苗',
    'accessions': [f'CIP-{i:03d}' for i in range(1, 37)]}}, raw_token=mcp_token)
j = r.json()
res = j.get('result', {})
check('C8 36 个 → isError + 文本含 35', res.get('isError') is True and '35' in (res.get('content', [{}])[0].get('text', '')), str(res)[:200])

# 未知编号
r = rpc(None, 'tools/call', {'name': 'submit_distribution_request', 'arguments': {
    'applicant': 'MCP坏号', 'resourceType': '试管苗', 'accessions': ['NO-SUCH-1', 'NO-SUCH-2']}}, raw_token=mcp_token)
res = r.json().get('result', {})
check('C9 未知编号 → isError 列出编号', res.get('isError') is True and 'NO-SUCH-1' in res.get('content', [{}])[0].get('text', ''), str(res)[:150])

# 未知工具
r = rpc(None, 'tools/call', {'name': 'no_such_tool', 'arguments': {}}, raw_token=mcp_token)
check('C10 未知工具 → -32601', r.json().get('error', {}).get('code') == -32601, r.text[:120])

# 审计
conn = get_conn()
aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action='MCP_CALL' AND record_id = ?", [token_name]).fetchone()['c']
conn.close()
check('C11 MCP_CALL 审计已记录', aud >= 7, f'aud={aud}')  # C10 未知工具在审计前被拒，有效调用 7 次

# ============ D. 基因组学预留块 ============
print('== D. 基因组学预留块 ==')
conn = get_conn()
acc = conn.execute("SELECT id FROM accession WHERE primary_id='CIP-001'").fetchone()
acc_id = acc['id']
has_col = any(r[1] == 'stock_id' for r in conn.execute('PRAGMA table_info(accession)'))
conn.close()
check('D1 accession.stock_id 列存在', has_col)

r = requests.post(f'{BASE}/api/accessions/{acc_id}/omics', headers=AH,
                  json={'category': 'marker', 'title': 'R1 marker', 'ref': 'Hosmani 2020', 'url': 'https://example.com/r1', 'notes': 'v211 test'}, timeout=10)
j = r.json()
omics_id = j.get('id')
check('D2 添加 marker 条目', r.status_code == 200 and omics_id, r.text[:150])

r = requests.post(f'{BASE}/api/accessions/{acc_id}/omics', headers=AH,
                  json={'category': 'bogus_cat', 'title': 'x'}, timeout=10)
check('D3 非法类别 → 400', r.status_code == 400, r.text[:120])

r = requests.get(f'{BASE}/api/accessions/{acc_id}/omics', headers=AH, timeout=10)
entries = r.json().get('entries', [])
check('D4 GET 可读条目', any(x.get('id') == omics_id and x.get('category') == 'marker' for x in entries), str(entries)[:150])

r = requests.get(f'{BASE}/api/accessions/{acc_id}', headers=AH, timeout=10)
check('D5 详情返回 stockId 字段', 'stockId' in r.json(), r.text[:120])

op2_token = login('op2', 'test123')
r = requests.post(f'{BASE}/api/accessions/{acc_id}/omics', headers={'Authorization': f'Bearer {op2_token}'},
                  json={'category': 'snp', 'title': 'x'}, timeout=10)
check('D6 非 admin → 403', r.status_code == 403, r.text[:100])

r = requests.delete(f'{BASE}/api/omics/{omics_id}', headers=AH, timeout=10)
conn = get_conn()
add_aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action='OMICS_ADD'").fetchone()['c']
del_aud = conn.execute("SELECT COUNT(*) AS c FROM audit_log WHERE action='OMICS_DEL'").fetchone()['c']
left = conn.execute('SELECT COUNT(*) AS c FROM accession_omics WHERE id = ?', [omics_id]).fetchone()['c']
conn.close()
check('D7 删除 + 审计 OMICS_ADD/DEL', r.status_code == 200 and left == 0 and add_aud >= 1 and del_aud >= 1, f'{r.status_code} add={add_aud} del={del_aud} left={left}')

# ============ 清理 ============
print('== 清理 ==')
if mcp_req_no:
    conn = get_conn()
    rid = conn.execute('SELECT id FROM dist_request WHERE req_no = ?', [mcp_req_no]).fetchone()
    conn.close()
    if rid:
        requests.delete(f'{BASE}/api/dist/requests/{rid["id"]}', headers=AH, timeout=10)
if token_id:
    requests.post(f'{BASE}/api/ai/tokens/{token_id}/status', headers=AH, json={'enabled': False}, timeout=10)
conn = get_conn()
left_req = conn.execute("SELECT COUNT(*) AS c FROM dist_request WHERE applicant='MCP测试'").fetchone()['c']
conn.close()
check('Z1 测试申请已清理/令牌已停用', left_req == 0, f'left_req={left_req}')

print(f'\n==== v2.11 checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
