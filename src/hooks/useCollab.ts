import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useEditorDispatch, useEditorState } from '../stores/editorStore';
import { isCollabFile, scheduleSave } from '../services/autosave';
import {
  getSharedFiles,
  getSnapshot,
  isShared,
  onRemoteTextChange,
  parseCollabHash,
  shareFile,
  startSession,
  subscribe,
} from '../services/collab';
import type { FileItem } from '../types';

const COLLAB_PREFIX = '__collab__';

/** 订阅协同状态快照 */
export const useCollabSnapshot = () =>
  useSyncExternalStore(subscribe, getSnapshot);

/** 本地文件对应的共享 key */
export const collabKeyOf = (file: FileItem) =>
  isCollabFile(file.id) ? file.id.slice(COLLAB_PREFIX.length) : file.id;

/**
 * 协同总控：链接自动加入、共享本地已打开文件、远端文件/内容同步到 store。
 * 在 App 顶层调用一次。
 */
export const useCollab = () => {
  const { files } = useEditorState();
  const dispatch = useEditorDispatch();
  const snap = useCollabSnapshot();
  const filesRef = useRef(files);
  filesRef.current = files;
  /** 已处理过的共享 key，避免关闭标签后被重新加回 */
  const seenKeys = useRef(new Set<string>());

  // 通过分享链接打开时自动加入房间
  useEffect(() => {
    const info = parseCollabHash();
    if (!info) return;
    startSession(info.room, info.key);
    dispatch({
      type: 'SHOW_TOAST',
      payload: { message: '已加入协同房间，等待对方连接…', type: 'info' },
    });
  }, [dispatch]);

  useEffect(() => {
    if (!snap.active) seenKeys.current.clear();
  }, [snap.active]);

  // 本地打开的文件自动共享到房间
  useEffect(() => {
    if (!snap.active) return;
    files
      .filter((f) => !isCollabFile(f.id) && !isShared(f.id))
      .forEach((f) => {
        seenKeys.current.add(f.id);
        shareFile(f.id, { name: f.name, language: f.language }, f.content);
      });
  }, [snap.active, files]);

  // 对方共享的新文件 → 以 __collab__ 标签打开
  useEffect(() => {
    if (!snap.active) return;
    getSharedFiles().forEach(({ key, meta, content }) => {
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);
      if (filesRef.current.some((f) => f.id === key)) return;
      dispatch({
        type: 'ADD_FILE',
        payload: {
          id: `${COLLAB_PREFIX}${key}`,
          name: meta.name,
          path: '',
          language: meta.language,
          content,
        },
      });
    });
  }, [snap.active, snap.filesVersion, dispatch]);

  // 远端内容变化 → 更新 store 并落盘（覆盖未激活、未绑定编辑器的文件）
  useEffect(() => {
    if (!snap.active) return;
    return onRemoteTextChange((key, content) => {
      const file = filesRef.current.find(
        (f) => f.id === key || f.id === `${COLLAB_PREFIX}${key}`
      );
      if (!file || file.content === content) return;
      dispatch({
        type: 'UPDATE_FILE_CONTENT',
        payload: { id: file.id, content },
      });
      scheduleSave(file, content, dispatch);
    });
  }, [snap.active, snap.room, dispatch]);
};
