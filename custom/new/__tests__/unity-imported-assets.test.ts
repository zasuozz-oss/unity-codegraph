import { afterEach, describe, expect, it } from 'vitest';
import CodeGraph from '../src';
import { detectLanguage, isSourceFile } from '../src/extraction/grammars';
import { enableUnityAssetMode } from '../src/extraction/unity-mode';
import { createUnityProject } from './helpers/unity-project-builder';

describe('Unity imported asset coverage', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY;
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  });

  it('keeps imported asset extensions out of the source set', () => {
    enableUnityAssetMode();

    for (const extension of ['.mat', '.fbx', '.wav', '.ttf', '.mp4', '.custombinary']) {
      const assetPath = `Assets/Data/Test${extension}`;
      expect(isSourceFile(assetPath), assetPath).toBe(false);
      expect(detectLanguage(assetPath), assetPath).toBe('unknown');
    }
  });

  it('does not materialize imported asset or sub-asset nodes', async () => {
    const project = createUnityProject();
    project.write('Assets/Models/Hero.fbx', Buffer.from([0, 1, 2, 3]));
    project.write(
      'Assets/Models/Hero.fbx.meta',
      'fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
    );

    enableUnityAssetMode();

    const cg = await CodeGraph.init(project.root, { index: false });
    try {
      await cg.indexAll();

      expect(cg.getNodesByName('Hero.fbx')).toEqual([]);
      expect(cg.getNodesByName('PlayerController').some((node) => node.kind === 'class')).toBe(true);
    } finally {
      cg.destroy();
    }
  });
});
