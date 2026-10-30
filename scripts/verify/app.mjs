/**
 * Find, start and stop the app a repo's verification contract describes, so a
 * change can be checked in the running app and not only through its tests.
 *
 * A developer usually has the app running already, often from another checkout
 * of the same repo. Starting a second copy wastes minutes and fights it for the
 * port, and a copy from the wrong checkout shows code without the change. So
 * status works out who owns whatever answers before anything starts:
 *
 *   running-here       a process whose working directory is in this checkout;
 *                      reuse it, it serves this branch's code
 *   running-elsewhere  a process from another checkout or worktree of the same
 *                      repo; it does not show this change, but it is a baseline
 *                      for a before and after comparison
 *   running-unknown    something answers, owner unknown; report it, never stop it
 *   stopped            nothing answers and nothing listens on the app's ports
 *   not-configured     no usable contract or no "app" block in it
 *
 * Stop only ever stops an instance this module started, recorded by checkout.
 *
 * @typedef {'here' | 'elsewhere' | 'unknown'} TOwner
 * @typedef {{ pid: number, port: number, owner: TOwner, cwd: string | null, checkout: string | null, branch: string | null, startedByTool: boolean }} IListener
 * @typedef {{ url: string, reachable: boolean, ready: boolean, httpStatus: number | null, error: string | null }} IProbe
 * @typedef {{ pid: number, port: number | null, readyUrl: string | null, log: string, startedAt: string, cmd: string[] }} IStartedRecord
 * @typedef {{ status: 'not-configured', reason: string, hint: string }} INotConfigured
 * @typedef {{
 *   status: 'running-here' | 'running-elsewhere' | 'running-unknown' | 'stopped',
 *   root: string,
 *   branch: string | null,
 *   url: string | null,
 *   probe: IProbe | null,
 *   listeners: IListener[],
 *   baseline: IListener | null,
 *   startedByTool: IStartedRecord | null,
 *   advice: string,
 *   notes: string[],
 * }} IAppStatus
 * @typedef {INotConfigured
 *   | { status: 'refused', reason: string, current: IAppStatus | null }
 *   | { status: 'started', pid: number, readyUrl: string | null, ready: boolean | null, readyAfterSec: number | null, log: string, notes: string[] }
 *   | { status: 'start-failed' | 'start-timeout', reason: string, pid: number | null, log: string, logTail: string }} IAppStartResult
 * @typedef {{ status: 'stopped' | 'already-exited', pid: number, log: string }
 *   | { status: 'not-started-by-tool', reason: string }} IAppStopResult
 */

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from '../lib/hook_io.mjs';
import { git, repoKey, repoRoot } from '../lib/repo.mjs';
import { readJson, stateDir, updateJson } from '../lib/state.mjs';
import { appProblem, resolveContract } from './contract.mjs';

/** Short, so a status call on a stopped app returns in seconds, not a TCP timeout. */
const PROBE_TIMEOUT_MS = 2_000;
/** Dev servers that compile on start take minutes; the contract can raise it. */
const READY_TIMEOUT_SEC = 180;
const READY_POLL_MS = 1_000;
const STOP_GRACE_MS = 10_000;
const STOP_POLL_MS = 100;
const LOG_TAIL_LINES = 30;
const INSTANCES_FILE = 'app-instances.json';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);
const NOT_CONFIGURED_HINT =
  'Add an "app" block (run, url, ready, ports) to this repo\'s verification contract with the verify-contract skill.';

/**
 * @param {string} reason
 * @returns {INotConfigured}
 */
function notConfigured(reason) {
  return { status: 'not-configured', reason, hint: NOT_CONFIGURED_HINT };
}

/**
 * @param {string} cwd
 * @returns {{ root: string, app: import('./contract.mjs').IAppConfig } | INotConfigured}
 */
function loadApp(cwd) {
  const root = repoRoot(cwd);
  if (root === null) {
    return notConfigured('not inside a git repository');
  }
  const resolved = resolveContract(root);
  if (resolved.status === 'none') {
    return notConfigured('no verification contract for this repo');
  }
  if (resolved.status === 'untrusted') {
    return notConfigured(`${resolved.path} is not trusted; review it, then run: ai-verify --trust`);
  }
  if (resolved.status === 'invalid') {
    return notConfigured(`${resolved.path}: ${resolved.reason}`);
  }
  if (resolved.contract.app === undefined) {
    return notConfigured(`${resolved.path} has no "app" block`);
  }
  const problem = appProblem(resolved.contract.app);
  if (problem !== null) {
    return notConfigured(`${resolved.path}: ${problem}`);
  }
  return { root, app: resolved.contract.app };
}

/**
 * @param {string} url
 * @param {number} port
 * @returns {string}
 */
function withPort(url, port) {
  const parsed = new URL(url);
  parsed.port = String(port);
  return parsed.toString();
}

/**
 * Joined by hand rather than with new URL(path, base): that drops a base path
 * such as /app, and apps served under one are common.
 *
 * @param {import('./contract.mjs').IAppConfig} app
 * @param {number} [port] Overrides the contract's port, for an instance started beside another.
 * @returns {string | null}
 */
export function readyUrl(app, port) {
  const base = app.url === undefined ? undefined : port === undefined ? app.url : withPort(app.url, port);
  if (app.ready === undefined) {
    return base ?? null;
  }
  if (app.ready.startsWith('/')) {
    return base === undefined ? null : `${base.replace(/\/$/, '')}${app.ready}`;
  }
  return port === undefined ? app.ready : withPort(app.ready, port);
}

/**
 * @param {string | undefined} url
 * @returns {number | null} The port of a URL on this machine; a remote one has nothing to look up.
 */
function localPort(url) {
  if (url === undefined) {
    return null;
  }
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    return null;
  }
  return parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port);
}

/**
 * @param {import('./contract.mjs').IAppConfig} app
 * @returns {number[]}
 */
function appPorts(app) {
  const fromUrls = [localPort(app.url), localPort(app.ready?.startsWith('/') ? undefined : app.ready)];
  return [...new Set([...(app.ports ?? []), ...fromUrls.filter((port) => port !== null)])];
}

/**
 * Any HTTP answer means something is there; only 2xx or 3xx means it is ready.
 * Redirects are not followed: a login redirect still proves the app is up.
 *
 * @param {string} url
 * @returns {Promise<IProbe>}
 */
export async function probe(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await response.body?.cancel();
    return { url, reachable: true, ready: response.status >= 200 && response.status < 400, httpStatus: response.status, error: null };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    return { url, reachable: false, ready: false, httpStatus: null, error: cause ?? (error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * @param {string[]} args
 * @returns {{ available: boolean, stdout: string }} available is false when lsof is not installed.
 */
function lsof(args) {
  const result = spawnSync('lsof', args, { encoding: 'utf8' });
  if (result.error !== undefined) {
    return { available: false, stdout: '' };
  }
  // lsof exits 1 when nothing matches, which here just means no listener.
  return { available: true, stdout: result.stdout ?? '' };
}

/**
 * @param {number} port
 * @returns {number[]} Pids listening on the TCP port.
 */
function listeningPids(port) {
  const lines = lsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']).stdout.split('\n');
  return [...new Set(lines.filter((line) => line.startsWith('p')).map((line) => Number(line.slice(1))))];
}

/**
 * @param {number} pid
 * @returns {string | null} The process's working directory, or null when it is not readable.
 */
function processCwd(pid) {
  const line = lsof(['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).stdout.split('\n').find((entry) => entry.startsWith('n'));
  if (line !== undefined) {
    return line.slice(1);
  }
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch (error) {
    return null;
  }
}

/**
 * @param {string} dir
 * @returns {string | null} The repo's shared .git directory, the same for every worktree of it.
 */
function commonDir(dir) {
  const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common === null) {
    return null;
  }
  try {
    return realpathSync(common);
  } catch (error) {
    return common;
  }
}

/**
 * @param {string} checkout
 * @returns {string | null} The branch, or the short commit when HEAD is detached.
 */
function branchOf(checkout) {
  const branch = git(checkout, ['branch', '--show-current']);
  return branch === null || branch === '' ? git(checkout, ['rev-parse', '--short', 'HEAD']) : branch;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * @param {number} pid
 * @returns {number | null}
 */
function processGroup(pid) {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  const pgid = Number(result.stdout?.trim());
  return result.status === 0 && Number.isInteger(pgid) ? pgid : null;
}

/**
 * Pids are reused, and after a reboot a recorded one can belong to anything.
 * Requiring the process to still run from this checkout keeps stop from
 * signalling a stranger.
 *
 * @param {number} pid
 * @param {string} root
 * @returns {boolean}
 */
function runsFrom(pid, root) {
  const cwd = isAlive(pid) ? processCwd(pid) : null;
  return cwd !== null && repoRoot(cwd) === root;
}

/** How far the process's own start time may sit from the recorded one: spawn and record are a moment apart. */
const START_TIME_TOLERANCE_MS = 10_000;

/**
 * The recorded instance is still the process this tool started: alive, in
 * this checkout, and started when the record says. Without the start time a
 * pid reused after a reboot or a wrap (the user's shell, their own dev server
 * in the same checkout) would pass, and stop would signal it.
 *
 * @param {IStartedRecord} record
 * @param {string} root
 * @returns {boolean}
 */
function isOurInstance(record, root) {
  if (!runsFrom(record.pid, root)) {
    return false;
  }
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(record.pid)], { encoding: 'utf8' });
  const started = Date.parse(result.status === 0 ? result.stdout.trim() : '');
  // An unreadable start time is treated as "not ours": refusing to stop is the safe mistake.
  return Number.isFinite(started) && Math.abs(started - Date.parse(record.startedAt)) <= START_TIME_TOLERANCE_MS;
}

/**
 * @param {string} root
 * @returns {IStartedRecord | null}
 */
function recordFor(root) {
  const all = readJson(INSTANCES_FILE, {});
  const record = isRecord(all) ? all[root] : undefined;
  return isRecord(record) && typeof record.pid === 'number' ? /** @type {IStartedRecord} */ (record) : null;
}

/** @param {string} root */
function forget(root) {
  updateJson(INSTANCES_FILE, {}, (all) => {
    const { [root]: removed, ...rest } = all;
    return rest;
  });
}

/**
 * @param {{ pid: number, port: number, root: string, common: string | null, started: IStartedRecord | null }} options
 * @returns {IListener}
 */
function describeListener({ pid, port, root, common, started }) {
  const cwd = processCwd(pid);
  const checkout = cwd === null ? null : repoRoot(cwd);
  // Same repo means a worktree sharing the git directory, or a separate clone of the same origin
  // (the key contracts are looked up by): either is a valid baseline for this checkout.
  const sameRepo = checkout !== null && ((common !== null && commonDir(checkout) === common) || repoKey(checkout) === repoKey(root));
  const owner = checkout === root ? 'here' : sameRepo ? 'elsewhere' : 'unknown';
  const startedByTool = started !== null && (pid === started.pid || processGroup(pid) === started.pid);
  return { pid, port, owner, cwd, checkout, branch: owner === 'unknown' || checkout === null ? null : branchOf(checkout), startedByTool };
}

/** @type {Record<IAppStatus['status'], (status: Omit<IAppStatus, 'advice'>) => string>} */
const ADVICE = {
  'running-here': () =>
    'Reuse it: it runs from this checkout. Make sure hot reload or the rebuild has picked up the latest edit before you test.',
  'running-elsewhere': ({ baseline }) =>
    `It runs from ${baseline?.checkout} (${baseline?.branch}), so it does not show this change. Use it as the baseline; to see the change, start this checkout beside it with ai-verify --app-start --force-new --port <free port>, or ask the user.`,
  'running-unknown': () => 'Something answers, but not from a checkout of this repo that could be identified. Never stop it; ask the user what it is.',
  stopped: () => 'Nothing is running. Start this checkout with ai-verify --app-start.',
};

/**
 * Work out whether the app is up, and which checkout it serves.
 *
 * @param {{ cwd: string }} options
 * @returns {Promise<IAppStatus | INotConfigured>}
 */
export async function appStatus({ cwd }) {
  const loaded = loadApp(cwd);
  if ('status' in loaded) {
    return loaded;
  }
  const { root, app } = loaded;
  const stored = recordFor(root);
  const started = stored !== null && isOurInstance(stored, root) ? stored : null;
  // An instance this tool started (perhaps with --force-new on another port) is the one that shows
  // this checkout's code. Probing the contract URL instead would test the baseline and call it "after".
  const url = started?.readyUrl ?? readyUrl(app);
  const probed = url === null ? null : await probe(url);
  const common = commonDir(root);
  const ports = [...new Set([...appPorts(app), ...(typeof started?.port === 'number' ? [started.port] : [])])];
  const listeners = ports.flatMap((port) =>
    listeningPids(port).map((pid) => describeListener({ pid, port, root, common, started })),
  );

  const notes = [
    ...(lsof(['-v']).available ? [] : ['lsof is not installed, so listening processes could not be identified']),
    ...(ports.length === 0 ? ['no local port in app.url or app.ports, so only the URL probe ran'] : []),
    ...(stored !== null && started === null ? [`a recorded instance (pid ${stored.pid}) is gone; its record was dropped`] : []),
  ];
  if (stored !== null && started === null) {
    forget(root);
  }

  const byOwner = (owner) => listeners.find((listener) => listener.owner === owner) ?? null;
  const status =
    byOwner('here') !== null || started !== null
      ? 'running-here'
      : byOwner('elsewhere') !== null
        ? 'running-elsewhere'
        : byOwner('unknown') !== null || probed?.reachable === true
          ? 'running-unknown'
          : 'stopped';
  const result = {
    status,
    root,
    branch: branchOf(root),
    url,
    probe: probed,
    listeners,
    // Kept when this checkout also runs (started beside it on another port): that is the before/after case.
    baseline: byOwner('elsewhere'),
    startedByTool: started,
    notes,
  };
  return { ...result, advice: ADVICE[status](result) };
}

/**
 * @param {string} log
 * @returns {string}
 */
function logTail(log) {
  try {
    return readFileSync(log, 'utf8').trimEnd().split('\n').slice(-LOG_TAIL_LINES).join('\n');
  } catch (error) {
    return '';
  }
}

/**
 * Start this checkout's app, unless an instance of it already runs. Another
 * checkout's instance blocks a start on the same address; forceNew with a
 * free port starts this one beside it, passing the port as a `{port}` argv
 * element and as PORT in the environment.
 *
 * @param {{ cwd: string, forceNew?: boolean, port?: number }} options
 * @returns {Promise<IAppStartResult>}
 */
export async function appStart({ cwd, forceNew = false, port }) {
  const loaded = loadApp(cwd);
  if ('status' in loaded) {
    return loaded;
  }
  const { root, app } = loaded;
  const current = await appStatus({ cwd });
  if (current.status === 'not-configured') {
    return current;
  }
  if (current.status === 'running-here') {
    return { status: 'refused', reason: 'an instance of this checkout is already running; reuse it', current };
  }
  if (!Array.isArray(app.run)) {
    const reason =
      app.run === undefined
        ? 'the contract has no app.run, so there is nothing to start'
        : 'app.run is a shell string; rewrite it as an argv array (the verify-contract skill) so it can run without a shell';
    return { status: 'refused', reason, current };
  }
  if (current.status !== 'stopped' && !forceNew) {
    return {
      status: 'refused',
      reason: `the app's address is taken (${current.status}); pass --force-new --port <free port> to start this checkout beside it`,
      current,
    };
  }
  if (forceNew && port === undefined) {
    return { status: 'refused', reason: '--force-new needs --port <free port>', current };
  }
  if (port !== undefined && listeningPids(port).length > 0) {
    return { status: 'refused', reason: `port ${port} is already in use`, current };
  }

  const effectivePort = port ?? appPorts(app)[0] ?? null;
  if (effectivePort === null && app.run.includes('{port}')) {
    return { status: 'refused', reason: 'app.run has a {port} element, but neither --port, app.url nor app.ports gives a port', current };
  }
  const notes = port !== undefined && !app.run.includes('{port}')
    ? ['app.run has no {port} element, so the port reached the app only through the PORT environment variable']
    : [];
  const [command, ...args] = app.run.map((part) =>
    part.replaceAll('{root}', root).replaceAll('{port}', String(effectivePort)),
  );
  const logDir = join(stateDir(), 'app-logs');
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${root.replace(/^\//, '').replaceAll('/', '__')}.log`);
  const fd = openSync(log, 'w');
  // Detached into its own process group, so stop can end the dev server's children with it.
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...(effectivePort === null ? {} : { PORT: String(effectivePort) }) },
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const spawnError = await new Promise((resolve) => {
    child.once('spawn', () => resolve(null));
    child.once('error', resolve);
  });
  closeSync(fd);
  if (spawnError !== null || child.pid === undefined) {
    return { status: 'start-failed', reason: `could not run ${command}: ${spawnError?.message ?? 'no pid'}`, pid: null, log, logTail: logTail(log) };
  }
  child.unref();
  const pid = child.pid;
  const target = readyUrl(app, port);
  const startedAt = Date.now();
  /** @type {IStartedRecord} */
  const record = { pid, port: effectivePort, readyUrl: target, log, startedAt: new Date(startedAt).toISOString(), cmd: [command, ...args] };
  updateJson(INSTANCES_FILE, {}, (all) => ({ ...all, [root]: record }));

  if (target === null) {
    return { status: 'started', pid, readyUrl: null, ready: null, readyAfterSec: null, log, notes: [...notes, 'no app.url or app.ready, so readiness was not checked'] };
  }
  const deadline = startedAt + (app.readyTimeoutSec ?? READY_TIMEOUT_SEC) * 1_000;
  // A loop because each attempt waits for the previous probe and a pause.
  for (;;) {
    if ((await probe(target)).ready) {
      return { status: 'started', pid, readyUrl: target, ready: true, readyAfterSec: Math.round((Date.now() - startedAt) / 1_000), log, notes };
    }
    if (exited || !isAlive(pid)) {
      forget(root);
      return { status: 'start-failed', reason: 'the app exited before it was ready', pid, log, logTail: logTail(log) };
    }
    if (Date.now() > deadline) {
      return {
        status: 'start-timeout',
        reason: `not ready after ${app.readyTimeoutSec ?? READY_TIMEOUT_SEC}s and still running; check the log, then wait with ai-verify --app-status or end it with ai-verify --app-stop`,
        pid,
        log,
        logTail: logTail(log),
      };
    }
    await delay(READY_POLL_MS);
  }
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    process.kill(pid, signal);
  }
}

/**
 * Stop the instance this tool started for this checkout. An instance it found
 * running belongs to someone else, so it is never touched.
 *
 * @param {{ cwd: string }} options
 * @returns {Promise<IAppStopResult | INotConfigured>}
 */
export async function appStop({ cwd }) {
  const root = repoRoot(cwd);
  if (root === null) {
    return notConfigured('not inside a git repository');
  }
  const record = recordFor(root);
  if (record === null) {
    return { status: 'not-started-by-tool', reason: 'no instance started by ai-verify --app-start for this checkout; one found running is never stopped' };
  }
  if (!isOurInstance(record, root)) {
    forget(root);
    return { status: 'already-exited', pid: record.pid, log: record.log };
  }
  signalGroup(record.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS;
  // A loop because the process gets a grace period before SIGKILL.
  while (isAlive(record.pid) && Date.now() < deadline) {
    await delay(STOP_POLL_MS);
  }
  if (isAlive(record.pid)) {
    signalGroup(record.pid, 'SIGKILL');
  }
  forget(root);
  return { status: 'stopped', pid: record.pid, log: record.log };
}
