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
import '../styles/header.css';

const GITHUB_REPO_URL = 'https://github.com/Chenjiaxing233/cocode';

/** 应用顶部工具栏。 */
export default function Header() {
  const { theme, tree } = useEditorState();
  const dispatch = useEditorDispatch();
  const hasFolder = getRootHandle() !== null || tree.length > 0;
  const handleOpenFolder = async () => {
    try {
      await openDirectory();
      dispatch({ type: 'SET_TREE', payload: await refreshTree() });
    } catch (error) {
      console.error('Failed to open directory:', error);
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
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  };
  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">CoCode</span>
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
        <button
          className="theme-btn"
          onClick={() =>
            dispatch({
              type: 'SET_THEME',
              payload: theme === 'vs-dark' ? 'vs' : 'vs-dark',
            })
          }
        >
          {theme === 'vs-dark' ? 'Light' : 'Dark'}
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
