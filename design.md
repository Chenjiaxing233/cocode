# 实时协同编辑设计文档（Yjs + WebRTC）

## 1. 背景与目标

让两人（或多人）在不同电脑上对同一份代码进行**实时协同编辑**，且**数据不经过应用/数据服务器**——代码内容在浏览器之间点对点（P2P）直传。

- 目标：多人并发编辑同一文件自动合并、实时看到对方光标/选区。
- 约束：不自建承载代码数据的后端；仅允许一个**只做握手、不存数据**的轻量信令服务（可用公共实例或自建）。

## 2. 方案选型

| 能力         | 选型            | 说明                                                                 |
| ------------ | --------------- | -------------------------------------------------------------------- |
| 并发合并算法 | **Yjs（CRDT）** | 无冲突复制数据类型，去中心化，无需中央服务器做冲突转换，天然适配 P2P |
| 编辑器绑定   | **y-monaco**    | 将 Monaco 的 `ITextModel` 与 Yjs 的 `Y.Text` 双向绑定                |
| 传输层       | **y-webrtc**    | 浏览器间 WebRTC 直连同步，内置 awareness（在场/光标）与端到端加密    |

为什么不是 OT（操作转换）：OT 通常依赖中央服务器串行化并转换操作，与"数据不过服务器"目标冲突；CRDT 可在纯 P2P 下收敛。

## 3. 依赖

```bash
pnpm add yjs y-webrtc y-monaco
```

## 4. 架构与数据流

```
┌─────────────── Peer A（浏览器） ───────────────┐        ┌────── Peer B ──────┐
│  Monaco Editor ── y-monaco ── Y.Text(perFile)   │        │  同左              │
│         │                        │              │        │                    │
│    editorRef                 Y.Doc              │        │   Y.Doc            │
│         │                        │              │        │     │              │
│   本地 autosave            WebrtcProvider ◄──────┼── P2P ─┼──► WebrtcProvider  │
│         ▼                     (awareness)       │ WebRTC │                    │
│   File System Access 写盘                        │        │  各自写各自磁盘    │
└──────────────────────────────────────────────────┘        └────────────────────┘
                     │
                     ▼ 仅握手（SDP/ICE 交换），不含代码内容
              信令服务器（公共或自建，轻量）
```

- **内容一致性**：由 Yjs 保证，两端编辑器内容实时收敛。
- **磁盘副本独立**：每个 peer 用各自的 File System Access 句柄把内容写回**自己本地**的文件；磁盘文件是内容的持久化快照，不参与同步通道。

## 5. 数据模型

- 每个"协同房间"对应一个 `Y.Doc`。
- 房间内每个文件用其**相对路径**作为 key，映射为一个 `Y.Text`：
  - `ydoc.getText(file.path)` → 该文件的协同文本。
- `provider.awareness`：承载每个用户的光标位置、选区、昵称、颜色等在场信息（不落 Y.Doc，实时且易失）。

```ts
// 概念示意
const ydoc = new Y.Doc();
const yTextOf = (path: string) => ydoc.getText(path); // 按文件路径取协同文本
```

## 6. 与现有代码的集成点

现有关键结构：

- `src/components/Editor.tsx`：`@monaco-editor/react`，`handleMount` 已保存 `editorRef`（可拿到 editor 与 model）。
- `src/stores/editorStore.tsx`：`files[]`、`activeFileId`、`UPDATE_FILE_CONTENT`、`MARK_FILE_SAVED`、`RELOAD_FILE`。
- `src/services/fs.ts`：`writeFile` + `Editor.handleChange` 中的防抖 autosave。

### 6.1 新增协同服务 `src/services/collab.ts`

集中管理 `Y.Doc` / `WebrtcProvider` / 各文件的 `MonacoBinding` 生命周期。

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { MonacoBinding } from 'y-monaco';
import type { editor } from 'monaco-editor';

interface CollabSession {
  ydoc: Y.Doc;
  provider: WebrtcProvider;
  bindings: Map<string, MonacoBinding>; // key: file.path
}

let session: CollabSession | null = null;

/** 加入协同房间（房间名 + 口令即“密钥”，两人约定一致即可连上） */
export const joinRoom = (
  room: string,
  password: string,
  user: { name: string; color: string }
) => {
  const ydoc = new Y.Doc();
  const provider = new WebrtcProvider(room, ydoc, {
    password,
    signaling: ['wss://<信令地址>'], // 公共或自建
  });
  provider.awareness.setLocalStateField('user', user);
  session = { ydoc, provider, bindings: new Map() };
};

/** 将某个已打开文件的 Monaco model 绑定到 Yjs（切换/打开文件时调用） */
export const bindModel = (
  path: string,
  editorInstance: editor.IStandaloneCodeEditor
) => {
  if (!session) return;
  const model = editorInstance.getModel();
  if (!model || session.bindings.has(path)) return;
  const ytext = session.ydoc.getText(path);
  session.bindings.set(
    path,
    new MonacoBinding(
      ytext,
      model,
      new Set([editorInstance]),
      session.provider.awareness
    )
  );
};

/** 离开房间，释放所有绑定与连接 */
export const leaveRoom = () => {
  session?.bindings.forEach((b) => b.destroy());
  session?.provider.destroy();
  session?.ydoc.destroy();
  session = null;
};
```

### 6.2 Editor.tsx 接入

- `handleMount` / `activeFile` 变化时调用 `bindModel(activeFile.path, editorRef.current)`。
- **多文件注意**：当前实现同一时刻仅挂载 `activeFile` 的 model（切换文件重建）。因此：
  - 已绑定的 `Y.Text` 即使文件未激活也会持续通过 provider 同步（数据层不依赖 model 是否挂载）；
  - 重新激活某文件时，若该 model 重新创建，需要重新 `bindModel`（`bindings` 用 path 去重，销毁旧绑定后再建）。

### 6.3 落盘（复用现有 autosave）

- 协同期间编辑器内容由 Yjs 驱动；`onChange` 仍会触发，沿用现有防抖 `writeFile`。
- 建议对"远端更新引起的变化"也落盘：监听 `ytext.observe(...)` 或复用 `onChange`，防抖后写回本地，保证磁盘快照跟上。

### 6.4 UI

- 在 `ActivityBar` 或 `Header` 增加"协同"入口：输入**房间名 + 口令 + 昵称**，调用 `joinRoom`；再次点击 `leaveRoom`。
- 协作者光标/选区由 `y-monaco` 基于 awareness 自动渲染；可加样式区分颜色。
- 状态提示：已连接的 peer 数量（`provider.awareness.getStates().size`）。

## 7. 信令服务器

- 作用：仅在建连阶段转发 WebRTC 的 SDP/ICE，让两端"互相找到"，**不接触代码内容**。
- 选择：
  - 公共实例（快速试用）；
  - 自建（推荐，稳定可控）：`y-webrtc` 提供的 signaling server，几十行、可跑在任意小机器/局域网。
- NAT 穿透：
  - 多数情况配置公共 **STUN** 即可打洞成功；
  - 少数严格对称 NAT 需要 **TURN** 中继（此时流量经 TURN，但仍是加密的、且不解析内容）。

## 8. 安全

- `WebrtcProvider` 的 `password` 对同步数据做端到端加密，房间名 + 口令共同作为访问密钥。
- 房间名避免使用可猜测的公共词；口令走安全渠道约定。
- 不在仓库中硬编码信令地址以外的任何密钥。

## 9. 取舍与限制

- 仍需一个信令服务（轻量、不存数据）；真正的"零服务器"仅在手动交换信令 / 同局域网场景下可行，体验差，不作为本方案。
- P2P 网状连接（mesh）在人数较多（> 一二十人）时开销上升；本场景为少数几人协同，无压力。
- 磁盘冲突：两端各写各自本地文件，不存在互相覆盖；与外部（编辑器之外）改动的冲突仍由现有"外部修改重载"机制兜底。
- 断网重连：`y-webrtc` 会自动重连并基于 CRDT 合并离线期间的编辑。

## 10. 实施计划（分阶段）

1. **接入依赖与最小闭环**：`collab.ts` + Editor 绑定 `activeFile`，两人同房间能实时同步单个文件。
2. **多文件与生命周期**：打开/切换/关闭文件时正确 `bindModel` / 销毁绑定。
3. **在场与光标**：awareness 昵称/颜色/光标渲染，显示在线人数。
4. **落盘与提示**：远端更新防抖写回本地；连接状态与错误 Toast。
5. **信令与部署**：自建信令 + STUN 配置；文档化房间/口令使用方式。
6. **打磨**：加密口令校验、断线重连提示、只读/跟随模式（可选）。

## 11. 验证要点

- 两浏览器加入同一房间，A 输入即时反映到 B，反之亦然。
- 同一行并发编辑不丢字符、最终一致。
- 断开 A 网络 → A 离线编辑 → 恢复后与 B 合并无冲突。
- 各端本地磁盘文件均被正确写回。

---

# 实时预览设计文档（Web 内运行项目）

## 1. 背景与目标

在浏览器内把用户编辑的 React/TS 项目**实时运行并预览**，无需本地 Node 环境。核心链路统一为三步：**转译 → 组装模块 → 沙箱运行**。本文档记录两条可落地路线：

- **方案 B：客户端打包器（Sandpack）** —— 浏览器内完成解析/转译/打包，运行于 iframe。
- **方案 C：WebContainer** —— 浏览器内跑 WebAssembly 版 Node.js，运行真实 dev server。

（轻量的"Babel + iframe 单文件"路线见前述讨论，此处不展开。）

---

## 2. 方案 B：客户端打包器（Sandpack）

### 2.1 原理

Sandpack（CodeSandbox 开源的客户端 bundler）在浏览器里完成：模块解析 → 依赖树构建 → 转译 → 打包，产物运行在隔离 iframe。支持多文件、`import` npm 包、错误覆盖层，部分模板支持 HMR。依赖包从 CDN（如 esm.sh / CodeSandbox 的包解析服务）拉取。

### 2.2 依赖

```bash
# 高层组件（最快）
pnpm add @codesandbox/sandpack-react
# 或仅用底层内核，自绘 UI
pnpm add @codesandbox/sandpack-client
```

### 2.3 架构与数据流

```
editorStore.files / 文件树
        │  映射为 Sandpack files map { "/App.tsx": { code } }
        ▼
 Sandpack 内核（浏览器内 bundler）
        │  解析 import → 从 CDN 拉依赖 → 转译打包
        ▼
    预览 iframe（沙箱运行，postMessage 通信）
        │  运行时错误 / console → 覆盖层与控制台面板
```

### 2.4 与现有代码的集成点

- **文件来源**：把工作区文件映射为 Sandpack 的 `files`（key 为以 `/` 开头的路径，value 为 `{ code }`）。
  - 来源可选：已打开的 `editorStore.files`，或遍历文件树 `services/fs.ts` 读取相关文件。
  - 入口约定：`/index.tsx` 或模板默认入口；`package.json` 的依赖交给 Sandpack 解析。
- **内容同步**：Monaco `onChange` → 防抖 → 更新对应 Sandpack 文件 → 触发重新打包与预览刷新。
- **UI**：在 `ActivityBar` 加"预览"视图，或在编辑区右侧开分栏（复用 `App.tsx` 的 resizer 思路）放预览面板。

```tsx
// 概念示意：受控地把工作区文件喂给 Sandpack
import { Sandpack } from '@codesandbox/sandpack-react';

/** 将工作区文件转为 Sandpack files map */
const toSandpackFiles = (files: { path: string; content: string }[]) =>
  Object.fromEntries(
    files.map((f) => [
      f.path.startsWith('/') ? f.path : `/${f.path}`,
      { code: f.content },
    ])
  );

<Sandpack
  template="react-ts"
  files={toSandpackFiles(openFiles)}
  options={{
    showConsole: true,
    editorHeight: 0 /* 用我们自己的 Monaco 编辑 */,
  }}
/>;
```

> 说明：编辑仍用项目自带的 Monaco，Sandpack 仅作运行/预览内核（可隐藏其内置编辑器）。若要更细控制，用 `@codesandbox/sandpack-client` 直接驱动预览、自绘控制台。

### 2.5 关键细节

- **依赖获取**：由 Sandpack 内核负责，从 CDN 拉取；`package.json` 决定版本。
- **错误处理**：Sandpack 自带编译错误覆盖层；运行时错误通过其 client 事件订阅。
- **console 转发**：`showConsole` 或订阅 client 的 `console` 消息渲染到自有面板。
- **性能**：首次打包与拉依赖有网络与转译开销；文件多时对变更做防抖。

### 2.6 取舍

- 优点：**集成成本低**、多文件、依赖支持、错误覆盖开箱即用；纯前端，可静态托管，无需特殊响应头。
- 局限：并非真实 Node 环境，某些依赖 CDN 解析可能失败；构建行为与本地 Vite/Webpack 有差异；无终端、无任意脚本。

---

## 3. 方案 C：WebContainer

### 3.1 原理

StackBlitz 的 WebContainer：在浏览器内用 WebAssembly 运行一个 **Node.js 运行时**，可真正执行 `npm install`、启动 Vite/Webpack **dev server**。通过 **Service Worker** 拦截请求，把 dev server 的响应喂给预览 iframe，支持真实 HMR 与终端。

### 3.2 依赖与硬性前提

```bash
pnpm add @webcontainer/api
```

- **跨域隔离（必须）**：WebContainer 依赖 `SharedArrayBuffer`，页面响应头必须包含：
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- **托管影响**：当前 `deploy.yml` 若发布到 GitHub Pages（无法自定义响应头），需改用可设响应头的托管，或用 `coi-serviceworker` 之类的 Service Worker 方案注入隔离头。
- 浏览器：需较新的 Chromium/Firefox；跨源资源需带 CORP，否则被 COEP 拦截。

### 3.3 架构与数据流

```
File System Access 读取本地项目
        │  构造 FileSystemTree
        ▼
 WebContainer.boot() → mount(tree)
        │  spawn: npm install → npm run dev（真实 Vite/Webpack）
        ▼
 'server-ready' 事件拿到本地预览 URL
        │  Service Worker 代理 dev server 输出
        ▼
    预览 iframe（真实 dev server + HMR）
        ▲
 Monaco 编辑 → wc.fs.writeFile(path) → dev server 触发 HMR
```

### 3.4 与现有代码的集成点

- **挂载文件**：把工作区文件（`services/fs.ts` 遍历读取）构造成 `FileSystemTree` 后 `mount`。
- **内容同步**：Monaco `onChange` → 防抖 → `webcontainerInstance.fs.writeFile(path, content)`；dev server 自身负责 HMR，无需刷新整个 iframe。
- **进程与终端**：`spawn('npm', ['install'])`、`spawn('npm', ['run', 'dev'])`；输出流可接一个终端面板（如 xterm.js）。
- **预览 URL**：监听 `server-ready`，将回调的 `url` 写入预览 iframe 的 `src`。

```ts
import { WebContainer, type FileSystemTree } from '@webcontainer/api';

let wc: WebContainer | null = null;

/** 启动 WebContainer 并跑起 dev server，返回预览 URL */
export const startPreview = async (
  tree: FileSystemTree,
  onUrl: (url: string) => void
) => {
  wc = await WebContainer.boot();
  await wc.mount(tree);

  const install = await wc.spawn('npm', ['install']);
  if ((await install.exit) !== 0) throw new Error('npm install failed');

  await wc.spawn('npm', ['run', 'dev']);
  wc.on('server-ready', (_port, url) => onUrl(url)); // 塞进预览 iframe
};

/** 编辑内容同步到容器内文件，触发 dev server HMR */
export const syncFile = (path: string, content: string) =>
  wc?.fs.writeFile(path, content);
```

### 3.5 取舍

- 优点：**最接近真实开发环境**（真实 Node、真实构建、HMR、终端、任意 npm 脚本），行为与本地一致。
- 局限：技术最重；**强制跨域隔离头**限制托管方式；首次 `npm install` 慢、内存占用高；老浏览器不支持。

---

## 4. 方案对比

| 维度             | 方案 B（Sandpack）            | 方案 C（WebContainer）    |
| ---------------- | ----------------------------- | ------------------------- |
| 运行环境         | 浏览器内 bundler，非真实 Node | 浏览器内真实 Node（WASM） |
| 多文件 / npm     | 支持（CDN 解析）              | 支持（真实 npm install）  |
| HMR              | 部分模板                      | 真实 dev server HMR       |
| 终端 / 任意脚本  | 否                            | 是                        |
| 集成成本         | 低（现成组件）                | 高                        |
| 托管要求         | 普通静态托管即可              | **必须 COOP/COEP 隔离头** |
| 首次开销         | 中（拉依赖+打包）             | 高（install+boot）        |
| 与本地构建一致性 | 有差异                        | 高度一致                  |

## 5. 选型建议

- **先接方案 B**：投入产出比最高，纯前端、可继续静态托管，快速得到多文件实时预览。
- **需要真实环境/终端/任意脚本时再上方案 C**，并同步解决托管的跨域隔离头问题。
- 两者可共存：默认 Sandpack 预览；提供"高保真模式"切换到 WebContainer。

## 6. 实施计划

1. **预览面板骨架**：`App.tsx` 加右侧可拖拽分栏 + "预览"开关（复用现有 resizer）。
2. **方案 B 最小闭环**：工作区文件 → `toSandpackFiles` → `Sandpack` 运行，隐藏其内置编辑器，用自有 Monaco 编辑并 `onChange` 同步。
3. **控制台与错误面板**：转发运行时 console / 错误。
4. **（可选）方案 C**：配置 COOP/COEP（或 `coi-serviceworker`）→ `@webcontainer/api` boot/mount → install + dev → `server-ready` 注入 iframe → 编辑 `fs.writeFile` 同步 HMR → 接 xterm.js 终端。
5. **模式切换**：Sandpack / WebContainer 二选一的"预览引擎"开关。

## 7. 验证要点

- 方案 B：改动 `App.tsx` 内容，预览在防抖后更新；`import` 第三方包能正常解析运行；编译错误有覆盖层。
- 方案 C：`npm install` 成功、dev server 起来、`server-ready` 拿到 URL；编辑触发 HMR 而非整页刷新；页面带正确的 COOP/COEP 头（否则 `SharedArrayBuffer` 不可用会启动失败）。
