import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @returns {string} Root of the ai-essentials checkout these scripts run from. */
export function repoHome() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}
