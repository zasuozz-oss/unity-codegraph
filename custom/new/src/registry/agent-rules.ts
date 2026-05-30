/**
 * Per-project agent rule files — on `codegraph init` we write `AGENTS.md` and
 * `CLAUDE.md` into the indexed project root (mirroring antigravity-gitnexus) so any
 * agent opening that repo learns to drive the CodeGraph MCP tools.
 *
 * The content lives inside `<!-- codegraph:start -->` / `<!-- codegraph:end -->`
 * markers so re-init only refreshes our block and leaves the user's own content in
 * those files untouched. `uninit` strips the block back out.
 */
import * as fs from 'fs';
import * as path from 'path';

const START = '<!-- codegraph:start -->';
const END = '<!-- codegraph:end -->';
const RULE_FILES = ['AGENTS.md', 'CLAUDE.md'];

export interface RuleStats {
  name: string;
  files: number;
  nodes: number;
  edges: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function renderBlock(s: RuleStats): string {
  return `${START}
# CodeGraph — Code Intelligence

This project is indexed by **CodeGraph** as **${s.name}** (${fmt(s.nodes)} symbols, ${fmt(s.edges)} relationships across ${fmt(s.files)} files). Use the CodeGraph MCP tools to understand code, assess impact, and navigate — before reaching for grep/read.

> If a CodeGraph tool reports the index is stale, run \`codegraph sync\` (or \`codegraph index\`) in the terminal first. Unity projects: \`codegraph unity index\`.

## Always Do

- **Assess impact before editing a symbol.** Before changing a function, class, or method, run \`codegraph_impact\` on it (CLI: \`codegraph impact <Symbol>\`) and report the blast radius (direct dependents + risk) to the user.
- **Answer structural questions with CodeGraph, not grep.** For "where is X", "what calls Y", "how does X reach Y", use the tools below — they read a prebuilt index and are far cheaper than scanning files.
- For a 360° view of one symbol (callers, callees, source), use \`codegraph_context\` (CLI: \`codegraph context "<symbol or task>"\`).
- For a flow / "how does X reach Y", use \`codegraph_trace\` — one call returns the whole call path.

## When Debugging

1. \`codegraph_search\` the error or symptom to locate the relevant symbols.
2. \`codegraph_context\` on the suspect function — see every caller and callee.
3. \`codegraph_trace\` from the entry point to the failing symbol to follow the flow.

## When Refactoring

- CodeGraph has **no automated rename**. Before renaming/moving a symbol, run \`codegraph_impact\` + \`codegraph_callers\` to enumerate every dependent, then update them yourself.
- After moving code, re-run \`codegraph_callers\` / \`codegraph_impact\` to confirm nothing was missed.

## Never Do

- NEVER edit a function, class, or method without first checking \`codegraph_impact\` on it.
- NEVER reconstruct a call path by grepping when \`codegraph_trace\` / \`codegraph_callers\` answers it directly.
- NEVER find-and-replace a rename across files without first enumerating callers via the graph.

## Tools Quick Reference

| Tool | When to use | CLI equivalent |
|------|-------------|----------------|
| \`codegraph_search\` | Find a symbol by name | \`codegraph query "<name>"\` |
| \`codegraph_context\` | 360° view of one symbol / area | \`codegraph context "<task>"\` |
| \`codegraph_callers\` | Who calls this | \`codegraph callers "<Symbol>"\` |
| \`codegraph_callees\` | What this calls | \`codegraph callees "<Symbol>"\` |
| \`codegraph_impact\` | Blast radius before editing | \`codegraph impact "<Symbol>"\` |
| \`codegraph_trace\` | Whole call path X → Y | — |
| \`codegraph_explore\` | Survey several related symbols' source | — |
| \`codegraph_files\` | What's in a directory | \`codegraph files\` |
| \`codegraph_status\` | Index size / freshness | \`codegraph status\` |

## Impact Depth Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect dependents | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if on a critical path |

## Self-Check Before Finishing

1. \`codegraph_impact\` was run for every modified symbol.
2. All d=1 (WILL BREAK) dependents were updated.
3. Structural questions were answered via CodeGraph, not blind grep.

## Keeping the Index Fresh

The file watcher auto-syncs the graph as you edit. To force a refresh after large changes:

\`\`\`bash
codegraph sync        # incremental
codegraph index       # full re-index (Unity: codegraph unity index)
\`\`\`
${END}`;
}

/** Write/refresh the CodeGraph rule block into AGENTS.md and CLAUDE.md. */
export function writeAgentRules(projectRoot: string, stats: RuleStats): void {
  const block = renderBlock(stats);
  for (const f of RULE_FILES) {
    const fp = path.join(projectRoot, f);
    let content = '';
    try { content = fs.readFileSync(fp, 'utf8'); } catch { /* new file */ }

    if (content.includes(START) && content.includes(END)) {
      content = content.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
    } else if (content.trim().length > 0) {
      content = `${content.trimEnd()}\n\n${block}\n`;
    } else {
      content = `${block}\n`;
    }
    try { fs.writeFileSync(fp, content); } catch { /* non-fatal */ }
  }
}

/** Strip the CodeGraph rule block; delete the file if nothing else remains. */
export function removeAgentRules(projectRoot: string): void {
  for (const f of RULE_FILES) {
    const fp = path.join(projectRoot, f);
    let content: string;
    try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    if (!content.includes(START)) continue;
    const stripped = content.replace(new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n*`), '\n').trim();
    try {
      if (stripped.length === 0) fs.unlinkSync(fp);
      else fs.writeFileSync(fp, `${stripped}\n`);
    } catch { /* non-fatal */ }
  }
}
