# -*- coding: utf-8 -*-
# v2.18 全局设计精修截图：两主题 × 多页（工作台/工单/种质/设置/仪表盘），核对语义 token 观感
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
import requests

BASE = 'http://localhost:7800'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
os.makedirs(OUT, exist_ok=True)

PAGES = [
    ('workbench', '#/'),
    ('orders', '#/orders'),
    ('accessions', '#/accessions'),
    ('setup', '#/setup'),
    ('dashboard', '#/dashboard'),
]

def set_theme(theme):
    tok = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']
    requests.put(f'{BASE}/api/my/settings', headers={'Authorization': f'Bearer {tok}'}, json={'key': 'ui.theme', 'value': theme}, timeout=10)

def ui_login(page):
    page.goto(BASE + '/#/login', wait_until='networkidle', timeout=30000)
    page.evaluate("localStorage.removeItem('brc_token')")
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(600)
    pw = page.locator('input[type="password"]').first; pw.wait_for(timeout=10000)
    ins = page.locator('input')
    for i in range(ins.count()):
        if (ins.nth(i).get_attribute('type') or '') != 'password':
            ins.nth(i).fill('admin'); break
    pw.fill('admin123')
    for i in range(page.locator('button').count()):
        t = (page.locator('button').nth(i).inner_text() or '').replace(' ', '')
        if '登录' in t: page.locator('button').nth(i).click(); break
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1600)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    for theme in ['brutalist', 'classic']:
        set_theme(theme)
        ui_login(page)  # 登录后主题随 boot 应用；此处已在 classic/brutalist
        if theme == 'classic':
            page.reload(wait_until='networkidle'); page.wait_for_timeout(1200)
        for name, h in PAGES:
            page.evaluate(f"location.hash = '{h}'"); page.wait_for_timeout(1500)
            fn = os.path.join(OUT, f'v218_{name}_{theme}.png')
            page.screenshot(path=fn, full_page=True)
            print('saved', fn)
    set_theme('brutalist')  # 复位
    browser.close()
