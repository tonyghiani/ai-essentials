# ESLint and Prettier recommendations

Config, not agent guidance. Everything here is deterministic and belongs in a project's lint setup
rather than in a rule file or a prompt. The `rules/*.mdc` files deliberately omit these so the agent
never spends attention on something CI already enforces.

Copy the blocks you need into a project's `eslint.config.mjs` and `.prettierrc.json`.

**Verified by running, not by reading.** These rules were installed into `checkworld` and executed
against its `src/`. Two corrections came out of that run and are already folded in below: global
consts need `PascalCase` allowed (components and factories are consts), and `cx` needs an
`id-length` exception (it is the classnames import name). The remaining 42 errors and 25 warnings
were genuine violations, including six single-letter identifiers and ten brace-less guards.

**Plugins most repos are missing.** `eslint-plugin-unicorn` for `no-for-loop` and `filename-case`,
`eslint-plugin-jest` for the test-title rules, and `@typescript-eslint/{eslint-plugin,parser}` where
a framework preset (such as `next/core-web-vitals`) bundles them without exposing them. Type-aware
rules also need `parserOptions.projectService: true` plus `tsconfigRootDir`.

## Prettier

Already shared verbatim by mountain-ui, mnt, and checkworld.

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "singleQuote": true,
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "avoid",
  "trailingComma": "none"
}
```

## Import ordering

Also already in those three repos. Copy the groups verbatim rather than reconstructing them.

```js
'simple-import-sort/imports': ['error', {
  groups: [
    ['^\\u0000'],
    ['^react', '^@?\\w'],
    ['^(utils|models|services|store|i18n|hooks)(/.*|$)'],
    ['^(components)(/.*|$)'],
    ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
    ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
    ['^.+\\.s?css$']
  ]
}],
'import/first': 'error',
'import/newline-after-import': 'error',
'import/no-duplicates': 'error',
'import/prefer-default-export': 'off',
'import/order': 'off',
'import/no-cycle': ['error', { maxDepth: Infinity }],
'import/no-default-export': 'error',
```

## Enforcing the style rules

Each entry maps to a rule in `rules/typescript-style.mdc`, `rules/react-components.mdc`, or
`rules/project-structure.mdc`. Where a lint rule exists, the `.mdc` file stays silent.

```js
'no-restricted-syntax': ['error',
  { selector: 'TSEnumDeclaration',
    message: 'Use a string-literal union or an `as const` array.' },
  { selector: 'CatchClause > Identifier.param[name!="error"]',
    message: 'Name the caught value `error`.' },
  { selector: 'TSTypeReference[typeName.left.name="React"][typeName.right.name="FC"]',
    message: 'Type props on the parameter instead of React.FC.' }
],

'@typescript-eslint/no-explicit-any': 'error',
'@typescript-eslint/ban-ts-comment': ['error', {
  'ts-ignore': true,
  'ts-expect-error': 'allow-with-description'
}],

// Needs parserOptions.project
'@typescript-eslint/prefer-nullish-coalescing': ['error', {
  ignorePrimitives: { boolean: true }
}],

'@typescript-eslint/consistent-type-imports': ['error', {
  prefer: 'type-imports',
  fixStyle: 'separate-type-imports'
}],

'curly': ['error', 'all'],
'unicorn/no-for-loop': 'error',
'prefer-const': 'error',

// Type-aware. Needs parserOptions.projectService (or project) for the boolean selector.
// Start at 'warn': existing repos carry dozens of unprefixed declarations.
'@typescript-eslint/naming-convention': ['warn',
  { selector: 'interface', format: ['PascalCase'], prefix: ['I'] },
  { selector: 'typeAlias', format: ['PascalCase'], prefix: ['T'] },
  { selector: 'variable', types: ['boolean'], format: ['PascalCase'],
    prefix: ['is', 'has', 'can', 'should', 'blocks'] },
  // PascalCase is required here, not optional: components and factories are consts.
  { selector: 'variable', modifiers: ['const', 'global'],
    format: ['UPPER_CASE', 'camelCase', 'PascalCase'] }
],

// `cx` is the conventional classnames import name, not a chosen identifier.
'id-length': ['error', { min: 3, exceptions: ['id', 'to', 'db', '_', 'cx'] }],

// Omit in published component libraries whose convention is PascalCase files.
'unicorn/filename-case': ['error', { case: 'snakeCase' }],

'no-unused-vars': 'off',
'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
```

## Jest

```js
'jest/valid-title': ['error', {
  mustNotMatch: { it: ['^should\\b', 'Start with the behaviour, not "should".'] }
}],
'jest/no-restricted-matchers': ['error', {
  toMatchSnapshot: 'Assert concrete values or use expect.objectContaining.',
  toMatchInlineSnapshot: 'Assert concrete values or use expect.objectContaining.'
}],
```

## Deliberately not enforced

Judgement calls that stay in the rule files because no linter can check intent: comment content,
memoisation justification, the extraction threshold, barrel policy, server layering, the split
between hand-rolled fakes and `jest.mock`, and what to test.

## Deliberately unresolved

- **Forms.** No form library appears in any repo. No rule written.
- **`user-event`.** Zero usage found, and too few interaction tests to tell preference from accident.
- **Fail-open vs fail-closed.** Decided case by case on purpose. No rule.
