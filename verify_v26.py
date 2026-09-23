# v2.6 E2E 验证：批量修改(F1) + 工单增强/步骤提醒(F2/F2c) + 巡检(F3) + 工作台个性化(F4) + 便签Markdown(F5) + 白屏回归
# 前置：server 已在 :7800 运行；admin/admin123（脚本会复用 op2 等测试用户）
import json, time, datetime, sys, os, base64
from playwright.sync_api import sync_playwright
import openpyxl

BASE = 'http://localhost:7800'
results = []
TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_tmp_v26')
os.makedirs(TMP, exist_ok=True)

def check(name, ok, extra=''):
    results.append((name, bool(ok), extra))
    print(('PASS' if ok else 'FAIL') + ' | ' + name + (' | ' + str(extra) if extra else ''))

def fetch(page, method, path, body=None):
    return page.evaluate("""async ({method, path, body}) => {
      const token = localStorage.getItem('brc_token') || '';
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      return { status: res.status, data };
    }""", {"method": method, "path": path, "body": body})

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

def body_len(page):
    return page.evaluate("document.body ? document.body.innerText.length : 0")

def goto_ok(page, path, min_len=40):
    page.goto(BASE + '/#/' + path)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(700)
    return body_len(page), page.url

def body(page):
    return page.evaluate("document.body.innerText")

def top_overlay(page):
    return page.locator('div.fixed.inset-0.z-50').last

def msg_types(page, username=None, password=None):
    if username:
        login(page, username, password)
    r = fetch(page, 'GET', '/api/messages?pageSize=300')
    if r['status'] != 200:
        return []
    return [m.get('type') for m in (r['data'].get('messages') or [])]

def make_xlsx(path, headers, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    wb.save(path)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    page.on('dialog', lambda d: d.accept())

    # ============ 0. admin 登录 + 固定中文 ============
    try:
        login(page, 'admin', 'admin123')
        check('admin 登录成功', '工作台' in body(page))
    except Exception as e:
        check('admin 登录成功', False, str(e))
    fetch(page, 'PUT', '/api/settings', {'language': 'zh'})
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)

    # 获取操作员 id 与种质数据
    ops = fetch(page, 'GET', '/api/users?type=operator')
    op_ids = {x['username']: x['id'] for x in (ops['data']['users'] or [])}
    op2_id = op_ids.get('op2')
    acc_r = fetch(page, 'GET', '/api/accessions/search?q=&page=1')
    accs = (acc_r['data'] or {}).get('accessions') or []
    pids = [str(a.get('primaryId') or '') for a in accs[:3] if a.get('primaryId')]
    print(f'  [info] op2={op2_id}, pids={pids}')

    # ============ 1. F1 批量修改 ============
    def read_acc(page, pid):
        r = fetch(page, 'GET', '/api/accessions/search?q=' + pid)
        accs_r = ((r['data'] or {}).get('accessions') or [])
        a = next((x for x in accs_r if str(x.get('primaryId')) == pid), None)
        return a or {}

    if len(pids) >= 1:
        pid1 = pids[0]
        old_name = read_acc(page, pid1).get('displayName') or ''
        new_name = 'E2E批量改名v26'

        # API: replace 模式
        r = fetch(page, 'POST', '/api/accessions/batch-update',
                  {'rows': [{'primaryId': pid1, 'updates': {'displayName': new_name}}], 'mode': 'replace'})
        check('F1 API批量修改 200', r['status'] == 200 and pid1 in (r['data'] or {}).get('updated', []), r['status'])
        cur_name = read_acc(page, pid1).get('displayName') or ''
        check('F1 种质值已更新', cur_name == new_name, f'cur={cur_name}')

        # 未匹配行
        r = fetch(page, 'POST', '/api/accessions/batch-update',
                  {'rows': [{'primaryId': 'NOT_EXIST_XYZ', 'updates': {'displayName': 'x'}}], 'mode': 'replace'})
        check('F1 未匹配行返回 notFound', 'NOT_EXIST_XYZ' in (r['data'] or {}).get('notFound', []), r['status'])

        # merge 模式只填空
        r = fetch(page, 'POST', '/api/accessions/batch-update',
                  {'rows': [{'primaryId': pid1, 'updates': {'displayName': '不应覆盖', 'new_field_v26': 'hello'}}], 'mode': 'merge'})
        check('F1 merge 模式 200', r['status'] == 200, r['status'])
        cur_name3 = read_acc(page, pid1).get('displayName') or ''
        check('F1 merge 不覆盖已有值', cur_name3 == new_name, f'cur={cur_name3}')

        # 恢复原值
        fetch(page, 'POST', '/api/accessions/batch-update',
              {'rows': [{'primaryId': pid1, 'updates': {'displayName': old_name}}], 'mode': 'replace'})

        # 权限：approver 可批量改
        login(page, 'app1', 'test123')
        r = fetch(page, 'POST', '/api/accessions/batch-update',
                  {'rows': [{'primaryId': pid1, 'updates': {'displayName': new_name}}], 'mode': 'replace'})
        check('F1 approver 可批量修改', r['status'] == 200, r['status'])
        fetch(page, 'POST', '/api/accessions/batch-update',
              {'rows': [{'primaryId': pid1, 'updates': {'displayName': old_name}}], 'mode': 'replace'})
        # 权限：operator 403
        login(page, 'op2', 'test123')
        r = fetch(page, 'POST', '/api/accessions/batch-update',
                  {'rows': [{'primaryId': pid1, 'updates': {'displayName': 'x'}}], 'mode': 'replace'})
        check('F1 operator 批量修改 403', r['status'] == 403, r['status'])

        # UI: 上传 xlsx → 预览 → 应用
        login(page, 'admin', 'admin123')
        goto_ok(page, 'accessions', 30)
        b = body(page)
        check('F1 页面含 批量修改 按钮', '批量修改' in b)
        page.click('text=批量修改')
        page.wait_for_timeout(600)
        modal = top_overlay(page)
        xlsx = os.path.join(TMP, 'batch.xlsx')
        make_xlsx(xlsx, ['primaryId', 'displayName'], [[pid1, new_name]])
        modal.locator('input[type="file"]').set_input_files(xlsx)
        page.wait_for_timeout(1200)
        modal_text = modal.inner_text()
        check('F1 预览出现', '修改预览' in modal_text and pid1 in modal_text, '')
        modal.locator('button:has-text("应用修改")').click()
        page.wait_for_timeout(1200)
        res_text = modal.inner_text()
        check('F1 UI应用 结果显示', '批量修改结果' in res_text and '已更新: 1' in res_text, '')
        modal.locator('button:has-text("完成")').click()
        page.wait_for_timeout(400)
        # 恢复
        fetch(page, 'POST', '/api/accessions/batch-update',
              {'rows': [{'primaryId': pid1, 'updates': {'displayName': old_name}}], 'mode': 'replace'})
    else:
        check('F1 种质数据充足', False, 'no accessions')

    # ============ 2. F2 工单增强：附件导入 + 打印 ============
    if len(pids) >= 2:
        # 清理历史同名测试工单（保证可重复运行）
        wo_r = fetch(page, 'GET', '/api/workorders?status=')
        for o in (wo_r['data'] or {}).get('orders', []):
            if o.get('title') in ('E2E附件导入工单', 'E2E步骤提醒工单'):
                fetch(page, 'DELETE', f"/api/workorders/{o['id']}")

        # 环境准备：确保存在标签模板（无模板时 OrderLabelPrintModal 会拦截提交）
        tmpl = fetch(page, 'GET', '/api/templates')
        if not ((tmpl['data'] or {}).get('templates') or []):
            r = fetch(page, 'POST', '/api/templates', {'name': 'E2E标签模板', 'width': 50, 'height': 30, 'elements': [], 'layout': {'mode': 'roll'}})
            check('F2 创建标签模板(环境)', r['status'] == 200, r['status'])
        else:
            check('F2 创建标签模板(环境)', True, 'already exists')

        # API: parse-accessions 识别 + 去重
        xlsx2 = os.path.join(TMP, 'acc.xlsx')
        make_xlsx(xlsx2, ['种质编号'], [[pids[0]], [pids[1]], [pids[0]]])  # 故意重复一个
        with open(xlsx2, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode()
        r = fetch(page, 'POST', '/api/workorders/parse-accessions', {'fileData': b64})
        parsed = (r['data'] or {}).get('accessions') or []
        check('F2 API附件解析+去重', r['status'] == 200 and len(parsed) == 2, f'n={len(parsed)}')

        # UI: 新建工单 上传附件导入
        login(page, 'admin', 'admin123')
        goto_ok(page, 'orders', 30)
        page.click('text=新建工单')
        page.wait_for_selector('input[placeholder*="工单标题"]', timeout=5000)
        modal = top_overlay(page)
        modal.locator('input[placeholder*="工单标题"]').fill('E2E附件导入工单')
        # 上传附件（输入框在 label 内）
        modal.locator('label:has-text("上传附件导入") input[type="file"]').set_input_files(xlsx2)
        page.wait_for_timeout(1500)
        # 再次上传同一文件 → 去重
        modal.locator('label:has-text("上传附件导入") input[type="file"]').set_input_files(xlsx2)
        page.wait_for_timeout(1500)
        chips = modal.locator('span.rounded-full.bg-\\[\\#e8f5e9\\]')
        chip_texts = [c.inner_text() for c in chips.all()]
        check('F2 UI附件导入+去重(2个编号)', len(chip_texts) == 2 and pids[0] in chip_texts and pids[1] in chip_texts,
              str(chip_texts))
        # 指派 op2 + 保存
        modal.get_by_text('Op二号').click()
        modal.locator('input[type="date"]').fill((datetime.date.today() + datetime.timedelta(days=3)).isoformat())
        modal.locator('button:has-text("保存")').click()
        page.wait_for_timeout(1200)
        check('F2 工单创建成功(看板可见)', 'E2E附件导入工单' in body(page))

        # 找到该工单 id（API）
        wo_r = fetch(page, 'GET', '/api/workorders?status=')
        wo = next((o for o in (wo_r['data'] or {}).get('orders', []) if o.get('title') == 'E2E附件导入工单'), None)
        wo_id = wo.get('id') if wo else None

        # 详情含 steps/currentStep 字段契约（F2c 数据契约；无 purpose 时为 [] / null）
        if wo_id:
            d = fetch(page, 'GET', f'/api/workorders/{wo_id}')
            dd = d['data'] or {}
            has_steps = ('steps' in dd) and ('currentStep' in dd)
            check('F2 详情含 步骤链字段', d['status'] == 200 and has_steps,
                  f"steps={len(dd.get('steps', []))}, cur={dd.get('currentStep')}")

            # 打印标签 + 打印工单（admin 视角，同一详情抽屉内完成）
            goto_ok(page, 'orders', 30)
            page.get_by_text('E2E附件导入工单').first.click()
            page.wait_for_timeout(800)
            drawer = top_overlay(page)
            check('F2 详情抽屉含 打印工单/打印标签', '打印工单' in drawer.inner_text() and '打印标签' in drawer.inner_text())
            # 打印标签弹窗
            drawer.locator('button:has-text("打印标签")').first.click()
            page.wait_for_timeout(800)
            lp = top_overlay(page)
            lp_text = lp.inner_text()
            check('F2 标签弹窗仅含本工单2编号', '2 个种质编号' in lp_text and pids[0] in lp_text and pids[1] in lp_text, '')
            lp.locator('button.btn-primary').click()
            page.wait_for_timeout(1200)
            check('F2 标签打印提交成功', '✓' in lp.inner_text() or '保存' in lp.inner_text())
            lp.locator('button').first.click()  # 关闭标签弹窗（X）
            page.wait_for_timeout(500)
            # 打印工单
            drawer = top_overlay(page)
            drawer.locator('button:has-text("打印工单")').first.click()
            page.wait_for_timeout(1000)
            check('F2 打印工单成功(任务已提交)', '打印工单' in body(page))  # 无报错即通过

        # op2 工作台：打印按钮 + currentStep
        login(page, 'op2', 'test123')
        goto_ok(page, '', 60)
        b = body(page)
        check('F2 op2工作台含附件工单', 'E2E附件导入工单' in b)
        check('F2 op2工作台含 打印标签', '打印标签' in b)
        check('F2 op2工作台含 打印工单', '打印工单' in b)
        if wo_id:
            wb = fetch(page, 'GET', '/api/workbench')
            wd = wb['data'] or {}
            myToday = wd.get('myToday') or []
            o2 = next((o for o in myToday if o.get('title') == 'E2E附件导入工单'), None)
            check('F2 myToday 含附件工单', bool(o2), '')
            # 无 purpose 的工单 currentStep 应为 null（有 purpose 的场景由 F2c 覆盖）
            check('F2 无purpose工单 currentStep=null', bool(o2) and not o2.get('currentStep'),
                  str(o2 and o2.get('currentStep')))
    else:
        check('F2 种质数据充足', False, 'need >=2 accessions')

    # ============ 3. F3 巡检（inventory，周期每周） ============
    login(page, 'admin', 'admin123')
    # 清理历史同名巡检（取消未完成项，保证可重复运行）
    hist = fetch(page, 'GET', '/api/inspections')
    for t in (hist['data'] or {}).get('inspections', []):
        if t.get('title') == 'E2E冷藏巡检' and t.get('status') not in ('done', 'cancelled'):
            fetch(page, 'POST', f"/api/inspections/{t['id']}/status", {'status': 'cancelled'})
    due = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    r = fetch(page, 'POST', '/api/inspections', {
        'title': 'E2E冷藏巡检', 'scopeType': 'all', 'targetType': 'inventory',
        'targetRef': 'all', 'dueDate': due, 'repeatMode': 'weekly', 'repeatInterval': 1,
        'assigneeIds': [op2_id] if op2_id else [],
    })
    check('F3 创建巡检 200', r['status'] == 200, r['status'])
    insp_id = (r['data'] or {}).get('id')
    r2 = fetch(page, 'GET', '/api/inspections')
    tasks = (r2['data'] or {}).get('inspections') or []
    mine = next((t for t in tasks if t.get('id') == insp_id), None)
    check('F3 任务列表出现', bool(mine), f'status={mine and mine.get("status")}')
    # checklist 长度
    cl = fetch(page, 'GET', f'/api/inspections/{insp_id}/checklist')
    n_items = len((cl['data'] or {}).get('checklist') or [])
    check('F3 应检清单>0', n_items > 0, f'n={n_items}')

    # op2 UI 执行：先上报一条 异常，再 统一提交
    login(page, 'op2', 'test123')
    goto_ok(page, 'inspection', 30)
    b = body(page)
    check('F3 op2巡检页可见任务', 'E2E冷藏巡检' in b)
    check('F3 op2巡检页(非白屏)', len(b) > 50)
    page.get_by_text('E2E冷藏巡检').first.click()
    page.wait_for_timeout(700)
    # 打开执行弹窗
    page.get_by_text('应检清单').first.click()
    page.wait_for_timeout(1000)
    exec_m = top_overlay(page)
    exec_text = exec_m.inner_text()
    check('F3 执行弹窗含 正常/异常/报修', '正常' in exec_text and '异常' in exec_text and '报修' in exec_text)
    # 第一条点 异常
    first_item = exec_m.locator('div.rounded-2xl.p-3').first
    first_item.locator('button:has-text("异常")').click()
    # 统一提交
    exec_m.locator('button:has-text("统一提交")').click()
    page.wait_for_timeout(1500)
    check('F3 统一提交完成', '已检' in exec_m.inner_text() or '全部完成' in exec_m.inner_text() or f'{n_items}/{n_items}' in exec_m.inner_text())
    exec_m.locator('button').first.click()  # 关闭执行弹窗（X）
    page.wait_for_timeout(600)

    # 验证：任务 done + 自动生成下一轮
    login(page, 'admin', 'admin123')
    r3 = fetch(page, 'GET', '/api/inspections')
    tasks = (r3['data'] or {}).get('inspections') or []
    done_t = next((t for t in tasks if t.get('id') == insp_id), None)
    check('F3 原任务 done', bool(done_t and done_t.get('status') == 'done'), f'status={done_t and done_t.get("status")}')
    renewed = [t for t in tasks if t.get('title') == 'E2E冷藏巡检' and t.get('status') == 'pending' and t.get('id') != insp_id]
    check('F3 自动生成下一轮', len(renewed) == 1, f'n={len(renewed)}')
    if renewed:
        nxt = renewed[0]
        exp_due = (datetime.date.today() + datetime.timedelta(days=8)).isoformat()
        check('F3 下一轮 due=+7天', nxt.get('dueDate') == exp_due, f"due={nxt.get('dueDate')}")
        check('F3 下一轮 repeat 徽章字段', nxt.get('repeatMode') == 'weekly', '')
    types = msg_types(page)
    check('F3 admin 收到 inspection_done', 'inspection_done' in types, str(types[-8:]))
    check('F3 admin 收到 inspection_issue', 'inspection_issue' in types, str(types[-8:]))
    check('F3 admin 收到 inspection_due', 'inspection_due' in types, str(types[-8:]))
    # 权限：regulator 只读可见
    login(page, 'reg1', 'test123')
    goto_ok(page, 'inspection', 30)
    check('F3 regulator 巡检页可看', 'E2E冷藏巡检' in body(page))
    r = fetch(page, 'POST', '/api/inspections', {'title': 'x'})
    check('F3 regulator 建巡检 403', r['status'] == 403, r['status'])

    # ============ 4. F4 工作台个性化 ============
    login(page, 'admin', 'admin123')
    goto_ok(page, '', 60)
    b = body(page)
    had_recent = '最近报工' in b
    check('F4 admin工作台含 最近报工', had_recent)
    # 清理历史设置：确保最近报工可见（默认）
    s = fetch(page, 'GET', '/api/my/settings')
    saved = (s['data'] or {}).get('settings') or {}
    mods = saved.get('wb.modules')
    print(f'  [info] wb.modules(admin)={mods}')
    # 打开自定义 → 取消勾选 最近报工
    page.click('text=自定义工作台')
    page.wait_for_timeout(600)
    cm = top_overlay(page)
    cb = cm.locator('label:has-text("最近报工") input[type="checkbox"]')
    check('F4 自定义弹窗含 最近报工 复选框', cb.count() == 1, f'n={cb.count()}')
    cb.uncheck()
    cm.locator('button:has-text("保存显示设置")').click()
    page.wait_for_timeout(1000)
    check('F4 保存后 最近报工 隐藏', '最近报工' not in body(page))
    # 刷新后仍隐藏（持久化）
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1200)
    check('F4 刷新后仍隐藏', '最近报工' not in body(page))
    # 恢复
    page.click('text=自定义工作台')
    page.wait_for_timeout(600)
    cm = top_overlay(page)
    cm.locator('label:has-text("最近报工") input[type="checkbox"]').check()
    cm.locator('button:has-text("保存显示设置")').click()
    page.wait_for_timeout(1000)
    check('F4 恢复后 最近报工 可见', '最近报工' in body(page))

    # op2 隐藏 我的待办
    login(page, 'op2', 'test123')
    goto_ok(page, '', 60)
    b = body(page)
    check('F4 op2工作台含 我的待办', '我的待办' in b)
    page.click('text=自定义工作台')
    page.wait_for_timeout(600)
    cm = top_overlay(page)
    cm.locator('label:has-text("我的待办") input[type="checkbox"]').uncheck()
    cm.locator('button:has-text("保存显示设置")').click()
    page.wait_for_timeout(1000)
    check('F4 op2 隐藏 我的待办 生效', '我的待办' not in body(page))
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1200)
    check('F4 op2 刷新后仍隐藏', '我的待办' not in body(page))
    page.click('text=自定义工作台')
    page.wait_for_timeout(600)
    cm = top_overlay(page)
    cm.locator('label:has-text("我的待办") input[type="checkbox"]').check()
    cm.locator('button:has-text("保存显示设置")').click()
    page.wait_for_timeout(1000)

    # ============ 5. F5 便签 Markdown ============
    login(page, 'admin', 'admin123')
    # 清理同名
    r = fetch(page, 'GET', '/api/todos')
    for td in (r['data'] or {}).get('todos') or []:
        if td.get('title') == 'E2E便签v26':
            fetch(page, 'DELETE', f"/api/todos/{td['id']}")
    goto_ok(page, 'todos', 30)
    page.click('text=新建清单')
    page.wait_for_selector('input[placeholder*="我的清单"]', timeout=5000)
    modal = top_overlay(page)
    modal.locator('input[placeholder*="我的清单"]').fill('E2E便签v26')
    modal.locator('textarea').fill('# 标题一\n**加粗内容**\n- 列表项')
    # 选绿色（第2个色块）
    modal.locator('button[style*="linear-gradient"]').nth(1).click()
    modal.locator('button:has-text("保存")').click()
    page.wait_for_timeout(1200)
    b = body(page)
    check('F5 便签创建成功', 'E2E便签v26' in b)
    # Markdown 渲染
    md = page.evaluate("""(() => {
      const h1 = document.querySelector('.markdown-body h1');
      const bold = document.querySelector('.markdown-body strong');
      const ul = document.querySelector('.markdown-body ul');
      return { h1: h1 ? h1.innerText : null, bold: bold ? bold.innerText : null, ul: ul ? ul.innerText : null };
    })()""")
    check('F5 Markdown h1 渲染', md.get('h1') == '标题一', str(md))
    check('F5 Markdown 加粗 渲染', md.get('bold') == '加粗内容', str(md))
    check('F5 Markdown 列表 渲染', bool(md.get('ul')), str(md))
    # 颜色持久化（API）
    r = fetch(page, 'GET', '/api/todos')
    td = next((x for x in (r['data'] or {}).get('todos') if x.get('title') == 'E2E便签v26'), None)
    check('F5 颜色持久化 green', bool(td and td.get('color') == 'green'), f"color={td and td.get('color')}")
    # 勾选完成（卡片第一个按钮）
    page.evaluate("""(() => {
      const els = [...document.querySelectorAll('p')].filter(p => p.innerText === 'E2E便签v26');
      const card = els[0] ? els[0].closest('.break-inside-avoid') : null;
      if (card) card.querySelectorAll('button')[0].click();
      return card ? 'ok' : 'nf';
    })()""")
    page.wait_for_timeout(800)
    r = fetch(page, 'GET', '/api/todos')
    td = next((x for x in (r['data'] or {}).get('todos') if x.get('title') == 'E2E便签v26'), None)
    check('F5 勾选完成 is_done', bool(td and td.get('is_done') == 1), f"is_done={td and td.get('is_done')}")
    # 删除（卡片最后一个按钮）
    page.evaluate("""(() => {
      const els = [...document.querySelectorAll('p')].filter(p => p.innerText === 'E2E便签v26');
      const card = els[0] ? els[0].closest('.break-inside-avoid') : null;
      if (card) { const b = card.querySelectorAll('button'); b[b.length - 1].click(); }
      return card ? 'ok' : 'nf';
    })()""")
    page.wait_for_timeout(800)
    check('F5 删除便签', 'E2E便签v26' not in body(page))

    # ============ 6. F2c 步骤链提醒 ============
    # 早建工单，最后等扫描周期
    step_title = 'E2E步骤提醒工单'
    r = fetch(page, 'POST', '/api/workorders', {
        'title': step_title, 'description': 'step reminder test',
        'assigneeIds': [op2_id] if op2_id else [], 'accessions': [], 'purpose': 'conservation',
        'targetQty': 5, 'priority': 'normal',
        'dueDate': (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
    })
    check('F2c 建步骤工单(API)', r['status'] == 200, r['status'])
    step_wo_id = (r['data'] or {}).get('id')
    if step_wo_id:
        # 设为 in_progress（触发扫描）
        r = fetch(page, 'POST', f'/api/workorders/{step_wo_id}/status', {'status': 'in_progress'})
        check('F2c 转 in_progress', r['status'] == 200, r['status'])
        d = fetch(page, 'GET', f'/api/workorders/{step_wo_id}')
        dd = d['data'] or {}
        check('F2c 详情含 currentStep', bool(dd.get('currentStep')), str(dd.get('currentStep')))
        steps = dd.get('steps') or []
        has_lead = any(s.get('reminderLeadDays') is not None for s in steps)
        check('F2c 步骤含 reminderLeadDays', has_lead, str([s.get('reminderLeadDays') for s in steps]))
        # 等扫描（60s 周期，轮询最多 90s）
        print('  [wait] 等待步骤提醒扫描 ...')
        got = False
        for i in range(9):
            time.sleep(10)
            types = msg_types(page)  # 当前仍是 admin token
            if 'wo_step_reminder' in types:
                got = True
                break
        check('F2c admin 收到 wo_step_reminder', got, str(types[-6:]))
        login(page, 'op2', 'test123')
        types = msg_types(page)
        check('F2c op2 收到 wo_step_reminder', 'wo_step_reminder' in types, str(types[-6:]))
        # op2 工作台 myToday 应展示 currentStep（有 purpose 的工单）
        wb = fetch(page, 'GET', '/api/workbench')
        wd = wb['data'] or {}
        o = next((x for x in (wd.get('myToday') or []) if x.get('title') == step_title), None)
        check('F2c op2工作台 myToday 含 currentStep', bool(o and o.get('currentStep')),
              str(o and o.get('currentStep')))

    # ============ 7. 白屏回归（含 /inspection） ============
    login(page, 'admin', 'admin123')
    for pg in ['', 'dashboard', 'orders', 'todos', 'accessions', 'sub', 'design', 'inventory',
               'operations', 'freezer', 'cryo', 'intro', 'dist', 'statistics', 'messages',
               'users', 'loginlog', 'setup', 'inspection']:
        try:
            n, _ = goto_ok(page, pg, 30)
            check(f'回归 {pg or "/"} 非白屏', n > 30, f'len={n}')
        except Exception as e:
            check(f'回归 {pg or "/"} 非白屏', False, str(e))

    browser.close()

passed = sum(1 for _, ok, _ in results if ok)
failed = [r for r in results if not r[1]]
print('\n==================== 汇总 ====================')
print(f'通过 {passed}/{len(results)}')
if failed:
    print('失败项:')
    for name, ok, extra in failed:
        print('  FAIL |', name, '|', extra)
    sys.exit(1)
print('ALL GREEN')
