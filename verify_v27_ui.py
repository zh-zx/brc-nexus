# -*- coding: utf-8 -*-
# v2.7 A 部分：侧边栏折叠/展开 + 拖拽排序 + 每用户持久化
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
passed = 0
failed = 0
def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'  [PASS] {name}')
    else:
        failed += 1
        print(f'  [FAIL] {name}  {detail}')

def login(page, username, password):
    page.goto(BASE + '/#/login')
    page.wait_for_load_state('domcontentloaded')
    try:
        page.evaluate("localStorage.removeItem('brc_token')")
    except Exception:
        pass
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('input[type="password"]', timeout=10000)
    page.fill('input[type="text"]', username)
    page.fill('input[type="password"]', password)
    page.click('button[type="submit"]')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1200)

def aside_width(page):
    return page.evaluate("""(() => {
      const el = document.querySelector('aside');
      return el ? el.getBoundingClientRect().width : -1;
    })()""")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1600, 'height': 900})
    page = ctx.new_page()

    # ---- admin 折叠测试 ----
    login(page, 'admin', 'admin123')
    w0 = aside_width(page)
    check('A1 侧边栏初始为展开宽度 w-64(~256)', w0 > 200, str(w0))

    # 点击折叠按钮（aside 内第一个 button = 折叠按钮）
    page.locator('aside button').first.click()
    # 轮询等待过渡动画完成
    w1 = w0
    for _ in range(20):
        page.wait_for_timeout(150)
        w1 = aside_width(page)
        if w1 < 100:
            break
    check('A2 点击折叠按钮后侧边栏变窄 w-16(~64)', w1 < 100, f'{w0} -> {w1}')

    # 折叠态下文字标签隐藏（title 提示存在）
    label_visible = page.evaluate("""(() => {
      const links = document.querySelectorAll('aside a');
      return Array.from(links).some(a => a.querySelector('span') && a.querySelector('span').offsetParent !== null);
    })()""")
    check('A3 折叠态下侧边栏文字标签隐藏', not label_visible)

    # 刷新后仍折叠（持久化）
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)
    w2 = aside_width(page)
    check('A4 刷新后保持折叠状态', w2 < 100, str(w2))

    # 展开
    page.locator('aside button').first.click()
    w3 = 0
    for _ in range(20):
        page.wait_for_timeout(150)
        w3 = aside_width(page)
        if w3 > 200:
            break
    check('A5 再次点击展开侧边栏', w3 > 200, str(w3))

    # ---- admin 排序测试 ----
    # 打开排序弹窗
    page.locator('aside').locator('button').filter(has_text='排序').click()
    page.wait_for_timeout(500)
    modal = page.locator('div.fixed.inset-0.z-50')
    check('A6 排序弹窗打开', modal.count() > 0)

    cards = modal.locator('[draggable="true"]')
    n = cards.count()
    check('A7 弹窗列出全部导航项', n >= 10, str(n))
    labels_before = [cards.nth(i).inner_text().strip().split('\n')[0] for i in range(n)]
    check('A8 弹窗首个为工作台', '工作台' in labels_before[0], labels_before[0])

    # 拖拽第 1 项到第 2 项（工作台 → 移到第 2 位）
    first = cards.nth(0)
    second = cards.nth(1)
    first.drag_to(second, target_position={'x': 10, 'y': 10})
    page.wait_for_timeout(500)
    labels_after = [cards.nth(i).inner_text().strip().split('\n')[0] for i in range(n)]
    check('A9 拖拽后顺序变化', labels_after[0] != labels_before[0] and labels_after[1] == labels_before[0],
          f'before={labels_before[:3]} after={labels_after[:3]}')

    # 保存
    modal.locator('button', has_text='保存').click()
    page.wait_for_timeout(800)

    # 侧边栏第一个链接应变为原第 2 项
    first_link_label = page.evaluate("""(() => {
      const a = document.querySelector('aside nav a');
      return a ? a.innerText.trim() : '';
    })()""")
    check('A10 保存后侧边栏立即按新顺序渲染', first_link_label == labels_after[0], f'got={first_link_label}')

    # 刷新后顺序保持
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)
    first_link_label2 = page.evaluate("""(() => {
      const a = document.querySelector('aside nav a');
      return a ? a.innerText.trim() : '';
    })()""")
    check('A11 刷新后导航顺序保持', first_link_label2 == labels_after[0], f'got={first_link_label2}')

    # 还原顺序：再次打开弹窗把原第 2 项拖回第 1 位
    page.locator('aside').locator('button').filter(has_text='排序').click()
    page.wait_for_timeout(500)
    modal2 = page.locator('div.fixed.inset-0.z-50')
    cards2 = modal2.locator('[draggable="true"]')
    cards2.nth(1).drag_to(cards2.nth(0), target_position={'x': 10, 'y': 10})
    page.wait_for_timeout(500)
    modal2.locator('button', has_text='保存').click()
    page.wait_for_timeout(800)
    first_link_label3 = page.evaluate("""(() => {
      const a = document.querySelector('aside nav a');
      return a ? a.innerText.trim() : '';
    })()""")
    check('A12 顺序还原成功', first_link_label3 == '工作台', f'got={first_link_label3}')

    # ---- 每用户独立 ----
    login(page, 'op2', 'test123')
    page.wait_for_timeout(800)
    op_first = page.evaluate("""(() => {
      const a = document.querySelector('aside nav a');
      return a ? a.innerText.trim() : '';
    })()""")
    check('A13 op2 的导航顺序独立（默认工作台在首位）', op_first == '工作台', f'got={op_first}')
    w_op = aside_width(page)
    check('A14 op2 侧边栏未继承 admin 折叠状态', w_op > 200, str(w_op))

    # admin 折叠持久化也独立于 op2（上面 op2 未折叠，回到 admin 仍折叠? 我们最后展开过，保持展开）
    browser.close()

print(f'\n==== v2.7 sidebar checks: {passed} passed, {failed} failed ====')
import sys
sys.exit(1 if failed else 0)
