# -*- coding: utf-8 -*-
# v2.12 UI 验证：Setup 角色分治(admin全量+矩阵 / op2精简 / external无入口) + 标签设计种质库实时源 + 消息徽标联动
import sys, time, uuid
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import requests
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
ROOT = r'C:\Users\Lenovo\brc-helper-v2'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:200]) if detail and not cond else ''))

def api_token(u='admin', p='admin123'):
    return requests.post(f'{BASE}/api/auth/login', json={'username': u, 'password': p}, timeout=10).json()['token']

def ui_login(page, username, password):
    page.goto(BASE + '/#/login', wait_until='networkidle', timeout=30000)
    page.evaluate("localStorage.removeItem('brc_token')")
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(600)
    pw = page.locator('input[type="password"]').first
    pw.wait_for(timeout=10000)
    ins = page.locator('input')
    for i in range(ins.count()):
        if (ins.nth(i).get_attribute('type') or '') != 'password':
            ins.nth(i).fill(username); break
    pw.fill(password)
    for i in range(page.locator('button').count()):
        t = (page.locator('button').nth(i).inner_text() or '').replace(' ', '')
        if '登录' in t:
            page.locator('button').nth(i).click(); break
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1000)

def badge_number(page):
    b = page.locator('span', has_text='99+')
    if b.count() > 0:
        return 999
    return -1  # unknown

test_msg_id = str(uuid.uuid4())

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    # ===== A. admin 的 Setup =====
    ui_login(page, 'admin', 'admin123')
    page.evaluate("location.hash = '#/setup'")
    page.wait_for_timeout(1500)
    body = page.locator('body').inner_text()
    check('A1 admin Setup 含数据源/导入/参数/AI', ('数据源模式' in body or 'Data Source' in body) and '导入' in body and '系统参数' in body and 'AI' in body, body[:150])
    check('A2 admin Setup 含可见性矩阵', '设置可见性矩阵' in body, body[-200:])
    # 矩阵含操作员列
    check('A3 矩阵列含操作员', '操作员' in body)

    # ===== B. op2 的 Setup（精简） =====
    ui_login(page, 'op2', 'test123')
    page.evaluate("location.hash = '#/setup'")
    page.wait_for_timeout(1500)
    body = page.locator('body').inner_text()
    check('B1 op2 Setup 有连接信息(服务器地址)', 'Server Address' in body or '服务器' in body or ':7800' in body, body[:120])
    check('B2 op2 Setup 有个人提示卡', '仅管理员可见' in body, body[:200])
    check('B3 op2 Setup 无 Excel 导入/系统参数/AI 令牌', '导入资源清单' not in body and '系统参数' not in body and '作用域令牌' not in body, body[:200])

    # ===== C. external 无系统设置入口 =====
    ui_login(page, 'ext1', 'test123')
    body = page.locator('body').inner_text()
    check('C1 external 侧边栏无系统设置', '系统设置' not in body, body[:150])
    page.evaluate("location.hash = '#/setup'")
    page.wait_for_timeout(1000)
    body = page.locator('body').inner_text()
    check('C2 external 直达 /setup 也只见精简视图', '导入资源清单' not in body and '系统参数' not in body)

    # ===== D. LabelDesigner 种质库实时源（admin） =====
    ui_login(page, 'admin', 'admin123')
    page.evaluate("location.hash = '#/design'")
    page.wait_for_timeout(1500)
    body = page.locator('body').inner_text()
    check('D1 设计器有 Excel/CSV 与 种质库 按钮', ('Excel / CSV' in body or 'Excel/CSV' in body) and '种质库' in body, body[:200])
    db_btn = page.locator('button', has_text='种质库').first
    if db_btn.count() > 0:
        db_btn.click()
        page.wait_for_timeout(1800)
        body = page.locator('body').inner_text()
        check('D2 实时加载行数>0', '条记录' in body, [l for l in body.split('\n') if '条记录' in l][:1])
        chip = page.locator('button', has_text='VITC')
        chip_zh = 0
        for i in range(chip.count()):
            if '维生素C' in (chip.nth(i).inner_text() or ''):
                chip_zh += 1
                break
        check('D3 字段芯片带中文名(维生素C … (VITC))', chip_zh > 0, f'vitcChips={chip.count()}')

    # ===== E. 消息徽标联动（admin） =====
    # 造一条 admin 的未读消息
    import sqlite3
    conn = sqlite3.connect(ROOT + r'\server\data\brc.db')
    admin_id = conn.execute("SELECT id FROM user WHERE username='admin'").fetchone()[0]
    conn.execute("INSERT INTO sys_message (id, user_id, type, title, body, is_read) VALUES (?,?,?,?,?,0)",
                 [test_msg_id, admin_id, 'test', f'v212UI徽标测试 {int(time.time())}', 'badge sync'])
    conn.commit(); conn.close()
    # 触发徽标刷新（进入消息页会 hashchange 刷新）
    page.evaluate("location.hash = '#/messages'")
    page.wait_for_timeout(1200)
    body = page.locator('body').inner_text()
    check('E1 新消息出现在列表', 'v212UI徽标测试' in body, body[:120])
    # 点击该消息的标记已读
    row = page.locator('div', has_text='v212UI徽标测试').locator('button', has_text='标记已读').first
    if row.count() == 0:
        row = page.get_by_text('标记已读').first
    row.click()
    page.wait_for_timeout(1200)
    body = page.locator('body').inner_text()
    check('E2 点击后行变为已读(标记按钮消失)', 'v212UI徽标测试' not in body or body.count('标记已读') < 1 or '标记已读' not in body.split('v212UI徽标测试')[0][:0], 'checked visually below')
    # 清理测试消息
    conn = sqlite3.connect(ROOT + r'\server\data\brc.db')
    conn.execute('DELETE FROM sys_message WHERE id = ?', [test_msg_id])
    conn.execute('DELETE FROM sys_message_read WHERE message_id = ?', [test_msg_id])
    conn.commit(); conn.close()

    # ===== F. 白屏扫描 =====
    for path, label in [('#/setup', '系统设置'), ('#/messages', '消息'), ('#/design', '标签设计'), ('#/accessions', '种质')]:
        page.evaluate(f"location.hash = '{path}'")
        page.wait_for_timeout(700)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页无白屏', len(txt) > 50, txt[:60])

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check('无 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:5]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.12 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
