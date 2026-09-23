# -*- coding: utf-8 -*-
# v2.15 UI 验证：多维表格（Bitable）——入口/权限/编辑入库/筛选排序分组/增字段/导出/质量/主题
import sys, time, os, sqlite3, zipfile, requests
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

# ---- 前置：确定主题 + 所需测试用户 ----
admin_tok = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']
AH = {'Authorization': f'Bearer {admin_tok}'}
requests.put(f'{BASE}/api/my/settings', headers=AH, json={'key': 'ui.theme', 'value': 'brutalist'}, timeout=10)
requests.post(f'{BASE}/api/users', headers=AH, json={'username': 'v215_oper', 'password': 'test123', 'displayName': 'V215操作员', 'role': 'user', 'userType': 'operator'}, timeout=10)

EXPECT_TOTAL = sql('SELECT COUNT(*) FROM accession')[0][0]
EXPECT_IPO = sql("SELECT COUNT(*) FROM accession WHERE species LIKE '%Ipomoea%'")[0][0]
EXPECT_FIRST_SPECIES = sql("SELECT primary_id FROM accession ORDER BY species COLLATE NOCASE ASC, created_at DESC, id DESC LIMIT 1")[0][0]
EXPECT_GROUPS = sql('SELECT COUNT(DISTINCT species) FROM accession')[0][0]
EXPECT_SOL_COUNT = sql("SELECT COUNT(*) FROM accession WHERE species='Solanum tuberosum'")[0][0]
EXPECT_QCORE = sql("""SELECT COUNT(*) FROM accession WHERE
  primary_id IS NULL OR primary_id='' OR display_name IS NULL OR display_name='' OR species IS NULL OR species='' OR origin IS NULL OR origin=''
  OR json_extract(data_json,'$."collectionYear"') IS NULL OR json_extract(data_json,'$."collectionYear"')=''""")[0][0]
ORIG_DN = sql("SELECT display_name FROM accession WHERE primary_id='CIP-003'")[0][0]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())

    ui_login(page)

    # ===== U1 入口与基本形态（admin）=====
    page.evaluate("location.hash = '#/accessions'"); page.wait_for_timeout(900)
    check('U1a admin 可见多维表格入口', page.locator('[data-testid="open-bitable"]').count() == 1)
    open_bitable(page)
    check('U1b overlay 打开', page.locator('[data-testid="bitable-root"]').count() == 1)
    check('U1c 网格渲染数据行', page.locator('[data-pid]').count() >= 5, str(page.locator('[data-pid]').count()))
    check('U1d 总数显示', f'共 {EXPECT_TOTAL} 条' in visible_text(page), visible_text(page)[:80])
    check('U1e 冻结主列存在', page.locator('[data-col="primaryId"]').count() == 1)

    # ===== U11 MCPD 徽标 + 受控词表 =====
    check('U11a primaryId 表头 MCPD 徽标', page.locator('[data-testid="bt-mcpd-primaryId"]').count() == 1)
    page.locator('[data-pid="CIP-001"] [data-cell="origin"]').click(); page.wait_for_timeout(400)
    inp = page.locator('[data-testid="bt-edit-origin"]')
    check('U11b origin 编辑为可搜索词表', inp.count() == 1 and (inp.get_attribute('list') or '') == 'bt-vocab-origin', str(inp.count()))
    opts = page.locator('datalist#bt-vocab-origin option').count()
    check('U11c 国家词表(ISO alpha-3)选项充足', opts > 150, str(opts))
    page.keyboard.press('Escape'); page.wait_for_timeout(300)

    # ===== U2 编辑 → 脏 → 保存 → 落库 → 还原 =====
    NEW_DN = f'E2E-{int(time.time()) % 100000}'
    row3 = page.locator('[data-pid="CIP-003"]')
    row3.locator('[data-cell="displayName"]').click(); page.wait_for_timeout(300)
    inp = page.locator('[data-testid="bt-edit-displayName"]')
    check('U2a 单元格进入编辑', inp.count() == 1)
    inp.fill(NEW_DN); page.keyboard.press('Enter'); page.wait_for_timeout(500)
    cls = row3.locator('[data-cell="displayName"]').get_attribute('class') or ''
    check('U2b 脏格琥珀高亮', 'amber' in cls, cls[:80])
    check('U2c 保存条计数', '1 处未保存修改' in visible_text(page), visible_text(page)[-120:])
    page.locator('[data-testid="bt-save"]').click(); page.wait_for_timeout(1800)
    now_dn = sql("SELECT display_name FROM accession WHERE primary_id='CIP-003'")[0][0]
    check('U2d 已落库(sqlite)', now_dn == NEW_DN, str(now_dn))
    # 重载页面再验证（读回数据库）
    page.reload(wait_until='networkidle'); page.wait_for_timeout(1200)
    open_bitable(page)
    check('U2e 重载后显示新值', NEW_DN in page.locator('[data-pid="CIP-003"] [data-cell="displayName"]').inner_text())
    # 还原
    page.locator('[data-pid="CIP-003"] [data-cell="displayName"]').click(); page.wait_for_timeout(300)
    inp = page.locator('[data-testid="bt-edit-displayName"]')
    inp.fill(ORIG_DN); page.keyboard.press('Enter'); page.wait_for_timeout(400)
    page.locator('[data-testid="bt-save"]').click(); page.wait_for_timeout(1800)
    check('U2f 已还原', sql("SELECT display_name FROM accession WHERE primary_id='CIP-003'")[0][0] == ORIG_DN)

    # ===== U5 筛选 =====
    page.locator('[data-testid="bt-filter-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-add-filter"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-filter-field"]').click(); page.wait_for_timeout(300)
    page.locator('[data-pick="species"]').first.click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-panel-filter"] input[placeholder="值"]').fill('Ipomoea')
    page.wait_for_timeout(1200)
    check('U5a 筛选后总数正确', f'共 {EXPECT_IPO} 条' in visible_text(page), visible_text(page)[:80])
    page.locator('[data-chip="filter"] button').last.click(); page.wait_for_timeout(1200)
    check('U5b 移除筛选项恢复', f'共 {EXPECT_TOTAL} 条' in visible_text(page), visible_text(page)[:80])
    page.locator('[data-testid="bt-filter-btn"]').click(); page.wait_for_timeout(200)

    # ===== U6 列菜单排序 =====
    page.locator('[data-col="species"] .bt-menu-btn').click(); page.wait_for_timeout(300)
    page.locator('[data-col="species"] .bt-col-menu button', has_text='升序').first.click()
    page.wait_for_timeout(1000)
    first_pid = page.locator('[data-testid="bitable-grid"] [data-pid]').first.get_attribute('data-pid')
    check('U6a 排序首行正确', first_pid == EXPECT_FIRST_SPECIES, f'{first_pid} vs {EXPECT_FIRST_SPECIES}')
    page.locator('[data-chip="sort"] button').last.click(); page.wait_for_timeout(900)

    # ===== U7 分组 =====
    page.locator('[data-testid="bt-group-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-group-field"]').click(); page.wait_for_timeout(300)
    page.locator('[data-pick="species"]').first.click(); page.wait_for_timeout(1600)
    gcount = page.locator('[data-group]').count()
    check('U7a 分组头渲染', gcount == EXPECT_GROUPS, f'{gcount} vs {EXPECT_GROUPS}')
    sol_txt = page.locator('[data-group="Solanum tuberosum"]').first.inner_text()
    check('U7b 组内计数显示', str(EXPECT_SOL_COUNT) in sol_txt, sol_txt[:60])
    check('U7c 组内行已懒加载', page.locator('[data-group="Solanum tuberosum"] [data-pid]').count() > 0)
    # 折叠/展开
    page.locator('[data-group="Solanum tuberosum"] button').first.click(); page.wait_for_timeout(400)
    check('U7d 折叠后行隐藏', page.locator('[data-group="Solanum tuberosum"] [data-pid]').count() == 0)
    page.locator('[data-group="Solanum tuberosum"] button').first.click(); page.wait_for_timeout(400)
    check('U7e 展开后行恢复', page.locator('[data-group="Solanum tuberosum"] [data-pid]').count() > 0)
    page.locator('[data-testid="bt-clear-group"]').click(); page.wait_for_timeout(900)

    # ===== U8 冻结列（横向滚动） =====
    x_before = page.locator('[data-pid="CIP-001"] [data-cell="primaryId"]').bounding_box()['x']
    page.locator('[data-testid="bitable-grid"]').evaluate("el => el.scrollLeft = 900")
    page.wait_for_timeout(500)
    x_after = page.locator('[data-pid="CIP-001"] [data-cell="primaryId"]').bounding_box()['x']
    check('U8 横向滚动主列冻结', abs(x_before - x_after) < 2, f'{x_before} -> {x_after}')
    page.locator('[data-testid="bitable-grid"]').evaluate("el => el.scrollLeft = 0")
    page.wait_for_timeout(300)

    # ===== U9 行高 =====
    page.locator('[data-testid="bt-density-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-density-tall"]').click(); page.wait_for_timeout(500)
    h = page.locator('[data-pid="CIP-001"]').first.evaluate("el => el.getBoundingClientRect().height")
    check('U9a 宽松行高生效', 56 <= h <= 60, str(h))
    page.locator('[data-testid="bt-density-normal"]').click(); page.wait_for_timeout(500)
    h2 = page.locator('[data-pid="CIP-001"]').first.evaluate("el => el.getBoundingClientRect().height")
    check('U9b 中等行高恢复', 40 <= h2 <= 44, str(h2))

    # ===== U10 质量检查 =====
    page.locator('[data-testid="bt-quality-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-quality-highlight"]').click(); page.wait_for_timeout(600)
    dashed = page.locator('[data-testid="bitable-grid"] .border-dashed').count()
    check('U10b 质量高亮标记空字段', dashed > 0, str(dashed))
    page.locator('[data-testid="bt-quality-highlight"]').click(); page.wait_for_timeout(400)
    dashed2 = page.locator('[data-testid="bitable-grid"] .border-dashed').count()
    check('U10b2 关闭后高亮消失', dashed2 == 0, str(dashed2))
    page.locator('[data-testid="bt-quality-passport"]').click(); page.wait_for_timeout(1200)
    check('U10a 质量预设计数正确', f'共 {EXPECT_QCORE} 条' in visible_text(page), f'期望 {EXPECT_QCORE}: ' + visible_text(page)[:80])
    page.locator('[data-chip="filter"] button').last.click(); page.wait_for_timeout(1000)
    if page.locator('[data-testid="bt-panel-quality"]').count():
        page.locator('[data-testid="bt-quality-btn"]').click(); page.wait_for_timeout(200)

    # ===== U12 新增自定义键（自由键 + 入库） =====
    page.locator('[data-testid="bt-add-field"]').click(); page.wait_for_timeout(400)
    page.locator('[data-testid="bt-nf-mode-custom"]').click(); page.wait_for_timeout(200)
    page.locator('[data-testid="bt-nf-key"]').fill('v215_uiKey')
    page.locator('[data-testid="bt-nf-submit"]').click(); page.wait_for_timeout(800)
    check('U12a 新列已加入视图', page.locator('[data-col="v215_uiKey"]').count() == 1)
    page.locator('[data-pid="CIP-004"] [data-cell="v215_uiKey"]').click(); page.wait_for_timeout(300)
    inp = page.locator('[data-testid="bt-edit-v215_uiKey"]')
    inp.fill('ui-val'); page.keyboard.press('Enter'); page.wait_for_timeout(400)
    page.locator('[data-testid="bt-save"]').click(); page.wait_for_timeout(1800)
    v = sql("SELECT json_extract(data_json,'$.\"v215_uiKey\"') FROM accession WHERE primary_id='CIP-004'")[0][0]
    check('U12b 自由键值已入库(sqlite)', v == 'ui-val', str(v))
    # 从视图移除（数据保留）
    page.locator('[data-testid="bt-fields-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-remove="v215_uiKey"]').click(); page.wait_for_timeout(300)
    check('U12c 从视图移除', page.locator('[data-col="v215_uiKey"]').count() == 0)
    page.locator('[data-testid="bt-fields-btn"]').click(); page.wait_for_timeout(200)
    # 数据清理（API）
    requests.post(f'{BASE}/api/accessions/batch-update', headers=AH, json={'mode': 'replace', 'allowCustomKeys': True, 'rows': [{'primaryId': 'CIP-004', 'updates': {'v215_uiKey': None}}]}, timeout=10)
    check('U12d 测试键已清理', sql("SELECT json_extract(data_json,'$.\"v215_uiKey\"') FROM accession WHERE primary_id='CIP-004'")[0][0] is None)

    # ===== U13/U14 注册性状 + 重命名 =====
    page.locator('[data-testid="bt-add-field"]').click(); page.wait_for_timeout(400)
    page.locator('[data-testid="bt-nf-key"]').fill('V215_UI_TRAIT')
    page.locator('[data-testid="bt-nf-zh"]').fill('测试性状')
    page.locator('[data-testid="bt-nf-submit"]').click(); page.wait_for_timeout(1500)
    check('U13a 性状列已加入视图', page.locator('[data-col="V215_UI_TRAIT"]').count() == 1)
    trait_row = sql("SELECT id,name_zh FROM trait_def WHERE code='V215_UI_TRAIT'")
    check('U13b 性状已注册(trait_def)', len(trait_row) == 1, str([dict(r) for r in trait_row]))
    page.locator('[data-pid="CIP-005"] [data-cell="V215_UI_TRAIT"]').click(); page.wait_for_timeout(300)
    inp = page.locator('[data-testid="bt-edit-V215_UI_TRAIT"]')
    inp.fill('X'); page.keyboard.press('Enter'); page.wait_for_timeout(400)
    page.locator('[data-testid="bt-save"]').click(); page.wait_for_timeout(1800)
    vv = sql("SELECT json_extract(data_json,'$.\"V215_UI_TRAIT\"') FROM accession WHERE primary_id='CIP-005'")[0][0]
    check('U13c 性状值已入库', vv == 'X', str(vv))
    # 重命名
    page.locator('[data-col="V215_UI_TRAIT"] .bt-menu-btn').click(); page.wait_for_timeout(300)
    page.locator('[data-col="V215_UI_TRAIT"] .bt-col-menu button', has_text='重命名').first.click(); page.wait_for_timeout(400)
    page.locator('[data-testid="bt-rename-zh"]').fill('测试性状改')
    page.locator('[data-testid="bt-rename-ok"]').click(); page.wait_for_timeout(900)
    htxt = page.locator('[data-col="V215_UI_TRAIT"]').inner_text()
    check('U14 重命名生效', '测试性状改' in htxt, htxt[:60])
    # 清理：值 + 性状定义
    requests.post(f'{BASE}/api/accessions/batch-update', headers=AH, json={'mode': 'replace', 'allowCustomKeys': True, 'rows': [{'primaryId': 'CIP-005', 'updates': {'V215_UI_TRAIT': None}}]}, timeout=10)
    if trait_row:
        requests.delete(f'{BASE}/api/traits/{trait_row[0]["id"]}', headers=AH, timeout=10)
    check('U14b 测试性状已清理', len(sql("SELECT id FROM trait_def WHERE code='V215_UI_TRAIT'")) == 0)
    page.locator('[data-testid="bt-fields-btn"]').click(); page.wait_for_timeout(300)
    if page.locator('[data-remove="V215_UI_TRAIT"]').count():
        page.locator('[data-remove="V215_UI_TRAIT"]').click(); page.wait_for_timeout(200)
    page.locator('[data-testid="bt-fields-btn"]').click(); page.wait_for_timeout(200)

    # ===== U15 导出全部（MCPD 表头）=====
    page.locator('[data-testid="bt-export-btn"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="bt-export-mcpd"]').click(); page.wait_for_timeout(200)
    with page.expect_download(timeout=20000) as dl:
        page.locator('[data-testid="bt-export-all"]').click()
    d = dl.value
    xlsx_all = '/tmp/v215_export_all.xlsx'
    d.save_as(xlsx_all)
    ok_zip = zipfile.is_zipfile(xlsx_all)
    names = []
    sheet_xml = ''
    if ok_zip:
        with zipfile.ZipFile(xlsx_all) as z:
            names = z.namelist()
            if 'xl/worksheets/sheet1.xml' in names:
                sheet_xml = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'ignore')
    check('U15a 导出为合法 xlsx', ok_zip and 'xl/worksheets/sheet1.xml' in names, d.suggested_filename)
    check('U15b MCPD 表头映射(ACCENUMB)', 'ACCENUMB' in sheet_xml)
    page.locator('[data-testid="bt-export-btn"]').click(); page.wait_for_timeout(200)

    # ===== U16 选择 + 导出所选 =====
    page.locator('[data-testid="bt-row-check"]').nth(0).click(); page.wait_for_timeout(200)
    page.locator('[data-testid="bt-row-check"]').nth(1).click(); page.wait_for_timeout(200)
    check('U16a 已选 2 计数', '已选 2' in visible_text(page), '')
    page.locator('[data-testid="bt-export-btn"]').click(); page.wait_for_timeout(300)
    with page.expect_download(timeout=20000) as dl2:
        page.locator('[data-testid="bt-export-selected"]').click()
    d2 = dl2.value
    xlsx_sel = '/tmp/v215_export_selected.xlsx'
    d2.save_as(xlsx_sel)
    rows_cnt = 0
    if zipfile.is_zipfile(xlsx_sel):
        with zipfile.ZipFile(xlsx_sel) as z:
            xml = z.read('xl/worksheets/sheet1.xml').decode('utf-8', 'ignore')
            rows_cnt = xml.count('<row ')
    check('U16b 所选导出行数 = 2+表头', rows_cnt == 3, str(rows_cnt))
    page.locator('[data-testid="bt-export-btn"]').click(); page.wait_for_timeout(200)

    # ===== U17 主题（关 overlay 切换再开）=====
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(600)
    page.locator('.t-theme-toggle button', has_text='CLASSIC').first.click(); page.wait_for_timeout(2000)
    open_bitable(page)
    txt = page.locator('body').inner_text().strip()
    check('U17a classic 下无白屏', len(txt) > 50 and page.locator('[data-pid]').count() > 0, txt[:60])
    try:
        page.screenshot(path='/tmp/v215_bitable_classic.png', full_page=False)
    except Exception: pass
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(600)
    page.locator('.t-theme-toggle button', has_text='BRUTALIST').first.click(); page.wait_for_timeout(2000)
    open_bitable(page)
    check('U17b brutalist 下正常', page.locator('[data-pid]').count() > 0)
    try:
        page.screenshot(path='/tmp/v215_bitable_brutalist.png', full_page=False)
    except Exception: pass
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(600)

    # ===== U3 regulator 只读 =====
    ui_login(page, 'v215_reg', 'test123')
    open_bitable(page)
    check('U3a regulator 可打开', page.locator('[data-testid="bitable-root"]').count() == 1)
    check('U3b 显示只读徽标', '只读浏览' in visible_text(page))
    page.locator('[data-pid="CIP-001"] [data-cell="displayName"]').click(); page.wait_for_timeout(400)
    check('U3c 单元格不可编辑', page.locator('[data-testid^="bt-edit-"]').count() == 0)
    check('U3d 无保存条', page.locator('[data-testid="bt-save"]').count() == 0)
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(500)

    # ===== U4 operator 无入口 =====
    ui_login(page, 'v215_oper', 'test123')
    page.evaluate("location.hash = '#/accessions'"); page.wait_for_timeout(900)
    check('U4 operator 无多维表格入口', page.locator('[data-testid="open-bitable"]').count() == 0)

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e and '#310' not in e and '#418' not in e]
    check('U18 无关键 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:3]))

    browser.close()

# 收尾保险：无论 UI 切主题结果如何，都经 API 将 admin 主题重置为 brutalist（避免污染后续脚本）
requests.put(f'{BASE}/api/my/settings', headers=AH, json={'key': 'ui.theme', 'value': 'brutalist'}, timeout=10)

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.15 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
