import { FormEvent, useEffect, useRef, useState } from 'react';
import { useEditorDispatch, useEditorState } from '../stores/editorStore';
import { SendIcon, CloseIcon } from './icons';
import '../styles/chat.css';

interface ChatMessage {
  id: number;
  text: string;
  from: 'you' | 'assistant';
  fileId?: string;
  fileName?: string;
  line?: number;
}

/** 代码协助聊天面板，支持将当前编辑器行作为消息引用。 */
export default function ChatPanel({ width }: { width: number }) {
  const { files, activeFileId } = useEditorState();
  const dispatch = useEditorDispatch();
  const activeFile = files.find((file) => file.id === activeFileId);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      from: 'assistant',
      text: '你好！选中代码行后，可以在这里提问或讨论实现细节。',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [line, setLine] = useState<number | null>(null);
  const nextId = useRef(2);

  useEffect(() => {
    const handleCursor = (event: Event) => {
      const detail = (event as CustomEvent<{ line: number }>).detail;
      if (detail?.line) setLine(detail.line);
    };
    window.addEventListener('editor-cursor-line', handleCursor);
    return () => window.removeEventListener('editor-cursor-line', handleCursor);
  }, []);

  /** 发送消息，并在有当前文件时附带文件与行号引用。 */
  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const reference =
      activeFile && line
        ? { fileId: activeFile.id, fileName: activeFile.name, line }
        : {};
    setMessages((current) => [
      ...current,
      { id: nextId.current++, from: 'you', text, ...reference },
    ]);
    setDraft('');
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          from: 'assistant',
          text: reference.line
            ? `我会结合 ${reference.fileName} 第 ${reference.line} 行来分析这个问题。`
            : '我已收到你的问题，请补充相关代码行或预期行为。',
        },
      ]);
    }, 350);
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
          <div className="chat-title">协助聊天</div>
          <div className="chat-subtitle">围绕代码行讨论问题</div>
        </div>
        <button
          className="chat-clear"
          title="清空聊天"
          onClick={() => setMessages([])}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">暂无消息，开始一段讨论吧。</div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message chat-message-${message.from}`}
          >
            <div className="chat-message-author">
              {message.from === 'you' ? '你' : '助手'}
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
          placeholder="输入消息，按 Enter 发送"
          rows={3}
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
          disabled={!draft.trim()}
        >
          <SendIcon size={16} />
          <span>发送</span>
        </button>
      </form>
    </aside>
  );
}
