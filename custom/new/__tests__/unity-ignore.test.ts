import { afterEach, describe, expect, it } from 'vitest';
import { buildDefaultIgnore } from '../src/extraction';

describe('Unity ignore preset', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY;
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  });

  it('ignores Unity generated and SDK directories in Unity mode', () => {
    process.env.CODEGRAPH_UNITY = '1';
    const ig = buildDefaultIgnore('/tmp/unity-project');

    expect(ig.ignores('Library/PackageCache/com.unity.mathematics/math.cs')).toBe(true);
    expect(ig.ignores('Temp/Generated.cs')).toBe(true);
    expect(ig.ignores('Logs/AssetImportWorker0.log')).toBe(true);
    expect(ig.ignores('UserSettings/EditorUserSettings.asset')).toBe(true);
    expect(ig.ignores('ProjectSettings/ProjectVersion.txt')).toBe(true);
    expect(ig.ignores('Packages/manifest.json')).toBe(true);
    expect(ig.ignores('Assets/Firebase/Scripts/FirebaseApp.cs')).toBe(true);
    expect(ig.ignores('Assets/DOTween/Scripts/DOTween.cs')).toBe(true);
    expect(ig.ignores('Assets/Plugins/Android/Plugin.cs')).toBe(true);
    expect(ig.ignores('Assets/_Game/Scripts/PlayerController.cs')).toBe(false);
  });

  it('keeps Unity asset directories ignored even when legacy asset mode env is set', () => {
    process.env.CODEGRAPH_UNITY = '1';
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const ig = buildDefaultIgnore('/tmp/unity-project');

    expect(ig.ignores('Library/PackageCache/com.unity.mathematics/math.cs')).toBe(true);
    expect(ig.ignores('ProjectSettings/ProjectVersion.txt')).toBe(true);
    expect(ig.ignores('Assets/Firebase/Scripts/FirebaseApp.cs')).toBe(true);
    expect(ig.ignores('Assets/Editor/BuildMenu.cs')).toBe(true);
    expect(ig.ignores('Assets/GeneratedLocalRepo/Generated.prefab')).toBe(true);
    expect(ig.ignores('Assets/Scenes/Main.unity')).toBe(true);
    expect(ig.ignores('Assets/Prefabs/Player.prefab')).toBe(true);
    expect(ig.ignores('Assets/ScriptableObjects/Items.asset')).toBe(false);
    expect(ig.ignores('Assets/Models/Hero.fbx')).toBe(true);
    expect(ig.ignores('Assets/Audio/Click.wav')).toBe(false);
  });
});
