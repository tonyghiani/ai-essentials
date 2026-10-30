/**
 * The style conventions a linter can check, as rule maps a project spreads into
 * its own flat config. A convention that agents (or people) keep missing moves
 * here from prose: a rule fails the build every time, a sentence in a rule file
 * is a request. Lessons recorded with `--route lint-rule` land in this file.
 *
 * Plugins are not imported here, so this file has no dependencies. The project
 * registers them under the names the keys use: `@typescript-eslint`, `unicorn`,
 * `import`, `jest`.
 *
 *   import { STYLE_RULES, TYPE_AWARE_RULES, JEST_RULES } from './style_rules.mjs';
 *   export default [
 *     { files: ['**\/*.{ts,tsx}'], rules: { ...STYLE_RULES, ...TYPE_AWARE_RULES } },
 *     { files: ['**\/*.test.{ts,tsx}'], rules: JEST_RULES },
 *   ];
 *
 * Project conventions win: drop a rule here rather than fight a codebase that
 * does it the other way. eslint-recommendations.md explains each choice.
 */

/** Rules that need no type information. */
export const STYLE_RULES = {
  'no-restricted-syntax': [
    'error',
    { selector: 'TSEnumDeclaration', message: 'Use a string-literal union or an `as const` array.' },
    { selector: 'CatchClause > Identifier.param[name!="error"]', message: 'Name the caught value `error`.' },
    {
      selector: 'TSTypeReference[typeName.left.name="React"][typeName.right.name="FC"]',
      message: 'Type props on the parameter instead of React.FC.',
    },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' }],
  '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
  curly: ['error', 'all'],
  'unicorn/no-for-loop': 'error',
  'prefer-const': 'error',
  'import/no-default-export': 'error',
  // `cx` is the conventional classnames import name, not a chosen identifier.
  'id-length': ['error', { min: 3, exceptions: ['id', 'to', 'db', '_', 'cx'] }],
  // Omit in published component libraries whose convention is PascalCase files.
  'unicorn/filename-case': ['error', { case: 'snakeCase' }],
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

/** Rules that need parserOptions.projectService (or project). */
export const TYPE_AWARE_RULES = {
  '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { boolean: true } }],
  // Start at 'warn': existing repos carry dozens of unprefixed declarations.
  '@typescript-eslint/naming-convention': [
    'warn',
    { selector: 'interface', format: ['PascalCase'], prefix: ['I'] },
    { selector: 'typeAlias', format: ['PascalCase'], prefix: ['T'] },
    { selector: 'variable', types: ['boolean'], format: ['PascalCase'], prefix: ['is', 'has', 'can', 'should', 'blocks'] },
    // PascalCase is required here, not optional: components and factories are consts.
    { selector: 'variable', modifiers: ['const', 'global'], format: ['UPPER_CASE', 'camelCase', 'PascalCase'] },
  ],
};

/** Rules for test files. */
export const JEST_RULES = {
  'jest/valid-title': ['error', { mustNotMatch: { it: ['^should\\b', 'Start with the behaviour, not "should".'] } }],
  'jest/no-restricted-matchers': [
    'error',
    {
      toMatchSnapshot: 'Assert concrete values or use expect.objectContaining.',
      toMatchInlineSnapshot: 'Assert concrete values or use expect.objectContaining.',
    },
  ],
};
