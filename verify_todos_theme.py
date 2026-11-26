# -*- coding: utf-8 -*-
# 便签卡重设计验证：平涂纸色(无渐变) + 胶带 + 轻微旋转；截图 brutalist/classic；种入即清理
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
import requests

BASE = 'http://localhost:7800'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_tmp_todo')
os.makedirs(OUT, exist_ok=True)

COLORS = ['yellow', 'green', 'blue', 'pink', 'purple']
FLAT_RGB = {'yellow': 'rgb(255, 243, 196)', 'green': 'rgb(227, 243, 226)', 'blue': 'rgb(225, 237, 249)',
            'pink': 'rgb(251, 234, 239)', 'purple': 'rgb(238, 231, 249)'}

def api_token():
    return requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']

def set_theme(theme):
    requests.put(f'{BASE}/api/my/settings', headers={'Authorization': f'Bearer {api_token()}'}, json={'key': 'ui.theme', 'value': theme}, timeout=10)

def auth():
    # 只带认证头；POST/PUT 用 json= 时会自动加 content-type，DELETE/GET 不带 content-type 避免 Fastify 400
    return {'Authorization': f'Bearer {api_token()}'}

def create_note(color):
    r = requests.post(f'{BASE}/api/todos', headers=auth(),
                      json={'title': f'_themecheck_{color}', 'notes': '**配色验证** 平涂纸色便签', 'priority': 'normal', 'color': color}, timeout=10)
    return r.json().get('id') if r.status_code == 200 else None

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1500, 'height': 950})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    ids = []
    # 预先清理历史残留，保证幂等
    for x in requests.get(f'{BASE}/api/todos', headers=auth(), timeout=10).json().get('todos', []):
        if str(x.get('title', '')).startswith('_themecheck'):
            try: requests.delete(f'{BASE}/api/todos/{x["id"]}', headers=auth(), timeout=10)
            except Exception: pass
    try:
        for c in COLORS:
            ids.append(create_note(c))

        page.goto(BASE + '/#/login', wait_until='networkidle', timeout=30000)
        page.evaluate("localStorage.removeItem('brc_token')")
        page.reload(wait_until='networkidle'); page.wait_for_timeout(600)
        page.locator('input[type="password"]').first.wait_for(timeout=10000)
        ins = page.locator('input')
        for i in range(ins.count()):
            if (ins.nth(i).get_attribute('type') or '') != 'password':
                ins.nth(i).fill('admin'); break
        page.locator('input[type="password"]').first.fill('admin123')
        for i in range(page.locator('button').count()):
            if '登录' in (page.locator('button').nth(i).inner_text() or '').replace(' ', ''):
                page.locator('button').nth(i).click(); break
        page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)

        results = []
        def check(name, cond, detail=''):
            results.append(bool(cond))
            print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:160]) if detail and not cond else ''))

        set_theme('brutalist'); page.reload(wait_until='networkidle'); page.wait_for_timeout(800)
        page.goto(BASE + '/#/todos'); page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(OUT, 'brutalist_cards.png'))

        card_info = {}
        for c in COLORS:
            info = page.evaluate(f"""() => {{
                const el = [...document.querySelectorAll('div')].find(d => d.className.includes('break-inside-avoid') && d.innerText.includes('_themecheck_{c}'));
                if (!el) return null;
                const hasGrad = [...el.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundImage.includes('linear-gradient'));
                const tape = [...el.querySelectorAll('*')].find(e => getComputedStyle(e).backgroundImage.includes('linear-gradient'));
                return {{
                    bg: getComputedStyle(el).backgroundColor,
                    bgImage: getComputedStyle(el).backgroundImage,
                    transform: getComputedStyle(el).transform,
                    tape: tape ? getComputedStyle(tape).position : null,
                }};
            }}""")
            card_info[c] = info
            check(f'[{c}] 平涂色(无渐变) 且背景=指定色', bool(info) and info['bgImage'] == 'none' and info['bg'] == FLAT_RGB[c],
                  f'bg={info["bg"] if info else None} img={info["bgImage"] if info else None}')
            check(f'[{c}] 胶带在位(子元素渐变白条)', bool(info) and info['tape'] == 'absolute', f'tape={info["tape"] if info else None}')

        # 旋转：至少一张便签有非零旋转角
        rot_ok = any(info and info['transform'] not in ('none', 'matrix(1, 0, 0, 1, 0, 0)') for info in card_info.values())
        check('便签有轻微旋转(手工贴感)', rot_ok, f"transforms={[card_info[c]['transform'] for c in card_info if card_info[c]]}")
        # hover 转正：把真实鼠标移到第一张便签中心，触发 :hover 伪类
        box = page.locator('.break-inside-avoid').nth(0).bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.wait_for_timeout(500)
        hover_tf = page.evaluate("() => { const el = [...document.querySelectorAll('div')].find(d => d.className.includes('break-inside-avoid')); return el ? getComputedStyle(el).transform : 'NONE'; }")
        # matrix 左上 2x2 应为单位阵(旋转归零)；translation 允许 hover 上浮(-2px)
        import re as _re
        m = _re.match(r'matrix\(([-\d.e]+), ([-\d.e]+), ([-\d.e]+), ([-\d.e]+),', hover_tf or '')
        ok = m is not None and abs(float(m.group(1)) - 1) < 1e-3 and abs(float(m.group(2))) < 1e-3 and abs(float(m.group(3))) < 1e-3 and abs(float(m.group(4)) - 1) < 1e-3
        check('hover 转正(旋转归零)', ok, f'tf={hover_tf}')

        set_theme('classic'); page.reload(wait_until='networkidle'); page.wait_for_timeout(900)
        page.goto(BASE + '/#/todos'); page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(OUT, 'classic_cards.png'))
        check('控制台无 error', len(console_errors) == 0, '; '.join(console_errors[:5]))
    finally:
        set_theme('brutalist')
        # 循环删到零：GET 列表可能只返回子集，单轮清扫不净就再来，保证不残留
        for _ in range(5):
            left = [x for x in requests.get(f'{BASE}/api/todos', headers=auth(), timeout=10).json().get('todos', [])
                    if str(x.get('title', '')).startswith('_themecheck')]
            if not left: break
            for x in left:
                try: requests.delete(f'{BASE}/api/todos/{x["id"]}', headers=auth(), timeout=10)
                except Exception: pass
        browser.close()

print(f"\n{sum(results)}/{len(results)} 通过；截图目录: {OUT}")