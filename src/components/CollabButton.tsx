import { useEditorDispatch } from '../stores/editorStore';
import { useCollabSnapshot } from '../hooks/useCollab';
import { getShareLink, startSession, stopSession } from '../services/collab';
import '../styles/collab.css';

/**
 * 顶栏协同入口：开启共享并复制链接 / 显示在线成员 / 退出协同。
 */
const CollabButton = () => {
  const dispatch = useEditorDispatch();
  const { active, peers, users } = useCollabSnapshot();

  /** 复制分享链接到剪贴板，失败时弹窗展示供手动复制 */
  const copyLink = async () => {
    const link = getShareLink();
    try {
      await navigator.clipboard.writeText(link);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: '协同链接已复制，发给对方打开即可一起编辑',
          type: 'success',
        },
      });
    } catch {
      window.prompt('复制以下链接发给对方：', link);
    }
  };

  /** 新建房间并复制链接 */
  const handleStart = () => {
    startSession();
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
      <button
        className="theme-btn collab-btn"
        onClick={handleStart}
        title="生成链接，与他人实时共享编辑已打开的文件"
      >
        共享协同
      </button>
    );

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
      </button>
      <button className="theme-btn" onClick={handleStop}>
        退出协同
      </button>
    </>
  );
};

export default CollabButton;
