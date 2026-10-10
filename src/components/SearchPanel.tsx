import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readFile,
  replaceAllInFile,
  replaceMatchInFile,
  searchInWorkspace,
  type SearchMatch,
} from '../services/fs';
import {
  getLanguageFromFileName,
  useEditorDispatch,
  useEditorState,
} from '../stores/editorStore';
import { FileIcon } from './FileIcon';
import {
  CaseSensitiveIcon,
  ChevronRightIcon,
  RegexIcon,
  ReplaceAllIcon,
  ReplaceIcon,
  SearchIcon,
  WholeWordIcon,
} from './icons';
import '../styles/search.css';

/** 搜索历史持久化配置 */
const HISTORY_KEY = 'jx-search-history';
const HISTORY_MAX = 20;

/** 按文件分组后的搜索结果 */
interface FileGroup {
  path: string;
  name: string;
  matches: SearchMatch[];
}

/** 从完整路径中取文件名 */
const basename = (path: string): string => path.split('/').pop() ?? path;

/** 从完整路径中取所在目录 */
const dirname = (path: string): string => {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
};

/**
 * 单条命中行：去除前导空白后展示，并高亮命中片段。
 */
const MatchLine = ({ match }: { match: SearchMatch }) => {
  const leading = match.lineText.length - match.lineText.trimStart().length;
  const text = match.lineText.trimStart();
  const start = Math.max(0, match.column - 1 - leading);
  const before = text.slice(0, start);
  const hit = text.slice(start, start + match.matchLength);
  const after = text.slice(start + match.matchLength);

  return (
    <span className="search-match-text">
      {before}
      <span className="search-match-highlight">{hit}</span>
      {after}
    </span>
  );
};

/**
 * VSCode 风格全局搜索面板：支持大小写/全字/正则、结果分组折叠、
 * 行内高亮跳转、单条/文件级/全局替换，以及搜索历史（↑↓ 浏览）。
 */
export default function SearchPanel({ width }: { width: number }) {
  const { files, dirtyFiles } = useEditorState();
  const dispatch = useEditorDispatch();

  const [query, setQuery] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0); // 替换后自增以重新搜索刷新结果

  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<SearchMatch[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 匹配选项对象，作为搜索 effect 的稳定依赖
  const options = useMemo(
    () => ({ caseSensitive, wholeWord, useRegex }),
    [caseSensitive, wholeWord, useRegex]
  );

  /** 写入搜索历史（去重前置，最多 HISTORY_MAX 条，持久化到 localStorage） */
  const pushHistory = useCallback((term: string) => {
    const value = term.trim();
    if (!value) return;
    setHistory((prev) => {
      const next = [value, ...prev.filter((h) => h !== value)].slice(
        0,
        HISTORY_MAX
      );
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* 忽略持久化失败 */
      }
      return next;
    });
  }, []);

  // 输入 / 选项变化后防抖搜索：流式增量渲染 + 取消过期请求
  useEffect(() => {
    abortRef.current?.abort();
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    bufferRef.current = [];

    if (!query.trim()) {
      setResults([]);
      setTruncated(false);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    setResults([]);
    setTruncated(false);
    setCollapsed(new Set());

    // 增量结果节流刷新：累积到缓冲区，每 80ms flush 一次，减少渲染次数
    const scheduleFlush = () => {
      if (flushTimerRef.current != null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        if (bufferRef.current.length) {
          const batch = bufferRef.current;
          bufferRef.current = [];
          setResults((prev) => prev.concat(batch));
        }
      }, 80);
    };

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchInWorkspace(
          query,
          options,
          controller.signal,
          (batch) => {
            bufferRef.current.push(...batch);
            scheduleFlush();
          }
        );
        if (!controller.signal.aborted) {
          if (flushTimerRef.current != null) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          bufferRef.current = [];
          // 用全量结果校正增量渲染的最终状态
          setResults(result.matches);
          setTruncated(result.truncated);
          pushHistory(query);
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error('Search failed:', err);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, options, nonce, pushHistory]);

  // 将扁平命中按文件分组，保持首次出现顺序
  const groups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, FileGroup>();
    for (const match of results) {
      let group = map.get(match.path);
      if (!group) {
        group = { path: match.path, name: basename(match.path), matches: [] };
        map.set(match.path, group);
      }
      group.matches.push(match);
    }
    return [...map.values()];
  }, [results]);

  /** 折叠 / 展开某个文件分组 */
  const toggleGroup = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 若文件已在编辑器打开，则同步替换后的最新内容 */
  const syncOpenFile = (
    path: string,
    content: string,
    lastModified: number
  ) => {
    if (files.some((file) => file.id === path)) {
      dispatch({
        type: 'RELOAD_FILE',
        payload: { id: path, content, lastModified },
      });
    }
  };

  /** 防止磁盘搜索替换覆盖编辑器中尚未保存的内容。 */
  const canReplacePath = (path: string) => {
    const file = files.find((item) => item.id === path);
    if (!file || !dirtyFiles.has(file.id)) return true;

    dispatch({
      type: 'SHOW_TOAST',
      payload: {
        message: `File "${file.name}" has unsaved changes. Save it before replacing.`,
        type: 'warning',
      },
    });
    return false;
  };

  /** 点击命中：确保文件已打开，再跳转到对应行列 */
  const openMatch = async (match: SearchMatch) => {
    const existing = files.find((file) => file.id === match.path);

    if (!existing) {
      try {
        const { content, lastModified } = await readFile(match.path);
        dispatch({
          type: 'ADD_FILE',
          payload: {
            id: match.path,
            name: basename(match.path),
            path: match.path,
            language: getLanguageFromFileName(match.path),
            content,
            lastModified,
          },
        });
      } catch (err) {
        console.error('Failed to open file from search:', err);
        dispatch({
          type: 'SHOW_TOAST',
          payload: {
            message: `无法打开文件: ${
              err instanceof Error ? err.message : '未知错误'
            }`,
            type: 'error',
          },
        });
        return;
      }
    }

    dispatch({
      type: 'REVEAL_LOCATION',
      payload: {
        fileId: match.path,
        line: match.line,
        column: match.column,
        endColumn: match.column + match.matchLength,
      },
    });
  };

  /** 替换单条命中 */
  const replaceOne = async (match: SearchMatch) => {
    if (!canReplacePath(match.path)) return;
    try {
      const res = await replaceMatchInFile(match, query, replaceValue, options);
      syncOpenFile(match.path, res.content, res.lastModified);
      dispatch({
        type: 'SHOW_TOAST',
        payload: { message: '已替换 1 处', type: 'success' },
      });
      setNonce((n) => n + 1); // 刷新结果
    } catch (err) {
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `替换失败: ${err instanceof Error ? err.message : '未知错误'}`,
          type: 'error',
        },
      });
    }
  };

  /** 替换某个文件内的全部命中 */
  const replaceFile = async (path: string) => {
    if (!canReplacePath(path)) return;
    try {
      const res = await replaceAllInFile(path, query, replaceValue, options);
      syncOpenFile(path, res.content, res.lastModified);
      dispatch({
        type: 'SHOW_TOAST',
        payload: { message: `已替换 ${res.count} 处`, type: 'success' },
      });
      setNonce((n) => n + 1);
    } catch (err) {
      dispatch({
        type: 'SHOW_TOAST',
        payload: {
          message: `替换失败: ${err instanceof Error ? err.message : '未知错误'}`,
          type: 'error',
        },
      });
    }
  };

  /** 替换全部文件的全部命中 */
  const replaceAll = async () => {
    const paths = [...new Set(results.map((match) => match.path))];
    let total = 0;
    for (const path of paths) {
      if (!canReplacePath(path)) continue;
      try {
        const res = await replaceAllInFile(path, query, replaceValue, options);
        total += res.count;
        syncOpenFile(path, res.content, res.lastModified);
      } catch (err) {
        console.error('Replace failed for', path, err);
      }
    }
    dispatch({
      type: 'SHOW_TOAST',
      payload: { message: `共替换 ${total} 处`, type: 'success' },
    });
    setNonce((n) => n + 1);
  };

  /** 搜索框键盘：↑↓ 浏览历史，Enter 记录历史 */
  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setQuery(history[next]);
    } else if (event.key === 'ArrowDown' && historyIndex >= 0) {
      event.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setQuery(next >= 0 ? history[next] : '');
    } else if (event.key === 'Enter') {
      pushHistory(query);
    }
  };

  const canReplace =
    showReplace && query.trim() !== '' && results.length > 0 && !searching;

  /** 结果统计文案 */
  let summaryText = '';
  if (searching) {
    summaryText = 'Searching...';
  } else if (query.trim() !== '') {
    if (results.length === 0) {
      summaryText = 'No results found';
    } else {
      const suffix = truncated ? ` (showing first ${results.length})` : '';
      summaryText = `${results.length}${truncated ? '+' : ''} results in ${groups.length} files${suffix}`;
    }
  }

  return (
    <aside className="search-panel" style={{ width }}>
      <div className="search-panel-header">
        <span className="search-panel-title">Search</span>
      </div>

      <div className="search-input-area">
        <button
          className="search-expand-toggle"
          title={showReplace ? 'Hide Replace' : 'Toggle Replace'}
          onClick={() => setShowReplace((value) => !value)}
        >
          <ChevronRightIcon
            size={16}
            className={`search-chevron ${showReplace ? 'search-chevron-open' : ''}`}
          />
        </button>

        <div className="search-fields">
          <div className="search-input-wrapper">
            <SearchIcon size={14} className="search-input-icon" />
            <input
              ref={inputRef}
              className="search-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHistoryIndex(-1);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Search"
              spellCheck={false}
            />
            <div className="search-toggles">
              <button
                className={`search-toggle ${caseSensitive ? 'search-toggle-active' : ''}`}
                title="Match Case"
                onClick={() => setCaseSensitive((value) => !value)}
              >
                <CaseSensitiveIcon size={14} />
              </button>
              <button
                className={`search-toggle ${wholeWord ? 'search-toggle-active' : ''}`}
                title="Match Whole Word"
                onClick={() => setWholeWord((value) => !value)}
              >
                <WholeWordIcon size={14} />
              </button>
              <button
                className={`search-toggle ${useRegex ? 'search-toggle-active' : ''}`}
                title="Use Regular Expression"
                onClick={() => setUseRegex((value) => !value)}
              >
                <RegexIcon size={14} />
              </button>
            </div>
          </div>

          {showReplace && (
            <div className="search-input-wrapper">
              <ReplaceIcon size={14} className="search-input-icon" />
              <input
                className="search-input"
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canReplace) void replaceAll();
                }}
                placeholder="Replace"
                spellCheck={false}
              />
              <div className="search-toggles">
                <button
                  className="search-toggle"
                  title="Replace All"
                  disabled={!canReplace}
                  onClick={() => void replaceAll()}
                >
                  <ReplaceAllIcon size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="search-summary">{summaryText}</div>

      <div className="search-results">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.path);
          const dir = dirname(group.path);
          return (
            <div key={group.path} className="search-group">
              <div
                className="search-group-header"
                onClick={() => toggleGroup(group.path)}
                title={group.path}
              >
                <ChevronRightIcon
                  size={14}
                  className={`search-chevron ${isCollapsed ? '' : 'search-chevron-open'}`}
                />
                <FileIcon
                  className="search-file-icon"
                  name={group.name}
                  type="file"
                />
                <span className="search-group-name">{group.name}</span>
                {dir && <span className="search-group-dir">{dir}</span>}
                {showReplace && (
                  <button
                    className="search-icon-btn search-group-action"
                    title="Replace All in File"
                    onClick={(event) => {
                      event.stopPropagation();
                      void replaceFile(group.path);
                    }}
                  >
                    <ReplaceAllIcon size={13} />
                  </button>
                )}
                <span className="search-group-count">
                  {group.matches.length}
                </span>
              </div>
              {!isCollapsed &&
                group.matches.map((match, index) => (
                  <div
                    key={`${match.line}:${match.column}:${index}`}
                    className="search-match-row"
                    onClick={() => void openMatch(match)}
                    title={`${group.path}:${match.line}:${match.column}`}
                  >
                    <MatchLine match={match} />
                    {showReplace && (
                      <button
                        className="search-icon-btn search-match-action"
                        title="Replace"
                        onClick={(event) => {
                          event.stopPropagation();
                          void replaceOne(match);
                        }}
                      >
                        <ReplaceIcon size={13} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
