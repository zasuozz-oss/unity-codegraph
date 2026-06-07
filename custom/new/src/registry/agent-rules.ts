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
const SKILL_FILES = [
  'codegraph-unity-exploring',
  'codegraph-unity-guide',
  'codegraph-unity-impact',
  'codegraph-unity-refactoring',
];

export interface RuleStats {
  name: string;
  files: number;
  nodes: number;
  edges: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

const FALLBACK_TEMPLATE = `# CodeGraph Unity - Project Instructions

This Unity project is indexed by **CodeGraph** as **{{projectName}}** ({{nodes}} symbols, {{edges}} relationships across {{files}} files).

Use CodeGraph before scanning files manually. Run \`codegraph unity index\` if the index is stale.

## Local Unity Skills

- \`codegraph-unity-guide\`
- \`codegraph-unity-exploring\`
- \`codegraph-unity-impact\`
- \`codegraph-unity-refactoring\`
`;

function candidateInstructionFiles(): string[] {
  const envPath = process.env.CODEGRAPH_UNITY_INSTRUCTION_FILE;
  return [
    envPath,
    path.resolve(__dirname, '..', '..', '..', 'custom', 'instructions', 'codegraph-unity.md'),
    path.resolve(__dirname, '..', '..', 'custom', 'instructions', 'codegraph-unity.md'),
    path.resolve(process.cwd(), 'custom', 'instructions', 'codegraph-unity.md'),
    path.resolve(process.cwd(), '..', 'custom', 'instructions', 'codegraph-unity.md'),
  ].filter((file): file is string => !!file);
}

function readInstructionTemplate(): string {
  for (const file of candidateInstructionFiles()) {
    try {
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    } catch {
      /* try next candidate */
    }
  }
  return FALLBACK_TEMPLATE;
}

function applyTemplate(template: string, s: RuleStats): string {
  return template
    .replaceAll('{{projectName}}', s.name)
    .replaceAll('{{files}}', fmt(s.files))
    .replaceAll('{{nodes}}', fmt(s.nodes))
    .replaceAll('{{edges}}', fmt(s.edges));
}

function renderBlock(s: RuleStats): string {
  const body = applyTemplate(readInstructionTemplate(), s).trim();
  return `${START}\n${body}\n${END}`;
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

function candidateSkillRoots(): string[] {
  const roots = [
    process.env.CODEGRAPH_UNITY_SKILLS_DIR,
    path.resolve(__dirname, '..', '..', '..', 'custom', 'skills'),
    path.resolve(__dirname, '..', '..', 'custom', 'skills'),
    path.resolve(process.cwd(), 'custom', 'skills'),
    path.resolve(process.cwd(), '..', 'custom', 'skills'),
  ];
  return roots.filter((root): root is string => !!root);
}

function findUnitySkillsRoot(): string | undefined {
  for (const root of candidateSkillRoots()) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
    } catch {
      /* try next candidate */
    }
  }
  return undefined;
}

function localSkillTargets(projectRoot: string): string[] {
  return [
    path.join(projectRoot, '.agents', 'skills'),
    path.join(projectRoot, '.claude', 'skills'),
  ];
}

/** Install Unity CodeGraph skills into the indexed project, not global agent dirs. */
export function installUnityAgentSkills(projectRoot: string): void {
  const sourceRoot = findUnitySkillsRoot();
  if (!sourceRoot) return;

  for (const targetRoot of localSkillTargets(projectRoot)) {
    for (const skillName of SKILL_FILES) {
      const source = path.join(sourceRoot, skillName, 'SKILL.md');
      const targetDir = path.join(targetRoot, skillName);
      const target = path.join(targetDir, 'SKILL.md');
      try {
        if (!fs.existsSync(source)) continue;
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(source, target);
      } catch {
        /* non-fatal */
      }
    }
  }
}

/** Remove the Unity CodeGraph skills installed by this overlay. */
export function removeUnityAgentSkills(projectRoot: string): void {
  for (const targetRoot of localSkillTargets(projectRoot)) {
    for (const skillName of SKILL_FILES) {
      try {
        fs.rmSync(path.join(targetRoot, skillName), { recursive: true, force: true });
      } catch {
        /* non-fatal */
      }
    }
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
