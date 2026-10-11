import { test, expect, type Page } from '@playwright/test';

/**
 * 临时验证：免登录 P2P 实时协同编辑（提交 8382ee5）
 * 用两个独立 BrowserContext 模拟两名用户，走完整链路：
 * A 开房 → 复制链接 → B 通过链接加入 → 文件共享 → 双向内容同步
 */

/** 注入 File System Access API 模拟，使应用可“打开文件夹”（addInitScript 只支持单个参数） */
const mockFs = ({
  fileName,
  content,
}: {
  fileName: string;
  content: string;
}) => {
  const store = new Map<string, { name: string; content: string }>();
  store.set(fileName, { name: fileName, content });

  const handleOf = (data: { name: string; content: string }) => ({
    kind: 'file',
    name: data.name,
    async getFile() {
      return new File([data.content], data.name, { lastModified: Date.now() });
    },
    async createWritable() {
      return {
        async write(next: string) {
          data.content = next;
        },
        async close() {},
      };
    },
  });

  (window as unknown as Record<string, unknown>).showDirectoryPicker =
    async () => ({
      kind: 'directory',
      name: 'collab-folder',
      async *entries() {
        for (const [name, data] of store.entries())
          yield [name, handleOf(data)];
      },
      async getFileHandle(name: string) {
        const data = store.get(name);
        if (!data) throw new Error('File not found');
        return handleOf(data);
      },
      async getDirectoryHandle() {
        return this;
      },
      async queryPermission() {
        return 'granted';
      },
      async requestPermission() {
        return 'granted';
      },
    });
};

/** 打开模拟文件夹中的首个文件，等待 Monaco 就绪 */
const openFirstFile = async (page: Page) => {
  await page.click('button:has-text("Open Folder")');
  await page.waitForSelector('.tree-file', { timeout: 10000 });
  await page.click('.tree-file >> nth=0');
  await page.waitForSelector('.monaco-editor', { timeout: 20000 });
  await page.waitForTimeout(1500);
};

/** 读取当前激活编辑器的文本 */
const editorText = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const ed = w.monaco?.editor?.getEditors?.()[0];
    return ed?.getModel()?.getValue() ?? '';
  });

/** 在编辑器开头插入文本（走真实输入路径，触发 Yjs 绑定） */
const typeAtStart = async (page: Page, text: string) => {
  await page.click('.monaco-editor .view-lines');
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(text, { delay: 30 });
};

test('P2P 协同：开房、加入、文件共享与双向同步', async ({ browser }) => {
  test.setTimeout(180000);

  const ctxA = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const ctxB = await browser.newContext();

  await ctxA.addInitScript(mockFs, {
    fileName: 'alpha.js',
    content: 'const a = 1;\n',
  });
  await ctxB.addInitScript(mockFs, {
    fileName: 'beta.js',
    content: 'const b = 2;\n',
  });

  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const logs: string[] = [];
  for (const [tag, p] of [
    ['A', pageA],
    ['B', pageB],
  ] as const) {
    p.on('console', (m) => {
      if (m.type() === 'error') logs.push(`[${tag}] ${m.text()}`);
    });
    p.on('pageerror', (e) => logs.push(`[${tag}] pageerror: ${e.message}`));
  }

  // --- 1. A 打开文件并开启协同 ---
  await pageA.goto('/');
  await openFirstFile(pageA);
  expect(await editorText(pageA)).toContain('const a = 1;');

  await pageA.click('button:has-text("共享协同")');
  await expect(pageA.locator('.collab-menu')).toBeVisible();
  await pageA.click('.collab-menu-item:has-text("可编辑")');
  await expect(pageA.locator('.collab-btn.active')).toBeVisible({
    timeout: 10000,
  });
  await expect(pageA.locator('.collab-mode-tag')).toHaveText('对方可编辑');
  console.log('✅ 1. A 选择「可编辑」开房成功');

  // --- 2. 分享链接写入剪贴板且格式正确 ---
  const link = await pageA.evaluate(() => navigator.clipboard.readText());
  console.log('   分享链接:', link);
  expect(link).toMatch(/#collab=[0-9a-f]{16}\.[0-9a-f]{32}$/);
  console.log('✅ 2. 分享链接已复制且格式正确（房间号+口令在 hash 中）');

  // --- 3. B 通过链接加入，并收到「可编辑」声明 ---
  await pageB.goto(link);
  await expect(pageB.locator('.collab-mode-tag')).toHaveText('我可编辑', {
    timeout: 90000,
  });
  console.log('✅ 3. B 通过链接加入，收到「我可编辑」权限');

  // --- 4. WebRTC 直连建立，双方成员数为 2 ---
  await expect(pageA.locator('.collab-btn.active')).toContainText('2 人', {
    timeout: 90000,
  });
  await expect(pageB.locator('.collab-btn.active')).toContainText('2 人', {
    timeout: 30000,
  });
  console.log('✅ 4. P2P 连接建立，双方均显示「协同中 · 2 人」');

  // --- 5. B 也打开本地文件夹，双方文件互相共享 ---
  await openFirstFile(pageB);
  await expect(pageB.locator('.tab', { hasText: 'alpha.js' })).toBeVisible({
    timeout: 30000,
  });
  await expect(pageA.locator('.tab', { hasText: 'beta.js' })).toBeVisible({
    timeout: 30000,
  });
  console.log('✅ 5. 双方已打开文件互相共享（A 见 beta.js，B 见 alpha.js）');

  // --- 6. B 侧打开 A 的文件，内容与 A 一致 ---
  await pageB.click('.tab:has-text("alpha.js")');
  await pageB.waitForTimeout(1500);
  expect(await editorText(pageB)).toContain('const a = 1;');
  console.log('✅ 6. B 侧 alpha.js 初始内容与 A 一致');

  // --- 7. A 输入 → B 实时同步 ---
  await pageA.click('.tab:has-text("alpha.js")');
  await pageA.waitForTimeout(500);
  await typeAtStart(pageA, '// from-A\n');
  await expect
    .poll(() => editorText(pageB), { timeout: 30000, intervals: [500] })
    .toContain('// from-A');
  console.log('✅ 7. A→B 内容实时同步');

  // --- 8. B 输入 → A 实时同步 ---
  await typeAtStart(pageB, '// from-B\n');
  await expect
    .poll(() => editorText(pageA), { timeout: 30000, intervals: [500] })
    .toContain('// from-B');
  console.log('✅ 8. B→A 内容实时同步（双向无回环）');

  // --- 9. 远端光标/选区渲染 ---
  const hasRemoteCursor = await pageA.evaluate(
    () =>
      document.querySelectorAll('[class*="yRemoteSelectionHead-"]').length > 0
  );
  console.log(
    hasRemoteCursor
      ? '✅ 9. A 侧渲染出 B 的远端光标'
      : '⚠️  9. 未检测到远端光标装饰'
  );

  // --- 10. 退出协同后清理 URL 与状态 ---
  await pageB.click('button:has-text("退出协同")');
  await expect(pageB.locator('button:has-text("共享协同")')).toBeVisible({
    timeout: 10000,
  });
  expect(pageB.url()).not.toContain('#collab=');
  await expect(pageA.locator('.collab-btn.active')).toContainText('等待加入', {
    timeout: 60000,
  });
  console.log('✅ 10. B 退出后 URL 已清理，A 感知到对方离开');

  if (logs.length) console.log('⚠️  控制台错误:\n' + logs.join('\n'));
  else console.log('✅ 全程无控制台错误');

  await ctxA.close();
  await ctxB.close();
});

test('P2P 协同：只读模式下访客无法修改', async ({ browser }) => {
  test.setTimeout(180000);

  const ctxA = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const ctxB = await browser.newContext();
  await ctxA.addInitScript(mockFs, {
    fileName: 'alpha.js',
    content: 'const a = 1;\n',
  });
  await ctxB.addInitScript(mockFs, {
    fileName: 'beta.js',
    content: 'const b = 2;\n',
  });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // --- 1. A 选择「只读」开房 ---
  await pageA.goto('/');
  await openFirstFile(pageA);
  await pageA.click('button:has-text("共享协同")');
  await pageA.click('.collab-menu-item:has-text("只读")');
  await expect(pageA.locator('.collab-mode-tag')).toHaveText('对方只读');
  const link = await pageA.evaluate(() => navigator.clipboard.readText());
  console.log('✅ R1. A 选择「只读」开房');

  // --- 2. B 加入并获知只读 ---
  await pageB.goto(link);
  await expect(pageB.locator('.collab-mode-tag')).toHaveText('我只读', {
    timeout: 90000,
  });
  await expect(pageB.locator('.toast')).toContainText('只读', {
    timeout: 10000,
  });
  console.log('✅ R2. B 加入，显示「我只读」并收到提示');

  // --- 3. B 打开本地文件夹：只读访客不应把自己的文件共享给 A ---
  await openFirstFile(pageB);
  await expect(pageB.locator('.tab', { hasText: 'alpha.js' })).toBeVisible({
    timeout: 30000,
  });
  await pageA.waitForTimeout(3000);
  await expect(pageA.locator('.tab', { hasText: 'beta.js' })).toHaveCount(0);
  console.log('✅ R3. B 可看到 alpha.js，B 的 beta.js 未共享给 A');

  // --- 4. B 在 alpha.js 中键盘输入被拦截 ---
  await pageB.click('.tab:has-text("alpha.js")');
  await pageB.waitForTimeout(1500);
  expect(await editorText(pageB)).toContain('const a = 1;');
  await typeAtStart(pageB, 'HACK-typed');
  await pageB.waitForTimeout(500);
  expect(await editorText(pageB)).not.toContain('HACK-typed');
  console.log('✅ R4. B 编辑器只读，键盘输入无效');

  // --- 5. 绕过 UI 直接改 B 的 model，A 也不应收到 ---
  await pageB.evaluate(() => {
    const ed = (window as any).monaco.editor.getEditors()[0];
    ed.getModel().setValue('HACK-model');
  });
  await pageA.waitForTimeout(3000);
  expect(await editorText(pageA)).not.toContain('HACK-model');
  console.log('✅ R5. 绕过 UI 修改 B 的 model，A 未受影响');

  // --- 6. A 的修改仍单向同步给 B ---
  await typeAtStart(pageA, '// host-edit\n');
  await expect
    .poll(() => editorText(pageB), { timeout: 30000, intervals: [500] })
    .toContain('// host-edit');
  console.log('✅ R6. A→B 单向同步正常');

  await ctxA.close();
  await ctxB.close();
});
