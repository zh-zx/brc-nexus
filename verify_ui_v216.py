# -*- coding: utf-8 -*-
# v2.16 UI 验证：全站形状归一（brutalist 圆角/阴影强制 + classic 补收） + 多维表格飞书化形态
import sys, time, os, sqlite3, requests
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'server', 'data', 'brc.db')

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
        txt = (page.locator('button').nth(i).inner_text() or '').replace(' ', '')
        if '登录' in txt:
            page.locator('button').nth(i).click(); break
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)

def sql(query, params=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(query, params).fetchall()
    finally:
        conn.close()

def open_bitable(page):
    page.evaluate("location.hash = '#/accessions'")
    page.wait_for_timeout(900)
    page.locator('[data-testid="open-bitable"]').first.click()
    page.wait_for_timeout(1500)

def visible_text(page):
    return page.locator('[data-testid="bitable-root"]').inner_text()

def cs(page, sel, prop):
    """computed style of first matching element"""
    el = page.locator(sel).first
    return el.evaluate("(el, p) => getComputedStyle(el)[p]", prop)

def row_hover(page, pid='CIP-001'):
    page.locator(f'[data-pid="{pid}"]').first.hover()
    page.wait_for_timeout(450)

def mouse_away(page):
    # 顶部工具条空白区（非任何数据行/沟槽内），避免误触 group-hover/row
    page.mouse.move(720, 30)
    page.wait_for_timeout(450)

def make_filter_chip(page, value='Ipomoea'):
    page.locator('[data-testid="bt-filter-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-add-filter"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-filter-field"]').click(); page.wait_for_timeout(300)
    page.locator('[data-pick="species"]').first.click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-panel-filter"] input[placeholder="值"]').fill(value)
    page.wait_for_timeout(1200)

def remove_filter_chip(page):
    if page.locator('[data-chip="filter"]').count():
        page.locator('[data-chip="filter"] button').last.click(); page.wait_for_timeout(1000)
    if page.locator('[data-testid="bt-panel-filter"]').count():
        page.locator('[data-testid="bt-filter-btn"]').click(); page.wait_for_timeout(200)

def open_nf_dialog(page):
    page.locator('[data-testid="bt-add-field"]').click(); page.wait_for_timeout(500)
    return page.locator('[data-testid="bt-add-field-dialog"]')

def close_nf_dialog(page):
    page.locator('[data-testid="bt-add-field-dialog"] button').first.click()
    page.wait_for_timeout(400)

# ---- 前置：主题 + 用户 + 期望值 ----
admin_tok = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']
AH = {'Authorization': f'Bearer {admin_tok}'}
requests.put(f'{BASE}/api/my/settings', headers=AH, json={'key': 'ui.theme', 'value': 'brutalist'}, timeout=10)
r = requests.post(f'{BASE}/api/users', headers=AH, json={'username': 'v215_reg', 'password': 'test123', 'displayName': 'V215监管方', 'role': 'user', 'userType': 'regulator'}, timeout=10)
assert r.status_code == 200 or '已存在' in r.text, f'v215_reg 创建失败: {r.status_code} {r.text[:100]}'

EXPECT_TOTAL = sql('SELECT COUNT(*) FROM accession')[0][0]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())

    ui_login(page)

    # ═══════════ BRUTALIST（默认主题）═══════════
    page.evaluate("location.hash = '#/accessions'"); page.wait_for_timeout(900)

    # N1 入口按钮 brutalist 直角
    r1 = cs(page, '[data-testid="open-bitable"]', 'borderRadius')
    check('N1a open-bitable brutalist radius=0px', r1 == '0px', r1)

    open_bitable(page)
    check('N1b overlay 打开', page.locator('[data-testid="bitable-root"]').count() == 1)

    # N1c 飞书视图标签栏
    tab = page.locator('[data-testid="bt-view-tab"]')
    check('N1c 视图标签(表格)存在', tab.count() == 1 and '表格' in tab.inner_text(), tab.inner_text()[:40] if tab.count() else 'missing')

    # N1d 表头行 1px 细分隔线（不再是 1.5px 纯墨）
    hdr = page.locator('[data-col="primaryId"]').first.evaluate("el => { const s = getComputedStyle(el.parentElement); return s.borderBottomWidth + '|' + s.borderBottomColor; }")
    check('N1d 表头底线 1px 且非纯墨', hdr.startswith('1px') and 'rgb(10, 10, 10)' not in hdr, hdr)

    # N1e 数据单元格列分隔线 1px
    cell = page.locator('[data-pid="CIP-001"] [data-cell="origin"]').first
    cw = cell.evaluate("el => { const s = getComputedStyle(el); return s.borderRightWidth + '|' + s.borderRightColor; }")
    check('N1e 列分隔线 1px 且非纯墨', cw.startswith('1px') and 'rgb(10, 10, 10)' not in cw, cw)

    # N2 行沟槽 hover 显现 checkbox
    mouse_away(page)
    chk = page.locator('[data-pid="CIP-001"] [data-testid="bt-row-check"]').first
    o_before = chk.evaluate("el => getComputedStyle(el).opacity")
    check('N2a 初始 checkbox 隐藏', o_before == '0', o_before)
    row_hover(page)
    o_hover = chk.evaluate("el => getComputedStyle(el).opacity")
    check('N2b 悬停行后 checkbox 显现', o_hover == '1', o_hover)
    mouse_away(page)
    o_after = chk.evaluate("el => getComputedStyle(el).opacity")
    check('N2c 移开后 checkbox 复隐', o_after == '0', o_after)

    # N3 列头 hover 显现菜单按钮
    menu = page.locator('[data-col="species"] .bt-menu-btn').first
    mo_before = menu.evaluate("el => getComputedStyle(el).opacity")
    page.locator('[data-col="species"]').first.hover(); page.wait_for_timeout(450)
    mo_hover = menu.evaluate("el => getComputedStyle(el).opacity")
    check('N3 列头菜单 hover 显现', mo_before == '0' and mo_hover == '1', f'{mo_before} -> {mo_hover}')
    mouse_away(page)

    # N4 MCPD 徽章 brutalist 警示黄
    mbg = cs(page, '[data-testid="bt-mcpd-primaryId"]', 'backgroundColor')
    check('N4a MCPD 徽章 brutalist bg #FDE68A', mbg == 'rgb(253, 230, 138)', mbg)

    # N5 条件 chip brutalist 直角
    make_filter_chip(page)
    n_ipo = sql("SELECT COUNT(*) FROM accession WHERE species LIKE '%Ipomoea%'")[0][0]
    check('N5a 筛选后总数', f'共 {n_ipo} 条' in visible_text(page), visible_text(page)[:80])
    cr = cs(page, '[data-chip="filter"]', 'borderRadius')
    check('N5b chip brutalist radius=0px', cr == '0px', cr)
    remove_filter_chip(page)
    check('N5c 移除筛选恢复', f'共 {EXPECT_TOTAL} 条' in visible_text(page), visible_text(page)[:80])

    # N6 新增字段弹窗 brutalist 硬阴影（4px4px0 墨色）
    dlg = open_nf_dialog(page)
    bsh = cs(page, '[data-testid="bt-add-field-dialog"]', 'boxShadow')
    check('N6 弹窗 brutalist 硬阴影 rgb(10,10,10)', 'rgb(10, 10, 10)' in bsh, bsh)
    close_nf_dialog(page)

    try:
        page.screenshot(path='/tmp/v216_bitable_brutalist.png', full_page=False)
    except Exception:
        pass

    # ═══════════ 切到 CLASSIC ═══════════
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(600)
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click(); page.wait_for_timeout(2000)

    r2 = cs(page, '[data-testid="open-bitable"]', 'borderRadius')
    check('N7a open-bitable classic radius=16px', r2 == '16px', r2)

    open_bitable(page)
    check('N7b classic 视图标签仍在', page.locator('[data-testid="bt-view-tab"]').count() == 1)

    mbg2 = cs(page, '[data-testid="bt-mcpd-primaryId"]', 'backgroundColor')
    check('N7c MCPD 徽章 classic 琥珀淡底', mbg2 == 'rgba(217, 119, 6, 0.12)', mbg2)

    make_filter_chip(page)
    cr2 = cs(page, '[data-chip="filter"]', 'borderRadius')
    check('N7d chip classic radius=8px', cr2 == '8px', cr2)
    chip_fg = cs(page, '[data-chip="filter"]', 'color')
    check('N7e chip classic 文字可读(非白)', chip_fg not in ('rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)'), chip_fg)
    remove_filter_chip(page)

    dlg2 = open_nf_dialog(page)
    bsh2 = cs(page, '[data-testid="bt-add-field-dialog"]', 'boxShadow')
    check('N7f 弹窗 classic 绿柔阴影', 'rgba(46, 125, 50' in bsh2, bsh2)
    close_nf_dialog(page)

    # ═══════════ 不变量快速复断言（classic 下）═══════════
    # 行高
    page.locator('[data-testid="bt-density-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-density-tall"]').click(); page.wait_for_timeout(500)
    h = page.locator('[data-pid="CIP-001"]').first.evaluate("el => el.getBoundingClientRect().height")
    check('N8a 宽松行高 56-60', 56 <= h <= 60, str(h))
    page.locator('[data-testid="bt-density-normal"]').click(); page.wait_for_timeout(500)
    h2 = page.locator('[data-pid="CIP-001"]').first.evaluate("el => el.getBoundingClientRect().height")
    check('N8b 中等行高 40-44', 40 <= h2 <= 44, str(h2))

    # 脏格琥珀 + 保存条 + 放弃（bt-ghost 弃改按钮）
    ORIG_DN = sql("SELECT display_name FROM accession WHERE primary_id='CIP-003'")[0][0]
    row3 = page.locator('[data-pid="CIP-003"]')
    row3.locator('[data-cell="displayName"]').click(); page.wait_for_timeout(300)
    inp = page.locator('[data-testid="bt-edit-displayName"]')
    inp.fill(f'N8-{int(time.time()) % 100000}'); page.keyboard.press('Enter'); page.wait_for_timeout(500)
    cls = row3.locator('[data-cell="displayName"]').get_attribute('class') or ''
    check('N8c 脏格琥珀高亮', 'amber' in cls, cls[:80])
    check('N8d 保存条计数', '1 处未保存修改' in visible_text(page), visible_text(page)[-120:])
    page.locator('[data-testid="bt-discard"]').click(); page.wait_for_timeout(600)
    check('N8e 放弃后还原', ORIG_DN in row3.locator('[data-cell="displayName"]').inner_text())

    # 分组 + 组头第一按钮折叠/展开
    page.locator('[data-testid="bt-group-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-group-field"]').click(); page.wait_for_timeout(300)
    page.locator('[data-pick="species"]').first.click(); page.wait_for_timeout(1600)
    gsel = '[data-group="Solanum tuberosum"]'
    page.locator(f'{gsel} button').first.click(); page.wait_for_timeout(400)
    check('N8f 组头第一按钮=折叠', page.locator(f'{gsel} [data-pid]').count() == 0)
    page.locator(f'{gsel} button').first.click(); page.wait_for_timeout(400)
    check('N8g 展开恢复', page.locator(f'{gsel} [data-pid]').count() > 0)
    page.locator('[data-testid="bt-clear-group"]').click(); page.wait_for_timeout(900)

    # ═══════════ regulator 只读 ═══════════
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(500)
    ui_login(page, 'v215_reg', 'test123')
    open_bitable(page)
    check('N9a regulator 只读徽标', '只读浏览' in visible_text(page))
    check('N9b regulator 无保存条', page.locator('[data-testid="bt-save"]').count() == 0)
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(500)

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e and '#310' not in e and '#418' not in e]
    check('N10 无关键 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

# 收尾：API 重置主题为 brutalist
requests.put(f'{BASE}/api/my/settings', headers=AH, json={'key': 'ui.theme', 'value': 'brutalist'}, timeout=10)

passed = sum(1 for x in results if x[1])
failed = sum(1 for x in results if not x[1])
print(f'\n==== v2.16 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
