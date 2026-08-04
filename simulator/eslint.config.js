import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
    rules: {
      // The simulator must be reproducible. These three are the only sources of
      // non-determinism a scenario could reach for, so they are banned outright
      // rather than merely discouraged; every id, timestamp and choice is
      // derived from `--seed` instead.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Non-deterministic. Use the seeded PRNG from src/prng.ts.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Non-deterministic. Use the seeded clock from src/clock.ts.',
        },
        {
          object: 'crypto',
          property: 'randomUUID',
          message: 'Non-deterministic. Use uuidFrom() in src/prng.ts.',
        },
      ],
    },
  },
)
