import { afterEach, describe, expect, it } from 'vitest';
import CodeGraph from '../src';
import { enableUnityAssetMode } from '../src/extraction/unity-mode';
import { createUnityProject } from './helpers/unity-project-builder';

describe('Unity object graph', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY;
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  });

  it('does not index prefab object graphs while asset mode is disabled', async () => {
    const project = createUnityProject();
    project.write(
      'Assets/Prefabs/Player.prefab',
      `%YAML 1.1
--- !u!1 &100
GameObject:
  m_Name: Player
--- !u!114 &200
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
`
    );
    project.write(
      'Assets/Prefabs/Player.prefab.meta',
      'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n'
    );

    enableUnityAssetMode();

    const cg = await CodeGraph.init(project.root, { index: false });
    try {
      await cg.indexAll();

      expect(cg.getNodesByName('Player').filter((node) => node.kind === 'unity_gameobject')).toEqual([]);
      expect(cg.getNodesByName('PlayerController').some((node) => node.kind === 'class')).toBe(true);
    } finally {
      cg.destroy();
    }
  });

  it('does not index scene object graphs while asset mode is disabled', async () => {
    const project = createUnityProject();
    project.write(
      'Assets/Scenes/Main.unity',
      `%YAML 1.1
--- !u!1 &100
GameObject:
  m_Name: Main Camera
--- !u!20 &200
Camera:
  m_GameObject: {fileID: 100}
`
    );

    enableUnityAssetMode();

    const cg = await CodeGraph.init(project.root, { index: false });
    try {
      await cg.indexAll();

      expect(cg.getNodesByName('Main Camera')).toEqual([]);
      expect(cg.getNodesByName('PlayerController').some((node) => node.kind === 'class')).toBe(true);
    } finally {
      cg.destroy();
    }
  });
});
