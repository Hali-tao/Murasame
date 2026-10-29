import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['out', 'release', 'node_modules', 'playwright-report', 'test-results', 'previews', 'src/renderer/public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/main/**', '**/preload/**'], message: '渲染层只能通过 preload 暴露的 window.murasame 访问主进程，纯函数请放到 src/shared。' }]
      }]
    }
  },
  {
    files: ['src/renderer/src/pet.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.config.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['*.cjs', '*.mjs', 'scripts/**/*.mjs', 'scripts/**/*.cjs', 'artifacts/**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    // 插件入口由 ToolRegistry 在隔离上下文中调用，文件自身不引用这些函数。
    files: ['plugins/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-unused-vars': 'off' }
  },
  {
    // 这些脚本里有 page.evaluate 回调，回调体在渲染上下文执行。
    files: ['scripts/inspect-pet.mjs', 'scripts/perf-suite.mjs', 'scripts/probe-window.mjs', 'artifacts/nailong-3d-refined-2026-10-29/verify-page.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
)
