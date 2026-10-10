import { useEffect, useRef, useState } from 'react';
import { useEditorDispatch } from '../stores/editorStore';
import { useCollabSnapshot } from '../hooks/useCollab';
import {
  getShareLink,
  hostSession,
  stopSession,
  type CollabMode,
} from '../services/collab';
import '../styles/collab.css';

/** 权限选项 */
const MODE_OPTIONS: { mode: CollabMode; label: string; desc: string }[] = [
  { mode: 'edit', label: '可编辑', desc: '对方可以与你一起修改文件' },
  { mode: 'readonly', label: '只读', desc: '对方只能查看，无法修改' },
];

const MODE_LABEL: Record<CollabMode, string> = {
  edit: '可编辑',
  readonly: '只读',
};

/**
 * 顶栏协同入口：选择对方权限后开启共享并复制链接 / 显示在线成员 / 退出协同。
 */
const CollabButton = () => {
  const dispatch = useEditorDispatch();
  const { active, peers, users, mode, role } = useCollabSnapshot();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部或按 Esc 关闭权限菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /** 复制分享链接到剪贴板，失败时弹窗展示供手动复制 */
  const copyLink = async () => {
    const link = getShareLink();
    try {
      await navigator.clipboard.writeText(link);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: '协同链接已复制，发给对方打开即可加入',
          type: 'success',
        },
      });
    } catch {
      window.prompt('复制以下链接发给对方：', link);
    }
  };

  /**
   * 按所选权限新建房间并复制链接
   * @param next 对方权限
   */
  const handleStart = (next: CollabMode) => {
    setMenuOpen(false);
    hostSession(next);
    copyLink();
  };

  /** 退出协同并清理 URL 中的房间参数 */
  const handleStop = () => {
    stopSession();
    history.replaceState(null, '', location.pathname + location.search);
    dispatch({
      type: 'SHOW_TOAST',
      payload: { message: '已退出协同', type: 'info' },
    });
  };

  if (!active)
    return (
      <div className="collab-wrap" ref={wrapRef}>
        <button
          className="theme-btn collab-btn"
          onClick={() => setMenuOpen((v) => !v)}
          title="生成链接，与他人实时共享已打开的文件"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          共享协同
        </button>
        {menuOpen && (
          <div className="collab-menu" role="menu" aria-label="选择对方权限">
            <div className="collab-menu-title">对方权限</div>
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.mode}
                className="collab-menu-item"
                role="menuitem"
                onClick={() => handleStart(o.mode)}
              >
                <span className="collab-menu-label">{o.label}</span>
                <span className="collab-menu-desc">{o.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );

  /** 权限标签：发起者显示设定值，访客显示收到的值 */
  const modeTag = mode
    ? `${role === 'guest' ? '我' : '对方'}${MODE_LABEL[mode]}`
    : '';

  return (
    <>
      <button
        className="theme-btn collab-btn active"
        onClick={copyLink}
        title={`在线：${users.map((u) => u.name).join('、')}\n点击复制协同链接`}
      >
        <span className="collab-users">
          {users.map((u) => (
            <span
              key={u.clientID}
              className="collab-dot"
              style={{ background: u.color }}
            />
          ))}
        </span>{' '}
        {peers > 0 ? `协同中 · ${peers + 1} 人` : '等待加入…'}
        {modeTag && <span className="collab-mode-tag">{modeTag}</span>}
      </button>
      <button className="theme-btn" onClick={handleStop}>
        退出协同
      </button>
    </>
  );
};

export default CollabButton;
