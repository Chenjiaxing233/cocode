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

| 类别       | 技术                          |
| ---------- | ----------------------------- |
| 前端框架   | React 18                      |
| 类型系统   | TypeScript 5.6                |
| 构建工具   | Vite                          |
| 编辑器     | Monaco Editor                 |
| 语法高亮   | Shiki                         |
| 本地文件   | File System Access API        |
| 状态管理   | React Context + useReducer    |
| 协同编辑   | Yjs + Trystero + WebRTC       |
| 自动化测试 | Playwright                    |
| 部署       | GitHub Pages + GitHub Actions |

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

## 9. 语法高亮与智能提示实施顺序

本项目将语法高亮与智能提示分开实现：Monaco + Shiki 负责代码着色；Monaco 内置语言服务或 LSP（Language Server Protocol）负责补全、悬停、诊断、定义跳转和引用查找。Shiki 本身不提供代码智能提示。

### 阶段 1：统一语言识别与高亮基线

1. 检查并统一 `src/stores/editorStore.tsx` 中的文件后缀到 Monaco 语言 ID 的映射。
2. 确保 `.js`、`.jsx`、`.ts`、`.tsx`、`.vue`、`.py`、`.go`、`.java`、`.rs`、`.c`、`.cpp`、`.json`、`.html`、`.css`、`.scss`、`.yaml`、`.sql` 和 Shell 文件能够正确识别。
3. 保留 `src/services/highlighter.ts` 的 Shiki 单例和主题配置，确认 Shiki 语言名称与 Monaco 语言 ID 能够对应。
4. 增加高亮回归测试，覆盖常用文件类型、主题切换和未知后缀回退到 `plaintext` 的情况。

验收标准：打开不同语言文件时，编辑器语言模式正确，关键字、字符串、注释和数字能够着色，切换明暗主题后高亮仍然可用。

### 阶段 2：完善 JavaScript 和 TypeScript 内置语言服务

1. 保留 Monaco 内置 TypeScript Language Service，覆盖 JavaScript、TypeScript、JSX 和 TSX。
2. 在 `handleBeforeMount` 中补充编译选项、JSX 支持和合理的诊断配置。
3. 使用 `addExtraLib()` 注入项目级声明，例如 React、Node.js、CSS Module 和 JSON 类型。
4. 验证补全、参数提示、悬停信息、语法错误和基础跳转功能。

验收标准：JS/TS 文件能够提供关键字、变量、函数和导入路径提示；语法错误显示在编辑器中；类型声明缺失时可以通过额外类型库补齐。

### 阶段 3：接入 Monaco 内置的 Web 类语言服务

1. 优先启用 JSON、HTML、CSS、SCSS 和 Markdown 的 Monaco 内置能力。
2. 为 JSON 配置 schema，使配置项能够显示属性补全和校验信息。
3. 为 HTML、CSS 和 SCSS 验证标签、属性、选择器、属性值和变量提示。
4. 将这些语言的服务初始化与编辑器模型生命周期绑定，切换文件时正确释放监听器。

验收标准：Web 类文件能够提供上下文补全、悬停说明和语法诊断；JSON 文件能够根据 schema 检查字段和类型。

### 阶段 4：建立 LSP 网关

1. 增加独立的语言服务层，负责管理语言服务器进程和浏览器连接。
2. 浏览器端使用 `monaco-languageclient`，通过 WebSocket 或 Web Worker 与语言服务器通信。
3. 服务端将语言服务器的 stdio 转换为 WebSocket；每个工作区和语言服务器实例需要隔离。
4. 统一处理 `initialize`、`didOpen`、`didChange`、`didClose`、补全、悬停、诊断和定义跳转等 LSP 消息。
5. 文件内容以 Monaco model 为准同步给语言服务器，文件关闭或工作区销毁时释放连接。

验收标准：浏览器可以建立 LSP 连接；编辑内容能够同步到语言服务器；服务端返回的诊断和补全能够显示在 Monaco 中；连接断开时界面给出可理解的状态提示。

### 阶段 5：按优先级接入主流语言服务器

建议依次接入：

1. Python：Pyright 或 Python Language Server。
2. Go：`gopls`。
3. Rust：`rust-analyzer`。
4. Java：Eclipse JDT Language Server。
5. C/C++：`clangd`。

为每种语言增加服务注册表，按 `activeFile.language` 选择 Monaco 内置服务、LSP 服务或无智能提示模式。语言服务器的运行环境、版本和项目依赖需要在部署文档中明确记录。

验收标准：每种已接入语言至少支持补全、悬停、语法诊断和定义跳转；服务不可用时，编辑器仍能正常编辑和高亮。

### 阶段 6：补充轻量级自定义提示

在 LSP 尚未覆盖的语言或领域场景中，可以通过 `monaco.languages.registerCompletionItemProvider()` 增加关键字、代码片段和项目 API 提示。该方式只作为补充，不能替代完整语言服务器，因为它无法准确处理类型、作用域、导入关系和跨文件引用。

### 阶段 7：测试、性能与降级

1. 为每种语言增加补全、诊断、悬停和跳转的端到端测试。
2. 测试大文件、快速输入、频繁切换文件和多个语言服务器并行运行的情况。
3. 对语言服务连接、诊断请求和补全请求增加取消、超时和重连机制。
4. 限制语言服务器资源，避免阻塞浏览器主线程和影响 Monaco 输入响应。
5. 高亮或语言服务器失败时降级到 Monaco 默认语言模式；LSP 不可用时保留基础编辑功能。

最终推荐架构：Monaco + Shiki 负责高亮，JS/TS 和 Web 类语言优先使用 Monaco 内置服务，Python、Go、Rust、Java、C/C++ 等语言通过后端 LSP 网关接入。

## 10. 前端可实现功能范围

### 10.1 纯前端可实现

在现有 React、Monaco Editor 和 File System Access API 基础上，可以直接实现：

- 多文件编辑、Tab 管理、最近关闭文件恢复。
- 文件树展开、折叠、重命名、删除和新建。
- 当前文件搜索、正则搜索、全局替换和批量替换。
- Prettier 格式化、JSON 格式化和代码片段。
- 代码折叠、括号匹配、缩进、多光标和列编辑。
- 符号大纲、Problems 面板、错误和警告标记。
- Minimap、行号、字体大小、Tab 大小、自动换行和快捷键设置。
- 明暗主题、Markdown 预览、HTML/CSS/JS 实时预览。
- IndexedDB 本地历史版本、离线缓存和 Service Worker。
- 文件拖拽打开、剪贴板操作、项目导入和 ZIP 导出。
- 命令面板，例如快速打开文件和执行编辑器命令。
- Git diff 展示、文件变更标记和基础协同编辑界面。

### 10.2 浏览器运行时支持的功能

以下能力可以在浏览器中运行，但需要额外的 WebAssembly、Worker 或沙箱运行时：

- JavaScript/TypeScript 沙箱执行。
- Python：Pyodide。
- C/C++：WebAssembly 编译器。
- Rust：WASM 编译器。
- SQL：SQLite WASM。
- Node.js 风格环境：WebContainer。
- 终端模拟器：xterm.js。
- 项目预览：Sandpack、iframe 或 WebContainer。
- Mermaid、PlantUML 等文本图表预览。

这些功能需要考虑运行时体积、首次加载时间、浏览器权限和内存占用。代码执行必须放在 Worker 或隔离沙箱中，不能直接执行不可信代码。

### 10.3 需要后端或语言服务器

以下功能通常需要后端服务、语言服务器或云端存储：

- Python、Go、Java、Rust、C/C++ 的完整类型分析和智能提示。
- 跨文件定义、引用查找、项目依赖解析和完整编译诊断。
- Git 提交、分支、合并和冲突解决。
- 用户登录、权限控制、云端项目保存和项目共享。
- 协同房间持久化、历史记录和成员管理。
- 远程终端、服务器部署和持续集成。
- 大型项目索引、全局代码搜索和依赖漏洞扫描。

### 10.4 建议实施优先级

1. 命令面板、快捷键系统和编辑器设置。
2. Prettier 格式化、JSON Schema 校验和 Problems 面板。
3. Markdown、HTML/CSS 实时预览。
4. IndexedDB 本地历史记录、ZIP 导出和项目导入。
5. JavaScript/TypeScript 项目运行沙箱。
6. LSP 网关及 Python、Go、Rust 语言服务。
7. Git 操作、远程运行环境和云端项目能力。

最终目标是保持基础编辑、文件读写和语法高亮在纯前端可用；需要编译、完整语言分析或持久化协作的能力，再通过 Worker、WebAssembly 或后端服务扩展。

### 10.5 已落地的编辑器增强

当前 `src/components/Editor.tsx` 已启用以下纯前端能力：

- 代码折叠、折叠高亮和始终显示折叠控件。
- 输入和粘贴时自动格式化。
- 格式化文档、格式化选区和切换行注释右键操作。
- 参数提示、自动闭合括号和引号。
- 括号着色、缩进参考线和括号对参考线。
