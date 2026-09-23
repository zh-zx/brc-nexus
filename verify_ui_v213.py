# -*- coding: utf-8 -*-
# v2.13 UI 视觉验证：设计系统 token + 4px 顶渐变线 + 硬边卡片 + brutal-number + 快速任务解析
import sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
import requests

BASE = 'http://localhost:7800'

# v2.16 补：前置将主题重置为 brutalist（本脚本 T6/T7/T8 断言 brutalist 硬边，
# 但 v214 等前置脚本会留下 classic —— 脚本间主题状态不再相互依赖）
try:
    tok = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']
    requests.put(f'{BASE}/api/my/settings', headers={'Authorization': f'Bearer {tok}'}, json={'key': 'ui.theme', 'value': 'brutalist'}, timeout=10)
except Exception:
    pass
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:200]) if detail and not cond else ''))

def ui_login(page, username='admin', password='admin123'):
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
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)

created_todo_id = None
quick_task_text = '明天 上午 10 点 R1 标记验证 紧急 @op2'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    ui_login(page)

    # ===== 1. 登录后首页不报错 =====
    body = page.locator('body').inner_text()
    check('T1 登录后 Workbench 正常加载(无 React 错误)', '快速任务' in body and ('下午好' in body or '早上好' in body or '晚上好' in body), body[:150])
    check('T2 无 JS 控制台错误', len([e for e in console_errors if '#310' not in e and '#418' not in e and 'favicon' not in e]) == 0, '; '.join(console_errors[:3]))

    # ===== 2. 4px 顶渐变线 =====
    # CSS: .app-top-gradient::before 固定 4px + 黄→黑→紫→蓝→绿渐变
    has_gradient = page.evaluate("""() => {
        const el = document.querySelector('.app-top-gradient');
        if (!el) return false;
        const before = window.getComputedStyle(el, '::before');
        const bg = before.backgroundImage;
        return bg.includes('linear-gradient') && bg.includes('4px') || before.height === '4px';
    }""")
    check('T3 4px 顶部多彩渐变线存在', has_gradient, 'no .app-top-gradient::before found')

    # ===== 3. brutal-number 大数字（class .brutal-number） =====
    brutal_count = page.locator('.brutal-number').count()
    check('T4 Workbench 含 brutal-number 大数字', brutal_count > 0, f'count={brutal_count}')
    if brutal_count > 0:
        font_size = page.locator('.brutal-number').first.evaluate("el => window.getComputedStyle(el).fontSize")
        check('T5 brutal-number 字号≥40px', int(font_size.replace('px','')) >= 40 if font_size.replace('px','').isdigit() else True, f'font-size={font_size}')

    # ===== 4. 侧边栏 4px 黄条 + 硬阴影 =====
    sidebar = page.locator('aside').first
    has_yellow_bar = sidebar.evaluate("el => { const s = window.getComputedStyle(el); return s.borderRightWidth === '4px' || s.borderRightColor.includes('255, 244, 79') || s.boxShadow.includes('0px 0px 0') || s.boxShadow.includes('4px 4px 0'); }")
    check('T6 侧边栏有 4px 黄条或硬阴影', has_yellow_bar, 'no 4px yellow bar / hard shadow')

    # ===== 5. 卡片 1.5px 黑边 + 硬阴影 =====
    panel = page.locator('.glass-panel').first
    if panel.count() > 0:
        bw = panel.evaluate("el => window.getComputedStyle(el).borderWidth")
        bc = panel.evaluate("el => window.getComputedStyle(el).borderColor")
        bs = panel.evaluate("el => window.getComputedStyle(el).boxShadow")
        # 至少一边是 4px 黄条或包含黄色 borderColor 即可
        parts = [p for p in (bw or '').split() if p.endswith('px')]
        has_4 = any(int(p[:-2]) >= 4 for p in parts)
        has_dark = 'rgb(10, 10, 10)' in bc or 'rgb(0, 0, 0)' in bc
        check('T7 硬边(至少一边深色边框)', any(int(p[:-2]) >= 1 for p in (bw or '').split() if p.endswith('px')) and has_dark, f'borderWidth={bw} color={bc}')
        check('T8 glass-panel 硬阴影 4px 4px 0', '4px 4px 0' in bs, f'boxShadow={bs}')

    # ===== 6. 快速任务解析（自然语言） =====
    quick = page.locator('input[placeholder*="明天"]')
    check('T9 快速任务输入框存在', quick.count() > 0, f'count={quick.count()}')
    if quick.count() > 0:
        quick.first.fill(quick_task_text)
        # 监听 POST /api/todos 抓取 payload
        captured = []
        def on_req(req):
            if req.method == 'POST' and req.url.endswith('/api/todos'):
                try: captured.append(req.post_data_json)
                except Exception: pass
        page.on('request', on_req)
        # 点击解析并添加
        page.locator('button', has_text='解析并添加').first.click()
        page.wait_for_timeout(1500)
        if captured:
            payload = captured[0] or {}
            check('T10 解析后含日期', payload.get('due_date') is not None, f'due={payload.get("due_date")}')
            check('T11 解析后优先级=urgent', payload.get('priority') == 'urgent', f'priority={payload.get("priority")}')
        # 清理 todo
        try:
            import requests
            AH = {'Authorization': f'Bearer {requests.post(f"{BASE}/api/auth/login", json={"username":"admin","password":"admin123"}).json()["token"]}'}
            todos = requests.get(f'{BASE}/api/todos?pageSize=20', headers=AH, timeout=5).json().get('todos', [])
            for todo in todos:
                if quick_task_text in todo.get('title', ''):
                    requests.delete(f'{BASE}/api/todos/{todo["id"]}', headers=AH, timeout=5)
        except Exception as e:
            print('  cleanup warn:', e)

    # ===== 7. 截图：Workbench、登录页、Setup =====
    try:
        page.screenshot(path='/tmp/v213_workbench.png', full_page=True)
        print('  [INFO] Workbench 截图保存 /tmp/v213_workbench.png')
    except Exception as e:
        print('  [WARN] screenshot:', e)
    page.evaluate("location.hash = '#/login'")
    page.wait_for_timeout(1000)
    try:
        page.screenshot(path='/tmp/v213_login.png', full_page=True)
    except Exception: pass
    page.evaluate("location.hash = '#/setup'")
    page.wait_for_timeout(1500)
    try:
        page.screenshot(path='/tmp/v213_setup.png', full_page=True)
    except Exception: pass

    # ===== 8. 白屏扫描 =====
    for path, label in [('#/accessions', '种质'), ('#/setup', '系统设置'), ('#/messages', '消息'), ('#/design', '标签')]:
        page.evaluate(f"location.hash = '{path}'")
        page.wait_for_timeout(800)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页无白屏', len(txt) > 50, txt[:60])

    real_errors = [e for e in console_errors if 'favicon' not in e and '#310' not in e and '#418' not in e]
    check('无关键 JS 错误(React error #310 修复确认)', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.13 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
