# -*- coding: utf-8 -*-
# v2.17 截图：两主题下工作台控制室全景（命令栏/t-pod/指挥台折线/团队负载）
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright
import requests

BASE = 'http://localhost:7800'

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
        ui_login(page)
        page.evaluate("location.hash = '#/'"); page.wait_for_timeout(1800)
        # 悬停一个 t-pod 展示抬升
        try:
            page.locator('.t-pod').first.hover(); page.wait_for_timeout(400)
        except Exception: pass
        page.screenshot(path=f'/tmp/v217_workbench_{theme}.png', full_page=True)
        print(f'saved /tmp/v217_workbench_{theme}.png')
    set_theme('brutalist')  # 复位
    browser.close()
