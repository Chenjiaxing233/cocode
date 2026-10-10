import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  EditorProvider,
  useEditorState,
  useEditorDispatch,
} from './stores/editorStore';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import SearchPanel from './components/SearchPanel';
import ActivityBar, { type SideView } from './components/ActivityBar';
import FileTabs from './components/FileTabs';
import Editor from './components/Editor';
import Preview from './components/Preview';
import { Toast } from './components/Toast';
import { useCollab } from './hooks/useCollab';
import './styles/common.css';
import './styles/preview.css';

const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 480;

function AppContent() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [sideView, setSideView] = useState<SideView>('explorer');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(420);
  const draggingRef = useRef(false);
  const previewDraggingRef = useRef(false);
  useCollab();

  /** 开始拖动分隔条，实时调整侧边栏宽度 */
  const startResize = (event: MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: globalThis.MouseEvent) => {
      if (!draggingRef.current) return;
      // 减去活动栏宽度（48px），得到侧边栏实际宽度
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, ev.clientX - 48)
      );
      setSidebarWidth(next);
    };

    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** 开始拖动预览面板分隔条。 */
  const startPreviewResize = (event: MouseEvent) => {
    event.preventDefault();
    previewDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: globalThis.MouseEvent) => {
      if (!previewDraggingRef.current) return;
      setPreviewWidth(Math.min(720, Math.max(280, window.innerWidth - ev.clientX)));
    };
    const onUp = () => {
      previewDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 全局快捷键：关闭当前文件、拦截保存对话框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // 关闭当前文件：Cmd/Ctrl+W（尽力拦截）或 Alt+W（可靠）
      if (key === 'w' && (mod || event.altKey)) {
        if (state.activeFileId) {
          event.preventDefault();
          const activeFile = state.files.find(
            (file) => file.id === state.activeFileId
          );
          if (
            activeFile &&
            state.dirtyFiles.has(activeFile.id) &&
            !window.confirm(
              `File "${activeFile.name}" has unsaved changes. Close it?`
            )
          ) {
            return;
          }
          dispatch({ type: 'REMOVE_FILE', payload: state.activeFileId });
        }
        return;
      }

      // 保存：本项目自动保存，拦截浏览器“保存网页”对话框并提示
      if (mod && key === 's') {
        event.preventDefault();
        if (state.activeFileId) {
          dispatch({
            type: 'SHOW_TOAST',
            payload: { message: '文件已自动保存', type: 'success' },
          });
        }
        return;
      }

      // 重新打开上一个关闭的文件：Cmd/Ctrl+T（尽力拦截）或 Alt+T（可靠）
      if (key === 't' && (mod || event.altKey)) {
        if (state.recentlyClosed.length > 0) {
          event.preventDefault();
          dispatch({ type: 'REOPEN_LAST_CLOSED' });
        }
      }
    };

    // capture 阶段，先于 Monaco 处理
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.activeFileId, state.recentlyClosed, dispatch]);

  // 页面刷新、关闭或跳转前保护尚未保存的编辑内容。
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (state.dirtyFiles.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.dirtyFiles]);

  return (
    <div
      className="app"
      data-theme={state.theme === 'vs-dark' ? 'dark' : 'light'}
    >
      <Header />
      <div className="main-area">
        <ActivityBar active={sideView} onChange={setSideView} />
        {sideView === 'explorer' ? (
          <Sidebar width={sidebarWidth} />
        ) : (
          <SearchPanel width={sidebarWidth} />
        )}
        <div
          className="sidebar-resizer"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
        />
        <div className="editor-panel">
          <FileTabs onPreview={() => setPreviewOpen((open) => !open)} />
          <Editor />
        </div>
        {previewOpen && (
          <>
            <div
              className="preview-resizer"
              onMouseDown={startPreviewResize}
              role="separator"
              aria-orientation="vertical"
            />
            <Preview width={previewWidth} onClose={() => setPreviewOpen(false)} />
          </>
        )}
      </div>
      {state.toast && (
        <Toast
          message={state.toast.message}
          type={state.toast.type}
          onClose={() => dispatch({ type: 'HIDE_TOAST' })}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider>
      <AppContent />
    </EditorProvider>
  );
}
