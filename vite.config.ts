import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 项目站点部署在 /<仓库名>/ 路径下，故生产构建需设置 base。
// 开发模式保持根路径 '/'。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/cocode/' : '/',
  plugins: [react()],
}));
