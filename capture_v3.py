#!/usr/bin/env python3
"""Capture Settings and Social Stats using coordinate-based clicks."""

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
                    if (div.textContent.trim() === '登入') {
                        div.click();
                        return;
                    }
                }
            }
        """)
        await page.wait_for_timeout(5000)

        # Go to Profile tab (5th tab)
        print("📸 Go to Profile...")
        await page.evaluate("""
            () => {
                const tablist = document.querySelector('[role="tablist"]');
                if (tablist) {
                    const tabs = tablist.querySelectorAll('[role="tab"]');
                    if (tabs[4]) tabs[4].click();
                }
            }
        """)
        await page.wait_for_timeout(3000)

        # Get gear icon position precisely
        gear_info = await page.evaluate("""
            () => {
                const svgs = document.querySelectorAll('svg');
                const headerSvgs = [];
                for (const svg of svgs) {
                    const rect = svg.getBoundingClientRect();
                    if (rect.y < 60 && rect.width > 10 && rect.width < 50) {
                        // Check paths for gear pattern
                        const paths = svg.querySelectorAll('path, circle, line');
                        headerSvgs.push({
                            x: rect.x + rect.width/2,
                            y: rect.y + rect.height/2,
                            w: rect.width,
                            pathCount: paths.length
                        });
                    }
                }
                return headerSvgs;
            }
        """)
        print(f"   Header SVGs: {gear_info}")

        # The gear icon is the rightmost one
        if gear_info:
            gear_info.sort(key=lambda x: x['x'], reverse=True)
            gear = gear_info[0]
            print(f"   Clicking gear at ({gear['x']}, {gear['y']})")

            # Use playwright's native click at coordinates
            await page.mouse.click(gear['x'], gear['y'])
            await page.wait_for_timeout(3000)

            content = await page.content()
            has_settings = '帳號資訊' in content or '通訊錄' in content or '深色模式' in content
            print(f"   Has settings: {has_settings}")

            if not has_settings:
                # Maybe a modal appeared, close it first
                print("   Trying to close modal...")
                # Press Escape or click X
                await page.keyboard.press('Escape')
                await page.wait_for_timeout(1000)

                # Try again - maybe we clicked QR instead of gear
                # Click the other icon
                if len(gear_info) >= 2:
                    other = gear_info[1] if gear_info[0]['x'] > gear_info[1]['x'] else gear_info[0]
                    print(f"   Trying other icon at ({other['x']}, {other['y']})")
                    await page.mouse.click(other['x'], other['y'])
                    await page.wait_for_timeout(3000)
                    content = await page.content()
                    has_settings = '帳號資訊' in content or '通訊錄' in content or '深色模式' in content
                    print(f"   Has settings now: {has_settings}")

            if not has_settings:
                # Check what's on screen
                await page.screenshot(path=f"{OUTPUT_DIR}/debug_gear_v3.png", full_page=False)

                # Maybe need to close a QR modal first
                close_result = await page.evaluate("""
                    () => {
                        // Find close/X button or overlay
                        const allEls = document.querySelectorAll('div');
                        for (const el of allEls) {
                            const text = el.textContent.trim();
                            if (text === '✕' || text === '×' || text === 'X' || text === '關閉') {
                                el.click();
                                return 'closed modal with text: ' + text;
                            }
                        }
                        // Click outside modal
                        const body = document.querySelector('body');
                        if (body) {
                            body.click();
                            return 'clicked body';
                        }
                        return 'no close button found';
                    }
                """)
                print(f"   Close result: {close_result}")
                await page.wait_for_timeout(1000)

                # Navigate back and try again
                await page.go_back()
                await page.wait_for_timeout(2000)

        # Final attempt: use React Navigation hash routing
        print("📸 Trying direct navigation to settings...")
        # Check if there's a settings route we can navigate to
        nav_result = await page.evaluate("""
            () => {
                // Try to find React Navigation and navigate programmatically
                const rootEl = document.getElementById('root') || document.getElementById('main');
                // Check window.__REACT_NAVIGATION__ or similar
                if (window.__REACT_NAVIGATION__) {
                    return 'has react nav';
                }

                // Look for React's __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
                // to find the navigation state

                // Alternative: find settings button via touch events
                const allDivs = document.querySelectorAll('div');
                for (const div of allDivs) {
                    const style = window.getComputedStyle(div);
                    if (style.cursor === 'pointer') {
                        const rect = div.getBoundingClientRect();
                        // Gear should be in top-right area
                        if (rect.top < 60 && rect.right > 340 && rect.width < 60 && rect.height < 60) {
                            // Dispatch touch events for React Native
                            const touch = new Touch({
                                identifier: 1,
                                target: div,
                                clientX: rect.x + rect.width/2,
                                clientY: rect.y + rect.height/2
                            });
                            div.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], targetTouches: [touch] }));
                            setTimeout(() => {
                                div.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
                            }, 100);
                            return 'dispatched touch at x=' + rect.x;
                        }
                    }
                }
                return 'no gear found';
            }
        """)
        print(f"   Nav result: {nav_result}")
        await page.wait_for_timeout(3000)

        content = await page.content()
        has_settings = '帳號資訊' in content or '通訊錄' in content or '深色模式' in content or '社交統計' in content
        print(f"   Has settings now: {has_settings}")

        if has_settings:
            await page.screenshot(path=f"{OUTPUT_DIR}/09_settings.png", full_page=False)
            print("   ✅ Settings saved!")
        else:
            # Use Chrome to capture these remaining screens manually
            print("   ❌ Cannot navigate to settings via headless browser")
            print("   Will capture via Chrome browser instead")

        await browser.close()
        print("\n🎉 Done!")


asyncio.run(main())
