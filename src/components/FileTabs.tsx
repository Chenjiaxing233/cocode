import type { MouseEvent } from 'react';
import { readFile } from '../services/fs';
import { useEditorDispatch, useEditorState } from '../stores/editorStore';
import { FileIcon } from './FileIcon';
import { CloseIcon, RefreshIcon } from './icons';
import '../styles/tabs.css';

export default function FileTabs() {
  const { files, activeFileId, dirtyFiles } = useEditorState();
  const dispatch = useEditorDispatch();

  const handleReloadFile = async (
    event: MouseEvent<HTMLSpanElement>,
    fileId: string
  ) => {
    event.stopPropagation();
    const file = files.find((item) => item.id === fileId);
    if (!file || !file.path) return;

    if (
      dirtyFiles.has(fileId) &&
      !window.confirm(`File "${file.name}" has unsaved changes. Reload it?`)
    ) {
      return;
    }

    try {
      const { content, lastModified } = await readFile(file.path);
      dispatch({
        type: 'RELOAD_FILE',
        payload: {
          id: file.id,
          content,
          lastModified,
        },
      });
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: 'File reloaded successfully',
          type: 'success',
        },
      });
    } catch (error) {
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to reload file: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
    }
  };

  if (files.length === 0) return null;

  return (
    <div className="file-tabs">
      {files.map((file) => {
        const isDirty = dirtyFiles.has(file.id);

        return (
          <div
            key={file.id}
            className={`tab ${file.id === activeFileId ? 'tab-active' : ''}`}
            onClick={() =>
              dispatch({ type: 'SET_ACTIVE_FILE', payload: file.id })
            }
          >
            <div className="tab-label">
              <FileIcon
                className="tab-file-icon"
                name={file.name}
                type="file"
              />
              <span className="tab-name">{file.name}</span>
              {isDirty && <span className="tab-dirty" title="未保存" />}
            </div>
            <div className="tab-actions">
              {file.path && (
                <span
                  className="tab-action-btn tab-reload"
                  title="Reload file"
                  onClick={(event) => void handleReloadFile(event, file.id)}
                >
                  <RefreshIcon size={13} />
                </span>
              )}
              <span
                className="tab-action-btn tab-close"
                title="Close file"
                onClick={(event) => {
                  event.stopPropagation();
                  if (
                    dirtyFiles.has(file.id) &&
                    !window.confirm(
                      `File "${file.name}" has unsaved changes. Close it?`
                    )
                  ) {
                    return;
                  }
                  dispatch({ type: 'REMOVE_FILE', payload: file.id });
                }}
              >
                <CloseIcon size={14} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
