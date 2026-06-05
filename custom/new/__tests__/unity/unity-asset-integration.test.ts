import { describe, it, expect } from 'vitest';
import { resolveUnityEdges } from '../../src/resolution/unity/unity-reference-resolver';
import { CodeGraph } from '../../src/index';
import { ToolHandler } from '../../src/mcp/tools';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function copyFixture(): string {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unity-'));
  fs.cpSync(path.join(__dirname, 'fixtures', 'MiniProject'), dst, { recursive: true });
  return dst;
}

describe('resolveUnityEdges', () => {
  it('resolves component_uses_script via guid to class node', () => {
    const guidToNodeId = new Map([['aaaa', 'class:PlayerController']]);
    const localAnchors = new Map<string, Map<number, string>>();
    const rawEdges = [
      {
        source: 'comp1',
        kind: 'references',
        provenance: 'unity',
        metadata: { unityRelation: 'component_uses_script', guid: 'aaaa', fileID: 11500000 },
        filePath: 'P.prefab',
      } as any,
    ];

    const { resolved, missing, placeholderNodes } = resolveUnityEdges(
      rawEdges,
      guidToNodeId,
      localAnchors
    );

    expect(resolved[0].target).toBe('class:PlayerController');
    expect(missing.length).toBe(0);
    expect(placeholderNodes.length).toBe(0);
  });

  it('flags missing script when guid not in map', () => {
    const rawEdges = [
      {
        source: 'comp1',
        kind: 'references',
        provenance: 'unity',
        metadata: { unityRelation: 'component_uses_script', guid: 'ffff' },
        filePath: 'B.prefab',
      } as any,
    ];

    const { resolved, missing, placeholderNodes } = resolveUnityEdges(
      rawEdges,
      new Map(),
      new Map()
    );

    expect(missing.length).toBe(1);
    expect(placeholderNodes.length).toBe(1);
    expect((resolved[0].metadata as any).unityRelation).toBe('missing_script');
    expect(resolved[0].target).toBe(placeholderNodes[0].id);
  });
});

describe('Unity full-asset integration', () => {
  it('builds resolved Unity graph on MiniProject', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();

      const player = cg.searchNodes('PlayerController').find((r) => r.node.kind === 'class')!.node;
      const componentEdges = cg.getEdgesByRelation('component_uses_script');
      expect(componentEdges.some((edge) => edge.target === player.id)).toBe(true);

      const missing = cg.getEdgesByRelation('missing_script');
      expect(missing.length).toBeGreaterThanOrEqual(1);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });

  it('csharp extractor tags [SerializeField] fields', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();

      const field = cg.searchNodes('database').find((r) => r.node.kind === 'field')?.node;
      expect(field?.decorators?.includes('SerializeField')).toBe(true);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });

  it('resolves UnityEvent persistent calls to methods', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();

      const method = cg.searchNodes('Respawn').find((r) => r.node.kind === 'method')!.node;
      const eventEdges = cg.getEdgesByRelation('unity_event_calls_method');
      expect(eventEdges.some((edge) => edge.target === method.id)).toBe(true);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });

  it('re-resolves Unity asset edges on sync after prefab reference changes', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();
      const beforeNodeCount = cg.getStats().nodeCount;

      const prefabPath = path.join(root, 'Assets', 'Prefabs', 'Player.prefab');
      const prefab = fs.readFileSync(prefabPath, 'utf8');
      fs.writeFileSync(
        prefabPath,
        prefab.replace(
          'm_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
          'm_Script: {fileID: 11500000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}'
        )
      );

      await cg.sync();

      const itemDatabase = cg.searchNodes('ItemDatabase').find((r) => r.node.kind === 'class')!.node;
      const playerController = cg.searchNodes('PlayerController').find((r) => r.node.kind === 'class')!.node;
      const playerComponentIds = new Set(
        cg.getNodesInFile('Assets/Prefabs/Player.prefab')
          .filter((node) => node.kind === 'unity_component')
          .map((node) => node.id)
      );
      const scriptEdges = cg.getEdgesByRelation('component_uses_script');
      expect(scriptEdges.some((edge) => playerComponentIds.has(edge.source) && edge.target === itemDatabase.id)).toBe(true);
      expect(scriptEdges.some((edge) => playerComponentIds.has(edge.source) && edge.target === playerController.id)).toBe(false);
      expect(cg.getStats().nodeCount).toBe(beforeNodeCount);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });

  it('codegraph_search hides Unity sub-object nodes by default', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();

      const handler = new ToolHandler(cg);
      const result = await handler.execute('codegraph_search', { query: 'Player', limit: 50 });
      const text = result.content[0]!.text;

      expect(text).not.toContain('(unity_gameobject)');
      expect(text).not.toContain('(unity_component)');
      expect(text).toContain('(unity_prefab)');
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });

  it('codegraph_impact surfaces Unity prefab attachments for MonoBehaviour classes', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();

      const handler = new ToolHandler(cg);
      const result = await handler.execute('codegraph_impact', { symbol: 'PlayerController' });
      const text = result.content[0]!.text;

      expect(text).toContain('Unity attachments');
      expect(text).toContain('Assets/Prefabs/Player.prefab');
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });

  it('Unity MCP tools find missing scripts and asset references', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();
      const handler = new ToolHandler(cg);

      const missing = await handler.execute('unity_find_missing_scripts', {});
      expect(missing.content[0]!.text).toContain('Assets/Prefabs/Broken.prefab');

      const refs = await handler.execute('unity_find_references_to_asset', { asset: 'Items.asset' });
      expect(refs.content[0]!.text).toContain('Assets/Prefabs/Player.prefab');
      expect(refs.content[0]!.text).toContain('Assets/AddressableAssetsData/AssetGroups.asset');
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
      delete process.env.CODEGRAPH_UNITY_ASSETS;
    }
  });
});
