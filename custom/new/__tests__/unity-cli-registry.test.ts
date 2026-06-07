import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('codegraph unity CLI registry integration', () => {
  it('registers a project after unity init', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-unity-registry-'));
    const home = path.join(root, 'home');
    const project = path.join(root, 'MiniUnity');
    fs.mkdirSync(path.join(project, 'Assets', 'Scripts'), { recursive: true });
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true });
    fs.writeFileSync(
      path.join(project, 'Assets', 'Scripts', 'PlayerController.cs'),
      'public class PlayerController { public void Move() {} }\n',
    );
    fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.0f1\n');

    const cli = path.resolve(__dirname, '..', 'dist', 'bin', 'codegraph.js');
    execFileSync(process.execPath, [cli, 'unity', 'init', project], {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CI: '1',
        FORCE_COLOR: '0',
      },
      stdio: 'pipe',
      timeout: 30_000,
    });

    const registryPath = path.join(home, '.codegraph', 'projects.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const normalized = path.resolve(project).replace(/\\/g, '/');
    expect(registry.projects).toContainEqual(
      expect.objectContaining({ name: 'MiniUnity', path: normalized }),
    );

    const agentsContent = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
    const claudeContent = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    expect(agentsContent).toContain('<!-- codegraph:start -->');
    expect(agentsContent).toContain('CodeGraph Unity - Project Instructions');
    expect(agentsContent).toContain('codegraph-unity-guide');
    expect(claudeContent).toContain('<!-- codegraph:start -->');
    expect(claudeContent).toContain('CodeGraph Unity - Project Instructions');
    expect(claudeContent).toContain('codegraph-unity-guide');

    const localSkillNames = [
      'codegraph-unity-exploring',
      'codegraph-unity-guide',
      'codegraph-unity-impact',
      'codegraph-unity-refactoring',
    ];
    for (const skillName of localSkillNames) {
      expect(fs.existsSync(path.join(project, '.agents', 'skills', skillName, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(project, '.claude', 'skills', skillName, 'SKILL.md'))).toBe(true);
    }
  });

  it('accepts legacy --assets while indexing C# only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-unity-assets-disabled-'));
    const home = path.join(root, 'home');
    const project = path.join(root, 'MiniUnity');
    fs.mkdirSync(path.join(project, 'Assets', 'Scripts'), { recursive: true });
    fs.mkdirSync(path.join(project, 'Assets', 'Sprites'), { recursive: true });
    fs.mkdirSync(path.join(project, 'Assets', 'Prefabs'), { recursive: true });
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true });
    fs.writeFileSync(
      path.join(project, 'Assets', 'Scripts', 'PlayerController.cs'),
      'public class PlayerController { public void Move() {} }\n',
    );
    fs.writeFileSync(path.join(project, 'Assets', 'Sprites', 'hero.png'), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(project, 'Assets', 'Prefabs', 'Player.prefab'), '%YAML 1.1\n');
    fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.0f1\n');

    const cli = path.resolve(__dirname, '..', 'dist', 'bin', 'codegraph.js');
    execFileSync(process.execPath, [cli, 'unity', 'init', project, '--assets'], {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CI: '1',
        FORCE_COLOR: '0',
      },
      stdio: 'pipe',
      timeout: 30_000,
    });

    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(path.join(project, '.codegraph', 'codegraph.db'), { readOnly: true });
    const csharpNode = db.prepare("select kind from nodes where name = 'PlayerController'").get() as
      | { kind: string }
      | undefined;
    const assetRows = db.prepare("select count(*) as count from nodes where language = 'unity_asset'").get() as
      | { count: number }
      | undefined;

    expect(csharpNode).toEqual({ kind: 'class' });
    expect(assetRows?.count).toBe(0);
    expect(fs.existsSync(path.join(project, '.codegraph', 'unity'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.codegraph', 'unity-assets'))).toBe(false);
  });
});
