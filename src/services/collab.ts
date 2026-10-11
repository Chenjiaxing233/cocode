import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { joinRoom, type Room } from 'trystero';
import type { editor as MonacoEditorNS } from 'monaco-editor';

/**
 * 免登录 P2P 协同：
 * - 数据：Yjs CRDT，每个共享文件一个 Y.Text，元信息存 Y.Map
 * - 传输：trystero（WebRTC 直连，借公共 Nostr 中继完成握手，无需自建服务器）
 * - 鉴权：房间号 + 口令放在链接 hash 中，口令用于加密握手信令
 */

const APP_ID = 'jx-web-code-collab';
/** 远端来源标记，避免回环广播 */
const REMOTE = Symbol('remote');
const COLORS = [
  '#e06c75',
  '#61afef',
  '#98c379',
  '#e5c07b',
  '#c678dd',
  '#56b6c2',
  '#d19a66',
];

export interface SharedFileMeta {
  name: string;
  language: string;
}

/** 协同权限：对方可编辑 / 只读 */
export type CollabMode = 'edit' | 'readonly';

/** 本端角色：发起者（持有本地文件） / 访客 */
export type CollabRole = 'host' | 'guest' | '';

export interface CollabUser {
  clientID: number;
  name: string;
  color: string;
}

/** 协同房间中的聊天消息。 */
export interface CollabChatMessage {
  id: string;
  senderClientID: number;
  senderName: string;
  senderColor: string;
  text: string;
  fileId?: string;
  fileName?: string;
  line?: number;
}

export interface CollabSnapshot {
  active: boolean;
  room: string;
  key: string;
  peers: number;
  users: CollabUser[];
  /** 共享文件列表变更版本号，供组件感知 */
  filesVersion: number;
  role: CollabRole;
  /** 权限模式；访客在收到发起者声明前为 null */
  mode: CollabMode | null;
}

interface Session {
  ydoc: Y.Doc;
  awareness: Awareness;
  room: Room;
  files: Y.Map<SharedFileMeta>;
  peerClients: Map<string, number>;
  /** 访客侧记录发起者的 peerId，只读模式下只接受其文档更新 */
  hostPeerId: string | null;
  chatAction: ChatAction;
}

interface ChatAction {
  send: (message: CollabChatMessage) => void;
  onMessage: (message: CollabChatMessage) => void;
}

/** 握手消息：发起者附带权限模式，访客为 null */
type Hello = { clientID: number; mode: CollabMode | null };

const EMPTY: CollabSnapshot = {
  active: false,
  room: '',
  key: '',
  peers: 0,
  users: [],
  filesVersion: 0,
  role: '',
  mode: null,
};

let session: Session | null = null;
let snapshot: CollabSnapshot = EMPTY;
const listeners = new Set<() => void>();
const chatListeners = new Set<(message: CollabChatMessage) => void>();

/** 更新快照并通知订阅者 */
const setSnapshot = (patch: Partial<CollabSnapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
};

/** useSyncExternalStore 订阅入口 */
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** 订阅当前协同房间的聊天消息。 */
export const subscribeChat = (
  listener: (message: CollabChatMessage) => void
) => {
  chatListeners.add(listener);
  return () => chatListeners.delete(listener);
};

/** 获取当前客户端在 awareness 中的唯一编号。 */
export const getLocalClientID = () => session?.ydoc.clientID;

/** useSyncExternalStore 快照入口 */
export const getSnapshot = () => snapshot;

/** 生成 URL 安全的随机串 */
const randomId = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

/** 过滤远端提供的昵称，防止样式注入 */
const safeName = (v: unknown) =>
  (typeof v === 'string' ? v : '匿名')
    .replace(/["\\<>{};]/g, '')
    .slice(0, 20) || '匿名';

/** 过滤远端提供的颜色 */
const safeColor = (v: unknown) =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : COLORS[0];

/** 本地昵称，持久化在 localStorage */
const localUser = () => {
  const saved = localStorage.getItem('collab-name');
  const name = saved || `用户-${randomId(2)}`;
  if (!saved) localStorage.setItem('collab-name', name);
  return { name, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
};

/** 向当前协同房间广播聊天消息。 */
export const sendChatMessage = (
  message: Omit<
    CollabChatMessage,
    'id' | 'senderClientID' | 'senderName' | 'senderColor'
  >
) => {
  if (!session || !snapshot.active) return false;
  const user = session.awareness.getLocalState()?.user as
    | { name?: unknown; color?: unknown }
    | undefined;
  const fullMessage: CollabChatMessage = {
    ...message,
    id: `${session.ydoc.clientID}-${Date.now()}-${randomId(3)}`,
    senderClientID: session.ydoc.clientID,
    senderName: safeName(user?.name),
    senderColor: safeColor(user?.color),
  };
  session.chatAction.send(fullMessage);
  chatListeners.forEach((listener) => listener(fullMessage));
  return true;
};

const textOf = (s: Session, key: string) => s.ydoc.getText(`file:${key}`);

/** 从 awareness 刷新在线用户，并重写远端光标颜色样式 */
const refreshUsers = () => {
  if (!session) return;
  const users: CollabUser[] = [];
  session.awareness.getStates().forEach((state, clientID) => {
    const user = state.user as { name?: unknown; color?: unknown } | undefined;
    users.push({
      clientID,
      name: safeName(user?.name),
      color: safeColor(user?.color),
    });
  });

  let style = document.getElementById('collab-cursor-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'collab-cursor-style';
    document.head.appendChild(style);
  }
  style.textContent = users
    .map(
      ({ clientID: id, name, color }) =>
        `.yRemoteSelection-${id}{background-color:${color}40}` +
        `.yRemoteSelectionHead-${id}{border-color:${color}}` +
        `.yRemoteSelectionHead-${id}::after{content:"${name}";background:${color}}`
    )
    .join('\n');

  setSnapshot({ users });
};

/** 生成分享链接（口令只在 hash 中，不会发送到任何服务器） */
export const getShareLink = () =>
  `${location.origin}${location.pathname}#collab=${snapshot.room}.${snapshot.key}`;

/** 解析当前 URL 中的协同参数 */
export const parseCollabHash = () => {
  const m = location.hash.match(/collab=([0-9a-f]+)\.([0-9a-f]+)/i);
  return m ? { room: m[1], key: m[2] } : null;
};

/** 本端是否为只读访客 */
export const isReadOnlyGuest = (s: CollabSnapshot = snapshot) =>
  s.role === 'guest' && s.mode === 'readonly';

/**
 * 是否接受某个 peer 的文档更新。
 * 只读模式下：发起者拒收所有访客更新；访客只接收发起者的更新。
 */
const acceptsDocFrom = (s: Session, peerId: string) => {
  if (snapshot.mode !== 'readonly') return true;
  return snapshot.role === 'guest' && peerId === s.hostPeerId;
};

/**
 * 新建协同房间（本端为发起者）。
 * @param mode 对方权限
 */
export const hostSession = (mode: CollabMode) =>
  startSession(randomId(8), randomId(16), mode);

/**
 * 加入协同房间；传入 mode 表示以发起者身份创建，否则为访客。
 * @param room 房间号
 * @param key 口令
 * @param mode 发起者设定的对方权限
 */
export const startSession = (room: string, key: string, mode?: CollabMode) => {
  if (session) {
    if (snapshot.room === room) return;
    stopSession();
  }

  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const trRoom = joinRoom({ appId: APP_ID, password: key }, room);
  const files = ydoc.getMap<SharedFileMeta>('files');
  const peerClients = new Map<string, number>();
  const s: Session = {
    ydoc,
    awareness,
    room: trRoom,
    files,
    peerClients,
    hostPeerId: null,
    chatAction: trRoom.makeAction('chat') as unknown as ChatAction,
  };
  session = s;

  const docAction = trRoom.makeAction<Uint8Array>('doc');
  const awAction = trRoom.makeAction<Uint8Array>('aw');
  const helloAction = trRoom.makeAction<Hello>('hello');
  s.chatAction.onMessage = (message) => {
    if (!message || typeof message.text !== 'string') return;
    chatListeners.forEach((listener) => listener(message));
  };

  // 本地变更 → 广播
  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) docAction.send(update);
  });
  awareness.on(
    'update',
    (
      {
        added,
        updated,
        removed,
      }: Record<'added' | 'updated' | 'removed', number[]>,
      origin: unknown
    ) => {
      if (origin !== REMOTE)
        awAction.send(
          encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])
        );
    }
  );
  awareness.on('change', refreshUsers);
  files.observe(() => setSnapshot({ filesVersion: snapshot.filesVersion + 1 }));

  // 远端 → 本地
  docAction.onMessage = (data, { peerId }) => {
    if (!acceptsDocFrom(s, peerId)) return;
    Y.applyUpdate(ydoc, new Uint8Array(data as unknown as ArrayBuffer), REMOTE);
  };
  awAction.onMessage = (data) =>
    applyAwarenessUpdate(
      awareness,
      new Uint8Array(data as unknown as ArrayBuffer),
      REMOTE
    );
  helloAction.onMessage = ({ clientID, mode: hostMode }, { peerId }) => {
    peerClients.set(peerId, clientID);
    // 访客收到发起者声明：记录发起者并同步权限模式
    if (hostMode && snapshot.role === 'guest') {
      s.hostPeerId = peerId;
      setSnapshot({ mode: hostMode });
    }
  };

  // 新成员加入：互发全量文档与在场信息（CRDT 自动合并）
  trRoom.onPeerJoin = (peerId) => {
    helloAction.send(
      { clientID: ydoc.clientID, mode: mode ?? null },
      { target: peerId }
    );
    docAction.send(Y.encodeStateAsUpdate(ydoc), { target: peerId });
    awAction.send(
      encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]),
      { target: peerId }
    );
    setSnapshot({ peers: Object.keys(trRoom.getPeers()).length });
  };
  trRoom.onPeerLeave = (peerId) => {
    const clientID = peerClients.get(peerId);
    if (clientID !== undefined)
      removeAwarenessStates(awareness, [clientID], REMOTE);
    peerClients.delete(peerId);
    setSnapshot({ peers: Object.keys(trRoom.getPeers()).length });
  };

  awareness.setLocalStateField('user', localUser());
  setSnapshot({
    ...EMPTY,
    active: true,
    room,
    key,
    filesVersion: 1,
    role: mode ? 'host' : 'guest',
    mode: mode ?? null,
  });
  refreshUsers();
};

/** 离开房间并释放资源 */
export const stopSession = () => {
  if (!session) return;
  const s = session;
  session = null;
  removeAwarenessStates(s.awareness, [s.ydoc.clientID], 'leave');
  s.room.leave();
  s.awareness.destroy();
  s.ydoc.destroy();
  document.getElementById('collab-cursor-style')?.remove();
  setSnapshot(EMPTY);
};

/**
 * 共享一个本地文件（已共享则忽略，避免重复写入初始内容）。
 * @param key 共享 key（本地 file.id）
 */
export const shareFile = (
  key: string,
  meta: SharedFileMeta,
  content: string
) => {
  const s = session;
  if (!s || s.files.has(key)) return;
  s.ydoc.transact(() => {
    textOf(s, key).insert(0, content);
    s.files.set(key, meta);
  });
};

/** 当前所有共享文件 */
export const getSharedFiles = () => {
  const s = session;
  if (!s) return [];
  return [...s.files.entries()].map(([key, meta]) => {
    const content = textOf(s, key).toString();
    return { key, meta, content };
  });
};

export const isShared = (key: string) => !!session?.files.has(key);

/**
 * 订阅远端引起的文本变化（用于非激活文件同步到 store / 落盘）。
 * @returns 取消订阅函数
 */
export const onRemoteTextChange = (
  cb: (key: string, content: string) => void
) => {
  const s = session;
  if (!s) return () => {};
  const handler = (tr: Y.Transaction) => {
    if (tr.origin !== REMOTE) return;
    s.files.forEach((_meta, key) => {
      const text = textOf(s, key);
      if (tr.changed.has(text as unknown as Y.AbstractType<Y.YEvent<Y.Text>>))
        cb(key, text.toString());
    });
  };
  s.ydoc.on('afterTransaction', handler);
  return () => s.ydoc.off('afterTransaction', handler);
};

type CodeEditor = MonacoEditorNS.IStandaloneCodeEditor;
type RelJSON = ReturnType<typeof Y.relativePositionToJSON>;

/**
 * 将 Monaco 编辑器与共享文本双向绑定，并渲染远端光标/选区。
 * @returns 解绑函数
 */
export const bindEditor = (key: string, ed: CodeEditor) => {
  const s = session;
  const model = ed.getModel();
  if (!s || !model || !s.files.has(key)) return () => {};

  const ytext = textOf(s, key);
  const origin = {}; // 本绑定的本地事务标记
  let muted = false;
  /** 执行期间忽略 model 变更，避免回写 Yjs */
  const mute = (fn: () => void) => {
    muted = true;
    try {
      fn();
    } finally {
      muted = false;
    }
  };

  if (model.getValue() !== ytext.toString())
    mute(() => model.setValue(ytext.toString()));

  const decorations = ed.createDecorationsCollection();

  /** 根据 awareness 渲染其他人的光标与选区 */
  const renderCursors = () => {
    const next: MonacoEditorNS.IModelDeltaDecoration[] = [];
    s.awareness.getStates().forEach((state, clientID) => {
      const c = state.cursor as
        | { key: string; anchor: RelJSON; head: RelJSON }
        | undefined;
      if (clientID === s.ydoc.clientID || !c || c.key !== key) return;
      const a = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(c.anchor),
        s.ydoc
      );
      const h = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(c.head),
        s.ydoc
      );
      if (!a || !h || a.type !== ytext || h.type !== ytext) return;
      const forward = a.index < h.index;
      const start = model.getPositionAt(Math.min(a.index, h.index));
      const end = model.getPositionAt(Math.max(a.index, h.index));
      const head = `yRemoteSelectionHead yRemoteSelectionHead-${clientID}`;
      next.push({
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        options: {
          className: `yRemoteSelection yRemoteSelection-${clientID}`,
          afterContentClassName: forward ? head : null,
          beforeContentClassName: forward ? null : head,
        },
      });
    });
    decorations.set(next);
  };

  // 远端 Yjs 变更 → Monaco（按 delta 顺序逐段应用）
  const onYText = (event: Y.YTextEvent) => {
    if (event.transaction.origin !== origin) {
      mute(() => {
        let index = 0;
        event.delta.forEach((op) => {
          if (op.retain !== undefined) index += op.retain;
          else if (typeof op.insert === 'string') {
            const p = model.getPositionAt(index);
            model.applyEdits([
              {
                range: {
                  startLineNumber: p.lineNumber,
                  startColumn: p.column,
                  endLineNumber: p.lineNumber,
                  endColumn: p.column,
                },
                text: op.insert,
              },
            ]);
            index += op.insert.length;
          } else if (op.delete !== undefined) {
            const p = model.getPositionAt(index);
            const e = model.getPositionAt(index + op.delete);
            model.applyEdits([
              {
                range: {
                  startLineNumber: p.lineNumber,
                  startColumn: p.column,
                  endLineNumber: e.lineNumber,
                  endColumn: e.column,
                },
                text: '',
              },
            ]);
          }
        });
      });
    }
    renderCursors();
  };
  ytext.observe(onYText);

  // 本地 Monaco 变更 → Yjs（按偏移倒序应用，保证位置正确）
  const contentSub = model.onDidChangeContent((e) => {
    if (muted || isReadOnlyGuest()) return;
    s.ydoc.transact(() => {
      [...e.changes]
        .sort((x, y) => y.rangeOffset - x.rangeOffset)
        .forEach((c) => {
          ytext.delete(c.rangeOffset, c.rangeLength);
          ytext.insert(c.rangeOffset, c.text);
        });
    }, origin);
  });

  // 本地光标 → awareness（使用相对位置，编辑后仍准确）
  const cursorSub = ed.onDidChangeCursorSelection(() => {
    const sel = ed.getSelection();
    if (!sel || ed.getModel() !== model) return;
    const rel = (lineNumber: number, column: number) =>
      Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(
          ytext,
          model.getOffsetAt({ lineNumber, column })
        )
      );
    s.awareness.setLocalStateField('cursor', {
      key,
      anchor: rel(sel.selectionStartLineNumber, sel.selectionStartColumn),
      head: rel(sel.positionLineNumber, sel.positionColumn),
    });
  });

  s.awareness.on('change', renderCursors);
  renderCursors();

  return () => {
    ytext.unobserve(onYText);
    contentSub.dispose();
    cursorSub.dispose();
    s.awareness.off('change', renderCursors);
    decorations.clear();
    if (session === s) s.awareness.setLocalStateField('cursor', null);
  };
};
