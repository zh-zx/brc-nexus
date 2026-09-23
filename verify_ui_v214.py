# -*- coding: utf-8 -*-
# v2.14 验证：两主题切换 + 持久化 + 关键页 retint + 设计系统统一
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

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    ui_login(page)
    body = page.locator('body').inner_text()
    check('T1 登录后默认 brutalist 主题', page.evaluate("() => document.documentElement.dataset.theme") in (None, 'brutalist'), f'data-theme={page.evaluate("() => document.documentElement.dataset.theme")}')
    check('T2 顶栏主题切换器两段', page.locator('.t-theme-toggle').count() == 1, f'count={page.locator(".t-theme-toggle").count()}')
    check('T3 顶栏 BRUTALIST 段有 data-active', page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.get_attribute('data-active') == 'true')

    # 验证 brutalist 视觉：4px 黄条强调 + 黄底 LOGIN 类
    workbench_card = page.locator('.glass-panel').first
    brutalist_bw = workbench_card.evaluate("el => window.getComputedStyle(el).borderRadius")
    check('T4 brutalist 卡片 borderRadius=0', brutalist_bw == '0px', f'borderRadius={brutalist_bw}')

    # ===== 切到 classic =====
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click()
    page.wait_for_timeout(800)
    check('T5 切到 classic 后 dataset.theme=classic', page.evaluate("() => document.documentElement.dataset.theme") == 'classic')

    classic_bw = workbench_card.evaluate("el => window.getComputedStyle(el).borderRadius")
    check('T6 classic 卡片 borderRadius=1rem', classic_bw == '16px', f'borderRadius={classic_bw}')
    classic_shadow = workbench_card.evaluate("el => window.getComputedStyle(el).boxShadow")
    check('T7 classic 卡片软阴影(非 4px 4px 0)', '4px 4px 0' not in classic_shadow, f'shadow={classic_shadow[:80]}')
    classic_bg = workbench_card.evaluate("el => window.getComputedStyle(el).backgroundColor")
    check('T8 classic 卡片非纯白', classic_bg != 'rgb(255, 255, 255)' and 'rgba' in classic_bg, f'bg={classic_bg}')

    # 切回 brutalist
    page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.click()
    page.wait_for_timeout(500)
    check('T9 切回 brutalist 卡片 borderRadius=0', workbench_card.evaluate("el => window.getComputedStyle(el).borderRadius") == '0px')

    # 持久化测试
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click()
    page.wait_for_timeout(2000)  # 给 putMySettings 留足时间落地
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(2500)  # 给 ThemeProvider 启动 + getMySettings 读取留时间
    check('T10 刷新后持久化为 classic', page.evaluate("() => document.documentElement.dataset.theme") == 'classic', f'data-theme={page.evaluate("() => document.documentElement.dataset.theme")}')

    # 切回 brutalist 让其他测试不打扰
    page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.click()
    page.wait_for_timeout(2000)  # 等 putMySettings 落地，避免后续脚本登录后读到残留 classic

    # ===== 多页白屏 + 无控制台错误 =====
    for path, label in [('#/accessions', '种质'), ('#/setup', '系统设置'), ('#/messages', '消息'), ('#/orders', '工单')]:
        page.evaluate(f"location.hash = '{path}'")
        page.wait_for_timeout(800)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页 brutalist 无白屏', len(txt) > 50, txt[:60])

    # 切到 classic 再扫一遍
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click()
    page.wait_for_timeout(500)
    for path, label in [('#/accessions', '种质'), ('#/setup', '系统设置')]:
        page.evaluate(f"location.hash = '{path}'")
        page.wait_for_timeout(800)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页 classic 无白屏', len(txt) > 50, txt[:60])

    # 截图
    page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.click()
    page.wait_for_timeout(2000)  # 收尾持久化等待：避免 browser.close 截断 putMySettings，残留 classic 影响后续脚本
    page.evaluate("location.hash = '#/'")
    page.wait_for_timeout(1500)
    try:
        page.screenshot(path='/tmp/v214_brutalist.png', full_page=True)
    except Exception: pass
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click()
    page.wait_for_timeout(500)
    try:
        page.screenshot(path='/tmp/v214_classic.png', full_page=True)
    except Exception: pass

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e and '#310' not in e and '#418' not in e]
    check('无关键 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.14 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
