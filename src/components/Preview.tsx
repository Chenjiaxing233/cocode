import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useRef, useState } from 'react';
import * as ts from 'typescript';
import { useEditorState } from '../stores/editorStore';
import '../styles/preview.css';

const SANDBOX_DOCUMENT = `<!doctype html><html><body><div id="root"></div><script>window.addEventListener('message',function(e){if(!e.data||e.data.type!=='run')return;var s=function(t,v){parent.postMessage({source:'jx-preview',type:t,value:v},'*')};['log','info','warn','error'].forEach(function(n){console[n]=function(){s(n,Array.from(arguments).map(String).join(' '))}});try{new Function(e.data.code)();s('ready','done')}catch(x){s('error',String(x))}});</script></body></html>`;
const SCRIPTABLE_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkdn']);

/** 将 Markdown 转换为 HTML，并清理危险标签与属性。 */
function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { breaks: true, gfm: true });
  return DOMPurify.sanitize(String(html), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}

export default function Preview({
  width,
  onClose,
}: {
  width: number;
  onClose: () => void;
}) {
  const { files, activeFileId, theme } = useEditorState();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const activeFile = files.find((file) => file.id === activeFileId);
  const extension = activeFile?.name.split('.').pop()?.toLowerCase() ?? '';
  const supported = SCRIPTABLE_EXTENSIONS.has(extension);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(extension);
  const run = () => {
    if (!activeFile || !supported || !iframeRef.current?.contentWindow) return;
    setLogs([]);
    const result = ts.transpileModule(activeFile.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: true,
    });
    const diagnostics =
      result.diagnostics?.map((item) =>
        ts.flattenDiagnosticMessageText(item.messageText, '\n')
      ) ?? [];
    if (diagnostics.length) {
      setLogs(diagnostics.map((item) => `编译错误: ${item}`));
      return;
    }
    iframeRef.current.contentWindow.postMessage(
      { type: 'run', code: result.outputText },
      '*'
    );
  };
  useEffect(() => {
    const handler = (
      event: MessageEvent<{ source?: string; type?: string; value?: string }>
    ) => {
      if (event.data?.source === 'jx-preview')
        setLogs((current) =>
          [...current, `[${event.data.type}] ${event.data.value ?? ''}`].slice(
            -100
          )
        );
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  useEffect(() => {
    if (supported) run();
  }, [activeFile?.id, activeFile?.content]);
  return (
    <section
      className="preview-panel"
      style={{ width }}
      data-theme={theme === 'vs-dark' ? 'dark' : 'light'}
    >
      <div className="preview-toolbar">
        <strong>{isMarkdown ? 'Markdown Preview' : 'JS/TS Sandbox'}</strong>
        <span
          className={`preview-status ${supported || isMarkdown ? 'preview-status-ready' : ''}`}
        >
          {isMarkdown ? '实时预览' : supported ? '隔离运行' : '不支持此文件'}
        </span>
        {supported && (
          <button className="preview-action" onClick={run} title="重新运行">
            Run
          </button>
        )}
        <button className="preview-close" onClick={onClose} title="关闭预览">
          ×
        </button>
      </div>
      <div className="preview-body">
        {isMarkdown ? (
          <article
            className="markdown-preview"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(activeFile?.content ?? ''),
            }}
          />
        ) : (
          <>
            <iframe
              ref={iframeRef}
              title="JS/TS sandbox"
              className="preview-frame"
              sandbox="allow-scripts"
              srcDoc={SANDBOX_DOCUMENT}
              onLoad={run}
            />
            <div className="preview-console" aria-label="运行日志">
              <div className="preview-console-title">Console</div>
              {logs.length === 0 ? (
                <div className="preview-empty">运行日志会显示在这里</div>
              ) : (
                logs.map((log, index) => (
                  <div className="preview-log" key={`${index}-${log}`}>
                    {log}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
