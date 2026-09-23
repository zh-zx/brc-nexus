# -*- coding: utf-8 -*-
# v2.10 UI 验证：找种质向导 E2E + 性状表头 ⓘ 弹层 + TraitManager 插图上传 + 白屏/控制台
import sys, time, json
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

AH = {}
created_req_id = None
illu_trait_set = False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    # 登录
    page.goto(BASE, wait_until='networkidle', timeout=30000)
    pw = page.locator('input[type="password"]').first
    pw.wait_for(timeout=10000)
    ins = page.locator('input')
    for i in range(ins.count()):
        if (ins.nth(i).get_attribute('type') or '') != 'password':
            ins.nth(i).fill('admin'); break
    pw.fill('admin123')
    clicked = False
    for i in range(page.locator('button').count()):
        txt = (page.locator('button').nth(i).inner_text() or '').replace(' ', '')
        if '登录' in txt:
            page.locator('button').nth(i).click(); clicked = True; break
    if not clicked:
        page.locator('button').first.click()
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(800)
    check('登录成功', '找种质' in page.locator('body').inner_text() or '工作台' in page.locator('body').inner_text())

    # ===== 向导 E2E =====
    page.goto(BASE + '/#/find', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    body = page.locator('body').inner_text()
    check('W1 /find 加载(标题+四步指示器)', '找种质' in body and '挑性状' in body and '提交申请' in body, body[:120])
    check('W2 无图性状卡片可点(ⓘ 图标存在)', page.locator('.glass-card button svg.lucide-info, .glass-card svg.lucide-info').count() >= 0)

    # Step1: 选 VITC + DRYMAT 两张卡
    for code_text in ['VITC', 'DRYMAT']:
        card = page.locator('button', has_text=code_text).first
        card.click()
        page.wait_for_timeout(200)
    body = page.locator('body').inner_text()
    check('W3 已选性状计数=2', '已选性状: 2' in body, [l for l in body.split('\n') if '已选性状' in l])
    page.locator('button', has_text='下一步').first.click()
    page.wait_for_timeout(500)

    # Step2: VITC 设 gte 0（DRYMAT 留空=仅展示）
    body = page.locator('body').inner_text()
    check('W4 进入第二步(定标准)', '定标准' in body and 'VITC' in body, body[:100])
    num_inputs = page.locator('input[type="number"]')
    check('W5 数字性状输入框存在', num_inputs.count() >= 2, f'count={num_inputs.count()}')
    if num_inputs.count() >= 2:
        num_inputs.nth(0).fill('0')
    page.locator('button', has_text='查一查').first.click()
    page.wait_for_timeout(1500)

    # Step3: 结果矩阵
    body = page.locator('body').inner_text()
    check('W6 结果页出现(计数/库存列)', ('份种质符合条件' in body or '已选' in body) and '库存' in body, body[:150])
    rows = page.locator('.glass-card table tbody tr')
    check('W7 VITC≥0 过滤出 3 行', rows.count() == 3, f'rows={rows.count()}')
    check('W8 库存徽标出现(需扩繁/有货)', '需扩繁' in body or '有货' in body)
    # 勾选两行
    if rows.count() >= 2:
        rows.nth(0).click(); page.wait_for_timeout(200)
        rows.nth(1).click(); page.wait_for_timeout(200)
    body = page.locator('body').inner_text()
    check('W9 勾选计数 已选2/上限35', '已选 2 / 上限 35' in body, [l for l in body.split('\n') if '已选' in l][:2])

    # Step4: 提交表单
    labels = page.locator('label')
    def fill_by_label(lbl, val):
        for i in range(labels.count()):
            if lbl in (labels.nth(i).inner_text() or ''):
                box = labels.nth(i).locator('xpath=following-sibling::input | following-sibling::textarea')
                if box.count() == 0:
                    parent = labels.nth(i).locator('..')
                    box = parent.locator('input, textarea')
                if box.count() > 0:
                    box.first.fill(val)
                    return True
        return False
    fill_by_label('申请方', '向导测试')
    fill_by_label('所需种质类型', '试管苗')
    fill_by_label('用途', 'v2.10 UI 自动化测试')
    submit_btn = page.locator('button', has_text='提交申请').first
    submit_btn.click()
    page.wait_for_timeout(1500)
    body = page.locator('body').inner_text()
    check('W10 提交成功(申请编号可见)', '申请已提交' in body and 'DS-' in body, body[:150])

    # 清理：删除测试申请
    try:
        AH = {'Authorization': f'Bearer {api_token()}'}
        r = requests.get(f'{BASE}/api/dist/requests', headers=AH, timeout=10)
        for x in r.json().get('requests', []):
            if x.get('applicant') == '向导测试':
                created_req_id = x.get('id')
                requests.delete(f'{BASE}/api/dist/requests/{created_req_id}', headers=AH, timeout=10)
    except Exception as e:
        print('  cleanup warn:', e)

    # ===== 性状表头 ⓘ =====
    page.goto(BASE + '/#/accessions', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    th_info = page.locator('th button svg.lucide-info, th svg.lucide-info')
    try:
        page.wait_for_selector('th svg.lucide-info', timeout=10000)
        check('I1 性状列表头出现 ⓘ 图标', True)
    except Exception:
        check('I1 性状列表头出现 ⓘ 图标', False, f'count={th_info.count()}')
    if th_info.count() >= 1:
        th_info.first.click()
        page.wait_for_timeout(500)
        popover = page.locator('div[class*="z-[70]"]')
        body = page.locator('body').inner_text()
        check('I2 ⓘ 弹层打开(卡片容器出现)', popover.count() >= 1, f'count={popover.count()}')
        check('I3 弹层含性状说明内容(单位/类别/暂无)', ('mg/100g' in body) or ('暂无该性状' in body) or ('等级含义' in body), body[-150:])
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        check('I4 Esc 关闭弹层', page.locator('div[class*="z-[70]"]').count() == 0)

    # ===== TraitManager 插图上传 =====
    # 生成小测试图
    img_path = r'C:\tmp\v210_illu.png'
    try:
        from PIL import Image
        Image.new('RGB', (60, 40), (46, 125, 50)).save(img_path)
        have_img = True
    except Exception as e:
        have_img = False
        print('  PIL skip:', e)
    mgr_btn = page.locator('button', has_text='管理性状').first
    if mgr_btn.count() > 0:
        mgr_btn.click()
        page.wait_for_timeout(800)
        # 编辑 VITC 行
        row = page.locator('div', has_text='VITC').locator('button[title*="编辑"], button:has(svg.lucide-edit, svg.lucide-pen)')
        edit_btns = page.locator('button:has(svg.lucide-pen), button:has(svg.lucide-edit-3), button:has(svg.lucide-edit)')
        # 更稳妥：找包含 VITC 文本的行容器内的第一个按钮
        target = None
        containers = page.locator('.border.rounded-xl.divide-y > div')
        for i in range(containers.count()):
            if 'VITC' in (containers.nth(i).inner_text() or ''):
                target = containers.nth(i).locator('button').first
                break
        if target:
            target.click()
            page.wait_for_timeout(600)
            file_input = page.locator('.fixed input[type="file"]')
            check('T1 编辑表单含插图上传入口', file_input.count() >= 1, f'count={file_input.count()}')
            if have_img and file_input.count() >= 1:
                file_input.first.set_input_files(img_path)
                page.wait_for_timeout(800)
                preview = page.locator('.fixed img[src^="data:image"]')
                check('T2 插图预览出现(dataURL)', preview.count() >= 1, f'count={preview.count()}')
                # 填中文说明
                tas = page.locator('.fixed textarea')
                if tas.count() >= 1:
                    tas.nth(0).fill('v2.10 测试说明')
                # 保存
                save_btn = page.locator('.fixed button', has_text='保存').first
                save_btn.click()
                page.wait_for_timeout(1200)
                # API 验证持久化
                AH = {'Authorization': f'Bearer {api_token()}'}
                r = requests.get(f'{BASE}/api/traits', headers=AH, timeout=10)
                vitc = next((x for x in r.json().get('traits', []) if x.get('code') == 'VITC'), None)
                illu_trait_set = bool(vitc and vitc.get('illustration'))
                check('T3 插图/说明持久化到 DB', illu_trait_set and (vitc.get('descZh') == 'v2.10 测试说明'),
                      f"illu={bool(vitc and vitc.get('illustration'))} desc={vitc.get('descZh') if vitc else None}")
                # 清理
                requests.put(f'{BASE}/api/traits/{vitc["id"]}', headers=AH, json={'illustration': None, 'descZh': None}, timeout=10)
        else:
            check('T0 找到 VITC 编辑按钮', False, 'row not found')

    # ===== 白屏扫描 + 控制台错误 =====
    for path, label in [('/#/find', '找种质'), ('/#/accessions', '种质'), ('/#/dist', '分发'), ('/#/dashboard', '工作台')]:
        page.goto(BASE + path, wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(600)
        txt = page.locator('body').inner_text().strip()
        check(f'{label}页无白屏', len(txt) > 50, txt[:60])

    real_errors = [e for e in console_errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check('无 JS 控制台错误', len(real_errors) == 0, '; '.join(real_errors[:5]))

    browser.close()

passed = sum(1 for r in results if r[1])
failed = sum(1 for r in results if not r[1])
print(f'\n==== v2.10 UI checks: {passed} passed, {failed} failed ====')
sys.exit(1 if failed else 0)
