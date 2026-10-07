#!/usr/bin/env python3
"""Combine Codex metadata with the shared Markdown agent prompts."""

import json
from pathlib import Path
import re
import sys


def render_agents(repo: Path, destination: Path) -> None:
    """Write native Codex agents without interpreting Cursor/Claude YAML fields."""
    for source in sorted((repo / "agents").glob("*.md")):
        metadata = repo / "codex" / "agents" / f"{source.stem}.toml"
        if not metadata.is_file():
            raise ValueError(f"Missing Codex metadata: {metadata}")

        match = re.fullmatch(r"---\n.*?\n---\n(.*)", source.read_text(), re.DOTALL)
        if match is None:
            raise ValueError(f"Missing agent frontmatter: {source}")

        # JSON string escaping also produces a TOML basic string. This preserves
        # code fences, backslashes, and quote sequences inside the original prompt.
        instructions = json.dumps(match.group(1).strip(), ensure_ascii=False)
        output = (
            f"# Generated from agents/{source.name}; re-run setup/install.sh --codex.\n"
            f"{metadata.read_text().rstrip()}\n"
            f"developer_instructions = {instructions}\n"
        )
        (destination / metadata.name).write_text(output)


if __name__ == "__main__":
    render_agents(Path(sys.argv[1]), Path(sys.argv[2]))
