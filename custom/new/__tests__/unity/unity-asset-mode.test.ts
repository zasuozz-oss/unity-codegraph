import { describe, it, expect, afterEach } from 'vitest';
import {
  isUnityAssetMode,
  enableUnityAssetMode,
  writeUnityAssetMarker,
} from '../../src/extraction/unity-mode';
import { CodeGraph } from '../../src/index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function copyFixture(): string {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unity-'));
  fs.cpSync(path.join(__dirname, 'fixtures', 'MiniProject'), dst, { recursive: true });
  return dst;
}

describe('unity asset mode flag', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    delete process.env.CODEGRAPH_UNITY;
  });

  it('is off by default', () => {
    expect(isUnityAssetMode()).toBe(false);
  });

  it('enableUnityAssetMode turns on BOTH asset mode and base unity mode', () => {
    enableUnityAssetMode();
    expect(isUnityAssetMode()).toBe(true);
    expect(process.env.CODEGRAPH_UNITY).toBe('1');
  });
});

describe('mode isolation', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    delete process.env.CODEGRAPH_UNITY;
  });

  it('csharp-only mode produces ZERO unity_* nodes', async () => {
    process.env.CODEGRAPH_UNITY = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();
      const unity = cg.searchNodes('', {
        kinds: ['unity_scene', 'unity_prefab', 'unity_asset', 'unity_gameobject', 'unity_component', 'unity_script'] as any,
      });
      expect(unity.length).toBe(0);

      const cls = cg.searchNodes('PlayerController');
      expect(cls.some((r) => r.node.kind === 'class')).toBe(true);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('full-asset mode produces unity_* nodes', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();
      const prefabs = cg.searchNodes('', { kinds: ['unity_prefab'] as any });
      expect(prefabs.length).toBeGreaterThanOrEqual(1);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });
});

describe('unity asset marker', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    delete process.env.CODEGRAPH_UNITY;
  });

  it('CodeGraph.open enables full-asset mode when marker exists', async () => {
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    cg.close();
    writeUnityAssetMarker(root);
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    delete process.env.CODEGRAPH_UNITY;

    const opened = await CodeGraph.open(root);
    try {
      expect(isUnityAssetMode()).toBe(true);
      expect(process.env.CODEGRAPH_UNITY).toBe('1');
    } finally {
      opened.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
