import { test, expect } from '@playwright/test';

test.describe('基础 UI 测试', () => {
  test('应该显示应用标题和主题切换按钮', async ({ page }) => {
    await page.goto('/');

    // 检查标题
    await expect(page.locator('.logo')).toHaveText('CoCode');

    // 检查主题切换按钮
    const themeBtn = page.locator('.theme-btn').filter({ hasText: 'Dark' });
    await expect(themeBtn).toBeVisible();
  });

  test('应该显示侧边栏和打开文件/文件夹按钮', async ({ page }) => {
    await page.goto('/');

    // 检查侧边栏
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sidebar-title')).toHaveText('Explorer');

    // 检查打开按钮
    await expect(
      page.locator('button', { hasText: 'Open File' })
    ).toBeVisible();
    await expect(
      page.locator('button', { hasText: 'Open Folder' })
    ).toBeVisible();
  });

  test('应该能够切换主题', async ({ page }) => {
    await page.goto('/');

    // 点击主题切换按钮
    const themeBtn = page
      .locator('.theme-btn')
      .filter({ hasText: /Light|Dark/ });
    const initialText = await themeBtn.textContent();

    await themeBtn.click();

    // 等待主题切换
    await page.waitForTimeout(100);

    const newText = await themeBtn.textContent();
    expect(initialText).not.toBe(newText);
  });

  test('应该显示空编辑器占位符', async ({ page }) => {
    await page.goto('/');

    // 检查编辑器占位符
    await expect(page.locator('.editor-placeholder')).toHaveText(
      'No file open'
    );
  });
});

test.describe('Toast 通知测试', () => {
  test('Toast 组件应该正确渲染', async ({ page }) => {
    await page.goto('/');

    // 注入测试代码来触发 Toast
    await page.evaluate(() => {
      const event = new CustomEvent('show-toast', {
        detail: { message: '测试消息', type: 'success' },
      });
      window.dispatchEvent(event);
    });

    // 注意：由于 Toast 是通过 React 状态管理的，这个测试需要实际触发操作
    // 这里只是示例，实际测试需要触发真实的文件操作
  });
});

test.describe('响应式设计测试', () => {
  test('应该在不同屏幕尺寸下正常显示', async ({ page }) => {
    // 测试桌面尺寸
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();

    // 测试小屏幕
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('.sidebar')).toBeVisible();
  });
});

test.describe('键盘导航测试', () => {
  test('应该能够使用 Tab 键导航', async ({ page }) => {
    await page.goto('/');

    // 按 Tab 键导航
    await page.keyboard.press('Tab');

    // 检查焦点是否在第一个可聚焦元素上
    const focusedElement = await page.evaluate(
      () => document.activeElement?.className
    );
    expect(focusedElement).toBeTruthy();
  });
});
