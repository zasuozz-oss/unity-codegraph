import { describe, it, expect, afterEach } from 'vitest';
import { CodeGraph } from '../../src/index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function copyFixture(): string {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unity-'));
  fs.cpSync(path.join(__dirname, 'fixtures', 'MiniProject'), dst, { recursive: true });
  return dst;
}

describe('Unity asmdef graph', () => {
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    delete process.env.CODEGRAPH_UNITY;
  });

  it('indexes asmdef modules and resolves asmdef references by GUID', async () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();

      const game = cg.searchNodes('Game').find((r) => r.node.kind === 'module')!.node;
      const core = cg.searchNodes('Core').find((r) => r.node.kind === 'module')!.node;
      const edges = cg.getEdgesByRelation('asmdef_references_asmdef');

      expect(game.filePath).toBe('Assets/Game.asmdef');
      expect(core.filePath).toBe('Assets/Core.asmdef');
      expect(edges.some((edge) => edge.source === game.id && edge.target === core.id)).toBe(true);
    } finally {
      cg.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
