import type { FileTreeNode } from '../types';
import {
  buildRegex,
  escapeReplacement,
  type SearchMatch,
  type SearchOptions,
  type SearchResult,
  type SearchRequest,
  type SearchResponse,
} from './searchCore';

export type { SearchMatch, SearchOptions, SearchResult } from './searchCore';
export { MAX_SEARCH_RESULTS } from './searchCore';

let rootHandle: FileSystemDirectoryHandle | null = null;
const singleFileHandles = new Map<string, FileSystemFileHandle>();

/** 检查当前浏览器是否支持本地文件访问能力。 */
function assertFileSystemAccessSupport(operation: 'directory' | 'file'): void {
  const supported =
    operation === 'directory'
      ? typeof window.showDirectoryPicker === 'function'
      : typeof window.showOpenFilePicker === 'function';

  if (!supported) {
    throw new Error(
      'This browser does not support the File System Access API. Please use Chrome or Edge.'
    );
  }
}

export function getRootHandle(): FileSystemDirectoryHandle | null {
  return rootHandle;
}

export async function openDirectory(): Promise<FileSystemDirectoryHandle> {
  assertFileSystemAccessSupport('directory');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  rootHandle = handle;
  return handle;
}

function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 读取目录的当前层级，并将子目录标记为未加载状态。
 */
export async function buildTreeAsync(
  dirHandle: FileSystemDirectoryHandle,
  parentPath = ''
): Promise<FileTreeNode[]> {
  const entries: FileTreeNode[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue;
    const entryPath = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === 'directory') {
      entries.push({
        name,
        path: entryPath,
        type: 'directory',
        children: [],
        loaded: false,
        loading: false,
      });
    } else {
      entries.push({ name, path: entryPath, type: 'file' });
    }
  }
  return sortTreeNodes(entries);
}

/**
 * 向后兼容旧调用方，默认也只加载当前层级。
 */
export async function buildTree(
  dirHandle: FileSystemDirectoryHandle,
  parentPath = ''
): Promise<FileTreeNode[]> {
  return buildTreeAsync(dirHandle, parentPath);
}

async function navigateToDir(path: string): Promise<FileSystemDirectoryHandle> {
  if (!rootHandle) throw new Error('No directory opened');
  if (!path) return rootHandle;
  const parts = path.split('/').filter(Boolean);
  let current = rootHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part);
  }
  return current;
}

export async function readFile(
  filePath: string
): Promise<{ content: string; lastModified: number }> {
  if (!rootHandle) {
    throw new Error('No directory opened - rootHandle is null');
  }
  const parts = filePath.split('/');
  const fileName = parts.pop()!;
  const dirPath = parts.join('/');
  const dirHandle = await navigateToDir(dirPath);
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return {
    content: await file.text(),
    lastModified: file.lastModified,
  };
}

export async function writeFile(
  filePath: string,
  content: string
): Promise<void> {
  const parts = filePath.split('/');
  const fileName = parts.pop()!;
  const dirPath = parts.join('/');
  const dirHandle = await navigateToDir(dirPath);
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * 读取指定文件的最新修改时间。
 */
export async function getFileLastModified(filePath: string): Promise<number> {
  const parts = filePath.split('/');
  const fileName = parts.pop()!;
  const dirPath = parts.join('/');
  const dirHandle = await navigateToDir(dirPath);
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();

  return file.lastModified;
}

export async function createFile(
  parentPath: string,
  fileName: string
): Promise<void> {
  const dirHandle = await navigateToDir(parentPath);
  await dirHandle.getFileHandle(fileName, { create: true });
}

export async function createFolder(
  parentPath: string,
  folderName: string
): Promise<void> {
  const dirHandle = await navigateToDir(parentPath);
  await dirHandle.getDirectoryHandle(folderName, { create: true });
}

/**
 * 按目录路径异步加载单个文件夹的直接子节点。
 */
export async function loadDirectoryChildren(
  directoryPath: string
): Promise<FileTreeNode[]> {
  const dirHandle = await navigateToDir(directoryPath);
  return buildTreeAsync(dirHandle, directoryPath);
}

/**
 * 刷新根目录，仅返回首层节点。
 */
export async function refreshTree(): Promise<FileTreeNode[]> {
  if (!rootHandle) return [];
  return buildTreeAsync(rootHandle);
}

export async function openSingleFile(): Promise<{
  name: string;
  content: string;
  lastModified: number;
}> {
  assertFileSystemAccessSupport('file');
  const [fileHandle] = await window.showOpenFilePicker({ multiple: false });
  const file = await fileHandle.getFile();
  const content = await file.text();
  singleFileHandles.set(file.name, fileHandle);
  return { name: file.name, content, lastModified: file.lastModified };
}

export function getSingleFileHandle(
  name: string
): FileSystemFileHandle | undefined {
  return singleFileHandles.get(name);
}

export async function writeSingleFile(
  name: string,
  content: string
): Promise<void> {
  const handle = singleFileHandles.get(name);
  if (!handle) throw new Error('No file handle for: ' + name);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * 读取单文件模式下文件的最新修改时间。
 */
export async function getSingleFileLastModified(name: string): Promise<number> {
  const handle = singleFileHandles.get(name);
  if (!handle) throw new Error('No file handle for: ' + name);

  const file = await handle.getFile();
  return file.lastModified;
}

export async function deleteFile(filePath: string): Promise<void> {
  if (!rootHandle) throw new Error('No directory opened');

  const parts = filePath.split('/');
  const fileName = parts.pop()!;
  const dirPath = parts.join('/');

  const dirHandle = await navigateToDir(dirPath);
  await dirHandle.removeEntry(fileName, { recursive: true });
}

export async function checkFileModified(
  filePath: string,
  lastKnownModified: number
): Promise<boolean> {
  try {
    if (!rootHandle) {
      return false;
    }
    const parts = filePath.split('/');
    const fileName = parts.pop()!;
    const dirPath = parts.join('/');
    const dirHandle = await navigateToDir(dirPath);
    const fileHandle = await dirHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    // 文件系统时间戳可能因为外部工具写回、时钟调整或精度差异而变小，
    // 只要时间戳发生变化就需要交给用户决定是否重新加载。
    return file.lastModified !== lastKnownModified;
  } catch (error) {
    return false;
  }
}

/** 复用的搜索 Worker 实例，避免反复创建/销毁 isolate */
let searchWorker: Worker | null = null;
let searchSeq = 0;

/** 惰性创建（并复用）搜索 Worker */
function getSearchWorker(): Worker {
  if (!searchWorker) {
    searchWorker = new Worker(new URL('./search.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return searchWorker;
}

/**
 * 在已打开的根目录下全局搜索文本。
 * 实际遍历与匹配在 Worker 线程执行，主线程仅收发消息，全程不阻塞渲染。
 * 只把根目录句柄传给 Worker（结构化克隆，轻量），不复制文件内容。
 * @param query 关键字或正则源
 * @param options 匹配选项（大小写 / 全字 / 正则）
 * @param signal 可选中断信号；中断时通知 Worker 停止当前请求
 * @param onBatch 增量结果回调，便于 UI 边搜边渲染
 */
export function searchInWorkspace(
  query: string,
  options: SearchOptions = {},
  signal?: AbortSignal,
  onBatch?: (matches: SearchMatch[]) => void
): Promise<SearchResult> {
  if (!rootHandle || !query) {
    return Promise.resolve({ matches: [], truncated: false });
  }
  if (signal?.aborted) {
    return Promise.resolve({ matches: [], truncated: false });
  }

  const root = rootHandle;
  const worker = getSearchWorker();
  const id = ++searchSeq;

  return new Promise((resolve) => {
    const matches: SearchMatch[] = [];
    let truncated = false;
    let settled = false;

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ matches, truncated });
    };

    const onMessage = (event: MessageEvent<SearchResponse>) => {
      const data = event.data;
      if (data.id !== id) return; // 忽略其它请求的消息
      if (data.type === 'batch') {
        matches.push(...data.batch);
        onBatch?.(data.batch);
      } else if (data.type === 'done') {
        truncated = data.truncated;
        finish();
      } else if (data.type === 'error') {
        console.error('Search worker error:', data.message);
        finish();
      }
    };

    const onAbort = () => {
      worker.postMessage({ type: 'cancel', id } satisfies SearchRequest);
      finish();
    };

    worker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort);

    worker.postMessage({
      type: 'search',
      id,
      root,
      query,
      options,
    } satisfies SearchRequest);
  });
}

/** 替换结果：替换次数 + 新内容 + 新修改时间 */
export interface ReplaceResult {
  count: number;
  content: string;
  lastModified: number;
}

/**
 * 替换单个文件内的所有命中并写回磁盘。
 */
export async function replaceAllInFile(
  path: string,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): Promise<ReplaceResult> {
  const pattern = buildRegex(query, options);
  const { content } = await readFile(path);
  if (!pattern) return { count: 0, content, lastModified: 0 };

  const matches = content.match(pattern);
  const count = matches ? matches.length : 0;
  if (count === 0) {
    return { count: 0, content, lastModified: await getFileLastModified(path) };
  }

  const repl = options.useRegex ? replacement : escapeReplacement(replacement);
  const next = content.replace(pattern, repl);
  await writeFile(path, next);
  return {
    count,
    content: next,
    lastModified: await getFileLastModified(path),
  };
}

/**
 * 替换单条命中（按行列精确定位），写回磁盘。
 */
export async function replaceMatchInFile(
  match: SearchMatch,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): Promise<ReplaceResult> {
  const globalPattern = buildRegex(query, options);
  const { content } = await readFile(match.path);
  if (!globalPattern) return { count: 0, content, lastModified: 0 };

  // 非全局版本，仅对命中文本本身做一次替换（保证捕获组 $1 正确）
  const single = new RegExp(
    globalPattern.source,
    globalPattern.flags.replace('g', '')
  );

  const lines = content.split('\n');
  const idx = match.line - 1;
  const line = lines[idx] ?? '';
  const start = match.column - 1;
  const matched = line.slice(start, start + match.matchLength);
  const repl = options.useRegex ? replacement : escapeReplacement(replacement);
  const newText = matched.replace(single, repl);

  lines[idx] =
    line.slice(0, start) + newText + line.slice(start + match.matchLength);
  const next = lines.join('\n');
  await writeFile(match.path, next);
  return {
    count: 1,
    content: next,
    lastModified: await getFileLastModified(match.path),
  };
}
