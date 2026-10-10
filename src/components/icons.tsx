/**
 * UI 操作图标：使用 VS Code 官方 Codicon 字体图标（@vscode/codicons）。
 * 颜色随 currentColor 继承，尺寸由 size（font-size）控制。
 */
type IconProps = { size?: number; className?: string };

const Codicon = ({
  name,
  size = 16,
  className,
}: { name: string } & IconProps) => (
  <i
    className={`codicon codicon-${name}${className ? ` ${className}` : ''}`}
    style={{ fontSize: size }}
    aria-hidden="true"
  />
);

/** 新建文件 */
export const NewFileIcon = (props: IconProps) => (
  <Codicon name="new-file" {...props} />
);

/** 新建文件夹 */
export const NewFolderIcon = (props: IconProps) => (
  <Codicon name="new-folder" {...props} />
);

/** 删除（垃圾桶） */
export const TrashIcon = (props: IconProps) => (
  <Codicon name="trash" {...props} />
);

/** 关闭 */
export const CloseIcon = (props: IconProps) => (
  <Codicon name="close" {...props} />
);

/** 刷新 */
export const RefreshIcon = (props: IconProps) => (
  <Codicon name="refresh" {...props} />
);

/** 右向箭头（折叠指示，展开时旋转 90°） */
export const ChevronRightIcon = (props: IconProps) => (
  <Codicon name="chevron-right" {...props} />
);

/** GitHub */
export const GithubIcon = (props: IconProps) => (
  <Codicon name="github" {...props} />
);

/** 执行当前文件 */
export const RunIcon = (props: IconProps) => <Codicon name="play" {...props} />;

/** 预览当前文件 */
export const PreviewIcon = (props: IconProps) => (
  <Codicon name="preview" {...props} />
);

/** 资源管理器（活动栏） */
export const FilesIcon = (props: IconProps) => (
  <Codicon name="files" {...props} />
);

/** 搜索（活动栏 / 输入框） */
export const SearchIcon = (props: IconProps) => (
  <Codicon name="search" {...props} />
);

/** 区分大小写 */
export const CaseSensitiveIcon = (props: IconProps) => (
  <Codicon name="case-sensitive" {...props} />
);

/** 全字匹配 */
export const WholeWordIcon = (props: IconProps) => (
  <Codicon name="whole-word" {...props} />
);

/** 使用正则表达式 */
export const RegexIcon = (props: IconProps) => (
  <Codicon name="regex" {...props} />
);

/** 替换单处 */
export const ReplaceIcon = (props: IconProps) => (
  <Codicon name="replace" {...props} />
);

/** 全部替换 */
export const ReplaceAllIcon = (props: IconProps) => (
  <Codicon name="replace-all" {...props} />
);
