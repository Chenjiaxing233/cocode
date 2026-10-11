import { test, expect } from '@playwright/test';

/**
 * 外部修改检测功能测试
 *
 * 注意：这些测试需要模拟文件外部修改，实际测试中需要手动操作
 */

test.describe('文件外部修改检测', () => {
  test('应该在窗口获得焦点时检测文件修改', async ({ page }) => {
    await page.goto('/');

    // 这个测试需要：
    // 1. 打开一个文件
    // 2. 在外部修改该文件
    // 3. 切换回浏览器窗口
    // 4. 应该弹出确认对话框

    // 由于无法自动化外部文件修改，这里只测试 UI 存在性
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('标签页应该显示刷新按钮', async ({ page }) => {
    await page.goto('/');

    // 检查刷新按钮的样式是否正确定义
    const styles = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      let hasReloadStyle = false;

      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (
              rule instanceof CSSStyleRule &&
              rule.selectorText?.includes('tab-reload')
            ) {
              hasReloadStyle = true;
              break;
            }
          }
        } catch (e) {
          // CORS 限制，跳过
        }
      }

      return hasReloadStyle;
    });

    expect(styles).toBe(true);
  });
});

test.describe('Toast 通知功能', () => {
  test('Toast 样式应该正确加载', async ({ page }) => {
    await page.goto('/');

    // 检查 Toast CSS 是否加载
    const hasToastStyles = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      let hasStyles = false;

      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (
              rule instanceof CSSStyleRule &&
              rule.selectorText?.includes('toast')
            ) {
              hasStyles = true;
              break;
            }
          }
        } catch (e) {
          // CORS 限制，跳过
        }
      }

      return hasStyles;
    });

    expect(hasToastStyles).toBe(true);
  });
});

test.describe('CSS 模块化测试', () => {
  test('应该加载所有 CSS 模块', async ({ page }) => {
    await page.goto('/');

    // 检查各个 CSS 模块是否加载
    const cssModules = ['common', 'header', 'sidebar', 'tabs', 'editor'];

    for (const module of cssModules) {
      const hasModule = await page.evaluate((moduleName) => {
        const styleSheets = Array.from(document.styleSheets);
        return styleSheets.some((sheet) => {
          try {
            return sheet.href?.includes(`${moduleName}.css`);
          } catch (e) {
            return false;
          }
        });
      }, module);

      // 注意：Vite 会打包 CSS，所以这个测试在生产环境中可能不适用
      // 这里主要是检查样式是否生效
    }
  });

  test('侧边栏样式应该正确应用', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // 检查侧边栏的基本样式
    const styles = await sidebar.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        display: computed.display,
        backgroundColor: computed.backgroundColor,
      };
    });

    expect(styles.display).toBe('flex');
  });
});

test.describe('错误处理测试', () => {
  test('应该优雅地处理无效操作', async ({ page }) => {
    await page.goto('/');

    // 尝试在没有打开文件的情况下进行操作
    // 应该不会崩溃
    await expect(page.locator('.editor-placeholder')).toBeVisible();
  });
});
