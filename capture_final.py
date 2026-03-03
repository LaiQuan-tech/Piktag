#!/usr/bin/env python3
"""Capture remaining screenshots using tap events for React Native Web."""

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
            has_touch=True,  # Enable touch events!
        )
        page = await context.new_page()

        # Login
        print("🔐 Logging in...")
        await page.goto(BASE_URL, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        await page.fill('input[type="email"]', EMAIL)
        await page.fill('input[type="password"]', PASSWORD)
        await page.evaluate("() => { document.querySelectorAll('div').forEach(d => { if(d.textContent.trim()==='登入') d.click(); }); }")
        await page.wait_for_timeout(5000)

        # Go to Profile tab
        print("📸 Profile tab...")
        await page.evaluate("() => { const t = document.querySelector('[role=\"tablist\"]'); if(t) { const tabs = t.querySelectorAll('[role=\"tab\"]'); if(tabs[4]) tabs[4].click(); } }")
        await page.wait_for_timeout(3000)

        # Find gear icon coordinates
        gear_pos = await page.evaluate("""
            () => {
                const svgs = document.querySelectorAll('svg');
                let rightmost = null;
                let rightmostX = 0;
                for (const svg of svgs) {
                    const rect = svg.getBoundingClientRect();
                    if (rect.y < 60 && rect.width > 10 && rect.x > rightmostX) {
                        rightmostX = rect.x;
                        rightmost = { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
                    }
                }
                return rightmost;
            }
        """)
        print(f"   Gear at: {gear_pos}")

        if gear_pos:
            # Use tap (touch) instead of click!
            await page.tap_position(gear_pos['x'], gear_pos['y']) if hasattr(page, 'tap_position') else await page.touchscreen.tap(gear_pos['x'], gear_pos['y'])
            await page.wait_for_timeout(3000)

            content = await page.content()
            has_settings = '帳號資訊' in content or '通訊錄' in content or '深色模式' in content or '社交統計' in content
            print(f"   Has settings: {has_settings}")

            if not has_settings:
                # Check if modal opened
                has_qr = 'QR' in content or '分享' in content
                if has_qr:
                    print("   QR modal opened, closing...")
                    await page.keyboard.press('Escape')
                    await page.wait_for_timeout(500)
                    # Press back or find close button
                    await page.evaluate("""
                        () => {
                            // Find and click any modal backdrop or close button
                            const modals = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
                            modals.forEach(m => m.remove());
                            // Also try clicking outside
                            document.body.click();
                        }
                    """)
                    await page.wait_for_timeout(1000)

                # Maybe we clicked QR, try the second icon
                print("   Trying second header icon...")
                second_pos = await page.evaluate("""
                    () => {
                        const svgs = document.querySelectorAll('svg');
                        const headerSvgs = [];
                        for (const svg of svgs) {
                            const rect = svg.getBoundingClientRect();
                            if (rect.y < 60 && rect.width > 10 && rect.width < 50) {
                                headerSvgs.push({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width });
                            }
                        }
                        headerSvgs.sort((a, b) => a.x - b.x);
                        // Return second to last (gear should be rightmost, QR is second)
                        return headerSvgs.length >= 2 ? headerSvgs[headerSvgs.length - 1] : null;
                    }
                """)

                if second_pos:
                    await page.touchscreen.tap(second_pos['x'], second_pos['y'])
                    await page.wait_for_timeout(3000)
                    content = await page.content()
                    has_settings = '帳號資訊' in content or '通訊錄' in content or '深色模式' in content
                    print(f"   Has settings now: {has_settings}")

            if has_settings:
                await page.screenshot(path=f"{OUTPUT_DIR}/09_settings.png", full_page=False)
                print("   ✅ Settings saved!")

                # Navigate to Social Stats
                print("📸 Social Stats...")
                await page.touchscreen.tap(187, 400)  # Try tapping middle of screen where menu item might be
                await page.wait_for_timeout(500)

                # Find social stats menu item
                stats_pos = await page.evaluate("""
                    () => {
                        const allText = document.querySelectorAll('div');
                        for (const el of allText) {
                            if (el.textContent.trim() === '社交統計報表' || el.textContent.trim().includes('社交統計')) {
                                const rect = el.getBoundingClientRect();
                                if (rect.height < 80 && rect.height > 10 && rect.width > 50) {
                                    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: el.textContent.trim() };
                                }
                            }
                        }
                        return null;
                    }
                """)
                print(f"   Stats button: {stats_pos}")

                if stats_pos:
                    await page.touchscreen.tap(stats_pos['x'], stats_pos['y'])
                    await page.wait_for_timeout(4000)

                    content = await page.content()
                    has_stats = '總人脈' in content or '使用標籤' in content
                    print(f"   Has stats: {has_stats}")

                    if has_stats:
                        await page.screenshot(path=f"{OUTPUT_DIR}/10_social_stats_top.png", full_page=False)
                        print("   ✅ Social Stats top saved!")

                        # Scroll down
                        await page.evaluate("""
                            () => {
                                const divs = document.querySelectorAll('div');
                                for (const el of divs) {
                                    if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) {
                                        el.scrollTop = el.scrollHeight * 0.6;
                                        return true;
                                    }
                                }
                            }
                        """)
                        await page.wait_for_timeout(1000)
                        await page.screenshot(path=f"{OUTPUT_DIR}/11_social_stats_bottom.png", full_page=False)
                        print("   ✅ Social Stats bottom saved!")

        await browser.close()
        print("\n🎉 All done!")


asyncio.run(main())
