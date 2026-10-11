/**
 * Mock File System Access API
 * 用于测试环境，模拟浏览器的 File System Access API
 */

interface MockFileData {
  name: string;
  content: string;
  lastModified: number;
  type: 'file' | 'directory';
  children?: Map<string, MockFileData>;
}

class MockFileSystemFileHandle implements FileSystemFileHandle {
  kind: 'file' = 'file';
  name: string;
  private data: MockFileData;

  constructor(name: string, data: MockFileData) {
    this.name = name;
    this.data = data;
  }

  async getFile(): Promise<File> {
    const blob = new Blob([this.data.content], { type: 'text/plain' });
    return new File([blob], this.name, {
      lastModified: this.data.lastModified,
    });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const data = this.data;
    return {
      write: async (content: string) => {
        data.content = content;
        data.lastModified = Date.now();
      },
      close: async () => {},
      seek: async () => {},
      truncate: async () => {},
    } as any;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return this === other;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }
}

class MockFileSystemDirectoryHandle implements FileSystemDirectoryHandle {
  kind: 'directory' = 'directory';
  name: string;
  private data: MockFileData;

  constructor(name: string, data: MockFileData) {
    this.name = name;
    this.data = data;
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    if (!this.data.children) return;
    for (const [name, childData] of this.data.children.entries()) {
      if (childData.type === 'file') {
        yield [name, new MockFileSystemFileHandle(name, childData)];
      } else {
        yield [name, new MockFileSystemDirectoryHandle(name, childData)];
      }
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    if (!this.data.children) return;
    for (const name of this.data.children.keys()) {
      yield name;
    }
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    if (!this.data.children) return;
    for (const [name, childData] of this.data.children.entries()) {
      if (childData.type === 'file') {
        yield new MockFileSystemFileHandle(name, childData);
      } else {
        yield new MockFileSystemDirectoryHandle(name, childData);
      }
    }
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle> {
    if (!this.data.children) {
      this.data.children = new Map();
    }

    let fileData = this.data.children.get(name);
    if (!fileData) {
      if (options?.create) {
        fileData = {
          name,
          content: '',
          lastModified: Date.now(),
          type: 'file',
        };
        this.data.children.set(name, fileData);
      } else {
        throw new Error(`File not found: ${name}`);
      }
    }

    return new MockFileSystemFileHandle(name, fileData);
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle> {
    if (!this.data.children) {
      this.data.children = new Map();
    }

    let dirData = this.data.children.get(name);
    if (!dirData) {
      if (options?.create) {
        dirData = {
          name,
          content: '',
          lastModified: Date.now(),
          type: 'directory',
          children: new Map(),
        };
        this.data.children.set(name, dirData);
      } else {
        throw new Error(`Directory not found: ${name}`);
      }
    }

    return new MockFileSystemDirectoryHandle(name, dirData);
  }

  async removeEntry(
    name: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    if (!this.data.children) return;
    this.data.children.delete(name);
  }

  async resolve(
    possibleDescendant: FileSystemHandle
  ): Promise<string[] | null> {
    return null;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return this === other;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> {
    return this.entries();
  }
}

/**
 * 创建一个测试用的文件系统结构
 */
export function createMockFileSystem(): MockFileSystemDirectoryHandle {
  const rootData: MockFileData = {
    name: 'test-project',
    content: '',
    lastModified: Date.now(),
    type: 'directory',
    children: new Map([
      [
        'src',
        {
          name: 'src',
          content: '',
          lastModified: Date.now(),
          type: 'directory',
          children: new Map([
            [
              'index.ts',
              {
                name: 'index.ts',
                content: 'console.log("Hello, World!");',
                lastModified: Date.now(),
                type: 'file',
              },
            ],
            [
              'App.tsx',
              {
                name: 'App.tsx',
                content:
                  'export default function App() { return <div>Hello</div>; }',
                lastModified: Date.now(),
                type: 'file',
              },
            ],
          ]),
        },
      ],
      [
        'README.md',
        {
          name: 'README.md',
          content: '# Test Project\n\nThis is a test project.',
          lastModified: Date.now(),
          type: 'file',
        },
      ],
      [
        'package.json',
        {
          name: 'package.json',
          content: '{"name": "test-project", "version": "1.0.0"}',
          lastModified: Date.now(),
          type: 'file',
        },
      ],
    ]),
  };

  return new MockFileSystemDirectoryHandle('test-project', rootData);
}

/**
 * 在页面中注入 Mock File System Access API
 */
export async function injectMockFileSystemAPI(page: any) {
  await page.addInitScript(() => {
    // 保存原始的 showDirectoryPicker
    (window as any).__originalShowDirectoryPicker = window.showDirectoryPicker;
    (window as any).__originalShowOpenFilePicker = window.showOpenFilePicker;

    // Mock showDirectoryPicker
    (window as any).showDirectoryPicker = async () => {
      // 返回一个 mock 的目录句柄
      return (window as any).__mockDirectoryHandle;
    };

    // Mock showOpenFilePicker
    (window as any).showOpenFilePicker = async () => {
      // 返回一个 mock 的文件句柄
      return [(window as any).__mockFileHandle];
    };
  });
}

/**
 * 设置 Mock 文件系统数据
 */
export async function setMockFileSystem(page: any, mockHandle: any) {
  await page.evaluate(
    (serializedData: string) => {
      // 将序列化的数据存储到 window 对象
      (window as any).__mockFileSystemData = JSON.parse(serializedData);
    },
    JSON.stringify({ name: 'test-project' })
  );
}
