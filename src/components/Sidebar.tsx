import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  createFile,
  createFolder,
  deleteFile,
  getRootHandle,
  loadDirectoryChildren,
  openDirectory,
  openSingleFile,
  readFile,
  refreshTree,
} from '../services/fs';
import {
  getLanguageFromFileName,
  useEditorDispatch,
  useEditorState,
} from '../stores/editorStore';
import { FileIcon } from './FileIcon';
import {
  NewFileIcon,
  NewFolderIcon,
  TrashIcon,
  ChevronRightIcon,
} from './icons';
import { ConfirmDialog } from './ConfirmDialog';
import type { FileTreeNode } from '../types';
import '../styles/sidebar.css';

/**
 * 为不同文件类型返回简短的文本图标。
 */
/**
 * 在文件树中递归查找指定路径的节点。
 */
function findTreeNode(
  nodes: FileTreeNode[],
  targetPath: string
): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }

    if (node.type === 'directory' && node.children?.length) {
      const matched = findTreeNode(node.children, targetPath);
      if (matched) {
        return matched;
      }
    }
  }

  return null;
}

/**
 * 仅更新命中的目录节点，保持其余树结构不变。
 */
function updateTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
  updater: (node: FileTreeNode) => FileTreeNode
): FileTreeNode[] {
  let changed = false;

  const nextNodes = nodes.map((node) => {
    if (node.path === targetPath) {
      changed = true;
      return updater(node);
    }

    if (node.type === 'directory' && node.children?.length) {
      const nextChildren = updateTreeNode(node.children, targetPath, updater);

      if (nextChildren !== node.children) {
        changed = true;
        return { ...node, children: nextChildren };
      }
    }

    return node;
  });

  return changed ? nextNodes : nodes;
}

/**
 * 收集当前树里存在的目录路径，用于清理失效的展开状态。
 */
function collectDirectoryPaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    if (node.type !== 'directory') {
      continue;
    }

    paths.add(node.path);

    if (node.children?.length) {
      const childPaths = collectDirectoryPaths(node.children);
      childPaths.forEach((path) => paths.add(path));
    }
  }

  return paths;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function removeExpandedPath(
  expandedPaths: Set<string>,
  removedPath: string
): Set<string> {
  return new Set(
    [...expandedPaths].filter(
      (path) => path !== removedPath && !path.startsWith(`${removedPath}/`)
    )
  );
}

/**
 * 根树刷新后，按当前已展开目录补齐对应层级，避免用户视图闪回折叠态。
 */
async function hydrateExpandedDirectories(
  nodes: FileTreeNode[],
  expandedPaths: Set<string>
): Promise<FileTreeNode[]> {
  let nextTree = nodes;
  const sortedPaths = [...expandedPaths].sort(
    (left, right) => left.split('/').length - right.split('/').length
  );

  for (const path of sortedPaths) {
    const currentNode = findTreeNode(nextTree, path);

    if (!currentNode || currentNode.type !== 'directory') {
      continue;
    }

    const children = await loadDirectoryChildren(path);
    nextTree = updateTreeNode(nextTree, path, (node) => {
      if (node.type !== 'directory') {
        return node;
      }

      return {
        ...node,
        children,
        loaded: true,
        loading: false,
      };
    });
  }

  return nextTree;
}

function InlineInput({
  depth,
  type,
  onSubmit,
  onCancel,
}: {
  depth: number;
  type: 'file' | 'directory';
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="tree-item tree-input-row"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <FileIcon
        className="tree-file-icon"
        type={type}
        isOpen={type === 'directory'}
      />
      <input
        ref={inputRef}
        className="tree-inline-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim()) {
            event.preventDefault();
            onSubmit(value.trim());
          }

          if (event.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={onCancel}
        placeholder={type === 'file' ? 'filename' : 'folder name'}
      />
    </div>
  );
}

function TreeNodeItem({
  node,
  depth,
  expanded,
  activeFileId,
  toggleExpand,
  onOpenFile,
  onStartCreating,
  creating,
  onCreateSubmit,
  onCreateCancel,
  onDelete,
  onContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  activeFileId: string;
  toggleExpand: (node: FileTreeNode) => Promise<void> | void;
  onOpenFile: (node: FileTreeNode) => Promise<void> | void;
  onStartCreating: (type: 'file' | 'directory', parentPath: string) => void;
  creating: { parentPath: string; type: 'file' | 'directory' } | null;
  onCreateSubmit: (name: string) => Promise<void> | void;
  onCreateCancel: () => void;
  onDelete: (node: FileTreeNode) => Promise<void> | void;
  onContextMenu: (event: MouseEvent, node: FileTreeNode | null) => void;
}) {
  if (node.type === 'directory') {
    const isKnownEmptyDirectory =
      node.loaded && !node.loading && (node.children?.length ?? 0) === 0;
    const canExpand = !isKnownEmptyDirectory;
    const isCreatingHere = creating?.parentPath === node.path;
    const isExpanded = isCreatingHere || (canExpand && expanded.has(node.path));

    return (
      <>
        <div
          className="tree-item tree-folder"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (canExpand) {
              void toggleExpand(node);
            }
          }}
          onContextMenu={(event) => onContextMenu(event, node)}
        >
          <span className="tree-arrow">
            {canExpand && (
              <ChevronRightIcon
                size={14}
                className={`tree-chevron ${isExpanded ? 'tree-chevron-open' : ''}`}
              />
            )}
          </span>
          <FileIcon
            className="tree-file-icon"
            name={node.name}
            type="directory"
            isOpen={isExpanded}
          />
          <span className="tree-name">{node.name}</span>
          <div className="tree-item-actions">
            <span
              className="tree-action-btn"
              title="New File"
              onClick={(event) => {
                event.stopPropagation();
                onStartCreating('file', node.path);
              }}
            >
              <NewFileIcon size={14} />
            </span>
            <span
              className="tree-action-btn"
              title="New Folder"
              onClick={(event) => {
                event.stopPropagation();
                onStartCreating('directory', node.path);
              }}
            >
              <NewFolderIcon size={14} />
            </span>
            <span
              className="tree-action-btn tree-delete-btn"
              title="Delete"
              onClick={(event) => {
                event.stopPropagation();
                void onDelete(node);
              }}
            >
              <TrashIcon size={14} />
            </span>
          </div>
        </div>
        {isExpanded && (
          <>
            {isCreatingHere && (
              <InlineInput
                depth={depth + 1}
                type={creating.type}
                onSubmit={onCreateSubmit}
                onCancel={onCreateCancel}
              />
            )}
            {node.loading && (
              <div
                className="tree-item"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                <span className="tree-name">Loading...</span>
              </div>
            )}
            {!node.loading &&
              node.children?.map((child) => (
                <TreeNodeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  expanded={expanded}
                  activeFileId={activeFileId}
                  toggleExpand={toggleExpand}
                  onOpenFile={onOpenFile}
                  onStartCreating={onStartCreating}
                  creating={creating}
                  onCreateSubmit={onCreateSubmit}
                  onCreateCancel={onCreateCancel}
                  onDelete={onDelete}
                  onContextMenu={onContextMenu}
                />
              ))}
          </>
        )}
      </>
    );
  }

  return (
    <div
      className={`tree-item tree-file ${
        node.path === activeFileId ? 'tree-item-active' : ''
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => void onOpenFile(node)}
      onContextMenu={(event) => onContextMenu(event, node)}
    >
      <FileIcon className="tree-file-icon" name={node.name} type="file" />
      <span className="tree-name">{node.name}</span>
      <div className="tree-item-actions">
        <span
          className="tree-action-btn tree-delete-btn"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(node);
          }}
        >
          <TrashIcon size={14} />
        </span>
      </div>
    </div>
  );
}

export default function Sidebar({ width }: { width: number }) {
  const { tree, files, dirtyFiles, activeFileId, createRequest } =
    useEditorState();
  const dispatch = useEditorDispatch();
  const treeRef = useRef<FileTreeNode[]>(tree);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedRef = useRef<Set<string>>(new Set());
  const [creating, setCreating] = useState<{
    parentPath: string;
    type: 'file' | 'directory';
  } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    node: FileTreeNode | null;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileTreeNode | null>(null);
  const lastCreateToken = useRef(0);

  const commitTree = (nextTree: FileTreeNode[]) => {
    treeRef.current = nextTree;
    dispatch({ type: 'SET_TREE', payload: nextTree });
  };

  const commitExpanded = (nextExpanded: Set<string>) => {
    expandedRef.current = nextExpanded;
    setExpanded(nextExpanded);
  };

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    const validPaths = collectDirectoryPaths(tree);
    const nextExpanded = new Set(
      [...expandedRef.current].filter((path) => validPaths.has(path))
    );

    if (!areSetsEqual(nextExpanded, expandedRef.current)) {
      commitExpanded(nextExpanded);
    }
  }, [tree]);

  const loadTree = async (expandedPaths = expandedRef.current) => {
    let nodes = await refreshTree();
    nodes = await hydrateExpandedDirectories(nodes, expandedPaths);
    commitTree(nodes);
  };

  const ensureDirectoryLoaded = async (path: string) => {
    const currentNode = findTreeNode(treeRef.current, path);

    if (
      !currentNode ||
      currentNode.type !== 'directory' ||
      currentNode.loaded ||
      currentNode.loading
    ) {
      return;
    }

    const loadingTree = updateTreeNode(treeRef.current, path, (node) =>
      node.type === 'directory' ? { ...node, loading: true } : node
    );
    commitTree(loadingTree);

    try {
      const children = await loadDirectoryChildren(path);
      const nextTree = updateTreeNode(treeRef.current, path, (node) => {
        if (node.type !== 'directory') {
          return node;
        }

        return {
          ...node,
          children,
          loaded: true,
          loading: false,
        };
      });
      commitTree(nextTree);
    } catch (error) {
      const revertedTree = updateTreeNode(treeRef.current, path, (node) =>
        node.type === 'directory' ? { ...node, loading: false } : node
      );
      commitTree(revertedTree);
      console.error('Failed to load directory:', error);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to load folder: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
    }
  };

  const toggleExpand = async (node: FileTreeNode) => {
    if (node.type !== 'directory') {
      return;
    }

    const nextExpanded = new Set(expandedRef.current);
    const isExpanded = nextExpanded.has(node.path);

    if (isExpanded) {
      nextExpanded.delete(node.path);
    } else {
      nextExpanded.add(node.path);
    }

    commitExpanded(nextExpanded);

    if (!isExpanded) {
      await ensureDirectoryLoaded(node.path);
    }
  };

  const handleOpenFile = async (node: FileTreeNode) => {
    const existing = files.find((file) => file.id === node.path);

    if (existing) {
      dispatch({ type: 'SET_ACTIVE_FILE', payload: existing.id });
      return;
    }

    try {
      const { content, lastModified } = await readFile(node.path);
      dispatch({
        type: 'ADD_FILE',
        payload: {
          id: node.path,
          name: node.name,
          path: node.path,
          language: getLanguageFromFileName(node.name),
          content,
          lastModified,
        },
      });
    } catch (error) {
      console.error('Failed to read file:', error);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to open file: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
    }
  };

  const handleCreate = async (name: string) => {
    if (!creating || !name.trim()) {
      setCreating(null);
      return;
    }

    const target = { ...creating };
    const nextExpanded = new Set(expandedRef.current);

    if (target.parentPath) {
      nextExpanded.add(target.parentPath);
    }

    try {
      if (target.type === 'file') {
        await createFile(target.parentPath, name.trim());
      } else {
        await createFolder(target.parentPath, name.trim());
      }

      commitExpanded(nextExpanded);
      setCreating(null);
      await loadTree(nextExpanded);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message:
            target.type === 'file'
              ? 'File created successfully'
              : 'Folder created successfully',
          type: 'success',
        },
      });
    } catch (error) {
      console.error('Failed to create item:', error);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to create ${target.type}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
      setCreating(null);
    }
  };

  const handleDelete = (node: FileTreeNode) => {
    setPendingDelete(node);
  };

  const performDelete = async (node: FileTreeNode) => {
    const filesToClose =
      node.type === 'file'
        ? files.filter((file) => file.id === node.path)
        : files.filter(
            (file) =>
              file.path === node.path || file.path.startsWith(`${node.path}/`)
          );
    const dirtyFilesToClose = filesToClose.filter((file) =>
      dirtyFiles.has(file.id)
    );

    if (
      dirtyFilesToClose.length > 0 &&
      !window.confirm(
        `${dirtyFilesToClose.length} open file(s) have unsaved changes. Delete anyway?`
      )
    ) {
      return;
    }

    try {
      await deleteFile(node.path);

      if (node.type === 'file') {
        dispatch({ type: 'REMOVE_FILE', payload: node.path });
      } else {
        filesToClose.forEach((file) => {
          dispatch({ type: 'REMOVE_FILE', payload: file.id });
        });
      }

      const nextExpanded =
        node.type === 'directory'
          ? removeExpandedPath(expandedRef.current, node.path)
          : new Set(expandedRef.current);

      commitExpanded(nextExpanded);
      await loadTree(nextExpanded);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message:
            node.type === 'file'
              ? 'File deleted successfully'
              : 'Folder deleted successfully',
          type: 'success',
        },
      });
    } catch (error) {
      console.error('Failed to delete item:', error);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to delete ${node.type}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
    }
  };

  const startCreating = (type: 'file' | 'directory', parentPath = '') => {
    setCreating({ parentPath, type });

    if (!parentPath) {
      return;
    }

    const nextExpanded = new Set(expandedRef.current);
    nextExpanded.add(parentPath);
    commitExpanded(nextExpanded);
  };

  // 响应来自 Header 的新建请求（token 变化时在根目录发起新建）
  useEffect(() => {
    if (!createRequest || createRequest.token === lastCreateToken.current) {
      return;
    }

    lastCreateToken.current = createRequest.token;
    startCreating(createRequest.type, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest]);

  // 计算某节点对应的“新建目标父路径”
  const parentPathOf = (node: FileTreeNode | null): string => {
    if (!node) {
      return '';
    }

    if (node.type === 'directory') {
      return node.path;
    }

    return node.path.includes('/')
      ? node.path.slice(0, node.path.lastIndexOf('/'))
      : '';
  };

  const openContextMenu = (event: MouseEvent, node: FileTreeNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, node });
  };

  // 打开菜单后，任意点击/滚动/窗口变化/Esc 均关闭
  useEffect(() => {
    if (!menu) {
      return;
    }

    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
      }
    };

    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const handleOpenFolder = async () => {
    try {
      await openDirectory();
      const nextExpanded = new Set<string>();
      commitExpanded(nextExpanded);
      setCreating(null);
      await loadTree(nextExpanded);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: 'Folder opened successfully',
          type: 'success',
        },
      });
    } catch (error) {
      console.error('Failed to open directory:', error);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to open folder: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
    }
  };

  const handleOpenSingleFile = async () => {
    try {
      const { name, content, lastModified } = await openSingleFile();
      dispatch({
        type: 'ADD_FILE',
        payload: {
          id: `__single__${name}`,
          name,
          path: '',
          language: getLanguageFromFileName(name),
          content,
          lastModified,
        },
      });
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: 'File opened successfully',
          type: 'success',
        },
      });
    } catch (error) {
      console.error('Failed to open file:', error);
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `Failed to open file: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          type: 'error',
        },
      });
    }
  };

  const hasFolder = getRootHandle() !== null || tree.length > 0;

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <span className="sidebar-title">Explorer</span>
        {hasFolder && (
          <div className="sidebar-actions">
            <button
              className="sidebar-action-btn"
              title="New File"
              onClick={() => startCreating('file')}
            >
              <NewFileIcon size={15} />
            </button>
            <button
              className="sidebar-action-btn"
              title="New Folder"
              onClick={() => startCreating('directory')}
            >
              <NewFolderIcon size={15} />
            </button>
          </div>
        )}
      </div>
      {!hasFolder ? (
        <div className="sidebar-empty">
          <button className="open-folder-btn" onClick={handleOpenSingleFile}>
            Open File
          </button>
          <button className="open-folder-btn" onClick={handleOpenFolder}>
            Open Folder
          </button>
          <p className="sidebar-hint">Open a file or folder to start editing</p>
        </div>
      ) : (
        <div
          className="file-tree"
          onContextMenu={(event) => {
            // 仅当右键点击空白区域时按根目录处理
            if (event.target === event.currentTarget) {
              openContextMenu(event, null);
            }
          }}
        >
          {creating && creating.parentPath === '' && (
            <InlineInput
              depth={0}
              type={creating.type}
              onSubmit={handleCreate}
              onCancel={() => setCreating(null)}
            />
          )}
          {tree.map((node) => (
            <TreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              activeFileId={activeFileId}
              toggleExpand={toggleExpand}
              onOpenFile={handleOpenFile}
              onStartCreating={startCreating}
              creating={creating}
              onCreateSubmit={handleCreate}
              onCreateCancel={() => setCreating(null)}
              onDelete={handleDelete}
              onContextMenu={openContextMenu}
            />
          ))}
          {tree.length === 0 && !creating && (
            <p className="sidebar-hint" style={{ padding: '8px 14px' }}>
              Folder is empty
            </p>
          )}
        </div>
      )}
      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              startCreating('file', parentPathOf(menu.node));
              setMenu(null);
            }}
          >
            <NewFileIcon size={15} />
            <span>New File</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              startCreating('directory', parentPathOf(menu.node));
              setMenu(null);
            }}
          >
            <NewFolderIcon size={15} />
            <span>New Folder</span>
          </button>
          {menu.node && (
            <>
              <div className="context-menu-divider" />
              <button
                className="context-menu-item context-menu-item-danger"
                onClick={() => {
                  const target = menu.node;
                  setMenu(null);
                  if (target) {
                    void handleDelete(target);
                  }
                }}
              >
                <TrashIcon size={15} />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      )}
      {pendingDelete && (
        <ConfirmDialog
          danger
          title={
            pendingDelete.type === 'directory' ? 'Delete Folder' : 'Delete File'
          }
          message={
            pendingDelete.type === 'directory'
              ? `Delete folder "${pendingDelete.name}" and all its contents? This cannot be undone.`
              : `Delete file "${pendingDelete.name}"? This cannot be undone.`
          }
          confirmText="Delete"
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void performDelete(target);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}
