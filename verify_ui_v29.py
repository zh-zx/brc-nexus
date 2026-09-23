# -*- coding: utf-8 -*-
# v2.9 前端人工清单自动验证：白屏 / 双模式切换 / 可视化性状列 / 网格编辑
import sys, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:200]) if detail and not cond else ''))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    # 1. 登录页无白屏
    page.goto(BASE, wait_until='networkidle', timeout=30000)
    check('登录页加载无白屏', page.locator('body').inner_text().strip() != '')
    page.screenshot(path='/tmp/v29_login.png')

    # 2. 登录
    pw = page.locator('input[type="password"]').first
    pw.wait_for(timeout=10000)
    inputs = page.locator('input')
    for i in range(inputs.count()):
        t = inputs.nth(i).get_attribute('type') or ''
        if t != 'password':
            inputs.nth(i).fill('admin')
            break
    pw.fill('admin123')
    # 找登录按钮
    btns = page.locator('button')
    clicked = False
    for i in range(btns.count()):
        txt = (btns.nth(i).inner_text() or '').strip()
        if '登' in txt and '录' in txt:
            btns.nth(i).click(); clicked = True; break
    if not clicked:
        btns.nth(0).click()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)
    body = page.locator('body').inner_text()
    check('登录后进入工作台(无白屏)', '登出' in body or '工作台' in body or 'dashboard' in body.lower() or '种质' in body, body[:120])

    # 3. 种质资源 → 网格编辑
    page.goto(BASE + '/#/accessions', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    grid_btn = page.get_by_text('网格编辑', exact=False)
    check('种质页出现「网格编辑」入口', grid_btn.count() > 0)
    if grid_btn.count() > 0:
        grid_btn.first.click()
        page.wait_for_timeout(800)
        body = page.locator('body').inner_text()
        check('进入网格编辑(出现保存/退出条)', ('保存修改' in body or '保存' in body) and '退出' in body, body[:200])
        # 编辑一个单元格
        inputs = page.locator('table input, table select')
        check('网格中出现可编辑单元格', inputs.count() > 0, f'inputs={inputs.count()}')
        if inputs.count() > 0:
            before = inputs.first.input_value()
            inputs.first.fill('ZZ-' + str(page.evaluate('Date.now()'))[-6:])
            page.wait_for_timeout(300)
            # 检查脏格高亮(amber)或保存条数字
            amber = page.locator('.bg-amber-50, .ring-amber-300, [class*="amber"]')
            save_bar = page.locator('text=/保存修改[（(]?\\d/')
            check('编辑后出现脏格高亮/保存计数', amber.count() > 0 or save_bar.count() > 0,
                  f'amber={amber.count()} savebar={save_bar.count()}')
        # 退出编辑
        exit_btn = None
        for t in ['退出编辑', '退出']:
            candidates = page.get_by_text(t, exact=True)
            for i in range(candidates.count()):
                el = candidates.nth(i)
                if el.evaluate('(n) => n.tagName === "BUTTON"'):
                    exit_btn = el; break
            if exit_btn: break
        if exit_btn:
            exit_btn.click()
            page.wait_for_timeout(500)
            check('退出网格编辑恢复只读视图', page.locator('table').count() > 0)

    # 4. 数据库管理台：双模式切换 + 可视化性状列
    page.goto(BASE + '/#/db', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1200)
    body = page.locator('body').inner_text()
    check('DB管理台加载(专业模式)', '专业模式' in body and '可视化模式' in body, body[:150])
    # 切到可视化
    vis = page.get_by_text('可视化模式', exact=False)
    if vis.count() > 0:
        vis.first.click()
        page.wait_for_timeout(1200)
        body = page.locator('body').inner_text()
        check('切换到可视化模式(出现表列表)', '种质' in body or 'accession' in body.lower() or '表' in body, body[:150])
        # 选 accession 表（表列表按钮显示中文标签「种质资源」）
        try:
            page.locator('button', has_text='种质资源').first.click(timeout=8000)
            clicked = True
        except Exception:
            try:
                page.locator('button', has_text='Accessions').first.click(timeout=5000)
                clicked = True
            except Exception:
                clicked = False
        page.wait_for_timeout(1500)
        body = page.locator('body').inner_text()
        check('可视化下选种质表成功', clicked and ('种质编号' in body or 'primary' in body.lower() or '性状' in body), body[:150])
        # 检查性状列(中文标签)与空值占位 '-'
        tbl = page.locator('table').first
        check('性状展开为列(表头含性状代码)', '#' in (tbl.inner_text()[:300]) or (tbl.locator('th').count() >= 5), f'ths={tbl.locator("th").count()}')
        check('空值显示为 - 占位', tbl.inner_text().count('-') > 0)
        # v2.9.1 修复回归：基础直列必须可见(专业/可视化一致)—— id/种质编号/名称 不应为空
        ths = [tbl.locator('th').nth(i).inner_text() for i in range(tbl.locator('th').count())]
        first_td = [tbl.locator('tbody tr').first.locator('td').nth(i).inner_text() for i in range(min(6, tbl.locator('tbody tr').first.locator('td').count()))]
        check('表头含 ID/种质编号/名称', '种质编号' in ' '.join(ths) and ('ID' in ' '.join(ths)) and '名称' in ' '.join(ths), ' | '.join(ths[:8]))
        check('首行种质编号可见(非空/-)', len(first_td) >= 3 and first_td[2] not in ('', '-', 'NULL'), f'row={first_td}')
        check('首行名称可见(非空/-)', len(first_td) >= 4 and first_td[3] not in ('', '-', 'NULL'), f'row={first_td}')
        page.screenshot(path='/tmp/v29_db_visual.png')
        # 编辑弹窗：种质编号/名称应带出原值（专业/可视化编辑内容一致）
        row = page.locator('table').first.locator('tbody tr').first
        row.locator('button').first.click()  # 编辑按钮（每行第一个按钮）
        page.wait_for_timeout(800)
        modal = page.locator('.fixed.inset-0')
        if modal.count() > 0:
            invals = [modal.locator('input').nth(i).input_value() for i in range(min(5, modal.locator('input').count()))]
            check('编辑弹窗带出种质编号原值', len(invals) >= 1 and invals[0] not in ('', 'NULL'), f'vals={invals}')
            check('编辑弹窗带出名称原值', len(invals) >= 2 and invals[1] not in ('', 'NULL'), f'vals={invals}')
            modal.locator('button', has_text='取消').first.click()
            page.wait_for_timeout(400)
        else:
            check('编辑弹窗打开', False, 'modal not found')
        # 模式状态保持：切回专业
        pro = page.get_by_text('专业模式', exact=False)
        if pro.count() > 0:
            pro.first.click()
            page.wait_for_timeout(800)
            body = page.locator('body').inner_text()
            check('切回专业模式(SQL/数据表/备份/完整性 tab 仍在)', '数据表' in body or 'SQL' in body or '备份' in body or '完整性' in body, body[:150])

    # 5. 白屏扫描：核心页
    for path, label in [('/#/dashboard', '工作台'), ('/#/freezer', '液氮库'), ('/#/dist', '分发'), ('/#/inventory', '库存')]:
        page.goto(BASE + path, wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(600)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页无白屏', len(txt) > 50, txt[:80])

    # 6. 控制台错误
    page.goto(BASE + '/#/db', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(800)
    real_errors = [e for e in console_errors if 'favicon' not in e and '404' not in e and 'Failed to load resource' not in e]
    check('页面无 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:5]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== 前端清单: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
