# -*- coding: utf-8 -*-
# v2.11 UI 验证：标签页标题 CCCAP + 侧边栏默认排序 + 详情弹窗基因组学区块（增删） + 白屏/控制台
import sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import requests
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  [PASS] ' if cond else '  [FAIL] ') + name + (('  ' + str(detail)[:200]) if detail and not cond else ''))

def api_token():
    r = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10)
    return r.json()['token']

omics_added_id = None

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    page.goto(BASE, wait_until='networkidle', timeout=30000)
    check('T1 标签页标题含 CCCAP', 'CCCAP' in page.title(), page.title())

    # 登录
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
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1000)

    # 侧边栏顺序（前 6 项：工作台/我的清单/消息/种质资源/找种质/组培继代）
    nav_texts = []
    navs = page.locator('aside a, nav a, a[href^="#/"]')
    seen = set()
    for i in range(navs.count()):
        el = navs.nth(i)
        href = el.get_attribute('href') or ''
        txt = (el.inner_text() or '').strip().split('\n')[0]
        if href.startswith('#/') and href not in seen and txt:
            seen.add(href)
            nav_texts.append((href, txt))
    order6 = [t for _, t in nav_texts[:6]]
    expected6 = ['工作台', '我的清单', '消息中心', '种质资源', '找种质', '组培继代']
    check('N1 侧边栏前6项符合新默认顺序', order6 == expected6, f'actual={order6}')
    paths = [h for h, _ in nav_texts]
    check('N2 找种质在种质资源之后', paths.index('#/find') == paths.index('#/accessions') + 1 if '#/find' in paths and '#/accessions' in paths else False, str(paths[:8]))
    check('N3 系统设置在最后', paths[-1] == '#/setup' if paths else False, str(paths[-3:]))

    # 详情弹窗基因组学区块
    page.evaluate("location.hash = '#/accessions'")
    page.wait_for_timeout(1800)
    row = page.locator('table tbody tr').first
    row.click()
    page.wait_for_timeout(1000)
    body = page.locator('body').inner_text()
    check('O1 详情弹窗出现基因组学区块', '基因组学' in body, body[-250:])
    check('O2 空态文案(预留字段)', '暂无基因组学记录' in body)
    # admin 添加条目
    add_btn = page.locator('button', has_text='添加记录').first
    if add_btn.count() > 0:
        add_btn.click()
        page.wait_for_timeout(400)
        # 表单：类别 select + 标题/文献/链接 input + 备注 textarea
        sel = page.locator('.fixed select').last
        sel.select_option('marker')
        inputs = page.locator('.fixed input.glass-input, .fixed input')
        # 找表单里的三个输入（标题/文献/链接）——定位 omics 表单容器
        form_box = page.locator('div.bg-gray-50.rounded-xl.border', has=sel)
        if form_box.count() == 0:
            form_box = page.locator('.fixed div.bg-gray-50').last
        fi = form_box.locator('input')
        if fi.count() >= 3:
            fi.nth(0).fill('R1 晚疫病抗性标记')
            fi.nth(1).fill('Hosmani et al. 2020')
            fi.nth(2).fill('https://example.com/R1-marker')
        form_box.locator('textarea').fill('v2.11 UI 测试')
        form_box.locator('button', has_text='保存').first.click()
        page.wait_for_timeout(1000)
        body = page.locator('body').inner_text()
        check('O3 添加后条目可见(R1 标记)', 'R1 晚疫病抗性标记' in body, body[-200:])
        # API 取 id 清理
        try:
            AH = {'Authorization': f'Bearer {api_token()}'}
            accs = requests.get(f'{BASE}/api/accessions?page=1&limit=1', headers=AH, timeout=10).json()['accessions']
            acc_id = accs[0]['id']
            entries = requests.get(f'{BASE}/api/accessions/{acc_id}/omics', headers=AH, timeout=10).json()['entries']
            if entries:
                omics_added_id = entries[0]['id']
                requests.delete(f'{BASE}/api/omics/{omics_added_id}', headers=AH, timeout=10)
        except Exception as e:
            print('  cleanup warn:', e)
    else:
        check('O3 添加按钮存在', False, 'no add button')

    # 白屏 + 控制台
    for path, label in [('#/find', '找种质'), ('#/accessions', '种质'), ('#/dist', '分发'), ('#/dashboard', '工作台')]:
        page.evaluate(f"location.hash = '{path}'")
        page.wait_for_timeout(700)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页无白屏', len(txt) > 50, txt[:60])

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check('无 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:5]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.11 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
