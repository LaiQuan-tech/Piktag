#!/usr/bin/env python3
"""Capture Settings and Social Stats screenshots."""

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
        context = await browser.new_context(viewport=VIEWPORT, device_scale_factor=2)
        page = await context.new_page()

        # Login
        print("🔐 Logging in...")
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.fill('input[type="email"]', EMAIL)
        await page.fill('input[type="password"]', PASSWORD)
        await page.evaluate("""
            () => {
                const divs = document.querySelectorAll('div');
                for (const div of divs) {
                    if (div.textContent.trim() === '登入' && window.getComputedStyle(div).cursor === 'pointer') {
                        div.click();
                        return;
                    }
                }
            }
        """)
        await page.wait_for_timeout(5000)
        print("   ✅ Logged in")

        # Go to Profile tab (5th tab)
        print("📸 Navigating to Profile...")
        await page.evaluate("""
            () => {
                const tablist = document.querySelector('[role="tablist"]');
                if (tablist) {
                    const tabs = tablist.querySelectorAll('[role="tab"]');
                    if (tabs[4]) tabs[4].click();
                }
            }
        """)
        await page.wait_for_timeout(2000)

        # Click gear icon - it's an SVG in the header
        print("📸 Clicking settings gear...")
        # Take screenshot to debug what's on screen
        content = await page.content()
        print(f"   Page has 'Verify': {'Verify' in content}")

        # Find and click gear icon using more reliable method
        gear_result = await page.evaluate("""
            () => {
                // Find all SVG elements
                const svgs = document.querySelectorAll('svg');
                const info = [];
                for (const svg of svgs) {
                    const rect = svg.getBoundingClientRect();
                    if (rect.width > 0 && rect.y < 80) {
                        info.push({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) });
                    }
                }
                // Click the rightmost SVG in header (should be gear)
                if (info.length > 0) {
                    info.sort((a, b) => b.x - a.x);
                    const target = info[0];
                    // Find and click the SVG at that position
                    for (const svg of svgs) {
                        const rect = svg.getBoundingClientRect();
                        if (Math.round(rect.x) === target.x && Math.round(rect.y) === target.y) {
                            // Click the parent element
                            let el = svg.parentElement;
                            while (el && window.getComputedStyle(el).cursor !== 'pointer' && el.parentElement) {
                                el = el.parentElement;
                            }
                            el.click();
                            return 'clicked gear at x=' + target.x + ', found ' + info.length + ' header SVGs';
                        }
                    }
                }
                return 'SVGs in header: ' + JSON.stringify(info);
            }
        """)
        print(f"   Gear result: {gear_result}")
        await page.wait_for_timeout(3000)

        # Check if we're on settings
        content = await page.content()
        has_settings = '帳號資訊' in content or '通訊錄同步' in content or '深色模式' in content or '社交統計' in content
        print(f"   Has settings content: {has_settings}")

        if has_settings:
            await page.screenshot(path=f"{OUTPUT_DIR}/09_settings.png", full_page=False)
            print("   ✅ Settings saved!")

            # Scroll down to see all settings items
            await page.evaluate("""
                () => {
                    const divs = document.querySelectorAll('div');
                    for (const el of divs) {
                        if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300) {
                            el.scrollTop = el.scrollHeight * 0.4;
                            return true;
                        }
                    }
                    window.scrollBy(0, 300);
                    return false;
                }
            """)
            await page.wait_for_timeout(500)
            await page.screenshot(path=f"{OUTPUT_DIR}/09b_settings_bottom.png", full_page=False)
            print("   ✅ Settings bottom saved!")

            # Navigate to Social Stats
            print("📸 Navigating to Social Stats...")
            stats_result = await page.evaluate("""
                () => {
                    const divs = document.querySelectorAll('div');
                    for (const div of divs) {
                        if (div.textContent.includes('社交統計') && div.childElementCount <= 5) {
                            const rect = div.getBoundingClientRect();
                            if (rect.height < 100 && rect.height > 20) {
                                // Find a clickable parent
                                let el = div;
                                while (el && el.parentElement) {
                                    if (window.getComputedStyle(el).cursor === 'pointer') {
                                        el.click();
                                        return 'clicked at y=' + rect.y;
                                    }
                                    el = el.parentElement;
                                }
                                div.click();
                                return 'clicked div directly at y=' + rect.y;
                            }
                        }
                    }
                    return 'not found';
                }
            """)
            print(f"   Stats result: {stats_result}")
            await page.wait_for_timeout(4000)

            content = await page.content()
            has_stats = '總人脈' in content or '使用標籤' in content
            print(f"   Has stats content: {has_stats}")

            if has_stats:
                await page.screenshot(path=f"{OUTPUT_DIR}/10_social_stats_top.png", full_page=False)
                print("   ✅ Social Stats top saved!")

                # Scroll down to see charts
                await page.evaluate("""
                    () => {
                        const divs = document.querySelectorAll('div');
                        for (const el of divs) {
                            if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) {
                                el.scrollTop = el.scrollHeight * 0.5;
                                return true;
                            }
                        }
                        window.scrollBy(0, 500);
                        return false;
                    }
                """)
                await page.wait_for_timeout(1000)
                await page.screenshot(path=f"{OUTPUT_DIR}/11_social_stats_bottom.png", full_page=False)
                print("   ✅ Social Stats bottom saved!")
            else:
                print("   ⚠️ Social stats content not found, trying scroll first...")
                # Maybe settings needs scroll to find social stats
                await page.go_back()
                await page.wait_for_timeout(2000)
        else:
            print("   ⚠️ Settings not loaded, trying different approach...")
            # Maybe QR modal opened instead
            await page.screenshot(path=f"{OUTPUT_DIR}/debug_after_gear.png", full_page=False)

        await browser.close()
        print("\n🎉 Done!")


asyncio.run(main())
