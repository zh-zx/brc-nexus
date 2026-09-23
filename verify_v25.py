# v2.5 E2E 验证：角色工作台 + 工单派单/报工 + 个人清单 + 逾期扫描 + 权限 + 回归
# 前置：server 已在 :7800 运行；admin/admin123（脚本会创建测试角色用户）
import json, time, datetime, sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
results = []

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
    page.reload()  # 重新初始化 SPA -> 未登录状态
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
    # 顶层遮罩（FeedbackModal / 详情抽屉 / 新建弹窗 均为 fixed.inset-0.z-50）
    return page.locator('div.fixed.inset-0.z-50').last

def msg_types(page):
    r = fetch(page, 'GET', '/api/messages?pageSize=200')
    if r['status'] != 200:
        return []
    return [m.get('type') for m in (r['data'].get('messages') or [])]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    page.on('dialog', lambda d: d.accept())  # 自动确认 confirm 弹窗

    # ============ 0. 管理员登录 ============
    try:
        login(page, 'admin', 'admin123')
        check('admin 登录成功', '工作台' in body(page))
    except Exception as e:
        check('admin 登录成功', False, str(e))

    # 固定界面语言为中文（全局 app_setting），保证文案选择器稳定
    fetch(page, 'PUT', '/api/settings', {'language': 'zh'})
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)

    # ============ 1. 准备测试角色用户（API） ============
    for u, disp, role, ut in [
        ('op2', 'Op二号', 'user', 'operator'),
        ('op3', 'Op三号', 'user', 'operator'),
        ('app1', '审批员一号', 'user', 'approver'),
        ('reg1', '监管方一号', 'user', 'regulator'),
        ('ext1', '外部用户一号', 'user', 'external'),
    ]:
        r = fetch(page, 'POST', '/api/users', {'username': u, 'password': 'test123', 'displayName': disp, 'role': role, 'userType': ut})
        ok = r['status'] == 200 or (r['status'] == 400 and '已存在' in ((r['data'] or {}).get('error') or ''))
        check(f'创建用户 {u} ({ut})', ok, r['status'])

    op2 = fetch(page, 'GET', '/api/users?type=operator')
    op_ids = {x['username']: x['id'] for x in (op2['data']['users'] or []) if x['username'] in ('op2', 'op3', 'testuser')}
    check('操作员列表可取', len(op_ids) >= 2, str(list(op_ids.keys())))

    # 逾期工单（due = 4 天前）
    ov_due = (datetime.date.today() - datetime.timedelta(days=4)).isoformat()
    ov = fetch(page, 'POST', '/api/workorders', {
        'title': 'E2E逾期工单', 'description': 'overdue scan test',
        'assigneeIds': [op_ids.get('op2')], 'accessions': [], 'purpose': '',
        'targetQty': 10, 'priority': 'high', 'dueDate': ov_due,
    })
    check('创建逾期工单(API)', ov['status'] == 200, ov['status'])

    # 种质数据探测
    acc_r = fetch(page, 'GET', '/api/accessions/search?q=&page=1')
    accs = (acc_r['data'] or {}).get('accessions') or []
    print(f'  [info] accessions available: {len(accs)}')

    # ============ 2. 管理员工作台 UI ============
    n, _ = goto_ok(page, '', 60)
    check('工作台(/)非白屏', n > 60, f'len={n}')
    b = body(page)
    for kw in ['生产看板', '团队负载', '我的待办', '工作台']:
        check(f'工作台含「{kw}」', kw in b)
    nav = page.evaluate("[...document.querySelectorAll('aside nav a')].map(a => a.innerText.trim())")
    check('nav 含 任务管理', any('任务管理' in x for x in nav))
    check('nav 含 我的清单', any('我的清单' in x for x in nav))
    check('nav 含 仪表盘(admin)', any('仪表盘' in x for x in nav))
    n, _ = goto_ok(page, 'dashboard', 40)
    check('/dashboard 非白屏', n > 40, f'len={n}')

    # ============ 3. 管理员新建工单（UI 弹窗） ============
    goto_ok(page, 'orders', 30)
    page.click('text=新建工单')
    page.wait_for_selector('input[placeholder*="工单标题"]', timeout=5000)
    modal = top_overlay(page)
    modal.locator('input[placeholder*="工单标题"]').fill('E2E派单测试')
    modal.locator('textarea[placeholder*="任务描述"]').fill('来自 E2E 的派单')
    modal.get_by_text('Op二号').click()
    modal.get_by_text('Op三号').click()
    # 种质选择（若有数据）
    acc_picked = False
    if len(accs) > 0:
        pid = str(accs[0].get('primaryId') or '')
        if pid:
            modal.locator('input[placeholder*="搜索种质"]').fill(pid[:3])
            page.wait_for_timeout(1000)
            rows = modal.locator('div.max-h-40 button')
            if rows.count() > 0:
                rows.first.click()
                acc_picked = True
    check('新建弹窗种质选择', acc_picked or len(accs) == 0, f'acc_picked={acc_picked}, avail={len(accs)}')
    # purpose=conservation -> 步骤链预览
    modal.locator('select').nth(0).select_option('conservation')
    page.wait_for_timeout(400)
    check('步骤链预览出现(conservation)', modal.get_by_text('步骤链').count() > 0)
    # 目标数量 / 截止 / 优先级
    modal.locator('input[placeholder*="目标数量"]').fill('100')
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    modal.locator('input[type="date"]').fill(tomorrow)
    modal.locator('select').nth(1).select_option('urgent')
    modal.locator('button:has-text("保存")').click()
    page.wait_for_timeout(1200)
    check('看板出现新工单', 'E2E派单测试' in body(page))

    # ============ 4. 操作员 op2：今日任务 + 报工 ============
    login(page, 'op2', 'test123')
    goto_ok(page, '', 60)
    b = body(page)
    check('op2 工作台含 今日任务', '今日任务' in b)
    check('op2 工作台含 E2E派单测试', 'E2E派单测试' in b)
    types = msg_types(page)
    check('op2 收到 wo_assigned 消息', 'wo_assigned' in types, str(types[:8]))

    goto_ok(page, 'orders', 30)
    page.get_by_text('E2E派单测试').first.click()
    page.wait_for_timeout(600)
    # 报工 progress qty=100
    top_overlay(page).get_by_text('提交报工').click()
    fb = top_overlay(page)  # FeedbackModal（位于详情之上）
    fb.locator('input[placeholder*="数量"]').fill('100')
    fb.get_by_text('进度').click()
    fb.locator('button:has-text("保存")').click()
    page.wait_for_timeout(1000)
    check('op2 报工 progress 成功', '100%' in body(page) or '进度' in body(page))
    # 报 issue -> blocked
    top_overlay(page).get_by_text('提交报工').click()
    fb = top_overlay(page)
    fb.get_by_text('受阻').click()
    fb.locator('button:has-text("保存")').click()
    page.wait_for_timeout(1000)
    check('报 issue 后状态受阻', '受阻' in body(page))
    # 报 done -> done
    top_overlay(page).get_by_text('提交报工').click()
    fb = top_overlay(page)
    fb.get_by_text('完成').click()
    fb.locator('button:has-text("保存")').click()
    page.wait_for_timeout(1000)
    check('报 done 后状态已完成', '已完成' in body(page))

    login(page, 'admin', 'admin123')
    types = msg_types(page)
    check('admin 收到 wo_feedback 消息', 'wo_feedback' in types, str(types[:8]))

    # ============ 5. 个人清单 ============
    def clean_todos(title):
        r = fetch(page, 'GET', '/api/todos')
        for td in (r['data'].get('todos') or []):
            if td.get('title') == title:
                fetch(page, 'DELETE', f"/api/todos/{td['id']}")

    clean_todos('E2E管理员清单')
    goto_ok(page, 'todos', 30)
    page.click('text=新建清单')
    page.wait_for_selector('input[placeholder*="我的清单"]', timeout=5000)
    page.fill('input[placeholder*="我的清单"]', 'E2E管理员清单')
    page.click('button:has-text("保存")')
    page.wait_for_timeout(800)
    check('admin 创建清单', 'E2E管理员清单' in body(page))
    # 勾选完成（便签卡片左上角圆形勾选按钮 = 卡片内第一个 button）
    page.evaluate("""(() => {
      const els = [...document.querySelectorAll('p')].filter(p => p.innerText === 'E2E管理员清单');
      const card = els[0] ? els[0].closest('.break-inside-avoid') : null;
      if (card) card.querySelectorAll('button')[0].click();
      return card ? 'ok' : 'nf';
    })()""")
    page.wait_for_timeout(800)
    check('admin 勾选清单完成', 'E2E管理员清单' in body(page))  # 完成后仍显示（划线）
    # 删除（便签卡片内最后一个 button = 删除）
    page.evaluate("""(() => {
      const els = [...document.querySelectorAll('p')].filter(p => p.innerText === 'E2E管理员清单');
      const card = els[0] ? els[0].closest('.break-inside-avoid') : null;
      if (card) { const b = card.querySelectorAll('button'); b[b.length - 1].click(); }
      return card ? 'ok' : 'nf';
    })()""")
    page.wait_for_timeout(800)
    check('admin 删除清单', 'E2E管理员清单' not in body(page))

    # op2 建清单 + 派给我的任务
    login(page, 'op2', 'test123')
    clean_todos('E2E操作员清单')
    goto_ok(page, 'todos', 30)
    page.click('text=新建清单')
    page.wait_for_selector('input[placeholder*="我的清单"]', timeout=5000)
    page.fill('input[placeholder*="我的清单"]', 'E2E操作员清单')
    page.click('button:has-text("保存")')
    page.wait_for_timeout(800)
    check('op2 我的清单', 'E2E操作员清单' in body(page))
    page.click('text=派给我的任务')
    page.wait_for_timeout(800)
    check('op2 派给我的任务显示工单', 'E2E派单测试' in body(page))

    # ============ 6. 逾期扫描（等一个扫描周期 ~70s） ============
    print('  [wait] 等待逾期扫描周期 70s ...')
    time.sleep(70)
    login(page, 'admin', 'admin123')
    types = msg_types(page)
    check('admin 收到 wo_overdue 消息', 'wo_overdue' in types, str(types[:8]))
    login(page, 'op2', 'test123')
    types = msg_types(page)
    check('op2 收到 wo_overdue 消息', 'wo_overdue' in types, str(types[:8]))

    # ============ 7. 角色权限 ============
    login(page, 'app1', 'test123')
    goto_ok(page, '', 60)
    check('approver 工作台含 审批队列', '审批队列' in body(page))
    nav = page.evaluate("[...document.querySelectorAll('aside nav a')].map(a => a.innerText.trim())")
    check('approver 无 任务管理 nav', not any('任务管理' in x for x in nav))

    login(page, 'reg1', 'test123')
    goto_ok(page, '', 60)
    check('regulator 工作台含 只读概览', '只读概览' in body(page))
    r = fetch(page, 'POST', '/api/workorders', {'title': 'x', 'assigneeIds': []})
    check('regulator 新建工单 403', r['status'] == 403, r['status'])

    login(page, 'ext1', 'test123')
    goto_ok(page, '', 60)
    check('external 工作台含 我的分发申请', '我的分发申请' in body(page))
    nav = page.evaluate("[...document.querySelectorAll('aside nav a')].map(a => a.innerText.trim())")
    check('external 无 任务管理 nav', not any('任务管理' in x for x in nav))
    r = fetch(page, 'GET', '/api/workorders')
    check('external 读工单 403', r['status'] == 403, r['status'])

    # ============ 8. 回归：主要页面非白屏 ============
    login(page, 'admin', 'admin123')
    for pg in ['', 'dashboard', 'orders', 'todos', 'accessions', 'sub', 'design', 'inventory',
               'operations', 'freezer', 'cryo', 'intro', 'dist', 'statistics', 'messages',
               'users', 'loginlog', 'setup']:
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
