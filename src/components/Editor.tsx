import { useRef, useEffect, useState } from 'react';
import MonacoEditor, {
  loader,
  type BeforeMount,
  type OnMount,
} from '@monaco-editor/react';
import { shikiToMonaco } from '@shikijs/monaco';
import { useEditorState, useEditorDispatch } from '../stores/editorStore';
import { getHighlighter, SHIKI_THEMES } from '../services/highlighter';
import { readFile, checkFileModified } from '../services/fs';
import { scheduleSave, isCollabFile } from '../services/autosave';
import { bindEditor, isReadOnlyGuest, isShared } from '../services/collab';
import { collabKeyOf, useCollabSnapshot } from '../hooks/useCollab';
import '../styles/editor.css';
import '../styles/collab.css';

const handleBeforeMount: BeforeMount = (monaco) => {
  // TypeScript: enable JSX/TSX, disable semantic errors (no node_modules in browser)
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.Latest,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    noEmit: true,
    strict: true,
  });
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  // JavaScript: same JSX support
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.Latest,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  // .vue 作为独立语言 id 注册，其 TextMate 高亮由 Shiki 提供（见下方 useEffect）。
  monaco.languages.register({ id: 'vue' });
};

export default function Editor() {
  const { files, activeFileId, theme, reveal } = useEditorState();
  const dispatch = useEditorDispatch();
  const [shikiReady, setShikiReady] = useState(false);
  // Monaco 编辑器实例，用于搜索结果跳转定位
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // 编辑器实例变化（切换文件会重新挂载）时触发协同重绑
  const [editorInstance, setEditorInstance] = useState<
    Parameters<OnMount>[0] | null
  >(null);
  const collab = useCollabSnapshot();

  // 初始化 Shiki 高亮引擎并接入 Monaco（VS Code 级 TextMate 高亮，含 Vue SFC）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [highlighter, monaco] = await Promise.all([
          getHighlighter(),
          loader.init(),
        ]);
        if (cancelled) return;
        if (!monaco.languages.getLanguages().some((l) => l.id === 'vue')) {
          monaco.languages.register({ id: 'vue' });
        }
        shikiToMonaco(highlighter, monaco);
        setShikiReady(true);
      } catch (err) {
        console.error('Failed to init Shiki highlighter:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Shiki 就绪后使用其主题（dark-plus/light-plus），否则回退 Monaco 内置主题
  const editorTheme = shikiReady ? SHIKI_THEMES[theme] : theme;

  const activeFile = files.find((f) => f.id === activeFileId);

  /** 将编辑器定位到指定行列并选中命中文本 */
  const applyReveal = () => {
    const ed = editorRef.current;
    if (!ed || !reveal || reveal.fileId !== activeFileId) return;
    ed.revealLineInCenter(reveal.line);
    ed.setSelection({
      startLineNumber: reveal.line,
      startColumn: reveal.column,
      endLineNumber: reveal.line,
      endColumn: reveal.endColumn,
    });
    ed.setPosition({ lineNumber: reveal.line, column: reveal.column });
    ed.focus();
  };

  // 文件已打开的情况下，reveal 变化时直接定位
  useEffect(() => {
    applyReveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.token, activeFileId]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    setEditorInstance(editor);
    // 文件刚被打开而挂载时，若存在待定位请求则立即执行
    applyReveal();
  };

  // 协同中：把当前编辑器绑定到对应共享文本
  const activeCollabKey = activeFile ? collabKeyOf(activeFile) : '';
  useEffect(() => {
    if (!collab.active || !editorInstance || !activeCollabKey) return;
    return bindEditor(activeCollabKey, editorInstance);
  }, [
    collab.active,
    collab.room,
    collab.filesVersion,
    editorInstance,
    activeCollabKey,
  ]);

  // 检测文件外部修改
  useEffect(() => {
    const checkExternalChanges = async () => {
      if (!activeFile || !activeFile.path || !activeFile.lastModified) return;

      try {
        const isModified = await checkFileModified(
          activeFile.path,
          activeFile.lastModified
        );

        if (isModified) {
          const shouldReload = confirm(
            `文件 "${activeFile.name}" 已被外部修改。是否重新加载？\n\n点击"确定"重新加载文件，点击"取消"保留当前编辑内容。`
          );

          if (shouldReload) {
            const { content, lastModified } = await readFile(activeFile.path);
            dispatch({
              type: 'RELOAD_FILE',
              payload: {
                id: activeFile.id,
                content,
                lastModified,
              },
            });
            dispatch({
              type: 'SHOW_TOAST',
              payload: {
                message: '文件已重新加载',
                type: 'success',
              },
            });
          }
        }
      } catch (err) {
        console.error('Failed to check file modification:', err);
      }
    };

    const handleFocus = () => {
      checkExternalChanges();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [activeFile, dispatch]);

  if (!activeFile)
    return <div className="editor-placeholder">No file open</div>;

  // 只读访客查看共享文件时禁止编辑
  const readOnly = isReadOnlyGuest(collab) && isShared(activeCollabKey);

  const handleChange = (value: string | undefined) => {
    const content = value ?? '';
    dispatch({
      type: 'UPDATE_FILE_CONTENT',
      payload: { id: activeFile.id, content },
    });
    // 防抖自动保存到磁盘（协同访客文件跳过）
    scheduleSave(activeFile, content, dispatch);
  };

  return (
    <div className="editor-container">
      <MonacoEditor
        key={activeFile.id}
        height="100%"
        path={
          activeFile.path ||
          (isCollabFile(activeFile.id) ? activeFile.id : activeFile.name)
        }
        language={activeFile.language}
        theme={editorTheme}
        value={activeFile.content}
        onChange={handleChange}
        onMount={handleMount}
        beforeMount={handleBeforeMount}
        options={{
          fontSize: 14,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          wordWrap: 'on',
          readOnly,
          readOnlyMessage: { value: '协同发起者已设置为只读' },
        }}
      />
    </div>
  );
}
