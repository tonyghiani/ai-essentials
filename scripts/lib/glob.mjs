/**
 * Minimal glob matcher for repo-relative POSIX paths. Supports `**`, `*` and
 * `?`. A pattern without a slash only matches at the repo root, so write
 * `**\/*.ts` to match TypeScript anywhere. No dependency on purpose: hooks run
 * on every turn and must start fast.
 */

/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const followedBySlash = glob[index + 2] === '/';
      source += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * @param {string} file Repo-relative POSIX path.
 * @param {string[] | undefined} globs No globs means "match everything".
 * @returns {boolean}
 */
export function matchesAny(file, globs) {
  if (globs === undefined || globs.length === 0) {
    return true;
  }
  return globs.some((glob) => globToRegExp(glob).test(file));
}
