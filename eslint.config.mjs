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
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
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
    files: ['*.cjs', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['scripts/inspect-pet.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
)
