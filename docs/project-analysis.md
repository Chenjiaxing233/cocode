# 项目分析

## 1. 项目概览

这是一个基于 React、TypeScript、Vite 和 Monaco Editor 的浏览器端代码编辑器，定位类似轻量版 VS Code。

主要能力：

- 使用 File System Access API 打开本地文件夹或单个文件
- 文件树懒加载、创建、删除和刷新
- 多文件 Tab 编辑
- Monaco 编辑器与 Shiki 语法高亮
- 500ms 防抖自动保存
- 外部文件修改检测
- 全局搜索、正则搜索和替换
- Light/Dark 主题
- Yjs + Trystero P2P 协同编辑
- 可编辑和只读访客模式
- Playwright 端到端测试

## 2. 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端框架 | React 18 |
| 类型系统 | TypeScript 5.6 |
| 构建工具 | Vite |
| 编辑器 | Monaco Editor |
| 语法高亮 | Shiki |
| 本地文件 | File System Access API |
| 状态管理 | React Context + useReducer |
| 协同编辑 | Yjs + Trystero + WebRTC |
| 自动化测试 | Playwright |
| 部署 | GitHub Pages + GitHub Actions |

## 3. 目录结构

```text
src/
├── App.tsx                 应用布局、快捷键、侧栏拖拽
├── stores/editorStore.tsx  Context + useReducer 状态管理
├── components/             Header、Sidebar、Editor、SearchPanel 等 UI
├── services/
│   ├── fs.ts               File System Access API 封装
│   ├── autosave.ts         自动保存
│   ├── searchCore.ts       搜索算法
│   ├── search.worker.ts    Worker 搜索
│   ├── collab.ts           Yjs/Trystero 协同
│   └── highlighter.ts      Shiki 高亮
├── hooks/useCollab.ts      协同状态与文件同步
└── styles/                 CSS 样式
```

## 4. 核心架构

### 状态管理

`src/stores/editorStore.tsx` 集中管理编辑器状态，包括：

- 文件树 `tree`
- 已打开文件 `files`
- 当前文件 `activeFileId`
- 未保存文件 `dirtyFiles`
- 主题、Toast 和搜索定位信息
- 最近关闭文件列表

通过 reducer 处理添加、关闭、编辑、保存、重新加载和主题切换等操作。

### 文件读写

`src/services/fs.ts` 封装浏览器文件系统能力：

1. 用户选择本地目录或文件。
2. 构建文件树，目录内容按需加载。
3. 打开文件时读取内容和 `lastModified`。
4. 编辑器修改内容后交给自动保存服务写回磁盘。

### 编辑与自动保存

Monaco 的 `onChange` 更新 Store 并标记文件为 dirty。`src/services/autosave.ts` 使用 500ms 防抖定时器写回文件，保存后重新读取修改时间并清除 dirty 状态。

### 搜索和替换

搜索任务在 Web Worker 中执行，支持：

- 普通文本搜索
- 大小写匹配
- 全词匹配
- 正则表达式
- 增量批量返回结果
- 取消过期搜索请求
- 单条、单文件和全局替换

### 协同编辑

`src/services/collab.ts` 使用 Yjs 保存共享文本，Trystero 负责 P2P 房间连接。每个共享文件对应一个 `Y.Text`，Awareness 同步用户、颜色、光标和选区。

协同流程如下：

1. 房主创建房间和访问密钥。
2. 房间信息写入 URL hash，生成分享链接。
3. 访客通过链接加入房间。
4. Yjs 同步文件元信息和内容。
5. Monaco 与 Yjs 双向同步。
6. 房主控制访客可编辑或只读权限。

## 5. 做得比较好的地方

- 文件系统、搜索、协同和自动保存模块边界清晰。
- 搜索放入 Web Worker，避免大目录搜索阻塞主线程。
- 搜索支持增量渲染、取消请求和结果数量限制。
- reducer 适合集中管理多文件编辑器状态。
- Yjs CRDT 适合 P2P 并发编辑。
- 只读权限同时在 Monaco UI 和 Yjs 数据接收层进行限制。
- Playwright 覆盖了文件操作、外部修改、编辑器和协同场景。
- GitHub Actions 已配置自动构建和 GitHub Pages 部署。

## 6. 风险与限制

### 浏览器兼容性

File System Access API 主要支持 Chrome 和 Edge，Firefox、Safari 无法完整使用。

### 文件句柄不会跨刷新保存

刷新页面后，目录和文件句柄会丢失，用户需要重新授权打开文件夹。

### 协同依赖信令网络

文件内容通过 P2P 传输，但 Trystero 仍依赖信令服务完成节点发现和握手。信令服务不可用时，协同功能会受影响。

### 分享链接包含协同密钥

room 和 key 放在 URL hash 中。它们不会提交到应用服务器，但链接泄露后，其他人可能加入房间。后续可以增加房间过期、撤销链接和密码二次确认。

### 单元测试不足

目前测试以 Playwright 端到端测试为主。reducer、搜索核心算法、路径处理和协同权限逻辑还缺少独立单元测试。

### 编码检查尚未完成

本次分析环境没有安装 `node_modules`，因此执行构建和 lint 时出现以下错误：

```text
tsc is not recognized
eslint is not recognized
```

需要先安装依赖，再执行：

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm test
```

## 7. 后续建议

1. 安装依赖并完成 TypeScript、lint 和 Playwright 验证。
2. 为 reducer、搜索核心和协同权限增加单元测试。
3. 增加浏览器能力检测和不支持浏览器的明确提示。
4. 增加协同房间过期、撤销和安全提示。
5. 研究最近打开目录和授权状态的持久化方案。
6. 检查源码与 README 的中文编码，避免界面文案出现乱码。

## 8. 本次分析范围

本次仅进行了项目结构、核心代码、测试配置和构建配置分析，没有修改业务代码。分析时尝试执行了构建和 lint，但由于本地缺少依赖，未能完成实际编译和静态检查。
