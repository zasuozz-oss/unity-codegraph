import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import CodeGraph from '../src/index';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { enableUnityAssetMode } from '../src/extraction/unity-mode';
import { createUnityProject } from './helpers/unity-project-builder';

describe('Unity index reconciliation', () => {
  const roots: string[] = [];

  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY;
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates a first-party Unity project with stable GUID sidecars', () => {
    const project = createUnityProject();
    roots.push(project.root);

    expect(fs.existsSync(project.path('Assets/Scripts/PlayerController.cs'))).toBe(true);
    expect(
      fs.readFileSync(project.path('Assets/Scripts/PlayerController.cs.meta'), 'utf8')
    ).toContain('guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('removes stale files and nodes after a source asset is renamed', async () => {
    const project = createUnityProject();
    roots.push(project.root);
    enableUnityAssetMode();

    const cg = CodeGraph.initSync(project.root);
    try {
      await cg.indexAll();

      project.move(
        'Assets/Scripts/PlayerController.cs',
        'Assets/Scripts/RenamedPlayerController.cs'
      );
      project.move(
        'Assets/Scripts/PlayerController.cs.meta',
        'Assets/Scripts/RenamedPlayerController.cs.meta'
      );

      await cg.indexAll();

      expect(cg.getFile('Assets/Scripts/PlayerController.cs')).toBeNull();
      expect(cg.getNodesInFile('Assets/Scripts/PlayerController.cs')).toEqual([]);
      expect(cg.getNodesInFile('Assets/Scripts/RenamedPlayerController.cs')).not.toEqual([]);
      expect(
        cg
          .getNodesByName('PlayerController')
          .filter((node) => node.kind === 'class')
      ).toHaveLength(1);
    } finally {
      cg.close();
    }
  });

  it('removes GUID rows after an asset and its meta file are deleted', async () => {
    const project = createUnityProject();
    roots.push(project.root);
    project.write(
      'Assets/Prefabs/Obsolete.prefab',
      '%YAML 1.1\n--- !u!1 &1000\nGameObject:\n  m_Name: Obsolete\n'
    );
    project.write(
      'Assets/Prefabs/Obsolete.prefab.meta',
      'fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
    );
    enableUnityAssetMode();

    const cg = CodeGraph.initSync(project.root);
    try {
      await cg.indexAll();
      project.remove('Assets/Prefabs/Obsolete.prefab');
      project.remove('Assets/Prefabs/Obsolete.prefab.meta');
      await cg.indexAll();
    } finally {
      cg.close();
    }

    const connection = DatabaseConnection.open(getDatabasePath(project.root));
    try {
      const rows = connection
        .getDb()
        .prepare('SELECT asset_path FROM unity_guids WHERE guid = ?')
        .all('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(rows).toEqual([]);
    } finally {
      connection.close();
    }
  });
});
