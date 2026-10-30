#!/usr/bin/env node
/**
 * A read-only health report on the installed setup: which skills get used,
 * what the always-on context costs each tool, which hooks are failing, which
 * verification checks keep failing, and which memory files are dead weight.
 *
 *   ai-checkup [--json] [--repo DIR] [--home DIR]
 *
 * Every finding ends with a suggested action. Nothing is written anywhere,
 * including the state directory, so it is safe to run at any time.
 *
 * @typedef {{ area: 'skills' | 'context' | 'hooks' | 'verification' | 'memory', message: string, action: string }} IFinding
 * @typedef {{ name: string, invocations: number, lastUsed: string | null }} ISkillUsage
 * @typedef {{ source: string, tokens: number }} IContextItem
 * @typedef {{ tool: 'claude' | 'codex' | 'cursor', totalTokens: number, items: IContextItem[] }} IContextCost
 * @typedef {{ project: string, files: number, indexLines: number, orphans: string[], stale: string[] }} IMemoryDir
 * @typedef {{
 *   skills: { logSpanDays: number, usage: ISkillUsage[] },
 *   context: IContextCost[],
 *   hookErrors: Record<string, number>,
 *   verifyFailures: Array<{ repo: string, check: string, count: number }>,
 *   memory: IMemoryDir[],
 *   findings: IFinding[],
 * }} ICheckupReport
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoHome } from '../lib/paths.mjs';

const DAY_MS = 86_400_000;
/** Below this the log has not seen enough ordinary work to call a skill unused. */
const MIN_LOG_SPAN_DAYS = 14;
const HOOK_ERROR_WINDOW_DAYS = 7;
const VERIFY_FAILURE_WINDOW_DAYS = 30;
const STALE_MEMORY_DAYS = 90;
/** Claude Code loads only the first 200 lines of MEMORY.md into a session. */
const MEMORY_INDEX_MAX_LINES = 200;
/** A rough estimate that matches English prose and markdown well enough to rank contributors. */
const CHARS_PER_TOKEN = 4;
/** Skill folders that hold shared material or sync output, not skills. */
const NOT_SKILLS = new Set(['shared', 'synced', '.trash']);

/**
 * Just enough YAML for skill, agent and rule frontmatter: `key: value`,
 * quoted values, folded or literal block scalars, multi-line plain values and
 * `- item` lists.
 *
 * @param {string} text
 * @returns {Record<string, string | string[]>}
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) {
    return {};
  }
  /** @type {Record<string, string | string[]>} */
  const fields = {};
  /** @type {{ key: string, style: 'folded' | 'literal' | 'plain' | 'list', lines: string[] } | null} */
  let open = null;
  const close = () => {
    if (open === null) {
      return;
    }
    if (open.style === 'list') {
      fields[open.key] = open.lines;
    } else if (open.lines.length > 0) {
      const joined = open.lines.join(open.style === 'literal' ? '\n' : ' ').trim();
      fields[open.key] = open.style === 'plain' ? `${fields[open.key] ?? ''} ${joined}`.trim() : joined;
    }
    open = null;
  };
  // A loop because a block scalar or list carries state from its key line to the lines after it.
  for (const line of match[1].split(/\r?\n/)) {
    const keyLine = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (keyLine !== null) {
      close();
      const [, key, rawValue] = keyLine;
      const value = rawValue.trim();
      if (/^[>|][-+]?$/.test(value)) {
        open = { key, style: value.startsWith('>') ? 'folded' : 'literal', lines: [] };
      } else if (value === '') {
        open = { key, style: 'list', lines: [] };
      } else {
        fields[key] = unquote(value);
        open = { key, style: 'plain', lines: [] };
      }
    } else if (open !== null && /^\s+-\s+/.test(line) && open.style === 'list') {
      open.lines.push(unquote(line.replace(/^\s+-\s+/, '').trim()));
    } else if (open !== null && /^\s+\S/.test(line)) {
      open.lines.push(line.trim());
    }
  }
  close();
  return fields;
}

/** @param {string} value */
function unquote(value) {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** @param {string} text */
function tokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** @param {string} path @returns {string} */
function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return '';
  }
}

/**
 * @param {string} path
 * @returns {Array<Record<string, unknown>>} Parsed lines; a torn or hand-edited line is skipped, not fatal.
 */
function readJsonl(path) {
  return readText(path)
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null ? [parsed] : [];
      } catch (error) {
        return [];
      }
    });
}

/** @param {Record<string, unknown>} entry @returns {number} Epoch ms, NaN when missing. */
function entryTime(entry) {
  return typeof entry.at === 'string' ? Date.parse(entry.at) : Number.NaN;
}

/** @param {string} dir @returns {string[]} */
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch (error) {
    return [];
  }
}

/**
 * @param {string} repo
 * @returns {Array<{ name: string, fields: Record<string, string | string[]> }>}
 */
function readSkills(repo) {
  const dir = join(repo, 'skills');
  return listDir(dir)
    .filter((name) => !NOT_SKILLS.has(name) && !name.startsWith('.') && existsSync(join(dir, name, 'SKILL.md')))
    .sort()
    .map((name) => ({ name, fields: parseFrontmatter(readText(join(dir, name, 'SKILL.md'))) }));
}

/** @param {string | string[] | undefined} value */
const asText = (value) => (Array.isArray(value) ? value.join(' ') : (value ?? ''));

/**
 * @param {{ repo: string, state: string, now: number }} options
 * @returns {{ logSpanDays: number, usage: ISkillUsage[], findings: IFinding[] }}
 */
export function checkSkills({ repo, state, now }) {
  const entries = readJsonl(join(state, 'skill-usage.jsonl')).filter((entry) => !Number.isNaN(entryTime(entry)));
  const first = Math.min(...entries.map(entryTime));
  const logSpanDays = entries.length === 0 ? 0 : Math.floor((now - first) / DAY_MS);
  const usage = readSkills(repo).map(({ name }) => {
    // A plugin install logs skills as `<plugin>:<name>`; the bare name is the same skill.
    const mine = entries.filter((entry) => String(entry.skill).split(':').pop() === name);
    const last = Math.max(...mine.map(entryTime));
    return { name, invocations: mine.length, lastUsed: mine.length === 0 ? null : new Date(last).toISOString() };
  });
  const unused = usage.filter((skill) => skill.invocations === 0).map((skill) => skill.name);

  /** @type {IFinding[]} */
  const findings = [];
  if (logSpanDays < MIN_LOG_SPAN_DAYS) {
    findings.push({
      area: 'skills',
      message: `skill-usage.jsonl covers ${logSpanDays} day(s); unused-skill findings start at ${MIN_LOG_SPAN_DAYS}`,
      action: 'keep the log-skill-use hook registered on PreToolUse (Skill) and UserPromptExpansion, then rerun later',
    });
  } else if (unused.length > 0) {
    findings.push({
      area: 'skills',
      message: `${unused.length} skill(s) never invoked in ${logSpanDays} days: ${unused.join(', ')}`,
      action: 'run the trigger eval on each; if the description triggers but you never need it, remove the skill to cut always-on context',
    });
  }
  return { logSpanDays, usage, findings };
}

/**
 * The text each tool loads into every session before the user types anything:
 * global instructions, every model-invocable skill's description, every
 * agent's description, and the rules that apply unconditionally.
 *
 * @param {{ repo: string }} options
 * @returns {{ context: IContextCost[], findings: IFinding[] }}
 */
export function checkContext({ repo }) {
  const skills = readSkills(repo);
  const agents = listDir(join(repo, 'agents'))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name: name.replace(/\.md$/, ''), fields: parseFrontmatter(readText(join(repo, 'agents', name))) }));

  /** @param {boolean} honoursDisable @returns {IContextItem[]} */
  const descriptionItems = (honoursDisable) => [
    ...skills
      .filter(({ fields }) => !(honoursDisable && fields['disable-model-invocation'] === 'true'))
      .map(({ name, fields }) => ({
        source: `skill ${name}`,
        tokens: tokens(`${name}: ${asText(fields.description)} ${asText(fields.when_to_use)}`),
      })),
    ...agents.map(({ name, fields }) => ({ source: `agent ${name}`, tokens: tokens(`${name}: ${asText(fields.description)}`) })),
  ];
  /** @param {string} relative @returns {IContextItem[]} */
  const file = (relative) => (existsSync(join(repo, relative)) ? [{ source: relative, tokens: tokens(readText(join(repo, relative))) }] : []);

  // Claude rules without `paths` frontmatter load in every session; path-scoped ones wait for a matching file.
  const claudeRules = listDir(join(repo, 'claude', 'rules'))
    .filter((name) => name.endsWith('.md'))
    .filter((name) => parseFrontmatter(readText(join(repo, 'claude', 'rules', name))).paths === undefined)
    .map((name) => ({ source: `claude/rules/${name}`, tokens: tokens(readText(join(repo, 'claude', 'rules', name))) }));
  const cursorRules = listDir(join(repo, 'rules'))
    .filter((name) => name.endsWith('.mdc'))
    .filter((name) => parseFrontmatter(readText(join(repo, 'rules', name))).alwaysApply === 'true')
    .map((name) => ({ source: `rules/${name}`, tokens: tokens(readText(join(repo, 'rules', name))) }));

  /** @type {Array<[IContextCost['tool'], IContextItem[]]>} */
  const perTool = [
    // Claude Code hides disable-model-invocation skills from the model; Codex and Cursor are assumed not to.
    ['claude', [...file('claude/CLAUDE.md'), ...claudeRules, ...descriptionItems(true)]],
    ['codex', [...file('codex/INSTRUCTIONS.md'), ...descriptionItems(false)]],
    ['cursor', [...cursorRules, ...descriptionItems(false)]],
  ];
  const context = perTool.map(([tool, items]) => ({
    tool,
    totalTokens: items.reduce((sum, item) => sum + item.tokens, 0),
    items: [...items].sort((a, b) => b.tokens - a.tokens),
  }));
  const findings = context
    .filter((cost) => cost.items.length > 0)
    .map((cost) => {
      const top = cost.items.slice(0, 3).map((item) => `${item.source} ~${item.tokens}`).join(', ');
      return {
        area: /** @type {const} */ ('context'),
        message: `${cost.tool}: ~${cost.totalTokens} tokens always on; largest: ${top}`,
        action: `shorten ${cost.items[0].source}, or move its detail into a skill body or a path-scoped rule that loads on demand`,
      };
    });
  return { context, findings };
}

/**
 * @param {{ state: string, now: number }} options
 * @returns {{ hookErrors: Record<string, number>, findings: IFinding[] }}
 */
export function checkHooks({ state, now }) {
  const recent = readJsonl(join(state, 'hook-errors.jsonl')).filter((entry) => now - entryTime(entry) <= HOOK_ERROR_WINDOW_DAYS * DAY_MS);
  /** @type {Record<string, number>} */
  const hookErrors = Object.fromEntries(
    [...new Set(recent.map((entry) => String(entry.hook ?? 'unknown')))].map((hook) => [hook, recent.filter((entry) => String(entry.hook ?? 'unknown') === hook).length]),
  );
  const findings = Object.entries(hookErrors).map(([hook, count]) => {
    const latest = recent.filter((entry) => String(entry.hook ?? 'unknown') === hook).at(-1);
    return {
      area: /** @type {const} */ ('hooks'),
      message: `${hook} failed ${count} time(s) in ${HOOK_ERROR_WINDOW_DAYS} days; latest: ${String(latest?.message ?? '').slice(0, 160)}`,
      action: `the hook fails open, so its job was skipped each time; replay a captured payload into ${hook}.mjs on stdin and fix the cause`,
    };
  });
  return { hookErrors, findings };
}

/**
 * @param {{ state: string, now: number }} options
 * @returns {{ verifyFailures: Array<{ repo: string, check: string, count: number }>, findings: IFinding[] }}
 */
export function checkVerification({ state, now }) {
  const recent = readJsonl(join(state, 'verify-failures.jsonl')).filter((entry) => now - entryTime(entry) <= VERIFY_FAILURE_WINDOW_DAYS * DAY_MS);
  const key = (/** @type {Record<string, unknown>} */ entry) => `${String(entry.repo ?? 'unknown')}\t${String(entry.check ?? 'unknown')}`;
  const verifyFailures = [...new Set(recent.map(key))]
    .map((pair) => {
      const [repo, check] = pair.split('\t');
      return { repo, check, count: recent.filter((entry) => key(entry) === pair).length };
    })
    .sort((a, b) => b.count - a.count);
  const findings = verifyFailures.map(({ repo, check, count }) => ({
    area: /** @type {const} */ ('verification'),
    message: `${repo}: check "${check}" failed ${count} time(s) in ${VERIFY_FAILURE_WINDOW_DAYS} days`,
    action: 'if the same failure repeats, the agent is not learning from it: fix the check command with the verify-contract skill, or add the lesson to memory with memory-distill',
  }));
  return { verifyFailures, findings };
}

/**
 * @param {{ home: string, now: number }} options
 * @returns {{ memory: IMemoryDir[], findings: IFinding[] }}
 */
export function checkMemory({ home, now }) {
  const projects = join(home, '.claude', 'projects');
  const memory = listDir(projects)
    .map((project) => ({ project, dir: join(projects, project, 'memory') }))
    .map(({ project, dir }) => ({ project, dir, files: listDir(dir).filter((name) => name.endsWith('.md')) }))
    .filter(({ files }) => files.length > 0)
    .map(({ project, dir, files }) => {
      const index = readText(join(dir, 'MEMORY.md'));
      const linked = new Set([...index.matchAll(/\]\(([^)\s]+)\)/g)].map((link) => basename(link[1])));
      return {
        project,
        files: files.length,
        indexLines: index === '' ? 0 : index.split('\n').filter(Boolean).length,
        orphans: files.filter((name) => name !== 'MEMORY.md' && !linked.has(name)).sort(),
        stale: files.filter((name) => now - statSync(join(dir, name)).mtimeMs > STALE_MEMORY_DAYS * DAY_MS).sort(),
      };
    });

  const findings = memory.flatMap((entry) => [
    ...(entry.orphans.length > 0
      ? [{ area: /** @type {const} */ ('memory'), message: `${entry.project}: ${entry.orphans.length} file(s) not linked from MEMORY.md: ${entry.orphans.join(', ')}`, action: 'link each from MEMORY.md or delete it; an unlinked memory file is never read' }]
      : []),
    ...(entry.indexLines > MEMORY_INDEX_MAX_LINES
      ? [{ area: /** @type {const} */ ('memory'), message: `${entry.project}: MEMORY.md has ${entry.indexLines} lines`, action: `merge or drop entries; lines past ${MEMORY_INDEX_MAX_LINES} are cut from every session` }]
      : []),
    ...(entry.stale.length > 0
      ? [{ area: /** @type {const} */ ('memory'), message: `${entry.project}: ${entry.stale.length} file(s) untouched for ${STALE_MEMORY_DAYS}+ days: ${entry.stale.join(', ')}`, action: 'reread them; delete what is no longer true, since stale memory steers sessions as firmly as current memory' }]
      : []),
  ]);
  return { memory, findings };
}

/**
 * @param {{ repo?: string, home?: string, state?: string, now?: number }} [options]
 * @returns {ICheckupReport}
 */
export function runCheckup({ repo = repoHome(), home = homedir(), state, now = Date.now() } = {}) {
  // Resolved by hand rather than through stateDir(), which creates the directory: the checkup writes nothing.
  const stateRoot = state ?? process.env.AI_ESSENTIALS_STATE ?? join(home, '.ai-essentials', 'state');
  const skills = checkSkills({ repo, state: stateRoot, now });
  const context = checkContext({ repo });
  const hooks = checkHooks({ state: stateRoot, now });
  const verification = checkVerification({ state: stateRoot, now });
  const memory = checkMemory({ home, now });
  return {
    skills: { logSpanDays: skills.logSpanDays, usage: skills.usage },
    context: context.context,
    hookErrors: hooks.hookErrors,
    verifyFailures: verification.verifyFailures,
    memory: memory.memory,
    findings: [...skills.findings, ...context.findings, ...hooks.findings, ...verification.findings, ...memory.findings],
  };
}

/**
 * @param {ICheckupReport} report
 * @returns {string}
 */
export function formatReport(report) {
  const usageWidth = Math.max(0, ...report.skills.usage.map((skill) => skill.name.length));
  const sections = [
    [
      `Skills (usage log spans ${report.skills.logSpanDays} day(s))`,
      ...report.skills.usage.map((skill) => `  ${skill.name.padEnd(usageWidth)}  ${String(skill.invocations).padStart(4)}  ${skill.lastUsed?.slice(0, 10) ?? 'never'}`),
    ],
    ['Always-on context (chars/4)', ...report.context.map((cost) => `  ${cost.tool.padEnd(7)} ~${cost.totalTokens} tokens from ${cost.items.length} source(s)`)],
    [`Hook errors (${HOOK_ERROR_WINDOW_DAYS} days)`, ...(Object.keys(report.hookErrors).length === 0 ? ['  none'] : Object.entries(report.hookErrors).map(([hook, count]) => `  ${hook}  ${count}`))],
    [
      `Verification failures (${VERIFY_FAILURE_WINDOW_DAYS} days)`,
      ...(report.verifyFailures.length === 0 ? ['  none'] : report.verifyFailures.map(({ repo, check, count }) => `  ${repo}  ${check}  ${count}`)),
    ],
    [
      'Memory',
      ...(report.memory.length === 0
        ? ['  no memory files']
        : report.memory.map((entry) => `  ${entry.project}  ${entry.files} file(s), MEMORY.md ${entry.indexLines} line(s), ${entry.orphans.length} unlinked, ${entry.stale.length} stale`)),
    ],
    [
      `Findings (${report.findings.length})`,
      ...report.findings.flatMap((finding) => [`  [${finding.area}] ${finding.message}`, `      action: ${finding.action}`]),
    ],
  ];
  return `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}

/**
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const report = runCheckup({ repo: flagValue('--repo'), home: flagValue('--home') });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
}
