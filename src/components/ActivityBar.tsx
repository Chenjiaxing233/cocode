import { CommentDiscussionIcon, FilesIcon, SearchIcon } from './icons';

/** 侧边栏视图类型 */
export type SideView = 'explorer' | 'search' | 'chat';

/**
 * VSCode 风格活动栏：左侧竖排图标，用于在资源管理器 / 搜索视图间切换。
 */
export default function ActivityBar({
  active,
  onChange,
}: {
  active: SideView;
  onChange: (view: SideView) => void;
}) {
  return (
    <div className="activity-bar">
      <button
        className={`activity-item ${active === 'explorer' ? 'activity-item-active' : ''}`}
        title="Explorer"
        onClick={() => onChange('explorer')}
      >
        <FilesIcon size={24} />
      </button>
      <button
        className={`activity-item ${active === 'chat' ? 'activity-item-active' : ''}`}
        title="Assistant chat"
        onClick={() => onChange('chat')}
      >
        <CommentDiscussionIcon size={24} />
      </button>
      <button
        className={`activity-item ${active === 'search' ? 'activity-item-active' : ''}`}
        title="Search"
        onClick={() => onChange('search')}
      >
        <SearchIcon size={24} />
      </button>
    </div>
  );
}
