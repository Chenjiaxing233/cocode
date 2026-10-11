# Playwright 测试文档

## 📋 测试概述

本项目使用 Playwright 进行端到端测试，确保所有功能正常工作。

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 安装 Playwright 浏览器

```bash
pnpm run test:install
```

### 3. 运行测试

```bash
# 运行所有测试
pnpm test

# 以 UI 模式运行测试
pnpm run test:ui

# 以有头模式运行测试（可以看到浏览器）
pnpm run test:headed

# 调试模式
pnpm run test:debug
```

## 📁 测试文件结构

```
tests/
├── basic-ui.spec.ts           # 基础 UI 测试
├── file-operations.spec.ts    # 文件操作测试
└── external-changes.spec.ts   # 外部修改检测测试
```

## 🧪 测试覆盖范围

### 1. 基础 UI 测试 (`basic-ui.spec.ts`)

- ✅ 应用标题和主题切换按钮
- ✅ 侧边栏和打开文件/文件夹按钮
- ✅ 主题切换功能
- ✅ 空编辑器占位符
- ✅ Toast 通知组件
- ✅ 响应式设计
- ✅ 键盘导航

### 2. 文件操作测试 (`file-operations.spec.ts`)

⚠️ **注意**：这些测试大部分被标记为 `skip`，因为它们需要 File System Access API 的手动授权。

- ⏭️ 打开文件夹并显示文件树
- ⏭️ 打开文件并在编辑器中显示
- ⏭️ 创建新文件
- ⏭️ 删除文件
- ⏭️ 文件标签页切换
- ⏭️ 关闭标签页
- ⏭️ 刷新文件
- ⏭️ 编辑文件内容
- ⏭️ 语法高亮

### 3. 外部修改检测测试 (`external-changes.spec.ts`)

- ✅ 窗口焦点检测
- ✅ 刷新按钮样式
- ✅ Toast 通知样式
- ✅ CSS 模块化
- ✅ 错误处理

## ⚠️ 测试限制

### File System Access API 限制

由于浏览器的安全限制，File System Access API 需要用户手动授权。这意味着：

1. **无法自动化文件系统操作**：打开文件夹、读写文件等操作需要用户交互
2. **大部分文件操作测试被跳过**：标记为 `test.skip()` 的测试需要手动运行
3. **建议手动测试**：对于文件操作功能，建议进行手动测试

### 解决方案

对于需要文件系统访问的测试，可以：

1. **使用 Chrome DevTools Protocol (CDP)**：

   ```typescript
   // 示例：使用 CDP 授权文件系统访问
   const client = await page.context().newCDPSession(page);
   await client.send('Browser.grantPermissions', {
     permissions: ['fileSystem'],
     origin: 'http://localhost:5173',
   });
   ```

2. **创建 Mock 数据**：
   - 使用内存中的虚拟文件系统
   - Mock File System Access API

3. **手动测试清单**：
   - 参考下面的手动测试清单

## 📝 手动测试清单

### 文件操作

- [ ] 打开文件夹
  - [ ] 文件树正确显示
  - [ ] 文件夹可以展开/折叠
- [ ] 打开文件
  - [ ] 文件内容正确显示
  - [ ] 语法高亮正常工作
  - [ ] 标签页正确显示
- [ ] 创建文件/文件夹
  - [ ] 输入框正确显示
  - [ ] 创建成功后显示 Toast
  - [ ] 文件树更新
- [ ] 删除文件/文件夹
  - [ ] 确认对话框显示
  - [ ] 删除成功后显示 Toast
  - [ ] 文件树更新
  - [ ] 对应标签页关闭

### 编辑功能

- [ ] 编辑文件
  - [ ] 可以正常输入
  - [ ] 自动保存（500ms 后）
  - [ ] 保存成功显示 Toast
- [ ] 多文件编辑
  - [ ] 可以打开多个文件
  - [ ] 标签页切换正常
  - [ ] 每个文件独立编辑

### 外部修改检测

- [ ] 自动检测
  - [ ] 在外部修改文件
  - [ ] 切换回浏览器
  - [ ] 显示确认对话框
  - [ ] 点击"确定"重新加载
  - [ ] 文件内容更新
  - [ ] **文件树保持显示**（Bug 修复验证）
- [ ] 手动刷新
  - [ ] 悬停在标签页上
  - [ ] 刷新按钮显示
  - [ ] 点击刷新按钮
  - [ ] 文件重新加载
  - [ ] 显示成功 Toast

### UI/UX

- [ ] 主题切换
  - [ ] 亮色/暗色主题切换
  - [ ] 编辑器主题同步
- [ ] 响应式设计
  - [ ] 不同屏幕尺寸下正常显示
- [ ] Toast 通知
  - [ ] 成功/错误/警告/信息类型
  - [ ] 自动消失（3秒）
  - [ ] 动画效果

## 🔧 调试技巧

### 1. 使用 UI 模式

```bash
pnpm run test:ui
```

UI 模式提供：

- 可视化测试运行
- 时间旅行调试
- 查看测试步骤
- 查看网络请求

### 2. 使用调试模式

```bash
pnpm run test:debug
```

调试模式会：

- 打开浏览器
- 暂停在每个测试步骤
- 允许你检查页面状态

### 3. 查看测试报告

测试运行后会生成 HTML 报告：

```bash
npx playwright show-report
```

### 4. 截图和视频

失败的测试会自动截图，配置在 `playwright.config.ts` 中：

```typescript
use: {
  screenshot: 'only-on-failure',
  trace: 'on-first-retry',
}
```

## 📊 CI/CD 集成

### GitHub Actions 示例

```yaml
name: Playwright Tests
on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - name: Install dependencies
        run: pnpm install
      - name: Install Playwright Browsers
        run: pnpm run test:install
      - name: Run Playwright tests
        run: pnpm test
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## 🎯 最佳实践

1. **保持测试独立**：每个测试应该独立运行，不依赖其他测试
2. **使用有意义的测试名称**：清楚描述测试的目的
3. **避免硬编码等待**：使用 `waitForSelector` 而不是 `waitForTimeout`
4. **清理测试数据**：测试后清理创建的文件和数据
5. **使用 Page Object Model**：对于复杂的测试，考虑使用 POM 模式

## 📚 参考资源

- [Playwright 官方文档](https://playwright.dev/)
- [Playwright 最佳实践](https://playwright.dev/docs/best-practices)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)

## 🐛 已知问题

1. **File System Access API 无法自动化**：需要手动授权
2. **Monaco Editor 测试复杂**：编辑器内部结构复杂，难以测试
3. **热重载可能影响测试**：开发模式下的热重载可能导致测试不稳定

## 💡 未来改进

- [ ] 添加 Mock File System Access API
- [ ] 使用 CDP 自动授权文件系统访问
- [ ] 添加性能测试
- [ ] 添加可访问性测试
- [ ] 增加测试覆盖率
