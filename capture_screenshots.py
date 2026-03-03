#!/usr/bin/env python3
"""Capture PikTag mobile screenshots for PPT presentation."""

import asyncio
from playwright.async_api import async_playwright

BASE_URL = "https://dist-gamma-pink.vercel.app"
OUTPUT_DIR = "/Users/aimand/.gemini/File/L PikTag/mobile/ppt-screenshots"
VIEWPORT = {"width": 375, "height": 812}

EMAIL = "piktag.verify3@yopmail.com"
PASSWORD = "TestPik123!"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=2,  # Retina quality
        )
        page = await context.new_page()

        # 1. Login page screenshot
        print("📸 1. Login page...")
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{OUTPUT_DIR}/01_login.png", full_page=False)
        print("   ✅ Login saved")

        # 2. Do login
        print("🔐 Logging in...")
        await page.fill('input[type="email"]', EMAIL)
        await page.fill('input[type="password"]', PASSWORD)
        # Click login button
        buttons = await page.query_selector_all('div[role="button"]')
        if not buttons:
            buttons = await page.query_selector_all('div[style*="cursor: pointer"]')
        # Try finding the login button by text
        login_btn = await page.query_selector('text=登入')
        if login_btn:
            await login_btn.click()
        else:
            # Click the first button-like element after password field
            for btn in buttons:
                text = await btn.inner_text()
                if "登入" in text or text.strip() == "":
                    await btn.click()
                    break
        await page.wait_for_timeout(4000)
        await page.wait_for_load_state("networkidle")

        # 3. Home screen
        print("📸 2. Home screen...")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{OUTPUT_DIR}/02_home.png", full_page=False)
        print("   ✅ Home saved")

        # 4. Click on 小花 to go to FriendDetail
        print("📸 3. Friend Detail...")
        # Find the clickable row for 小花
        xiaohua = await page.query_selector('text=小花')
        if xiaohua:
            await xiaohua.click()
            await page.wait_for_timeout(5000)
            await page.screenshot(path=f"{OUTPUT_DIR}/03_friend_detail_top.png", full_page=False)
            print("   ✅ Friend Detail top saved")

            # Scroll down to see CRM section
            await page.evaluate("""
                () => {
                    const scrollables = document.querySelectorAll('div');
                    for (const el of scrollables) {
                        if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
                            el.scrollTop = el.scrollHeight * 0.3;
                            return true;
                        }
                    }
                    window.scrollBy(0, 300);
                    return false;
                }
            """)
            await page.wait_for_timeout(1000)
            await page.screenshot(path=f"{OUTPUT_DIR}/04_friend_detail_crm.png", full_page=False)
            print("   ✅ Friend Detail CRM saved")

            # Scroll more to biolinks
            await page.evaluate("""
                () => {
                    const scrollables = document.querySelectorAll('div');
                    for (const el of scrollables) {
                        if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
                            el.scrollTop = el.scrollHeight * 0.6;
                            return true;
                        }
                    }
                    window.scrollBy(0, 300);
                    return false;
                }
            """)
            await page.wait_for_timeout(1000)
            await page.screenshot(path=f"{OUTPUT_DIR}/05_friend_detail_biolinks.png", full_page=False)
            print("   ✅ Friend Detail Biolinks saved")

            # Go back
            await page.go_back()
            await page.wait_for_timeout(3000)

        # 5. Search screen - click search tab
        print("📸 4. Search screen...")
        tabs = await page.query_selector_all('div[role="tab"]')
        if len(tabs) >= 2:
            await tabs[1].click()  # Search tab
        else:
            # Try clicking by icon position - search is 2nd tab
            await page.evaluate("""
                () => {
                    const tablist = document.querySelector('[role="tablist"]');
                    if (tablist) {
                        const tabs = tablist.querySelectorAll('[role="tab"]');
                        if (tabs.length >= 2) tabs[1].click();
                    }
                }
            """)
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUTPUT_DIR}/06_search.png", full_page=False)
        print("   ✅ Search saved")

        # 6. Notifications - navigate via bell icon or URL
        print("📸 5. Notifications...")
        # Go back to home first
        tabs = await page.query_selector_all('div[role="tab"]')
        if len(tabs) >= 1:
            await tabs[0].click()
        await page.wait_for_timeout(2000)

        # Click bell icon
        bell_clicked = await page.evaluate("""
            () => {
                const svgs = document.querySelectorAll('svg');
                for (const svg of svgs) {
                    const rect = svg.getBoundingClientRect();
                    // Bell icon should be in the header area, around y < 80
                    if (rect.y < 80 && rect.x > 150 && rect.x < 350 && rect.width > 10) {
                        const paths = svg.querySelectorAll('path');
                        for (const p of paths) {
                            const d = p.getAttribute('d') || '';
                            if (d.includes('M18') || d.includes('bell') || d.includes('15')) {
                                svg.parentElement.click();
                                return 'clicked bell';
                            }
                        }
                    }
                }
                // Try clicking any clickable element near the bell position
                const allDivs = document.querySelectorAll('div');
                for (const div of allDivs) {
                    const rect = div.getBoundingClientRect();
                    if (rect.y < 80 && rect.x > 200 && rect.x < 310 && rect.width < 60 && rect.width > 15 && window.getComputedStyle(div).cursor === 'pointer') {
                        div.click();
                        return 'clicked div near bell: ' + rect.x;
                    }
                }
                return 'not found';
            }
        """)
        print(f"   Bell click: {bell_clicked}")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUTPUT_DIR}/07_notifications.png", full_page=False)
        print("   ✅ Notifications saved")

        # 7. Go to Profile/Settings tab
        print("📸 6. Settings...")
        # Go back if needed
        back_btn = await page.query_selector('text=←')
        if back_btn:
            await back_btn.click()
            await page.wait_for_timeout(1000)

        tabs = await page.query_selector_all('div[role="tab"]')
        if len(tabs) >= 5:
            await tabs[4].click()  # Profile tab (last)
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{OUTPUT_DIR}/08_profile.png", full_page=False)
        print("   ✅ Profile saved")

        # Click settings gear
        settings_clicked = await page.evaluate("""
            () => {
                const svgs = document.querySelectorAll('svg');
                for (const svg of svgs) {
                    const rect = svg.getBoundingClientRect();
                    if (rect.y < 80 && rect.width > 10) {
                        svg.parentElement.click();
                        return 'clicked svg at x=' + rect.x;
                    }
                }
                return 'not found';
            }
        """)
        print(f"   Settings click: {settings_clicked}")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{OUTPUT_DIR}/09_settings.png", full_page=False)
        print("   ✅ Settings saved")

        # 8. Navigate to Social Stats
        print("📸 7. Social Stats...")
        social_stats = await page.query_selector('text=社交統計報表')
        if social_stats:
            await social_stats.click()
            await page.wait_for_timeout(3000)
            await page.screenshot(path=f"{OUTPUT_DIR}/10_social_stats_top.png", full_page=False)
            print("   ✅ Social Stats top saved")

            # Scroll down
            await page.evaluate("""
                () => {
                    const scrollables = document.querySelectorAll('div');
                    for (const el of scrollables) {
                        if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200) {
                            el.scrollTop = el.scrollHeight * 0.5;
                            return true;
                        }
                    }
                    window.scrollBy(0, 400);
                    return false;
                }
            """)
            await page.wait_for_timeout(1000)
            await page.screenshot(path=f"{OUTPUT_DIR}/11_social_stats_bottom.png", full_page=False)
            print("   ✅ Social Stats bottom saved")

        await browser.close()
        print("\n🎉 All screenshots captured!")


asyncio.run(main())
