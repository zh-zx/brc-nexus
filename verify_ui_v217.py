# -*- coding: utf-8 -*-
# v2.17 工作台控制室 UI 验证：命令栏 / .t-pod / 指挥台折线 / 状态芯片 / 实时钟 / 动效 / 两主题一致 / 快速任务契约
import sys, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
import requests

BASE = 'http://localhost:7800'

def set_theme(theme):
    try:
        tok = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']
        requests.put(f'{BASE}/api/my/settings', headers={'Authorization': f'Bearer {tok}'}, json={'key': 'ui.theme', 'value': theme}, timeout=10)
    except Exception as e:
        print('  theme set warn:', e)

# 前置：重置 brutalist（脚本间状态不互相依赖）
set_theme('brutalist')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:220]) if detail and not cond else ''))

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

quick_task_text = '明天 下午 3 点 控制室自检 紧急 @op2'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    ui_login(page)

    # ===== 0. 首页正常加载 =====
    body = page.locator('body').inner_text()
    check('W0 工作台加载(快速任务+问候+控制室)', '快速任务' in body and ('下午好' in body or '早上好' in body or '晚上好' in body) and ('控制室' in body or 'Control Room' in body), body[:160])

    # ===== 1. 命令栏 = 第一个 .glass-panel（brutalist：radius 0 + 硬阴影）=====
    panel = page.locator('.glass-panel').first
    radius = panel.evaluate("el => window.getComputedStyle(el).borderRadius")
    shadow = panel.evaluate("el => window.getComputedStyle(el).boxShadow")
    check('W1 命令栏为第一个 .glass-panel 且硬阴影 4px 4px 0', '4px 4px 0' in shadow, f'shadow={shadow}')
    check('W2 brutalist 命令栏 radius=0px', radius in ('0px', ''), f'radius={radius}')

    # ===== 2. 第一个 .brutal-number 字号≥40（hero 不被新 pod 抢位）=====
    bcount = page.locator('.brutal-number').count()
    check('W3 存在 .brutal-number', bcount > 0, f'count={bcount}')
    if bcount > 0:
        fs = page.locator('.brutal-number').first.evaluate("el => window.getComputedStyle(el).fontSize")
        check('W4 第一个 .brutal-number 字号≥40', int(re.sub(r'[^0-9]', '', fs) or 0) >= 40, f'fontSize={fs}')

    # ===== 3. 状态芯片为 <span>，文本∈{系统运行中,逾期预警} =====
    chip = page.locator('[data-testid="cr-status"]')
    check('W5 状态芯片存在', chip.count() > 0, f'count={chip.count()}')
    if chip.count() > 0:
        tag = chip.first.evaluate("el => el.tagName.toLowerCase()")
        ctext = chip.first.inner_text().strip()
        check('W6 状态芯片为 <span>（非 button）', tag == 'span', f'tag={tag}')
        check('W7 状态芯片文本合法', any(k in ctext for k in ['系统运行中', '逾期预警', 'System Nominal', 'Overdue Alert']), f'text={ctext}')

    # ===== 4. 实时钟 HH:MM:SS =====
    clock = page.locator('[data-testid="live-clock"]')
    check('W8 实时钟存在', clock.count() > 0, f'count={clock.count()}')
    if clock.count() > 0:
        ctime = clock.first.inner_text().strip()
        check('W9 实时钟格式 HH:MM:SS', bool(re.match(r'^\d{2}:\d{2}:\d{2}$', ctime)), f'clock={ctime}')

    # ===== 5. .t-pod 数量≥4 =====
    pods = page.locator('.t-pod')
    pcount = pods.count()
    check('W10 控制室卡片 .t-pod ≥4', pcount >= 4, f'count={pcount}')

    # ===== 6. 指挥台 SVG 折线存在 =====
    spark = page.locator('[data-testid="cr-sparkline"]')
    check('W11 7 日活跃度折线 svg 存在', spark.count() > 0, f'count={spark.count()}')
    if spark.count() > 0:
        has_poly = spark.first.evaluate("el => !!el.querySelector('polyline')")
        check('W12 折线含 polyline 描边', has_poly, 'no polyline')

    # ===== 7. hover .t-pod → transform translate + ::after opacity→1 =====
    if pcount > 0:
        target = pods.first
        before = target.evaluate("el => window.getComputedStyle(el).transform")
        target.hover()
        page.wait_for_timeout(400)
        after = target.evaluate("el => { const s = window.getComputedStyle(el); const a = window.getComputedStyle(el, '::after'); return { t: s.transform, o: a.opacity }; }")
        moved = after['t'] not in ('none', before) and 'matrix' in after['t']
        check('W13 hover .t-pod 发生 translateY 抬升', moved, f'before={before} after={after["t"]}')
        check('W14 hover .t-pod ::after opacity→1', float(after['o']) > 0.5, f'opacity={after["o"]}')
        page.mouse.move(10, 10)

    # ===== 8. reduced-motion 关闭装饰动画 =====
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_timeout(200)
    cranim = page.evaluate("""() => {
        const el = document.querySelector('.cr-ping') || document.querySelector('[class*="cr-ping"]');
        if (!el) return 'none';
        return window.getComputedStyle(el).animationName;
    }""")
    check('W15 reduced-motion 下 cr-ping 停用', cranim in ('none', 'null'), f'animationName={cranim}')
    page.emulate_media(reduced_motion='no-preference')
    page.wait_for_timeout(200)

    # ===== 9. 快速任务契约：POST /api/todos 带 due_date + priority=urgent =====
    quick = page.locator('input[placeholder*="明天"]')
    check('W16 快速任务输入框存在(含 明天)', quick.count() > 0, f'count={quick.count()}')
    if quick.count() > 0:
        quick.first.fill(quick_task_text)
        captured = []
        def on_req(req):
            if req.method == 'POST' and req.url.endswith('/api/todos'):
                try: captured.append(req.post_data_json)
                except Exception: pass
        page.on('request', on_req)
        page.locator('button', has_text='解析并添加').first.click()
        page.wait_for_timeout(1500)
        if captured:
            payload = captured[0] or {}
            check('W17 解析后含 due_date', payload.get('due_date') is not None, f'due={payload.get("due_date")}')
            check('W18 解析后 priority=urgent', payload.get('priority') == 'urgent', f'priority={payload.get("priority")}')
        else:
            check('W17 解析后含 due_date', False, 'no POST captured')
        # 清理
        try:
            AH = {'Authorization': f'Bearer {requests.post(f"{BASE}/api/auth/login", json={"username":"admin","password":"admin123"}).json()["token"]}'}
            todos = requests.get(f'{BASE}/api/todos?pageSize=20', headers=AH, timeout=5).json().get('todos', [])
            for todo in todos:
                if quick_task_text in todo.get('title', ''):
                    requests.delete(f'{BASE}/api/todos/{todo["id"]}', headers=AH, timeout=5)
        except Exception as e:
            print('  cleanup warn:', e)

    # ===== 10. classic 主题一致性 =====
    set_theme('classic')
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(1500)
    cpanel = page.locator('.glass-panel').first
    cbg = cpanel.evaluate("el => window.getComputedStyle(el).backgroundColor")
    crad = cpanel.evaluate("el => window.getComputedStyle(el).borderRadius")
    check('W19 classic 命令栏背景 rgba（非实底）', 'rgba' in cbg, f'bg={cbg}')
    check('W20 classic 命令栏 radius=1rem', crad in ('16px', '1rem'), f'radius={crad}')
    cpod = page.locator('.t-pod').first
    if page.locator('.t-pod').count() > 0:
        cpod_shadow = cpod.evaluate("el => window.getComputedStyle(el, '::after').boxShadow")
        check('W21 classic .t-pod ::after 绿柔影 rgba(46, 125, 50', '46, 125, 50' in cpod_shadow, f'shadow={cpod_shadow}')
    # 收尾：重置 brutalist，避免污染后续脚本
    set_theme('brutalist')

    # ===== 11. 无关键 JS 错误 =====
    real_errors = [e for e in console_errors if 'favicon' not in e and '#310' not in e and '#418' not in e]
    check('W22 无关键 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.17 控制室 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
