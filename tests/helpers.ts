import { test as base } from '@playwright/test';

/**
 * 测试辅助工具
 */

// 扩展 Playwright 的 test 对象
export const test = base.extend({
  // 可以在这里添加自定义 fixtures
});

export { expect } from '@playwright/test';

/**
 * 等待 Toast 消息出现
 */
export async function waitForToast(
  page: any,
  type: 'success' | 'error' | 'warning' | 'info'
) {
  return page.waitForSelector(`.toast-${type}`, { timeout: 5000 });
}

/**
 * 等待 Monaco 编辑器加载完成
 */
export async function waitForMonacoEditor(page: any) {
  await page.waitForSelector('.monaco-editor', { timeout: 10000 });
  // 等待编辑器完全初始化
  await page.waitForTimeout(500);
}

/**
 * 模拟文件系统授权（需要 CDP）
 */
export async function grantFileSystemPermission(page: any) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Browser.grantPermissions', {
      permissions: ['fileSystem'],
      origin: page.url(),
    });
  } catch (error) {
    console.warn('无法授权文件系统权限:', error);
  }
}

/**
 * 检查元素是否可见
 */
export async function isVisible(page: any, selector: string): Promise<boolean> {
  try {
    const element = await page.locator(selector);
    return await element.isVisible();
  } catch {
    return false;
  }
}

/**
 * 等待页面加载完成
 */
export async function waitForPageLoad(page: any) {
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');
}

/**
 * 截图辅助函数
 */
export async function takeScreenshot(page: any, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
}

/**
 * 清理测试数据
 */
export async function cleanup(page: any) {
  // 清理 localStorage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}
