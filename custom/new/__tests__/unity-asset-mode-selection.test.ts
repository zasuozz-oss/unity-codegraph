import { afterEach, describe, expect, it } from 'vitest';
import { detectLanguage, isSourceFile } from '../src/extraction/grammars';
import {
  enableUnityAssetMode,
  hasUnityAssetMarker,
  isUnityAssetMode,
  writeUnityAssetMarker,
} from '../src/extraction/unity-mode';

describe('Unity asset mode selection', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY;
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  });

  it('keeps Unity asset files disabled even when legacy asset mode env is set', () => {
    process.env.CODEGRAPH_UNITY = '1';
    process.env.CODEGRAPH_UNITY_ASSETS = '1';

    for (const file of [
      'Assets/Scenes/Main.unity',
      'Assets/Prefabs/Player.prefab',
      'Assets/ScriptableObjects/Items.asset',
      'Assets/Sprites/hero.png',
      'Assets/Sprites/hero.png.meta',
      'Assets/Assemblies/Game.asmdef',
    ]) {
      expect(isSourceFile(file), file).toBe(false);
      expect(detectLanguage(file), file).toBe('unknown');
    }

    expect(isSourceFile('Assets/Scripts/PlayerController.cs')).toBe(true);
    expect(detectLanguage('Assets/Scripts/PlayerController.cs')).toBe('csharp');
  });

  it('treats asset-mode helpers as no-ops while preserving base Unity mode', () => {
    enableUnityAssetMode();

    expect(process.env.CODEGRAPH_UNITY).toBe('1');
    expect(process.env.CODEGRAPH_UNITY_ASSETS).toBeUndefined();
    expect(isUnityAssetMode()).toBe(false);
  });

  it('does not persist or read full-asset markers', () => {
    const projectRoot = process.cwd();

    writeUnityAssetMarker(projectRoot);

    expect(hasUnityAssetMarker(projectRoot)).toBe(false);
  });
});
