# -*- coding: utf-8 -*-
# v2.18 全局设计精修 UI 验证：语义 token（tone/eyebrow/page-title/num/focus/elevation）+ 两主题一致 + 冻结不变量复断言
import sys, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
import requests

BASE = 'http://localhost:7800'

def api_token():
    return requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']

def set_theme(theme):
    try:
        requests.put(f'{BASE}/api/my/settings', headers={'Authorization': f'Bearer {api_token()}'}, json={'key': 'ui.theme', 'value': theme}, timeout=10)
    except Exception as e:
        print('  theme set warn:', e)

# 前置：重置 brutalist
set_theme('brutalist')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:220]) if detail and not cond else ''))

def ui_login(page):
    page.goto(BASE + '/#/login', wait_until='networkidle', timeout=30000)
    page.evaluate("localStorage.removeItem('brc_token')")
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(600)
    pw = page.locator('input[type="password"]').first
    pw.wait_for(timeout=10000)
    ins = page.locator('input')
    for i in range(ins.count()):
        if (ins.nth(i).get_attribute('type') or '') != 'password':
            ins.nth(i).fill('admin'); break
    pw.fill('admin123')
    for i in range(page.locator('button').count()):
        t = (page.locator('button').nth(i).inner_text() or '').replace(' ', '')
        if '登录' in t:
            page.locator('button').nth(i).click(); break
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)

def go_hash(page, h):
    page.evaluate(f"location.hash = '{h}'"); page.wait_for_load_state('networkidle'); page.wait_for_timeout(1200)

def rgb_tuple(s):
    m = re.findall(r'\d+', s or '')
    return tuple(int(x) for x in m[:3]) if len(m) >= 3 else None

quick_task_text = '明天 下午 4 点 v218精修自检 紧急 @op2'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    ui_login(page)  # 落在工作台（brutalist）

    # ===== 1. 冻结不变量：第一个 .glass-panel（命令栏）brutalist 硬阴影 + radius 0 =====
    panel = page.locator('.glass-panel').first
    shadow = panel.evaluate("el => window.getComputedStyle(el).boxShadow")
    radius = panel.evaluate("el => window.getComputedStyle(el).borderRadius")
    check('X1 brutalist 命令栏硬阴影 4px 4px 0 保留', '4px 4px 0' in shadow, f'shadow={shadow}')
    check('X2 brutalist 命令栏 radius=0 保留', radius in ('0px', ''), f'radius={radius}')

    # ===== 2. 冻结不变量：第一个 .brutal-number 字号≥40 =====
    bcount = page.locator('.brutal-number').count()
    check('X3 存在 .brutal-number', bcount > 0, f'count={bcount}')
    if bcount > 0:
        fs = page.locator('.brutal-number').first.evaluate("el => window.getComputedStyle(el).fontSize")
        check('X4 第一个 .brutal-number 字号≥40', int(re.sub(r'[^0-9]', '', fs) or 0) >= 40, f'fontSize={fs}')

    # ===== 3. 冻结不变量：工作台 body 含 快速任务 + 问候 =====
    body = page.locator('body').inner_text()
    check('X5 工作台含 快速任务+问候', '快速任务' in body and ('下午好' in body or '早上好' in body or '晚上好' in body), body[:120])

    # ===== 4. acid token 精修锁定 #FFE24A =====
    acid = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--acid').trim()")
    check('X6 --acid 精修为 #FFE24A', acid.upper() == '#FFE24A', f'acid={acid}')

    # ===== 5. .t-page-title brutalist = uppercase + 900 =====
    pt = page.locator('.t-page-title')
    check('X7 存在 .t-page-title(工作台 h1)', pt.count() > 0, f'count={pt.count()}')
    if pt.count() > 0:
        tb = pt.first.evaluate("el => { const s = window.getComputedStyle(el); return { tt: s.textTransform, fw: s.fontWeight, col: s.color }; }")
        check('X8 brutalist .t-page-title 大写', tb['tt'] == 'uppercase', f'transform={tb["tt"]}')
        check('X9 brutalist .t-page-title 字重≥800', int(re.sub(r'[^0-9]', '', tb['fw']) or 0) >= 800, f'fw={tb["fw"]}')

    # ===== 6. .t-eyebrow 字体栈含 mono =====
    eb = page.locator('.t-eyebrow')
    check('X10 存在 .t-eyebrow(命令栏/页头)', eb.count() > 0, f'count={eb.count()}')
    if eb.count() > 0:
        eff = eb.first.evaluate("el => window.getComputedStyle(el).fontFamily").lower()
        ls = eb.first.evaluate("el => window.getComputedStyle(el).letterSpacing")
        check('X11 .t-eyebrow 字体栈含 mono', 'mono' in eff, f'font={eff[:60]}')
        check('X12 .t-eyebrow 字距放宽(≥0.1em 生效)', float(re.sub(r'[^0-9.]', '', ls) or 0) >= 1.5, f'letterSpacing={ls}')

    # ===== 7. 输入框 focus 出现 focus ring（真实生效类为 .glass-input；.t-input 为无 JSX 引用的死类，会被 Tailwind 摇树剔除）=====
    fr = page.evaluate("""async () => {
        const el = document.createElement('input');
        el.className = 'glass-input'; el.type = 'text';
        el.style.transition = 'none';  // 绕开 transition:all 造成的过渡中途值
        document.body.appendChild(el);
        el.focus();
        const sh = window.getComputedStyle(el).boxShadow;
        const isFocus = el.matches(':focus');
        el.remove();
        return { sh: sh, isFocus: isFocus };
    }""")
    check('X13 .glass-input:focus 渲染 focus ring', bool(fr['isFocus']) and fr['sh'] and fr['sh'] != 'none' and 'rgba' in fr['sh'], f"shadow={fr['sh']} isFocus={fr['isFocus']}")

    # ===== 8. Orders：tone 徽章 + .t-num =====
    go_hash(page, '#/orders')
    tw = page.locator('.tone-warn')
    check('X14 Orders 存在 .tone-warn 徽章', tw.count() > 0, f'count={tw.count()}')
    if tw.count() > 0:
        s = tw.first.evaluate("el => { const c = window.getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color }; }")
        bt, ft = rgb_tuple(s['bg']), rgb_tuple(s['fg'])
        check('X15 brutalist .tone-warn 背景非纯白', bt and bt != (255, 255, 255), f'bg={s["bg"]}')
        check('X16 brutalist .tone-warn 前景≠背景', bt and ft and bt != ft, f'bg={s["bg"]} fg={s["fg"]}')

    tk = page.locator('.tone-ok')
    if tk.count() > 0:
        s = tk.first.evaluate("el => { const c = window.getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color }; }")
        bt, ft = rgb_tuple(s['bg']), rgb_tuple(s['fg'])
        check('X17 brutalist .tone-ok 前景≠背景', bt and ft and bt != ft, f'bg={s["bg"]} fg={s["fg"]}')

    # .t-num 生效 tabular-nums（注入法确定验证，不依赖 Orders 是否有数据行）
    tnum = page.evaluate("""() => {
        const el = document.createElement('span');
        el.className = 't-num'; el.textContent = 'WO-0007';
        document.body.appendChild(el);
        const s = window.getComputedStyle(el);
        const r = { fvn: s.fontVariantNumeric, ff: s.fontFamily };
        el.remove();
        return r;
    }""")
    check('X18 .t-num 生效 tabular-nums', 'tabular-nums' in tnum['fvn'], f'fvn={tnum["fvn"]}')
    check('X19 .t-num 字体栈含 mono', 'mono' in tnum['ff'].lower(), f'font={tnum["ff"][:60]}')

    # ===== 9. classic 主题：page-title 衬线 + 卡片无 4px4px0 + tone 非白底 =====
    set_theme('classic')
    page.reload(wait_until='networkidle'); page.wait_for_timeout(1200)  # 主题在服务端设置，须整页重载才会应用
    go_hash(page, '#/orders')
    cpt = page.locator('.t-page-title')
    if cpt.count() > 0:
        s = cpt.first.evaluate("el => { const c = window.getComputedStyle(el); return { ff: c.fontFamily, tt: c.textTransform }; }")
        check('X20 classic .t-page-title 衬线族(Georgia)', 'georgia' in s['ff'].lower(), f'font={s["ff"][:60]}')
        check('X21 classic .t-page-title 非大写', s['tt'] == 'none', f'transform={s["tt"]}')

    ctw = page.locator('.tone-warn')
    if ctw.count() > 0:
        s = ctw.first.evaluate("el => { const c = window.getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color }; }")
        bt, ft = rgb_tuple(s['bg']), rgb_tuple(s['fg'])
        check('X22 classic .tone-warn 背景非纯白', bt and bt != (255, 255, 255), f'bg={s["bg"]}')
        check('X23 classic .tone-warn 前景≠背景', bt and ft and bt != ft, f'bg={s["bg"]} fg={s["fg"]}')

    # classic 下任何卡片阴影不得含 brutalist 招牌 4px 4px 0
    any_hard = page.evaluate("""() => {
        const els = document.querySelectorAll('.glass-panel, .glass-card, [class*="card"]');
        for (const el of els) { if ((window.getComputedStyle(el).boxShadow || '').includes('4px 4px 0')) return window.getComputedStyle(el).boxShadow; }
        return '';
    }""")
    check('X24 classic 卡片无 4px 4px 0 硬阴影', any_hard == '', f'found={any_hard}')

    # classic 命令栏（第一个 .glass-panel）rgba 底 + radius 1rem
    go_hash(page, '#/')
    cp = page.locator('.glass-panel').first
    cbg = cp.evaluate("el => window.getComputedStyle(el).backgroundColor")
    crad = cp.evaluate("el => window.getComputedStyle(el).borderRadius")
    check('X25 classic 命令栏 rgba 底(非实白)', 'rgba' in cbg and '255, 255, 255, 1)' not in cbg, f'bg={cbg}')
    check('X26 classic 命令栏 radius=1rem', crad in ('16px', '1rem'), f'radius={crad}')

    # ===== 10. 快速任务契约 POST /api/todos 带 due_date + urgent =====
    quick = page.locator('input[placeholder*="明天"]')
    check('X27 快速任务输入框存在(含 明天)', quick.count() > 0, f'count={quick.count()}')
    if quick.count() > 0:
        quick.first.fill(quick_task_text)
        captured = []
        page.on('request', lambda req: captured.append(req.post_data_json) if (req.method == 'POST' and req.url.endswith('/api/todos')) else None)
        page.locator('button', has_text='解析并添加').first.click()
        page.wait_for_timeout(1500)
        if captured:
            payload = captured[0] or {}
            check('X28 解析后含 due_date', payload.get('due_date') is not None, f'due={payload.get("due_date")}')
            check('X29 解析后 priority=urgent', payload.get('priority') == 'urgent', f'priority={payload.get("priority")}')
        else:
            check('X28 解析后含 due_date', False, 'no POST captured')
        try:
            AH = {'Authorization': f'Bearer {api_token()}'}
            todos = requests.get(f'{BASE}/api/todos?pageSize=20', headers=AH, timeout=5).json().get('todos', [])
            for todo in todos:
                if quick_task_text in todo.get('title', ''):
                    requests.delete(f'{BASE}/api/todos/{todo["id"]}', headers=AH, timeout=5)
        except Exception as e:
            print('  cleanup warn:', e)

    # 收尾：重置 brutalist
    set_theme('brutalist')

    # ===== 11. 无关键 JS 错误 =====
    real_errors = [e for e in console_errors if 'favicon' not in e and '#310' not in e and '#418' not in e]
    check('X30 无关键 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.18 设计精修 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
