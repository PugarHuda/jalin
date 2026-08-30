import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

/**
 * Everything outside the app.
 *
 * `app/` has its own Next-flavoured config and 113 rules. The SDK, the Playwright
 * suite and the scripts had none at all — which is two thirds of the TypeScript
 * in this repository, including the module that decides whether a plan is safe
 * to sign.
 *
 * Type-aware rather than syntax-only: the rules worth having here — a floating
 * promise, an unnecessary condition, a mishandled `any` — all need the type
 * checker, and this repository already runs one.
 */
export default defineConfig([
  globalIgnores([
    'app/**',
    'node_modules/**',
    // Build output, written by scripts/publish-sdk.mjs. Linting it lints the
    // compiler.
    'sdk/dist/**',
    'vendor/**',
    'contracts/target/**',
    'test-results/**',
    'playwright-report/**',
  ]),

  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise in a script is a script that exits before its work
      // lands, and in a test it is an assertion that never runs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  {
    /**
     * node:test's `test()` returns a promise the runner already tracks, so
     * every call in every test file reads as a floating one. Ninety-two false
     * positives is how a rule stops being read, and the real ones - three of
     * them - were all outside these files.
     */
    files: ['sdk/test/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  {
    // Plain JavaScript, so the type-aware rules have nothing to read.
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
])
