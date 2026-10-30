import json
import tempfile
import tomllib
import unittest
from pathlib import Path

import render_agents

REPO = Path(__file__).resolve().parent.parent

NEUTRAL = """---
name: probe
description: >-
  First line of a folded
  description with: a colon.
access: read-only
tier: fast
---

Body with a "quote" and a \\ backslash.
"""

LEGACY = """---
name: legacy
model: inherit
tools: Bash, Read
description: Legacy agent.
---

Legacy body.
"""


def make_repo(root: Path, agents: dict[str, str], codex_metadata: dict[str, str] | None = None) -> Path:
    (root / "agents").mkdir(parents=True)
    (root / "agents" / "models.json").write_text((REPO / "agents" / "models.json").read_text())
    for name, text in agents.items():
        (root / "agents" / f"{name}.md").write_text(text)
    (root / "codex" / "agents").mkdir(parents=True)
    for name, text in (codex_metadata or {}).items():
        (root / "codex" / "agents" / f"{name}.toml").write_text(text)
    return root


class ParseAgentTest(unittest.TestCase):
    def test_folds_a_multi_line_description_into_one_line(self):
        fields, _ = render_agents.parse_agent(NEUTRAL, "probe.md")
        self.assertEqual(fields["description"], "First line of a folded description with: a colon.")

    def test_keeps_the_body_after_the_frontmatter(self):
        _, body = render_agents.parse_agent(NEUTRAL, "probe.md")
        self.assertIn('Body with a "quote"', body)

    def test_rejects_a_file_without_frontmatter(self):
        with self.assertRaises(ValueError):
            render_agents.parse_agent("no frontmatter", "bad.md")


class RenderNeutralAgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = make_repo(Path(self.tmp.name) / "repo", {"probe": NEUTRAL})
        self.out = Path(self.tmp.name) / "out"

    def tearDown(self):
        self.tmp.cleanup()

    def test_claude_gets_read_only_tools_and_the_fast_model(self):
        render_agents.render_agents(self.repo, "claude", self.out)
        text = (self.out / "probe.md").read_text()
        self.assertIn("tools: Read, Grep, Glob\n", text)
        self.assertIn("model: haiku\n", text)
        self.assertNotIn("Bash", text)

    def test_cursor_gets_readonly_true_and_inherits_the_model(self):
        render_agents.render_agents(self.repo, "cursor", self.out)
        text = (self.out / "probe.md").read_text()
        self.assertIn("readonly: true\n", text)
        self.assertIn("model: inherit\n", text)

    def test_codex_gets_a_read_only_sandbox_and_a_parseable_prompt(self):
        render_agents.render_agents(self.repo, "codex", self.out)
        parsed = tomllib.loads((self.out / "probe.toml").read_text())
        self.assertEqual(parsed["sandbox_mode"], "read-only")
        self.assertEqual(parsed["name"], "probe")
        self.assertIn('Body with a "quote" and a \\ backslash.', parsed["developer_instructions"])
        self.assertNotIn("model", parsed)

    def test_description_with_a_colon_stays_valid_yaml_in_claude_output(self):
        render_agents.render_agents(self.repo, "claude", self.out)
        line = next(
            line for line in (self.out / "probe.md").read_text().split("\n") if line.startswith("description:")
        )
        self.assertEqual(
            json.loads(line.removeprefix("description: ")),
            "First line of a folded description with: a colon.",
        )

    def test_claude_gets_the_effort_when_one_is_set(self):
        (self.repo / "agents" / "probe.md").write_text(NEUTRAL.replace("tier: fast\n", "tier: fast\neffort: high\n"))
        render_agents.render_agents(self.repo, "claude", self.out)
        self.assertIn("effort: high\n", (self.out / "probe.md").read_text())

    def test_rejects_an_unknown_effort(self):
        (self.repo / "agents" / "probe.md").write_text(NEUTRAL.replace("tier: fast\n", "tier: fast\neffort: huge\n"))
        with self.assertRaises(ValueError):
            render_agents.render_agents(self.repo, "claude", self.out)

    def test_rejects_an_unknown_access_level(self):
        (self.repo / "agents" / "probe.md").write_text(NEUTRAL.replace("read-only", "root"))
        with self.assertRaises(ValueError):
            render_agents.render_agents(self.repo, "claude", self.out)

    def test_rejects_an_unknown_tool(self):
        with self.assertRaises(ValueError):
            render_agents.render_agents(self.repo, "vim", self.out)


class RenderLegacyAgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = make_repo(
            Path(self.tmp.name) / "repo",
            {"legacy": LEGACY},
            {"legacy": 'name = "legacy"\ndescription = "Legacy."\nsandbox_mode = "read-only"\n'},
        )
        self.out = Path(self.tmp.name) / "out"

    def tearDown(self):
        self.tmp.cleanup()

    def test_claude_and_cursor_receive_the_file_unchanged(self):
        for tool in ("claude", "cursor"):
            render_agents.render_agents(self.repo, tool, self.out / tool)
            self.assertEqual((self.out / tool / "legacy.md").read_text(), LEGACY)

    def test_codex_pairs_the_body_with_the_existing_metadata(self):
        render_agents.render_agents(self.repo, "codex", self.out)
        parsed = tomllib.loads((self.out / "legacy.toml").read_text())
        self.assertEqual(parsed["sandbox_mode"], "read-only")
        self.assertEqual(parsed["developer_instructions"], "Legacy body.")


class RealAgentsTest(unittest.TestCase):
    def test_every_agent_in_the_repo_renders_for_every_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            for tool in render_agents.TOOLS:
                written = render_agents.render_agents(REPO, tool, Path(tmp) / tool)
                self.assertGreaterEqual(len(written), 4, tool)

    def test_the_reviewers_are_read_only_in_every_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            for tool in render_agents.TOOLS:
                render_agents.render_agents(REPO, tool, Path(tmp) / tool)
            for name in ("reviewer", "convention-checker"):
                self.assertIn("tools: Read, Grep, Glob\n", (Path(tmp) / "claude" / f"{name}.md").read_text())
                self.assertIn("readonly: true\n", (Path(tmp) / "cursor" / f"{name}.md").read_text())
                parsed = tomllib.loads((Path(tmp) / "codex" / f"{name}.toml").read_text())
                self.assertEqual(parsed["sandbox_mode"], "read-only")


if __name__ == "__main__":
    unittest.main()
