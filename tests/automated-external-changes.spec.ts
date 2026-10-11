import { test, expect } from '@playwright/test';

/**
 * 外部修改检测自动化测试
 */

test.describe('外部修改检测自动化测试', () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock File System API 并支持修改检测
    await page.addInitScript(() => {
      const mockFileSystem = new Map();
      const fileData = {
        name: 'test.txt',
        content: 'Original content',
        lastModified: Date.now(),
      };
      mockFileSystem.set('test.txt', fileData);

      // 暴露一个函数用于模拟外部修改
      (window as any).simulateExternalModification = (
        filename: string,
        newContent: string
      ) => {
        const data = mockFileSystem.get(filename);
        if (data) {
          data.content = newContent;
          data.lastModified = Date.now() + 1000; // 确保时间戳更新
        }
      };

      (window as any).showDirectoryPicker = async () => {
        return {
          kind: 'directory',
          name: 'test-folder',
          async *entries() {
            for (const [name, data] of mockFileSystem.entries()) {
              yield [
                name,
                {
                  kind: 'file',
                  name: data.name,
                  async getFile() {
                    return new File([data.content], data.name, {
                      lastModified: data.lastModified,
                    });
                  },
                  async createWritable() {
                    return {
                      async write(content: string) {
                        data.content = content;
                        data.lastModified = Date.now();
                      },
                      async close() {},
                    };
                  },
                },
              ];
            }
          },
          async getFileHandle(name: string) {
            const data = mockFileSystem.get(name);
            if (!data) throw new Error('File not found');
            return {
              kind: 'file',
              name: data.name,
              async getFile() {
                return new File([data.content], data.name, {
                  lastModified: data.lastModified,
                });
              },
              async createWritable() {
                return {
                  async write(content: string) {
                    data.content = content;
                    data.lastModified = Date.now();
                  },
                  async close() {},
                };
              },
            };
          },
          async getDirectoryHandle() {
            return this;
          },
        };
      };
    });

    await page.goto('/');
  });

  test('应该检测到文件外部修改', async ({ page }) => {
    // 打开文件夹
    await page.click('button:has-text("Open Folder")');
    await page.waitForSelector('.file-tree', { timeout: 5000 });

    // 打开文件
    await page.click('.tree-file:first-child');
    await page.waitForSelector('.monaco-editor', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 模拟外部修改文件
    await page.evaluate(() => {
      (window as any).simulateExternalModification(
        'test.txt',
        'Modified by external editor'
      );
    });

    // 设置对话框处理
    let dialogShown = false;
    page.once('dialog', (dialog) => {
      dialogShown = true;
      expect(dialog.message()).toContain('已被外部修改');
      dialog.accept(); // 点击"确定"重新加载
    });

    // 触发焦点事件（模拟切换回浏览器）
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // 等待对话框出现
    await page.waitForTimeout(1000);

    // 验证对话框是否显示
    expect(dialogShown).toBe(true);

    // 等待 Toast 提示
    await page.waitForSelector('.toast', { timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('重新加载');
  });

  test('应该在重新加载后保持文件树显示', async ({ page }) => {
    // 打开文件夹
    await page.click('button:has-text("Open Folder")');
    await page.waitForSelector('.file-tree', { timeout: 5000 });

    // 打开文件
    await page.click('.tree-file:first-child');
    await page.waitForSelector('.monaco-editor', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 模拟外部修改
    await page.evaluate(() => {
      (window as any).simulateExternalModification('test.txt', 'New content');
    });

    // 自动接受对话框
    page.once('dialog', (dialog) => dialog.accept());

    // 触发焦点事件
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // 等待重新加载完成
    await page.waitForTimeout(1500);

    // 验证文件树仍然显示（这是我们修复的 bug）
    await expect(page.locator('.file-tree')).toBeVisible();
    await expect(page.locator('.tree-file')).toHaveCount(1);
  });

  test('应该能够手动刷新文件', async ({ page }) => {
    // 打开文件夹
    await page.click('button:has-text("Open Folder")');
    await page.waitForSelector('.file-tree', { timeout: 5000 });

    // 打开文件
    await page.click('.tree-file:first-child');
    await page.waitForSelector('.tab', { timeout: 3000 });

    // 悬停在标签页上
    await page.hover('.tab:first-child');

    // 等待刷新按钮出现
    await page.waitForSelector('.tab-reload', { timeout: 2000 });

    // 点击刷新按钮
    await page.click('.tab-reload:first-child');

    // 等待 Toast 提示
    await page.waitForSelector('.toast', { timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('重新加载');
  });

  test('用户取消重新加载时应保留当前内容', async ({ page }) => {
    // 打开文件夹
    await page.click('button:has-text("Open Folder")');
    await page.waitForSelector('.file-tree', { timeout: 5000 });

    // 打开文件
    await page.click('.tree-file:first-child');
    await page.waitForSelector('.monaco-editor', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 获取当前内容
    const originalContent = await page.evaluate(() => {
      const monaco = (window as any).monaco;
      if (monaco) {
        const model = monaco.editor.getModels()[0];
        if (model) {
          return model.getValue();
        }
      }
      return '';
    });

    // 模拟外部修改
    await page.evaluate(() => {
      (window as any).simulateExternalModification(
        'test.txt',
        'External modification'
      );
    });

    // 拒绝对话框（点击"取消"）
    page.once('dialog', (dialog) => dialog.dismiss());

    // 触发焦点事件
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // 等待对话框处理完成
    await page.waitForTimeout(1000);

    // 验证内容没有改变
    const currentContent = await page.evaluate(() => {
      const monaco = (window as any).monaco;
      if (monaco) {
        const model = monaco.editor.getModels()[0];
        if (model) {
          return model.getValue();
        }
      }
      return '';
    });

    expect(currentContent).toBe(originalContent);
  });
});
