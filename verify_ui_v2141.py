# -*- coding: utf-8 -*-
# v2.14.1 验证：全站控件归一（button/input/tab 在 brutalist/classic 两主题下形状与配色一致）
# 策略：不依赖具体按钮文本，按 className 子串（与 index.css 选择器同语义）扫描全部 <button>
import sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
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

def goto(page, path):
    page.evaluate(f"location.hash = '{path}'")
    page.wait_for_timeout(800)

def btn_style(page, i):
    return page.locator('button').nth(i).evaluate("""el => {
        const s = getComputedStyle(el);
        return { r: s.borderRadius, bw: s.borderTopWidth, bc: s.borderTopColor, sh: s.boxShadow };
    }""")

def scan_buttons(page, theme):
    """按 className 子串分类扫描全部按钮（与 index.css 选择器语义一致）
    注意：本机 headless Chromium 会把 border-width 向下取整到整数设备像素
    （实测 1.5px→1px、2.5px→2px），因此 brutalist 宽度断言容忍 1/1.5/2px 三值，
    由「颜色=纯黑 + 样式表声明 1.5px」双条件保底。"""
    agg = {'total': 0, 'radius_bad': [], 'bg': 0, 'bg_border_bad': [], 'solid': 0, 'solid_shadow_bad': []}
    n = page.locator('button').count()
    agg['total'] = n
    for i in range(n):
        b = page.locator('button').nth(i)
        cls = b.get_attribute('class') or ''
        st = btn_style(page, i)
        is_toggle_seg = bool(b.evaluate("el => !!el.closest('.t-theme-toggle')"))
        exp_r = '9999px' if (is_toggle_seg and theme == 'classic') else ('0px' if theme == 'brutalist' else '16px')
        if st['r'] != exp_r:
            agg['radius_bad'].append(f"{st['r']}|{cls[:46]}")
        has_bg = 'bg-' in cls
        has_border_cls = 'border' in cls
        if has_bg or has_border_cls:
            agg['bg'] += 1
            if theme == 'brutalist':
                if st['bw'] not in ('1px', '1.5px', '2px') or st['bc'] != 'rgb(10, 10, 10)':
                    agg['bg_border_bad'].append(f"{st['bw']}/{st['bc']}|{cls[:46]}")
            else:
                if st['bw'] != '1px' or st['bc'] != 'rgba(46, 125, 50, 0.25)':
                    agg['bg_border_bad'].append(f"{st['bw']}/{st['bc']}|{cls[:46]}")
        solid = has_bg and any(k in cls for k in ('-500', '-600', '-700', '-800', '-900', 'bg-black', 'bg-ink'))
        if solid:
            agg['solid'] += 1
            hard = '4px 4px 0' in st['sh']
            if theme == 'brutalist' and not hard:
                agg['solid_shadow_bad'].append(f"no hard shadow|{cls[:46]}")
            if theme == 'classic' and hard:
                agg['solid_shadow_bad'].append(f"hard shadow leaked|{cls[:46]}")
    return agg

def scan_inputs(page, theme):
    """glass-input 输入框：主题下形状/边框一致（宽度同样容忍整数像素量化）"""
    bad = []; total = 0
    for sel in ('input.glass-input', 'select', 'textarea'):
        for i in range(page.locator(sel).count()):
            el = page.locator(sel).nth(i)
            cls = el.get_attribute('class') or ''
            if 'bg-transparent' in cls or 'border-none' in cls:
                continue  # 透明内嵌输入（登录框内层等）按设计保持无边框
            st = el.evaluate("el => { const s = getComputedStyle(el); return { r: s.borderRadius, bw: s.borderTopWidth, bc: s.borderTopColor }; }")
            total += 1
            if theme == 'brutalist':
                if st['r'] != '0px' or st['bw'] not in ('1px', '1.5px', '2px') or st['bc'] != 'rgb(10, 10, 10)':
                    bad.append(f"{st['r']}/{st['bw']}/{st['bc']}|{(el.get_attribute('class') or '')[:40]}")
            else:
                if st['r'] != '16px' or st['bw'] != '1px' or st['bc'] != 'rgba(46, 125, 50, 0.15)':
                    bad.append(f"{st['r']}/{st['bw']}/{st['bc']}|{(el.get_attribute('class') or '')[:40]}")
    return total, bad

PAGES = [('#/', '工作台'), ('#/db', '数据库'), ('#/accessions', '种质'), ('#/setup', '设置'), ('#/orders', '工单')]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    ui_login(page)
    # 确保起点是 brutalist（上次会话可能残留 classic）
    if page.evaluate("() => document.documentElement.dataset.theme") != 'brutalist':
        page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.click()
        page.wait_for_timeout(500)

    # ===== BRUTALIST 扫描 =====
    agg_b = {'total': 0, 'radius_bad': [], 'bg': 0, 'bg_border_bad': [], 'solid': 0, 'solid_shadow_bad': []}
    in_bad = []; in_total = 0; white_bad = []
    for path, label in PAGES:
        goto(page, path)
        txt = page.locator('body').inner_text().strip()
        if len(txt) <= 50: white_bad.append(f'{label}:{txt[:40]}')
        a = scan_buttons(page, 'brutalist')
        for k in ('total', 'bg', 'solid'): agg_b[k] += a[k]
        for k in ('radius_bad', 'bg_border_bad', 'solid_shadow_bad'): agg_b[k] += a[k]
        t, b2 = scan_inputs(page, 'brutalist')
        in_total += t; in_bad += b2
    check('B1 brutalist 全部按钮圆角=0（含标签页）', len(agg_b['radius_bad']) == 0, agg_b['radius_bad'][:3])
    check('B2 带 bg/border 类的按钮均为 1.5px 黑硬边', agg_b['bg'] > 0 and len(agg_b['bg_border_bad']) == 0, agg_b['bg_border_bad'][:3] or f'bg_buttons={agg_b["bg"]}')
    check('B3 实色按钮带 4px 4px 0 硬投影', agg_b['solid'] > 0 and len(agg_b['solid_shadow_bad']) == 0, agg_b['solid_shadow_bad'][:3] or f'solid={agg_b["solid"]}')
    check('B4 输入框 0 圆角 + 黑边', in_total > 0 and len(in_bad) == 0, in_bad[:3] or f'inputs={in_total}')
    declared = page.evaluate("""() => {
        for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch(e) { continue; }
            const walk = (rs) => {
                for (const r of rs) {
                    try { if ((r.cssText || '').includes('1.5px solid var(--ink)')) return true; } catch(e) {}
                    if (r.cssRules && walk(r.cssRules)) return true;
                }
                return false;
            };
            if (walk(rules)) return true;
        }
        return false;
    }""")
    check('B4b 样式表声明含 1.5px 黑硬边规则（宽度量化保底）', declared)
    check('B5 各页 brutalist 无白屏', len(white_bad) == 0, white_bad[:2])

    # ===== 截图 brutalist =====
    try:
        page.screenshot(path='/tmp/v2141_brutalist.png', full_page=True)
        print('  [INFO] brutalist 截图 /tmp/v2141_brutalist.png')
    except Exception as e:
        print('  [WARN] screenshot:', e)

    # ===== 切 CLASSIC =====
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click()
    page.wait_for_timeout(1000)
    check('C0 切到 classic（dataset.theme）', page.evaluate("() => document.documentElement.dataset.theme") == 'classic')

    agg_c = {'total': 0, 'radius_bad': [], 'bg': 0, 'bg_border_bad': [], 'solid': 0, 'solid_shadow_bad': []}
    in_bad_c = []; in_total_c = 0; white_bad_c = []
    found_teal_indigo = {'found': 0, 'bad': []}
    found_purple_bg = {'found': 0, 'bad': []}
    for path, label in PAGES:
        goto(page, path)
        txt = page.locator('body').inner_text().strip()
        if len(txt) <= 50: white_bad_c.append(f'{label}:{txt[:40]}')
        a = scan_buttons(page, 'classic')
        for k in ('total', 'bg', 'solid'): agg_c[k] += a[k]
        for k in ('radius_bad', 'bg_border_bad', 'solid_shadow_bad'): agg_c[k] += a[k]
        t, b2 = scan_inputs(page, 'classic')
        in_total_c += t; in_bad_c += b2
        # C4：未收录色系按钮在 classic 下必须已归绿（bg 阴影用锚定匹配，避免 text-teal-600 误触发）
        for i in range(page.locator('button').count()):
            cls = page.locator('button').nth(i).get_attribute('class') or ''
            for fam in ('teal', 'indigo', 'sky', 'orange', 'purple', 'pink', 'violet'):
                text_col = f'text-{fam}-' in cls
                solid_bg = any(f'bg-{fam}-{sh}' in cls for sh in ('500', '600', '700', '800', '900'))
                if text_col or solid_bg:
                    found_teal_indigo['found'] += 1
                    if text_col:
                        c = page.locator('button').nth(i).evaluate("el => getComputedStyle(el).color")
                        if c != 'rgb(46, 125, 50)':
                            found_teal_indigo['bad'].append(f'{cls[:46]}->c:{c}')
                    if solid_bg:
                        bg = page.locator('button').nth(i).evaluate("el => getComputedStyle(el).backgroundColor")
                        if bg != 'rgb(46, 125, 50)':
                            found_teal_indigo['bad'].append(f'{cls[:46]}->bg:{bg}')
    check('C1 classic 全部按钮圆角=16px（切换器药丸除外）', len(agg_c['radius_bad']) == 0, agg_c['radius_bad'][:3])
    check('C2 带 bg/border 类的按钮均为 1px 绿柔边', agg_c['bg'] > 0 and len(agg_c['bg_border_bad']) == 0, agg_c['bg_border_bad'][:3] or f'bg_buttons={agg_c["bg"]}')
    check('C3 无硬投影残留（4px 4px 0 消失）', len(agg_c['solid_shadow_bad']) == 0, agg_c['solid_shadow_bad'][:3])
    check('C4 teal/indigo 等漏收色系已归主题绿', found_teal_indigo['found'] > 0 and len(found_teal_indigo['bad']) == 0, found_teal_indigo['bad'][:3] or f'found={found_teal_indigo["found"]}')
    check('C5 输入框 16px 圆角 + 1px 绿柔边', in_total_c > 0 and len(in_bad_c) == 0, in_bad_c[:3] or f'inputs={in_total_c}')
    check('C6 主题切换器药丸（9999px）', page.locator('.t-theme-toggle').first.evaluate("el => getComputedStyle(el).borderRadius") == '9999px')
    check('C7 classic 各页无白屏', len(white_bad_c) == 0, white_bad_c[:2])

    try:
        page.screenshot(path='/tmp/v2141_classic.png', full_page=True)
        print('  [INFO] classic 截图 /tmp/v2141_classic.png')
    except Exception as e:
        print('  [WARN] screenshot:', e)

    # 切回 brutalist 保持环境整洁
    page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.click()
    page.wait_for_timeout(500)

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e and '#310' not in e and '#418' not in e]
    check('无关键 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.14.1 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)