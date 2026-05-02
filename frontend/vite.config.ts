import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';
import baseConfig from '../vite.config';

/** Absolute monorepo root — avoids `root: '..'` resolving from drive root if cwd is wrong (Windows + pagefile.sys watcher crash). */
const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  ...baseConfig,
  root: monorepoRoot,
  envDir: monorepoRoot
});
