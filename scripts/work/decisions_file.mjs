/**
 * Parse and serialize the decision policy (policy/decisions.local.md).
 *
 * The file is Markdown so it stays readable and hand-editable, but its shape is
 * strict enough to round-trip: `### D-nnn title` blocks of `- key: value`
 * bullets under `## Precedents`, and a `## Gate` table. Anything before the
 * first `## Precedents` heading is kept verbatim as the preamble.
 *
 * @typedef {{
 *   id: string, title: string, class: string, situation: string, decision: string,
 *   why: string, scope: string, confirmations: number, lastConfirmed: string, contradicted: string,
 *   record?: string
 * }} IPrecedent
 * @typedef {{ class: string, count: number, gate: 'on' | 'off' }} IGateRow
 * @typedef {{ preamble: string, precedents: IPrecedent[], gate: IGateRow[] }} IDecisionFile
 */

const PRECEDENTS_HEADING = '## Precedents';
const GATE_HEADING = '## Gate';
// `record` is optional: the path of the ADR a brainstorm wrote for the decision.
const FIELD_ORDER = ['class', 'situation', 'decision', 'why', 'scope', 'confirmations', 'last-confirmed', 'contradicted', 'record'];

/**
 * @param {string} text
 * @returns {IDecisionFile}
 */
export function parseDecisions(text) {
  // Headings are matched at line start: the preamble may mention them in prose.
  const precedentsStart = text.search(/^## Precedents\s*$/m);
  const gateStart = text.search(/^## Gate\s*$/m);
  const preamble = precedentsStart === -1 ? text : text.slice(0, precedentsStart);
  const precedentsText =
    precedentsStart === -1 ? '' : text.slice(precedentsStart + PRECEDENTS_HEADING.length, gateStart === -1 ? undefined : gateStart);
  const gateText = gateStart === -1 ? '' : text.slice(gateStart + GATE_HEADING.length);

  const precedents = precedentsText
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [heading, ...lines] = block.split('\n');
      const [id, ...titleWords] = heading.trim().split(/\s+/);
      /** @type {Record<string, string>} */
      const fields = {};
      for (const line of lines) {
        const match = /^- ([a-z-]+):\s*(.*)$/.exec(line);
        if (match !== null) {
          fields[match[1]] = match[2].trim().replace(/^`(.*)`$/, '$1');
        }
      }
      return {
        id,
        title: titleWords.join(' '),
        class: fields.class ?? '',
        situation: fields.situation ?? '',
        decision: fields.decision ?? '',
        why: fields.why ?? '',
        scope: fields.scope ?? 'global',
        confirmations: Number.parseInt(fields.confirmations ?? '0', 10) || 0,
        lastConfirmed: fields['last-confirmed'] ?? '',
        contradicted: fields.contradicted ?? 'no',
        ...(fields.record === undefined ? {} : { record: fields.record }),
      };
    });

  const gate = gateText
    .split('\n')
    .map((line) => /^\|\s*([a-z-]+)\s*\|\s*(\d+)\s*\|\s*(on|off)\s*\|/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ class: match[1], count: Number.parseInt(match[2], 10), gate: /** @type {'on' | 'off'} */ (match[3]) }));

  return { preamble, precedents, gate };
}

/**
 * @param {IDecisionFile} file
 * @returns {string}
 */
export function serializeDecisions({ preamble, precedents, gate }) {
  const blocks = precedents.map((precedent) => {
    const values = {
      class: `\`${precedent.class}\``,
      situation: precedent.situation,
      decision: precedent.decision,
      why: precedent.why,
      scope: precedent.scope,
      confirmations: String(precedent.confirmations),
      'last-confirmed': precedent.lastConfirmed,
      contradicted: precedent.contradicted,
      record: precedent.record,
    };
    const bullets = FIELD_ORDER.filter((key) => values[key] !== undefined)
      .map((key) => `- ${key}: ${values[key]}`)
      .join('\n');
    return `### ${precedent.id} ${precedent.title}\n${bullets}\n`;
  });
  const rows = gate.map((row) => `| ${row.class} | ${row.count} | ${row.gate} |`).join('\n');
  return `${preamble.trimEnd()}\n\n${PRECEDENTS_HEADING}\n\n${blocks.join('\n')}\n${GATE_HEADING}\n\n| class | consecutive-approved-unedited | gate |\n|---|---|---|\n${rows}\n`;
}

/**
 * @param {string} alwaysAskText Contents of the tech-lead skill's always-ask.md.
 * @returns {Set<string>} Class names from the table's first column.
 */
export function parseAlwaysAsk(alwaysAskText) {
  return new Set([...alwaysAskText.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map((match) => match[1]));
}
