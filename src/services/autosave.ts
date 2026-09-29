import type { Dispatch } from 'react';
import type { EditorAction, FileItem } from '../types';
import {
  writeFile,
  getRootHandle,
  writeSingleFile,
  getFileLastModified,
  getSingleFileLastModified,
} from './fs';

/** 每个文件的防抖计时器（key: file.id） */
const timers = new Map<string, number>();

/** 协同访客的远端文件，无本地句柄，不落盘 */
export const isCollabFile = (id: string) => id.startsWith('__collab__');

/**
 * 防抖 500ms 后把内容写回本地磁盘，并同步保存状态与提示。
 * @param file 目标文件
 * @param content 待写入内容
 * @param dispatch store dispatch
 */
export const scheduleSave = (
  file: FileItem,
  content: string,
  dispatch: Dispatch<EditorAction>
) => {
  if (isCollabFile(file.id)) return;
  const isSingleFile = file.id.startsWith('__single__');
  if (!isSingleFile && !(getRootHandle() && file.path)) return;

  const prev = timers.get(file.id);
  if (prev) clearTimeout(prev);
  timers.set(
    file.id,
    window.setTimeout(async () => {
      timers.delete(file.id);
      try {
        if (isSingleFile) await writeSingleFile(file.name, content);
        else await writeFile(file.path, content);

        let lastModified: number | undefined;
        try {
          lastModified = isSingleFile
            ? await getSingleFileLastModified(file.name)
            : await getFileLastModified(file.path);
        } catch (metadataError) {
          console.error('Failed to read saved file metadata:', metadataError);
        }

        dispatch({
          type: 'MARK_FILE_SAVED',
          payload: { id: file.id, content, lastModified },
        });
        dispatch({
          type: 'SHOW_TOAST',
          payload: { message: '文件已自动保存', type: 'success' },
        });
      } catch (err) {
        console.error('Auto-save failed:', err);
        dispatch({
          type: 'SHOW_TOAST',
          payload: {
            message: `自动保存失败: ${err instanceof Error ? err.message : '未知错误'}`,
            type: 'error',
          },
        });
      }
    }, 500)
  );
};
