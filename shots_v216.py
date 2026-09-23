# -*- coding: utf-8 -*-
# v2.16 截图：两主题下多维表格全景 + 代表页面（形状归一效果）
import sys, os, requests
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7800'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots_v216')
os.makedirs(OUT, exist_ok=True)

tok = requests.post(f'{BASE}/api/auth/login', json={'username': 'admin', 'password': 'admin123'}, timeout=10).json()['token']
AH = {'Authorization': f'Bearer {tok}'}

def set_theme(v):
    requests.put(f'{BASE}/api/my/settings', headers=AH, json={'key': 'ui.theme', 'value': v}, timeout=10)

def ui_login(page):
    page.goto(BASE + '/#/login', wait_until='networkidle', timeout=30000)
    page.evaluate("localStorage.removeItem('brc_token')")
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(600)
    pw = page.locator('input[type="password"]').first
    pw.wait_for(timeout=10000)
    page.locator('input').first.fill('admin')
    pw.fill('admin123')
    for i in range(page.locator('button').count()):
        txt = (page.locator('button').nth(i).inner_text() or '').replace(' ', '')
        if '登录' in txt:
            page.locator('button').nth(i).click(); break
    page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})

    # ---- brutalist ----
    set_theme('brutalist')
    ui_login(page)
    page.screenshot(path=os.path.join(OUT, '1_workbench_brutalist.png'))
    page.evaluate("location.hash = '#/accessions'"); page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUT, '2_accessions_brutalist.png'))
    page.locator('[data-testid="open-bitable"]').first.click(); page.wait_for_timeout(1800)
    page.screenshot(path=os.path.join(OUT, '3_bitable_brutalist.png'))

    # ---- classic ----
    set_theme('classic')
    page.reload(wait_until='networkidle'); page.wait_for_timeout(2000)
    page.locator('[data-testid="open-bitable"]').first.click(); page.wait_for_timeout(1800)
    page.screenshot(path=os.path.join(OUT, '4_bitable_classic.png'))
    page.locator('[data-testid="bt-back"]').click(); page.wait_for_timeout(700)
    page.screenshot(path=os.path.join(OUT, '5_accessions_classic.png'))
    page.evaluate("location.hash = '#/'"); page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUT, '6_workbench_classic.png'))

    browser.close()

set_theme('brutalist')
print('saved to', OUT)
for f in sorted(os.listdir(OUT)):
    print(' -', f)
