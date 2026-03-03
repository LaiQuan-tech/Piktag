#!/usr/bin/env python3
"""Fix missing screenshots by navigating with better selectors."""

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
            device_scale_factor=2,
        )
        page = await context.new_page()

        # Login
        print("🔐 Logging in...")
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.fill('input[type="email"]', EMAIL)
        await page.fill('input[type="password"]', PASSWORD)

        # Click login - try finding by text content
        await page.evaluate("""
            () => {
                const divs = document.querySelectorAll('div');
                for (const div of divs) {
                    if (div.textContent.trim() === '登入' && window.getComputedStyle(div).cursor === 'pointer') {
                        div.click();
                        return 'clicked';
                    }
                }
                // Fallback: click any element containing 登入
                for (const div of divs) {
                    if (div.textContent.includes('登入') && !div.textContent.includes('還沒') && div.childElementCount <= 2) {
                        div.click();
                        return 'clicked fallback';
                    }
                }
                return 'not found';
            }
        """)
        await page.wait_for_timeout(5000)

        # Verify we're on home screen
        content = await page.content()
        print(f"   Page has 小花: {'小花' in content}")

        # === SEARCH SCREEN ===
        print("📸 Search screen...")
        # Click second tab in bottom tab bar
        await page.evaluate("""
            () => {
                const tablist = document.querySelector('[role="tablist"]');
                if (tablist) {
                    const tabs = tablist.querySelectorAll('[role="tab"]');
                    if (tabs[1]) { tabs[1].click(); return 'clicked tab 2'; }
                }
                return 'no tablist';
            }
        """)
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUTPUT_DIR}/06_search.png", full_page=False)
        content = await page.content()
        has_search = '熱門標籤' in content or '搜尋' in content or '附近' in content
        print(f"   Has search content: {has_search}")

        # === NOTIFICATIONS ===
        print("📸 Notifications...")
        # Go back to home tab first
        await page.evaluate("""
            () => {
                const tablist = document.querySelector('[role="tablist"]');
                if (tablist) {
                    const tabs = tablist.querySelectorAll('[role="tab"]');
                    if (tabs[0]) { tabs[0].click(); return 'clicked home'; }
                }
                return 'no tablist';
            }
        """)
        await page.wait_for_timeout(2000)

        # Click bell icon (it's an SVG in the header area)
        bell_result = await page.evaluate("""
            () => {
                // Find all clickable divs in header
                const allDivs = document.querySelectorAll('div');
                const candidates = [];
                for (const div of allDivs) {
                    const rect = div.getBoundingClientRect();
                    const style = window.getComputedStyle(div);
                    if (rect.top < 70 && rect.left > 100 && style.cursor === 'pointer' && rect.width < 80 && rect.height < 80 && rect.width > 10) {
                        candidates.push({ el: div, x: rect.x, w: rect.width, text: div.innerHTML.substring(0, 50) });
                    }
                }
                // Sort by x position - bell should be the middle icon in the header
                candidates.sort((a, b) => a.x - b.x);
                // The bell icon - look for the one that has SVG with bell-like path
                for (const c of candidates) {
                    if (c.el.querySelector('svg')) {
                        // Check if this SVG contains a bell-like path
                        const paths = c.el.querySelectorAll('path');
                        for (const p of paths) {
                            const d = p.getAttribute('d') || '';
                            // Bell icon typically has certain path patterns
                            if (d.includes('M15') || d.includes('M18') || d.includes('M13.73')) {
                                c.el.click();
                                return 'clicked bell at x=' + c.x;
                            }
                        }
                    }
                }
                // Fallback: click second icon in header (usually bell)
                if (candidates.length >= 2) {
                    candidates[1].el.click();
                    return 'clicked 2nd header icon at x=' + candidates[1].x;
                }
                if (candidates.length >= 1) {
                    candidates[0].el.click();
                    return 'clicked 1st header icon at x=' + candidates[0].x;
                }
                return JSON.stringify(candidates.map(c => ({ x: c.x, w: c.w, t: c.text })));
            }
        """)
        print(f"   Bell result: {bell_result}")
        await page.wait_for_timeout(3000)

        content = await page.content()
        has_notif = '通知' in content or '全部' in content or '追蹤' in content
        print(f"   Has notification content: {has_notif}")

        if has_notif:
            await page.screenshot(path=f"{OUTPUT_DIR}/07_notifications.png", full_page=False)
            print("   ✅ Notifications saved")
        else:
            # Maybe we need to find notifications differently
            # Try going back and using a different approach
            print("   ⚠️ No notification content, trying back button approach...")
            await page.go_back()
            await page.wait_for_timeout(2000)

        # === PROFILE SCREEN ===
        print("📸 Profile screen...")
        await page.evaluate("""
            () => {
                const tablist = document.querySelector('[role="tablist"]');
                if (tablist) {
                    const tabs = tablist.querySelectorAll('[role="tab"]');
                    // Profile is the last tab (5th)
                    if (tabs[4]) { tabs[4].click(); return 'clicked profile tab'; }
                }
                return 'no tab';
            }
        """)
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUTPUT_DIR}/08_profile.png", full_page=False)
        content = await page.content()
        has_profile = 'verify3' in content or '個人' in content
        print(f"   Has profile content: {has_profile}")

        # === SETTINGS SCREEN ===
        print("📸 Settings screen...")
        # Click gear/settings icon in profile screen header
        settings_result = await page.evaluate("""
            () => {
                // Look for gear icon or settings text
                const allDivs = document.querySelectorAll('div');
                for (const div of allDivs) {
                    const rect = div.getBoundingClientRect();
                    const style = window.getComputedStyle(div);
                    // Gear icon should be in upper right
                    if (rect.top < 70 && rect.left > 280 && style.cursor === 'pointer' && rect.width < 80) {
                        div.click();
                        return 'clicked at x=' + rect.x;
                    }
                }
                return 'not found';
            }
        """)
        print(f"   Settings result: {settings_result}")
        await page.wait_for_timeout(3000)

        content = await page.content()
        has_settings = '設定' in content or '帳號' in content or '社交統計' in content or '通知設定' in content
        print(f"   Has settings content: {has_settings}")

        if has_settings:
            await page.screenshot(path=f"{OUTPUT_DIR}/09_settings.png", full_page=False)
            print("   ✅ Settings saved")

            # === SOCIAL STATS ===
            print("📸 Social Stats...")
            stats_btn = await page.evaluate("""
                () => {
                    const divs = document.querySelectorAll('div');
                    for (const div of divs) {
                        if (div.textContent && div.textContent.includes('社交統計報表') && div.childElementCount <= 3) {
                            const style = window.getComputedStyle(div);
                            if (style.cursor === 'pointer') {
                                div.click();
                                return 'clicked social stats';
                            }
                        }
                    }
                    // Try text matching
                    const texts = document.querySelectorAll('div');
                    for (const t of texts) {
                        if (t.textContent.trim() === '社交統計報表') {
                            t.parentElement.click();
                            return 'clicked parent';
                        }
                    }
                    return 'not found';
                }
            """)
            print(f"   Stats click: {stats_btn}")
            await page.wait_for_timeout(3000)

            content = await page.content()
            has_stats = '總人脈' in content or '統計' in content or '標籤' in content
            print(f"   Has stats content: {has_stats}")

            if has_stats:
                await page.screenshot(path=f"{OUTPUT_DIR}/10_social_stats_top.png", full_page=False)
                print("   ✅ Social Stats top saved")

                # Scroll down
                await page.evaluate("""
                    () => {
                        const divs = document.querySelectorAll('div');
                        for (const el of divs) {
                            if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) {
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
        print("\n🎉 Fix screenshots done!")


asyncio.run(main())
