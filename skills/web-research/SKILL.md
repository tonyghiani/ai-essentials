---
name: web-research
description: Load this before the first web search whenever the user asks to research a topic, look online, find best practices, survey the state of the art or compare approaches, instead of searching directly. Researches the question on the web and returns a cited report. Finds the perspectives that disagree about the question, has one agent per perspective search and read primary sources in parallel, writes the answer, then has a fresh agent check every claim against the page it came from and drops what it cannot trace. Triggers: "research", "look online", "find best practices for", "what's the state of the art in", "compare X and Y" about something outside the codebase, and the brainstorm skill needing outside facts. A single factual lookup needs no skill. For understanding local code or docs, use deep-research instead.
effort: high
---

# Web research

Answer a question from sources you actually opened, and show where each claim came from. The method follows two published systems. Stanford's STORM finds the perspectives first and asks questions from each one, which surfaces what a single line of searching misses. Anthropic's research system adds a separate citation pass that checks claims against the fetched pages, not against the writer's memory of them.

## Depth

| Depth | When | Shape |
|---|---|---|
| quick | A factual question, or a brainstorm frame that needs a few facts | Inline, no agents: 3–6 searches, open the 2–4 best pages, short answer with sources |
| standard | The default | 3–5 perspective agents, citation pass |
| deep | The user asks for thorough, or the topic is contested or fast-moving | 5–7 perspective agents, two search rounds, citation pass |

Say the depth you picked and the agent count before fanning out.

## Where the report goes

Inside a brainstorm session, write `research.md` in that session's folder. Otherwise write `${AI_BRAINSTORMS_DIR:-$HOME/brainstorms}/research/<YYYY-MM-DD>-<slug>.md`. Never into a repo. Keep the agents' notes beside the report as `<slug>.notes.md`; the citation pass needs them.

## Step 1: Scope

Restate the question in one sentence, plus what the answer will be used for and how recent the sources must be. Ask only when the question is ambiguous enough to send the search the wrong way; otherwise state your reading and continue.

## Step 2: Perspectives

Run 2–3 broad searches and skim the results to find who disagrees about this: schools of thought, roles (builder, operator, buyer, researcher), or camps. Pick 3–5 perspectives for standard depth, at least one of them critical of the mainstream view. For each, write 3–5 questions that perspective would ask. List them to the user in a few lines and carry on unless they object.

## Step 3: Search in parallel

One agent per perspective, in parallel, fresh context. In Claude Code: one message, one Agent call each, `effort: "lower"`. The brief carries the question, that perspective and its questions, today's date and the recency requirement, and this:

```
Find answers to these questions on the web. Rules:
- Prefer primary sources: papers, official docs, the engineering blog of the team that built the thing, release notes, datasets.
  Use aggregators, listicles and secondary write-ups only to find the primary source, then open that.
- Open a page before citing it. A search snippet is not a source.
- Put the year in queries about anything that changes fast.
- Stop at about 12 searches.

Return notes only, no prose report. One block per claim:
- claim: <one sentence>
- source: <URL you opened>
- quote: <the sentence or two on the page that supports it, verbatim>
- date: <publication date, or "undated">
- kind: primary | secondary
End with: questions you could not answer, and why.
```

For deep depth, read the first round's unanswered questions and run a second, smaller round on them.

Merge every agent's notes into `<slug>.notes.md`.

## Step 4: Write

Write the report from the notes, not from what you remember of the topic:

1. **Answer**: the direct answer in one paragraph.
2. **Findings**: organised by question, not by perspective. Each claim carries a numbered citation `[n]`.
3. **Where sources disagree**: who says what, and what evidence would settle it.
4. **Unknowns**: what the search could not establish.
5. **Sources**: numbered, with title, URL, date, and `primary` or `secondary`.

Mark any claim that rests on a single secondary source as such in the sentence itself.

## Step 5: Citation pass

A fresh agent, standard tier, gets the report path and the notes path and nothing else:

```
For every [n] citation in the report, check the claim against the quote in the notes for that source, and open the URL
when the quote is missing or does not plainly support the claim. Return one line per citation:
SUPPORTED, OVERSTATED (say what the source actually supports) or UNSUPPORTED. Then list every factual sentence
that carries no citation.
```

Fix the report: drop UNSUPPORTED claims, soften OVERSTATED ones to what the source supports, and cite or drop uncited factual sentences. Put the count at the top of the report: `Citation check: 31 supported, 3 softened, 2 dropped.`

## Step 6: Hand back

In chat: the report path, the one-paragraph answer, and the top three findings with links. Not the whole report.

## Gotchas

- Search tools often return a summary along with the links. Treat the summary as a lead, never as a source: it misdates things and merges claims from different pages.
- arXiv IDs, version numbers and benchmark figures copied from secondary pages are often wrong. Cite them only from the primary page.
- "Recent" is relative to today's date, which goes in every brief. A 2023 post about a fast-moving tool is history, not the state of the art.
- Perspective agents told the answer you expect come back confirming it. The brief carries the questions, never your hypothesis.
- Five agents that each read the same top three results add cost without adding coverage. If the notes cite the same handful of URLs, the perspectives were too close; widen them next time.
