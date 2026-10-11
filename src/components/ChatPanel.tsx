import { FormEvent, useEffect, useState } from 'react';
import { useEditorDispatch, useEditorState } from '../stores/editorStore';
import {
  sendChatMessage,
  subscribeChat,
  getLocalClientID,
  type CollabChatMessage,
} from '../services/collab';
import { useCollabSnapshot } from '../hooks/useCollab';
import { SendIcon, CloseIcon } from './icons';
import '../styles/chat.css';

/** 协同聊天面板中的展示消息。 */
interface ChatMessage extends CollabChatMessage {
  local?: boolean;
}

/** 协同房间聊天面板，消息通过当前 Trystero 房间实时广播。 */
export default function ChatPanel({ width }: { width: number }) {
  const { files, activeFileId } = useEditorState();
  const dispatch = useEditorDispatch();
  const collab = useCollabSnapshot();
  const activeFile = files.find((file) => file.id === activeFileId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [line, setLine] = useState<number | null>(null);

  useEffect(() => {
    setMessages([]);
    if (!collab.active) return;
    const unsubscribe = subscribeChat((message) => {
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [
              ...current,
              {
                ...message,
                local: message.senderClientID === getLocalClientID(),
              },
            ]
      );
    });
    return () => {
      unsubscribe();
    };
  }, [collab.active, collab.room]);

  useEffect(() => {
    const handleCursor = (event: Event) => {
      const detail = (event as CustomEvent<{ line: number }>).detail;
      if (detail?.line) setLine(detail.line);
    };
    window.addEventListener('editor-cursor-line', handleCursor);
    return () => window.removeEventListener('editor-cursor-line', handleCursor);
  }, []);

  /** 将当前输入广播给协同房间中的所有成员。 */
  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !collab.active) return;
    sendChatMessage({
      text,
      ...(activeFile && line
        ? { fileId: activeFile.id, fileName: activeFile.name, line }
        : {}),
    });
    setDraft('');
  };

  /** 点击代码引用时跳转到对应文件和行。 */
  const revealMessage = (message: ChatMessage) => {
    if (!message.fileId || !message.line) return;
    dispatch({
      type: 'REVEAL_LOCATION',
      payload: {
        fileId: message.fileId,
        line: message.line,
        column: 1,
        endColumn: 1,
      },
    });
  };

  return (
    <aside className="chat-panel" style={{ width }}>
      <div className="chat-header">
        <div>
          <div className="chat-title">协同聊天</div>
          <div className="chat-subtitle">
            {collab.active
              ? `${collab.users.length} 位成员在线`
              : '请先加入协同房间'}
          </div>
        </div>
        <button
          className="chat-clear"
          title="清空本地显示"
          onClick={() => setMessages([])}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="chat-messages" aria-live="polite">
        {!collab.active && (
          <div className="chat-empty">
            点击顶部“共享协同”并加入房间后开始聊天。
          </div>
        )}
        {collab.active && messages.length === 0 && (
          <div className="chat-empty">暂无消息，和协同成员打个招呼吧。</div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.local ? 'chat-message-you' : 'chat-message-assistant'}`}
          >
            <div
              className="chat-message-author"
              style={{ color: message.senderColor }}
            >
              {message.local ? '你' : message.senderName}
            </div>
            <div className="chat-message-text">{message.text}</div>
            {message.line && (
              <button
                className="chat-reference"
                onClick={() => revealMessage(message)}
              >
                {message.fileName} · 第 {message.line} 行
              </button>
            )}
          </div>
        ))}
      </div>
      <form className="chat-composer" onSubmit={sendMessage}>
        {activeFile && (
          <div className="chat-context">
            <span>{activeFile.name}</span>
            {line ? <span>第 {line} 行</span> : <span>选择一行以添加引用</span>}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            collab.active ? '输入消息，按 Enter 发送' : '未加入协同房间'
          }
          rows={3}
          disabled={!collab.active}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          className="chat-send"
          type="submit"
          title="发送消息"
          disabled={!collab.active || !draft.trim()}
        >
          <SendIcon size={16} />
          <span>发送</span>
        </button>
      </form>
    </aside>
  );
}
