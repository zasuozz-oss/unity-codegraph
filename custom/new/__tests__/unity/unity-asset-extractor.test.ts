import { afterEach, describe, it, expect } from 'vitest';
import { NODE_KINDS } from '../../src/types';
import { isSourceFile } from '../../src/extraction/grammars';
import { buildDefaultIgnore } from '../../src/extraction/index';
import { UnityAssetExtractor } from '../../src/extraction/unity/unity-asset-extractor';
import * as fs from 'fs';
import * as path from 'path';

describe('unity node kinds registered', () => {
  it('includes the 6 unity node kinds', () => {
    for (const kind of [
      'unity_scene',
      'unity_prefab',
      'unity_asset',
      'unity_gameobject',
      'unity_component',
      'unity_script',
    ]) {
      expect(NODE_KINDS).toContain(kind);
    }
  });
});

describe('isSourceFile gate by mode', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    delete process.env.CODEGRAPH_UNITY;
  });

  it('skips .prefab in csharp-only', () => {
    expect(isSourceFile('A/X.prefab')).toBe(false);
  });

  it('accepts node-producing assets in full-asset, but never .meta', () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    expect(isSourceFile('A/X.prefab')).toBe(true);
    expect(isSourceFile('A/X.unity')).toBe(true);
    expect(isSourceFile('A/X.asset')).toBe(true);
    expect(isSourceFile('A/X.asmdef')).toBe(true);
    expect(isSourceFile('A/X.cs.meta')).toBe(false);
    expect(isSourceFile('A/X.prefab.meta')).toBe(false);
  });

  it('full-asset mode walks asset folders while still ignoring engine folders', () => {
    process.env.CODEGRAPH_UNITY = '1';
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const ig = buildDefaultIgnore('/tmp/unity-project');
    expect(ig.ignores('Assets/Prefabs/Player.prefab')).toBe(false);
    expect(ig.ignores('Assets/Scenes/Main.unity')).toBe(false);
    expect(ig.ignores('Library/Generated.cs')).toBe(true);
    expect(ig.ignores('Assets/Firebase/Vendor.cs')).toBe(true);
  });
});

describe('UnityAssetExtractor', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'MiniProject', 'Assets', 'Prefabs', 'Player.prefab'),
    'utf8'
  );
  const result = new UnityAssetExtractor('Assets/Prefabs/Player.prefab', src).extract();

  it('emits a prefab node, gameobject, and component', () => {
    expect(result.nodes.some((n) => n.kind === 'unity_prefab')).toBe(true);
    expect(result.nodes.some((n) => n.kind === 'unity_gameobject' && n.name === 'Player')).toBe(true);
    expect(result.nodes.some((n) => n.kind === 'unity_component')).toBe(true);
  });

  it('emits raw component to script edge carrying guid in metadata', () => {
    const edge = result.unityRawEdges.find(
      (e) => (e.metadata as any)?.unityRelation === 'component_uses_script'
    );
    expect(edge).toBeTruthy();
    expect((edge!.metadata as any).guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(edge!.provenance).toBe('unity');
  });

  it('emits raw serialized-field to asset edge with fieldName', () => {
    const edge = result.unityRawEdges.find(
      (e) => (e.metadata as any)?.unityRelation === 'serialized_field_references_asset'
    );
    expect((edge!.metadata as any).fieldName).toBe('database');
    expect((edge!.metadata as any).guid).toBe('cccccccccccccccccccccccccccccccc');
  });
});
