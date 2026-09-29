import {
  openDirectory,
  openSingleFile,
  refreshTree,
  getRootHandle,
} from '../services/fs';
import {
  getLanguageFromFileName,
  useEditorDispatch,
  useEditorState,
} from '../stores/editorStore';
import { GithubIcon, NewFileIcon, NewFolderIcon } from './icons';
import CollabButton from './CollabButton';

/** GitHub 项目地址，点击跳转以便 star */
const GITHUB_REPO_URL = 'https://github.com/Chenjiaxing233/jx-web-code';
import '../styles/header.css';

export default function Header() {
  const { theme, tree } = useEditorState();
  const dispatch = useEditorDispatch();

  const hasFolder = getRootHandle() !== null || tree.length > 0;

  const toggleTheme = () => {
    dispatch({
      type: 'SET_THEME',
      payload: theme === 'vs-dark' ? 'vs' : 'vs-dark',
    });
  };

  const handleOpenFolder = async () => {
    try {
      await openDirectory();
      const tree = await refreshTree();
      dispatch({ type: 'SET_TREE', payload: tree });
    } catch (err) {
      console.error('Failed to open directory:', err);
    }
  };

  const handleOpenFile = async () => {
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
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">Code Editor</span>
      </div>
      <div className="header-right">
        {hasFolder && (
          <>
            <button
              className="icon-btn"
              title="New File"
              onClick={() =>
                dispatch({ type: 'REQUEST_CREATE', payload: 'file' })
              }
            >
              <NewFileIcon />
            </button>
            <button
              className="icon-btn"
              title="New Folder"
              onClick={() =>
                dispatch({ type: 'REQUEST_CREATE', payload: 'directory' })
              }
            >
              <NewFolderIcon />
            </button>
            <span className="header-divider" />
          </>
        )}
        <CollabButton />
        <button className="theme-btn" onClick={handleOpenFile}>
          Open File
        </button>
        <button className="theme-btn" onClick={handleOpenFolder}>
          Open Folder
        </button>
        <button className="theme-btn" onClick={toggleTheme}>
          {theme === 'vs-dark' ? '☀ Light' : '☾ Dark'}
        </button>
        <a
          className="icon-btn"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Star on GitHub"
        >
          <GithubIcon />
        </a>
      </div>
    </header>
  );
}
