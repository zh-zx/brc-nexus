# -*- coding: utf-8 -*-
# v2.7 C 部分 UI：Setup 作用域令牌管理界面 + MCP 按作用域注册
import subprocess, sys, time, requests
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
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

def login(page, username, password):
    page.goto(BASE + '/#/login')
    page.wait_for_load_state('domcontentloaded')
    try:
        page.evaluate("localStorage.removeItem('brc_token')")
    except Exception:
        pass
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('input[type="password"]', timeout=10000)
    page.fill('input[type="text"]', username)
    page.fill('input[type="password"]', password)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1200)

# ---- Setup UI 测试 ----
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    login(page, 'admin', 'admin123')
    page.goto(BASE + '/#/setup')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)

    body = page.evaluate("document.body.innerText")
    check('S1 Setup 页包含作用域令牌管理区块', '作用域令牌管理' in body, '')

    # 打开新建表单
    page.locator('button', has_text='新建令牌').click()
    page.wait_for_timeout(400)
    check('S2 新建令牌表单出现', page.locator('input[placeholder="令牌名称"]').count() > 0)

    # 填名称 + 选角色 + 生成（用时间戳保证唯一，避免命中历史测试令牌）
    token_name = 'ui-test-' + str(int(time.time()))
    page.fill('input[placeholder="令牌名称"]', token_name)
    page.locator('input[placeholder="令牌名称"]').locator('xpath=following-sibling::select').select_option('regulator')
    page.locator('button', has_text='生成令牌').click()
    page.wait_for_timeout(1200)
    body2 = page.evaluate("document.body.innerText")
    check('S3 生成后明文令牌显示', '令牌仅显示一次' in body2)

    # 列表中出现新令牌
    body3 = page.evaluate("document.body.innerText")
    check('S4 列表出现新令牌名称', token_name in body3)
    check('S5 列表显示角色 regulator', '监管员' in body3)

    # 吊销本行：令牌列表按创建时间升序，刚创建的在最后一行 → 点最后一个吊销按钮（不误伤默认管理员令牌）
    page.on('dialog', lambda d: d.accept())
    page.locator('button[title="吊销"]').last.click()
    page.wait_for_timeout(1200)
    body4 = page.evaluate("document.body.innerText")
    check('S6 吊销后状态显示已吊销', '已吊销' in body4)
    browser.close()

# ---- MCP 按作用域注册测试 ----
print('== MCP scoped registration ==')
# 用 API 建一个全新 operator token
r = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10)
admin_token = r.json()['token']
AH = {'Authorization': f'Bearer {admin_token}'}
r = requests.post(f'{BASE}/api/ai/tokens', headers=AH, json={'name': 'mcp-op-test', 'role': 'operator'}, timeout=10)
op_token = r.json()['token']
op_id = r.json()['id']

env = {'BRC_URL': BASE, 'BRC_TOKEN': op_token, 'BRC_TOKEN_NAME': 'mcp-operator-test'}
proc = subprocess.Popen(
    [sys.executable and 'node', 'brc-mcp-server/src/index.js'],
    cwd=r'C:\Users\Lenovo\brc-helper-v2',
    env={**__import__('os').environ, **env},
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    encoding='utf-8', errors='replace',
)
time.sleep(4)
proc.terminate()
out, err = proc.communicate(timeout=10)
check('M1 MCP 启动日志标注 operator 作用域', 'scope: operator' in err, err[-300:])
check('M2 MCP 跳过管理工具(get_login_log/get_messages/export_accessions)',
      '跳过工具 get_login_log' in err and '跳过工具 get_messages' in err and '跳过工具 export_accessions' in err,
      err[-500:])
check('M3 MCP 注册工具数小于全部(注册 <= 9 且 > 0)', '注册工具 9' in err or ('注册工具 ' in err and not any(f'注册工具 {n}' in err for n in range(10, 20))), err[-300:])

# 清理测试 token
requests.post(f'{BASE}/api/ai/tokens/{op_id}/status', headers=AH, json={'enabled': False}, timeout=10)

print(f'\n==== v2.7 setup UI + MCP checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
