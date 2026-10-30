#!/usr/bin/env python3
"""Render the shared agent sources in agents/*.md into one tool's native format.

Usage: render_agents.py <repo> <claude|cursor|codex> <output-dir>

Agents with `access:` and `tier:` frontmatter are neutral: the constraint is
written once and translated per tool, so a read-only reviewer is read-only in
Claude Code, Cursor and Codex alike. Agents without `access:` are legacy and
pass through the way they always have (Claude and Cursor read the file as is;
Codex pairs it with codex/agents/<name>.toml metadata).

    access: read-only | edit | shell
    tier:   fast | standard | strong   (mapped per tool by agents/models.json)
    effort: low | medium | high | xhigh | max   (optional; Claude only, the others have no per-agent effort)
"""

import json
import re
import sys
from pathlib import Path

TOOLS = ("claude", "cursor", "codex")

CLAUDE_TOOLS = {
    "read-only": "Read, Grep, Glob",
    "edit": "Read, Grep, Glob, Edit, Write",
    "shell": "Read, Grep, Glob, Edit, Write, Bash",
}
CODEX_SANDBOX = {
    "read-only": "read-only",
    "edit": "workspace-write",
    "shell": "workspace-write",
}
NEUTRAL_KEYS = ("name", "description", "access", "tier")
EFFORTS = ("low", "medium", "high", "xhigh", "max")


def parse_agent(text: str, source: str) -> tuple[dict[str, str], str]:
    """Split an agent file into frontmatter fields and body.

    Supports `key: value` and folded `key: >-` blocks, which is all the agent
    files use. A full YAML parser would add a dependency for no gain.
    """
    match = re.fullmatch(r"---\n(.*?)\n---\n(.*)", text, re.DOTALL)
    if match is None:
        raise ValueError(f"Missing agent frontmatter: {source}")

    fields: dict[str, str] = {}
    key = None
    for line in match.group(1).split("\n"):
        pair = re.fullmatch(r"([A-Za-z_][\w-]*):\s*(.*)", line)
        if pair is not None and not line.startswith(" "):
            key, value = pair.group(1), pair.group(2).strip()
            fields[key] = "" if value in (">-", ">", "|") else value
        elif key is not None and line.startswith(" "):
            fields[key] = f"{fields[key]} {line.strip()}".strip()
    return fields, match.group(2)


def load_models(repo: Path) -> dict[str, dict[str, str | None]]:
    return json.loads((repo / "agents" / "models.json").read_text())


def validate_neutral(fields: dict[str, str], source: str) -> None:
    missing = [key for key in NEUTRAL_KEYS if not fields.get(key)]
    if missing:
        raise ValueError(f"{source}: missing {', '.join(missing)}")
    if fields["access"] not in CLAUDE_TOOLS:
        raise ValueError(f"{source}: access must be one of {', '.join(CLAUDE_TOOLS)}")
    if "effort" in fields and fields["effort"] not in EFFORTS:
        raise ValueError(f"{source}: effort must be one of {', '.join(EFFORTS)}")


def render_claude(fields: dict[str, str], body: str, models: dict) -> str:
    model = models[fields["tier"]]["claude"] or "inherit"
    effort = f"effort: {fields['effort']}\n" if "effort" in fields else ""
    return (
        "---\n"
        f"name: {fields['name']}\n"
        f"description: {json.dumps(fields['description'])}\n"
        f"tools: {CLAUDE_TOOLS[fields['access']]}\n"
        f"model: {model}\n"
        f"{effort}"
        "---\n" + body
    )


def render_cursor(fields: dict[str, str], body: str, models: dict) -> str:
    model = models[fields["tier"]]["cursor"] or "inherit"
    readonly = "true" if fields["access"] == "read-only" else "false"
    return (
        "---\n"
        f"name: {fields['name']}\n"
        f"description: {json.dumps(fields['description'])}\n"
        f"model: {model}\n"
        f"readonly: {readonly}\n"
        "---\n" + body
    )


def render_codex(fields: dict[str, str], body: str, models: dict) -> str:
    lines = [
        "# Generated file. Edit the agent definition and reinstall; changes here are overwritten.",
        f"name = {json.dumps(fields['name'])}",
        f"description = {json.dumps(fields['description'])}",
        f"sandbox_mode = {json.dumps(CODEX_SANDBOX[fields['access']])}",
    ]
    model = models[fields["tier"]]["codex"]
    if model:
        lines.append(f"model = {json.dumps(model)}")
    # JSON string escaping is also valid TOML basic-string escaping, so code
    # fences, backslashes and quotes in the prompt survive unchanged.
    lines.append(f"developer_instructions = {json.dumps(body.strip(), ensure_ascii=False)}")
    return "\n".join(lines) + "\n"


def render_legacy_codex(repo: Path, source: Path, body: str) -> str:
    metadata = repo / "codex" / "agents" / f"{source.stem}.toml"
    if not metadata.is_file():
        raise ValueError(f"Missing Codex metadata: {metadata}")
    instructions = json.dumps(body.strip(), ensure_ascii=False)
    return (
        "# Generated file. Edit the agent definition and reinstall; changes here are overwritten.\n"
        f"{metadata.read_text().rstrip()}\n"
        f"developer_instructions = {instructions}\n"
    )


def render_agents(repo: Path, tool: str, destination: Path) -> list[Path]:
    """Write every agent for one tool and return the files written."""
    if tool not in TOOLS:
        raise ValueError(f"Unknown tool: {tool}")
    models = load_models(repo)
    destination.mkdir(parents=True, exist_ok=True)
    renderers = {"claude": render_claude, "cursor": render_cursor, "codex": render_codex}
    extension = "toml" if tool == "codex" else "md"

    written = []
    for source in sorted((repo / "agents").glob("*.md")):
        text = source.read_text()
        fields, body = parse_agent(text, str(source))
        output = destination / f"{source.stem}.{extension}"
        if "access" in fields:
            validate_neutral(fields, str(source))
            output.write_text(renderers[tool](fields, body, models))
        elif tool == "codex":
            output.write_text(render_legacy_codex(repo, source, body))
        else:
            output.write_text(text)
        written.append(output)
    return written


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    render_agents(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]))
