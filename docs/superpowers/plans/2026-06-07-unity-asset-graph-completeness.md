# Unity Asset Graph Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Unity full-asset indexing complete and idempotent for all first-party assets that survive the existing ignore rules, including rename/delete reconciliation, readable component names, ScriptableObjects, prefab overrides, UnityEvents, hierarchy, and imported/binary sub-assets.

**Architecture:** Keep the existing layered pipeline, but make identity and reconciliation explicit. Build the GUID/fileID catalog before extraction, generate Unity node IDs from `asset GUID + local fileID`, extract YAML and imported assets into one object graph, then resolve local/external references and enrich display names in a post-pass. `Library`, `Packages`, plugins, SDKs, generated/editor-only directories, and previously excluded noise remain outside the pipeline.

**Tech Stack:** TypeScript, Vitest, `yaml`, SQLite through the existing adapter, Unity text serialization, Unity `.meta` importer metadata.

---

## Working Rules

- Work from repository root `C:\Users\Zasuo\Desktop\Project\AI-Tool\unity-codegraph`.
- Run CodeGraph build/tests with `workdir=codegraph`.
- Use finite command timeouts. Do not use watch mode.
- Do not create branches, worktrees, or commits unless the user explicitly requests them.
- The wrapper is the durable source:
  - New upstream files belong under `custom/new/<upstream-relative-path>`.
  - Changes to existing upstream files must also be represented in `custom/patches/`.
  - Root web files are edited directly.
- Existing uncommitted work is user-owned. Do not revert or rewrite unrelated changes.
- Preserve the current ignore policy in `unity-preset.ts`. Full-asset expansion applies only to first-party files that pass that policy.
- Follow TDD for every behavior: add one failing test, run it and confirm the expected failure, implement the minimum behavior, then rerun focused and broader tests.

## File Structure

### New focused modules

- Create `custom/new/src/extraction/unity/unity-node-id.ts`
  - Stable Unity IDs derived from GUID, local fileID, and node kind.
- Create `custom/new/src/extraction/unity/unity-meta-extractor.ts`
  - Classify imported assets and parse named sub-assets from importer metadata.
- Create `custom/new/src/resolution/unity/unity-resolution-index.ts`
  - Build lookup maps for local anchors, global `GUID:fileID`, component scripts, and method overloads.
- Create `custom/new/__tests__/unity-index-reconcile.test.ts`
- Create `custom/new/__tests__/unity-object-graph.test.ts`
- Create `custom/new/__tests__/unity-event-resolution.test.ts`
- Create `custom/new/__tests__/unity-imported-assets.test.ts`

### Existing upstream files to modify and persist as patches

- Modify `codegraph/src/extraction/index.ts`
- Modify `codegraph/src/db/queries.ts`
- Modify `codegraph/src/extraction/unity/unity-guid-index.ts`
- Modify `codegraph/src/extraction/unity/unity-asset-extractor.ts`
- Modify `codegraph/src/resolution/unity/unity-reference-resolver.ts`
- Modify `codegraph/src/extraction/unity-preset.ts`
- Modify `codegraph/src/extraction/grammars.ts`
- Modify `codegraph/src/types.ts` only if a generic imported-subasset node kind cannot reuse `unity_asset`.

### Existing wrapper copies to keep synchronized

- Modify `custom/new/src/extraction/unity/unity-guid-index.ts`
- Modify `custom/new/src/extraction/unity/unity-asset-extractor.ts`
- Modify `custom/new/src/resolution/unity/unity-reference-resolver.ts`
- Modify `custom/new/src/extraction/unity-preset.ts`
- Add or regenerate the next ordered patch files after `custom/patches/19-unity-64bit-fileid-text.patch`.

---

## Task 1: Add a Reusable Unity Test Project Builder

**Files:**
- Create: `custom/new/__tests__/helpers/unity-project-builder.ts`
- Test: `custom/new/__tests__/unity-index-reconcile.test.ts`

- [ ] **Step 1: Write the failing helper smoke test**

Create `custom/new/__tests__/unity-index-reconcile.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { createUnityProject } from './helpers/unity-project-builder';

describe('Unity project fixture builder', () => {
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
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
rtk npm test -- --run __tests__/unity-index-reconcile.test.ts
```

Workdir: `codegraph`

Expected: FAIL because `./helpers/unity-project-builder` does not exist.

- [ ] **Step 3: Implement the project builder**

Create `custom/new/__tests__/helpers/unity-project-builder.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface UnityProjectFixture {
  root: string;
  path(relativePath: string): string;
  write(relativePath: string, content: string | Buffer): void;
  move(from: string, to: string): void;
  remove(relativePath: string): void;
}

export function createUnityProject(): UnityProjectFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-unity-assets-'));

  const resolve = (relativePath: string) => path.join(root, ...relativePath.split('/'));
  const write = (relativePath: string, content: string | Buffer) => {
    const target = resolve(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  write('ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3.0f1\n');
  write(
    'Assets/Scripts/PlayerController.cs',
    [
      'using UnityEngine;',
      'public class PlayerController : MonoBehaviour {',
      '  public void Respawn() {}',
      '  public void SetCount(int value) {}',
      '}',
      '',
    ].join('\n')
  );
  write(
    'Assets/Scripts/PlayerController.cs.meta',
    'fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
  );

  return {
    root,
    path: resolve,
    write,
    move(from, to) {
      const target = resolve(to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(resolve(from), target);
    },
    remove(relativePath) {
      fs.rmSync(resolve(relativePath), { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 4: Copy the helper and test into the working upstream tree**

Copy:

```text
custom/new/__tests__/helpers/unity-project-builder.ts
  -> codegraph/__tests__/helpers/unity-project-builder.ts
custom/new/__tests__/unity-index-reconcile.test.ts
  -> codegraph/__tests__/unity-index-reconcile.test.ts
```

Use the existing overlay application flow rather than ad hoc shell writes:

```powershell
rtk bash update.sh --apply-custom-only
```

Expected: overlay applies without deleting unrelated user changes.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
rtk npm test -- --run __tests__/unity-index-reconcile.test.ts
```

Workdir: `codegraph`

Expected: PASS.

---

## Task 2: Reconcile Renamed and Deleted Files During Full Index

**Files:**
- Modify: `codegraph/src/extraction/index.ts`
- Test: `custom/new/__tests__/unity-index-reconcile.test.ts`
- Patch: `custom/patches/20-index-all-reconcile-deleted-files.patch`

- [ ] **Step 1: Add the failing rename regression test**

Append to `custom/new/__tests__/unity-index-reconcile.test.ts`:

```ts
import CodeGraph from '../src/index';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { enableUnityAssetMode } from '../src/extraction/unity-mode';

it('removes stale nodes when a source or asset file is renamed before indexAll', async () => {
  const project = createUnityProject();
  roots.push(project.root);
  enableUnityAssetMode();

  const cg = CodeGraph.initSync(project.root);
  try {
    await cg.indexAll();
    expect(cg.searchNodes('PlayerController')).toHaveLength(1);

    project.move(
      'Assets/Scripts/PlayerController.cs',
      'Assets/Scripts/RenamedPlayerController.cs'
    );
    project.move(
      'Assets/Scripts/PlayerController.cs.meta',
      'Assets/Scripts/RenamedPlayerController.cs.meta'
    );

    await cg.indexAll();

    const matches = cg.searchNodes('PlayerController');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.node.filePath).toBe('Assets/Scripts/RenamedPlayerController.cs');
    expect(cg.getStats().fileCount).toBe(1);
  } finally {
    cg.destroy();
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
rtk npm test -- --run __tests__/unity-index-reconcile.test.ts -t "removes stale nodes"
```

Expected: FAIL with two `PlayerController` nodes or a file count of `2`.

- [ ] **Step 3: Add filesystem reconciliation to `indexAll`**

In `ExtractionOrchestrator.indexAll`, immediately after `scanDirectoryAsync` returns `files`, add:

```ts
const currentFiles = new Set(files);
for (const tracked of this.queries.getAllFiles()) {
  const fullPath = path.join(this.rootDir, tracked.path);
  if (!currentFiles.has(tracked.path) || !fs.existsSync(fullPath)) {
    this.queries.deleteFile(tracked.path);
  }
}
```

Do not call `clear()`. Existing files keep their normal hash-based replacement behavior; only tracked files absent from the current filesystem are removed.

- [ ] **Step 4: Run focused reconciliation tests**

Run:

```powershell
rtk npm test -- --run __tests__/unity-index-reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing sync regressions**

Run:

```powershell
rtk npm test -- --run __tests__/sync.test.ts
```

Expected: PASS, including deleted-file and modified-file cases.

- [ ] **Step 6: Persist the upstream modification**

Generate `custom/patches/20-index-all-reconcile-deleted-files.patch` containing only the `index.ts` reconciliation change. Reapply with:

```powershell
rtk bash update.sh --apply-custom-only
```

Expected: patch applies cleanly.

---

## Task 3: Rebuild the GUID Catalog Atomically and Remove Stale Rows

**Files:**
- Modify: `codegraph/src/extraction/unity/unity-guid-index.ts`
- Modify: `codegraph/src/db/queries.ts`
- Modify: `custom/new/src/extraction/unity/unity-guid-index.ts`
- Test: `custom/new/__tests__/unity-index-reconcile.test.ts`
- Patch: `custom/patches/21-unity-guid-catalog-reconcile.patch`

- [ ] **Step 1: Add a database observation helper for tests**

Add to `QueryBuilder`:

```ts
getUnityGuidRowsByPath(assetPath: string): UnityGuidDbRow[] {
  const rows = this.db.prepare(`
    SELECT guid, file_id, asset_path, asset_type, name
    FROM unity_guids
    WHERE asset_path = ?
    ORDER BY file_id
  `).all(assetPath) as Array<{
    guid: string;
    file_id: string | number;
    asset_path: string;
    asset_type: string;
    name: string | null;
  }>;

  return rows.map((row) => ({
    guid: row.guid,
    fileId: String(row.file_id),
    assetPath: row.asset_path,
    assetType: row.asset_type as UnityAssetType,
    name: row.name,
  }));
}
```

Expose only if a public test API already exists. Otherwise test through the SQLite adapter at `.codegraph/codegraph.db`; do not add a general public API solely for tests.

- [ ] **Step 2: Add the failing stale-GUID test**

Append:

```ts
it('removes old unity_guids rows after an asset rename', async () => {
  const project = createUnityProject();
  roots.push(project.root);
  enableUnityAssetMode();

  project.write(
    'Assets/Prefabs/Old.prefab',
    '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &100\nGameObject:\n  m_Name: Old\n'
  );
  project.write(
    'Assets/Prefabs/Old.prefab.meta',
    'fileFormatVersion: 2\nguid: dddddddddddddddddddddddddddddddd\n'
  );

  const cg = CodeGraph.initSync(project.root);
  try {
    await cg.indexAll();
    project.move('Assets/Prefabs/Old.prefab', 'Assets/Prefabs/New.prefab');
    project.move('Assets/Prefabs/Old.prefab.meta', 'Assets/Prefabs/New.prefab.meta');
    await cg.indexAll();

    const reader = DatabaseConnection.open(getDatabasePath(project.root));
    const paths = reader.getDb().prepare(
      'SELECT DISTINCT asset_path FROM unity_guids WHERE guid = ?'
    ).all('dddddddddddddddddddddddddddddddd') as Array<{ asset_path: string }>;
    reader.close();

    expect(paths).toEqual([{ asset_path: 'Assets/Prefabs/New.prefab' }]);
  } finally {
    cg.destroy();
  }
});
```

- [ ] **Step 3: Run the test and verify RED**

Expected: both old and new `asset_path` values remain, or the old path remains.

- [ ] **Step 4: Make catalog rebuild atomic**

Change `buildGuidIndex` to accept the existing SQLite database interface and execute one transaction:

```ts
export function buildGuidIndex(root: string, db: SqliteDatabase): number {
  let count = 0;
  const rebuild = db.transaction(() => {
    db.exec('DELETE FROM unity_guids');
    const stmt = db.prepare(
      'INSERT INTO unity_guids (guid, file_id, asset_path, asset_type, name, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const now = Date.now();

    for (const metaPath of walkMeta(root)) {
      for (const row of readMetaFile(metaPath)) {
        stmt.run(
          row.guid,
          row.fileId,
          path.relative(root, row.assetPath).replace(/\\/g, '/'),
          row.assetType,
          row.name,
          now
        );
        count++;
      }
    }
  });

  rebuild();
  return count;
}
```

Update `QueryBuilder.buildUnityGuidIndex` to pass `this.db`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
rtk npm test -- --run __tests__/unity-index-reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run GUID migration/index tests**

Run:

```powershell
rtk npm test -- --run __tests__/unity-asset-mode-selection.test.ts
```

Expected: PASS.

- [ ] **Step 7: Synchronize wrapper source and patch**

Copy the final new-file implementation to `custom/new/src/extraction/unity/unity-guid-index.ts` and persist existing-file changes in `custom/patches/21-unity-guid-catalog-reconcile.patch`.

---

## Task 4: Introduce Stable Unity Node Identity

**Files:**
- Create: `custom/new/src/extraction/unity/unity-node-id.ts`
- Modify: `codegraph/src/extraction/unity/unity-asset-extractor.ts`
- Modify: `codegraph/src/extraction/index.ts`
- Modify: `custom/new/src/extraction/unity/unity-asset-extractor.ts`
- Test: `custom/new/__tests__/unity-index-reconcile.test.ts`
- Patch: `custom/patches/22-unity-stable-node-identity.patch`

- [ ] **Step 1: Add a failing stable-ID test**

Create a prefab with GUID `dddd...`, index it, capture the GameObject ID, rename prefab and sidecar, re-index, then compare:

```ts
it('keeps Unity object IDs stable when an asset path changes', async () => {
  const project = createUnityProject();
  roots.push(project.root);
  enableUnityAssetMode();
  project.write(
    'Assets/Prefabs/Old.prefab',
    [
      '%YAML 1.1',
      '%TAG !u! tag:unity3d.com,2011:',
      '--- !u!1 &100',
      'GameObject:',
      '  m_Name: Player',
      '',
    ].join('\n')
  );
  project.write(
    'Assets/Prefabs/Old.prefab.meta',
    'fileFormatVersion: 2\nguid: dddddddddddddddddddddddddddddddd\n'
  );

  const cg = CodeGraph.initSync(project.root);
  try {
    await cg.indexAll();
    const before = cg.searchNodes('Player').find((r) => r.node.kind === 'unity_gameobject')!.node.id;

    project.move('Assets/Prefabs/Old.prefab', 'Assets/Prefabs/New.prefab');
    project.move('Assets/Prefabs/Old.prefab.meta', 'Assets/Prefabs/New.prefab.meta');
    await cg.indexAll();

    const after = cg.searchNodes('Player').find((r) => r.node.kind === 'unity_gameobject')!.node.id;
    expect(after).toBe(before);
  } finally {
    cg.destroy();
  }
});
```

- [ ] **Step 2: Run and verify RED**

Expected: IDs differ because current IDs hash `filePath:kind:name:line`.

- [ ] **Step 3: Implement the stable ID helper**

Create `custom/new/src/extraction/unity/unity-node-id.ts`:

```ts
import { NodeKind } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';

export function generateUnityNodeId(
  assetGuid: string,
  kind: NodeKind,
  localFileId: string
): string {
  return generateNodeId(`unity-guid:${assetGuid}`, kind, localFileId, 1);
}
```

- [ ] **Step 4: Supply asset GUID before asset extraction**

Add a query:

```ts
getUnityGuidForAssetPath(assetPath: string): string | null {
  const row = this.db.prepare(`
    SELECT guid FROM unity_guids
    WHERE asset_path = ? AND file_id = '0'
    LIMIT 1
  `).get(assetPath) as { guid: string } | undefined;
  return row?.guid ?? null;
}
```

At the start of `indexAll`, before scanning and reconciliation, call `buildUnityGuidIndex(this.rootDir)`. The catalog is the source for unknown imported assets that normal extension-based scanning cannot discover. Remove the later redundant rebuild from `resolveUnityAssetEdges`; resolution reads the catalog produced at run start.

For `unity_asset` extraction on the main thread, construct:

```ts
const assetGuid = this.queries.getUnityGuidForAssetPath(filePath);
result = new UnityAssetExtractor(filePath, content, assetGuid).extract();
```

Use the same constructor in `indexFileWithContent`.

- [ ] **Step 5: Use stable IDs inside `UnityAssetExtractor`**

Change the constructor:

```ts
constructor(
  private filePath: string,
  private source: string,
  private assetGuid: string | null = null
) {}
```

Change `mkNode` so Unity YAML nodes use:

```ts
const id = assetGuid
  ? generateUnityNodeId(assetGuid, kind, fileId)
  : generateNodeId(filePath, kind, name, line);
```

The display name and path may change without changing the ID. Keep `qualifiedName` as `${filePath}::${fileId}` for navigation.

- [ ] **Step 6: Run reconciliation and stable-ID tests**

Expected: PASS.

- [ ] **Step 7: Run build**

Run:

```powershell
rtk npm run build
```

Expected: PASS without type errors.

- [ ] **Step 8: Persist wrapper files and patch**

Add `unity-node-id.ts` to `custom/new`, synchronize the extractor copy, and generate `custom/patches/22-unity-stable-node-identity.patch` for existing orchestrator/query changes.

---

## Task 5: Extract Complete YAML Object Graphs and Readable Names

**Files:**
- Modify: `codegraph/src/extraction/unity/unity-asset-extractor.ts`
- Modify: `codegraph/src/resolution/unity/unity-reference-resolver.ts`
- Create: `custom/new/__tests__/unity-object-graph.test.ts`
- Patch: `custom/patches/23-unity-yaml-object-graph.patch`

- [ ] **Step 1: Add fixtures and failing assertions**

Create `custom/new/__tests__/unity-object-graph.test.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import CodeGraph from '../src/index';
import { enableUnityAssetMode } from '../src/extraction/unity-mode';
import { createUnityProject } from './helpers/unity-project-builder';

describe('Unity YAML object graph', () => {
  const roots: string[] = [];
  afterEach(() => {
    delete process.env.CODEGRAPH_UNITY;
    delete process.env.CODEGRAPH_UNITY_ASSETS;
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('names components as GameObject / ScriptClass and extracts ScriptableObjects', async () => {
    const project = createUnityProject();
    roots.push(project.root);
    enableUnityAssetMode();

    project.write(
      'Assets/Prefabs/Player.prefab',
      [
        '%YAML 1.1',
        '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!1 &100',
        'GameObject:',
        '  m_Name: Player',
        '--- !u!4 &150',
        'Transform:',
        '  m_GameObject: {fileID: 100}',
        '  m_Father: {fileID: 0}',
        '--- !u!114 &200',
        'MonoBehaviour:',
        '  m_GameObject: {fileID: 100}',
        '  m_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
        '',
      ].join('\n')
    );
    project.write(
      'Assets/Prefabs/Player.prefab.meta',
      'fileFormatVersion: 2\nguid: dddddddddddddddddddddddddddddddd\n'
    );
    project.write(
      'Assets/Data/Items.asset',
      [
        '%YAML 1.1',
        '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!114 &11400000',
        'MonoBehaviour:',
        '  m_GameObject: {fileID: 0}',
        '  m_Script: {fileID: 11500000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}',
        '  m_Name: Items',
        '  playerPrefab: {fileID: 100100000, guid: dddddddddddddddddddddddddddddddd, type: 3}',
        '',
      ].join('\n')
    );
    project.write(
      'Assets/Data/Items.asset.meta',
      'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n'
    );
    project.write(
      'Assets/Scripts/ItemDatabase.cs',
      'using UnityEngine; public class ItemDatabase : ScriptableObject {}\n'
    );
    project.write(
      'Assets/Scripts/ItemDatabase.cs.meta',
      'fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
    );

    const cg = CodeGraph.initSync(project.root);
    try {
      await cg.indexAll();
      expect(cg.searchNodes('Player / PlayerController')).toHaveLength(1);
      expect(cg.searchNodes('Player / Transform')).toHaveLength(1);
      expect(cg.searchNodes('Items / ItemDatabase')).toHaveLength(1);
    } finally {
      cg.destroy();
    }
  });
});
```

- [ ] **Step 2: Run and verify RED**

Expected:
- `MonoBehaviour_<fileID>` appears instead of `Player / PlayerController`.
- ScriptableObject child node is absent.

- [ ] **Step 3: Extract standalone serialized objects**

In `UnityAssetExtractor`:

```ts
const ownerFileId = unityFileIdKey(body.m_GameObject?.fileID);
const isStandaloneObject = doc.classId === 114 && ownerFileId === '0';
```

For `isStandaloneObject`, create a `unity_component` child using `doc.fileId`, add:

```ts
unityEdge(fileNode.id, component.id, 'contains', 'asset_contains_object', {
  childFileId: doc.fileId,
  componentClassId: doc.classId,
  componentType: className,
})
```

Collect `m_Script`, serialized references, and UnityEvents exactly as for attached MonoBehaviours.

- [ ] **Step 4: Return component display descriptors from resolution**

When the extractor creates a component, calculate and carry its owner label:

```ts
const ownerName =
  goNodeByFileId.get(ownerFileId ?? '')?.name ??
  (typeof body.m_Name === 'string' && body.m_Name.length > 0 ? body.m_Name : fileName);
```

Use `${ownerName} / ${className}` immediately for built-in components. Add `ownerName` and `componentType` to `component_uses_script` raw-edge metadata so the resolver can replace `MonoBehaviour` with the resolved C# class without querying presentation state back out of the database.

Change resolver result:

```ts
interface UnityNodeUpdate {
  id: string;
  name: string;
}

interface UnityResolutionResult {
  resolved: Edge[];
  missing: Edge[];
  placeholderNodes: Node[];
  nodeUpdates: UnityNodeUpdate[];
}
```

Build component names after script resolution:

```ts
const ownerName = metadata.ownerName ?? path.basename(edge.filePath);
const typeName = scriptClass?.name ?? metadata.componentType ?? 'Component';
nodeUpdates.push({ id: componentId, name: `${ownerName} / ${typeName}` });
```

For standalone ScriptableObjects, use `m_Name` as `ownerName`. For built-in components, use the YAML class name.

- [ ] **Step 5: Apply updates through `QueryBuilder.updateNode`**

After `resolveUnityEdges`:

```ts
for (const update of nodeUpdates) {
  const node = this.queries.getNodeById(update.id);
  if (node && node.name !== update.name) {
    this.queries.updateNode({ ...node, name: update.name });
  }
}
```

Stable IDs from Task 4 ensure renaming the display label does not change identity.

- [ ] **Step 6: Add hierarchy extraction**

For each Transform-like document with `m_GameObject` and `m_Father`, emit raw metadata:

```ts
rawUnityEdge(this.filePath, ownerGameObjectId, 'contains', 'transform_parent_of', {
  parentTransformFileId,
  childGameObjectFileId: ownerFileId,
})
```

Resolver maps parent Transform -> owning GameObject and produces parent GameObject -> child GameObject.

- [ ] **Step 7: Run object graph tests**

Expected: PASS.

- [ ] **Step 8: Persist changes**

Synchronize custom/new extractor/resolver copies and generate `custom/patches/23-unity-yaml-object-graph.patch`.

---

## Task 6: Resolve Global `GUID:fileID`, Stripped Objects, and Prefab Sources

**Files:**
- Create: `custom/new/src/resolution/unity/unity-resolution-index.ts`
- Modify: `codegraph/src/extraction/index.ts`
- Modify: `codegraph/src/resolution/unity/unity-reference-resolver.ts`
- Test: `custom/new/__tests__/unity-object-graph.test.ts`
- Patch: `custom/patches/24-unity-prefab-object-resolution.patch`

- [ ] **Step 1: Add failing prefab-source tests**

Add a source prefab and scene containing:

```yaml
--- !u!1001 &500
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: dddddddddddddddddddddddddddddddd, type: 3}
--- !u!114 &502 stripped
MonoBehaviour:
  m_CorrespondingSourceObject: {fileID: 200, guid: dddddddddddddddddddddddddddddddd, type: 3}
  m_PrefabInstance: {fileID: 500}
  m_GameObject: {fileID: 501}
  m_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
```

Assert:

```ts
expect(relations('prefab_instance_of')).toContainEqual(
  expect.objectContaining({
    sourceFile: 'Assets/Scenes/Main.unity',
    targetFile: 'Assets/Prefabs/Player.prefab',
  })
);
expect(relations('prefab_object_instance_of')).toHaveLength(1);
```

- [ ] **Step 2: Run and verify RED**

Expected: only file-level `scene_references_prefab` exists; stripped-object relation is absent.

- [ ] **Step 3: Implement `UnityResolutionIndex`**

Create:

```ts
import { Node } from '../../types';

export class UnityResolutionIndex {
  readonly localByFile = new Map<string, Map<string, string>>();
  readonly globalByGuidFileId = new Map<string, string>();
  readonly componentScriptClass = new Map<string, string>();
  readonly methodsByClass = new Map<string, Map<string, Node[]>>();

  addLocal(filePath: string, fileId: string, nodeId: string): void {
    let local = this.localByFile.get(filePath);
    if (!local) {
      local = new Map();
      this.localByFile.set(filePath, local);
    }
    local.set(fileId, nodeId);
  }

  addGlobal(guid: string, fileId: string, nodeId: string): void {
    this.globalByGuidFileId.set(`${guid}:${fileId}`, nodeId);
  }
}
```

- [ ] **Step 4: Register every YAML anchor globally**

For every Unity anchor node:

```ts
const assetGuid = guidByAssetPath.get(node.filePath);
if (assetGuid) {
  resolutionIndex.addGlobal(assetGuid, fileId, node.id);
}
```

This must include GameObjects, components, ScriptableObject child objects, and file-level assets.

- [ ] **Step 5: Extract and resolve `m_CorrespondingSourceObject`**

Emit:

```ts
rawUnityEdge(this.filePath, node.id, 'references', 'prefab_object_instance_of', {
  guid: corresponding.guid,
  fileID: unityFileIdKey(corresponding.fileID),
})
```

Resolve exact `GUID:fileID`; do not fall back to the prefab file node for this relation.

- [ ] **Step 6: Normalize file-level prefab relation**

Use `prefab_instance_of` for `PrefabInstance.m_SourcePrefab`. Keep compatibility by accepting existing `scene_references_prefab` in query/UI code during migration, but emit only the new normalized relation after this task.

- [ ] **Step 7: Run object graph tests**

Expected: PASS.

- [ ] **Step 8: Persist new resolver module and patch**

Add `unity-resolution-index.ts` to `custom/new` and generate `custom/patches/24-unity-prefab-object-resolution.patch`.

---

## Task 7: Resolve UnityEvents for Local, External, Overloaded, and Overridden Targets

**Files:**
- Modify: `codegraph/src/extraction/unity/unity-asset-extractor.ts`
- Modify: `codegraph/src/resolution/unity/unity-reference-resolver.ts`
- Modify: `custom/new/src/resolution/unity/unity-resolution-index.ts`
- Create: `custom/new/__tests__/unity-event-resolution.test.ts`
- Patch: `custom/patches/25-unity-event-and-prefab-overrides.patch`

- [ ] **Step 1: Add a local-target failing test**

Use a prefab where a Button event targets another local MonoBehaviour:

```yaml
m_OnClick:
  m_PersistentCalls:
    m_Calls:
    - m_Target: {fileID: 200}
      m_TargetAssemblyTypeName: PlayerController, Game
      m_MethodName: Respawn
      m_Mode: 1
```

Assert one `unity_event_calls_method` edge targets `PlayerController.Respawn`.

- [ ] **Step 2: Add overload fixtures**

Add:

```csharp
public void SetCount() {}
public void SetCount(int value) {}
```

Create event metadata with `m_Mode: 3` and assert the selected method signature has one integer parameter.

- [ ] **Step 3: Run and verify RED**

Expected: local target is skipped because current extractor requires `target.guid`; overload map keeps only one method per name.

- [ ] **Step 4: Extract any non-null event target**

Replace the GUID-only condition:

```ts
if (isRef(target) && typeof methodName === 'string' && methodName.length > 0) {
  const fileID = unityFileIdKey(target.fileID);
  if (!fileID || fileID === '0') continue;
  unityRawEdges.push(rawUnityEdge(
    this.filePath,
    component.id,
    'references',
    'unity_event_calls_method',
    {
      fieldName,
      guid: typeof target.guid === 'string' ? target.guid : undefined,
      fileID,
      methodName,
      mode: call?.m_Mode,
      targetAssemblyTypeName: call?.m_TargetAssemblyTypeName,
      objectArgumentAssemblyTypeName: call?.m_Arguments?.m_ObjectArgumentAssemblyTypeName,
    }
  ));
}
```

- [ ] **Step 5: Index all method overloads**

Store:

```ts
Map<classNodeId, Map<methodName, Node[]>>
```

Do not use `Map<methodName, id>`.

- [ ] **Step 6: Resolve target object before method**

Resolution order:

```ts
const targetObjectId = metadata.guid
  ? index.globalByGuidFileId.get(`${metadata.guid}:${metadata.fileID}`)
  : index.localByFile.get(edge.filePath)?.get(metadata.fileID);

const targetClassId =
  index.componentScriptClass.get(targetObjectId ?? '') ??
  directScriptGuidClassId(metadata.guid);
```

Then select methods by `methodName`.

- [ ] **Step 7: Select overload by Unity event mode**

Implement:

```ts
function expectedParameterType(mode: number | undefined): string | null {
  switch (mode) {
    case 1: return 'void';
    case 2: return 'UnityEngine.Object';
    case 3: return 'int';
    case 4: return 'float';
    case 5: return 'string';
    case 6: return 'bool';
    default: return null;
  }
}
```

Selection:

- Mode `1`: method with zero parameters.
- Modes `2..6`: method with one compatible parameter.
- Mode `0` or unknown: use exact name only if one candidate exists.
- If still ambiguous, do not create an edge. Record unresolved metadata including candidate IDs.

- [ ] **Step 8: Parse prefab modifications**

For each `PrefabInstance.m_Modification.m_Modifications` entry, emit:

```ts
rawUnityEdge(this.filePath, prefabInstanceNode.id, 'references', 'prefab_override_targets', {
  guid: modification.target?.guid,
  fileID: unityFileIdKey(modification.target?.fileID),
  propertyPath: modification.propertyPath,
  value: modification.value,
  objectReferenceGuid: modification.objectReference?.guid,
  objectReferenceFileID: unityFileIdKey(modification.objectReference?.fileID),
})
```

Group modifications by `target GUID:fileID` and persistent-call array index parsed from `propertyPath`. Apply overridden `m_Target`, `m_MethodName`, and argument fields before final UnityEvent method resolution.

- [ ] **Step 9: Run focused UnityEvent tests**

Run:

```powershell
rtk npm test -- --run __tests__/unity-event-resolution.test.ts
```

Expected: PASS for local, external, overload, and prefab override cases.

- [ ] **Step 10: Persist changes**

Synchronize custom/new files and generate `custom/patches/25-unity-event-and-prefab-overrides.patch`.

---

## Task 8: Index All First-Party YAML Asset Types

**Files:**
- Modify: `codegraph/src/extraction/unity-preset.ts`
- Modify: `codegraph/src/extraction/grammars.ts`
- Modify: `codegraph/src/extraction/unity/unity-asset-extractor.ts`
- Test: `custom/new/__tests__/unity-imported-assets.test.ts`
- Patch: `custom/patches/26-unity-yaml-asset-coverage.patch`

- [ ] **Step 1: Add extension coverage tests**

Test these extensions:

```ts
const yamlExtensions = [
  '.mat',
  '.anim',
  '.controller',
  '.overrideController',
  '.renderTexture',
  '.mixer',
  '.preset',
  '.signal',
  '.terrainlayer',
  '.spriteatlas',
  '.spriteatlasv2',
  '.asmref',
];
```

For each, assert:

```ts
expect(isSourceFile(`Assets/Data/Test${ext}`)).toBe(true);
expect(detectLanguage(`Assets/Data/Test${ext}`, yamlBody)).toBe('unity_asset');
```

Also assert the same files remain excluded when `CODEGRAPH_UNITY_ASSETS` is not enabled.

- [ ] **Step 2: Run and verify RED**

Expected: most listed extensions are absent from `UNITY_ASSET_NODE_EXTENSIONS`.

- [ ] **Step 3: Separate full-asset coverage from permanent skip documentation**

Create:

```ts
export const UNITY_YAML_NODE_EXTENSIONS = new Set([
  '.prefab', '.unity', '.asset',
  '.mat', '.anim', '.controller', '.overridecontroller',
  '.rendertexture', '.mixer', '.preset', '.signal', '.terrainlayer',
  '.spriteatlas', '.spriteatlasv2',
]);

export const UNITY_IMPORTED_NODE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.tga', '.psd', '.webp', '.bmp', '.tif', '.tiff',
  '.fbx', '.obj', '.blend', '.dae', '.3ds', '.dxf',
  '.wav', '.mp3', '.ogg', '.aiff', '.aif', '.flac',
  '.ttf', '.otf',
  '.mp4', '.mov', '.webm',
  '.bytes',
]);
```

`UNITY_ASSET_NODE_EXTENSIONS` becomes the union of YAML, imported, and existing JSON/text extensions. Keep ignore directories unchanged.

- [ ] **Step 4: Detect YAML by content**

For any first-party file admitted by the Unity asset gate:

```ts
if (isUnityTextAsset(content)) return 'unity_asset';
```

This supports compatible Unity YAML files even when a new extension is introduced. Imported/binary files remain file-level only.

- [ ] **Step 5: Use generic file kind fallback**

Unknown or newly supported YAML file extensions use `unity_asset`. Do not add a NodeKind for every Unity extension.

- [ ] **Step 6: Run mode-selection and imported-asset tests**

Expected: PASS and existing csharp-only isolation remains green.

- [ ] **Step 7: Persist preset/grammar changes**

Synchronize `custom/new/src/extraction/unity-preset.ts` and generate `custom/patches/26-unity-yaml-asset-coverage.patch`.

---

## Task 9: Materialize Imported/Binary Assets and Generic Sub-Assets from `.meta`

**Files:**
- Create: `custom/new/src/extraction/unity/unity-meta-extractor.ts`
- Modify: `codegraph/src/extraction/unity/unity-guid-index.ts`
- Modify: `codegraph/src/extraction/index.ts`
- Modify: `custom/new/src/extraction/unity/unity-guid-index.ts`
- Test: `custom/new/__tests__/unity-imported-assets.test.ts`
- Patch: `custom/patches/27-unity-imported-asset-nodes.patch`

- [ ] **Step 1: Add failing imported asset tests**

Create metadata for:

- Texture with sprites.
- FBX with named Mesh and AnimationClip IDs in `fileIDToRecycleName`.
- Audio file.
- Font file.
- Unknown binary first-party file.

Assert:

```ts
expect(node('Assets/Models/Hero.fbx')).toBeDefined();
expect(node('HeroMesh')).toBeDefined();
expect(node('Run')).toBeDefined();
expect(node('Assets/Audio/Click.wav')).toBeDefined();
expect(node('Assets/Fonts/Main.ttf')).toBeDefined();
expect(node('Assets/Data/Table.bin')).toBeDefined();
expect(relation('asset_contains_subasset', 'Hero.fbx', 'HeroMesh')).toBe(true);
```

- [ ] **Step 2: Run and verify RED**

Expected: only currently whitelisted image/text files produce nodes; FBX/audio/font/unknown binary are absent.

- [ ] **Step 3: Implement importer metadata parsing**

Create:

```ts
export interface UnityMetaSubAsset {
  fileId: string;
  name: string;
}

export function parseNamedSubAssets(metaContent: string): UnityMetaSubAsset[] {
  const names = new Map<string, string>();
  let inRecycleTable = false;

  for (const line of metaContent.split(/\r?\n/)) {
    if (/^\s*(fileIDToRecycleName|internalIDToNameTable):\s*$/.test(line)) {
      inRecycleTable = true;
      continue;
    }
    if (inRecycleTable && /^\S/.test(line)) inRecycleTable = false;
    if (!inRecycleTable) continue;

    const direct = /^\s+(-?\d+):\s*(.+?)\s*$/.exec(line);
    if (direct) names.set(direct[1]!, unquoteYamlScalar(direct[2]!));
  }

  collectInternalIdTableNames(metaContent, names);
  collectSpriteSheetNames(metaContent, names);

  return [...names].map(([fileId, name]) => ({ fileId, name }));
}
```

Reuse the existing 64-bit-safe string handling.

- [ ] **Step 4: Expand asset classification**

Classify only for display/filter purposes:

```ts
export type UnityAssetType =
  | 'script' | 'prefab' | 'scene' | 'asset' | 'asmdef' | 'asmref'
  | 'image' | 'model' | 'audio' | 'font' | 'video'
  | 'sprite' | 'subasset' | 'folder' | 'other';
```

All types may still materialize as existing `unity_asset` nodes except images/sprites and existing specialized kinds.

- [ ] **Step 5: Materialize imported asset nodes post-catalog**

In `resolveUnityAssetEdges`, before resolving edges:

```ts
const importedNodes = guidRows
  .filter((row) => row.fileId === '0' && isImportedOrOpaque(row.assetType))
  .map((row) => makeUnityCatalogNode(row, row.assetPath));

const subAssetNodes = guidRows
  .filter((row) => row.fileId !== '0' && row.name)
  .map((row) => makeUnityCatalogNode(row, row.name!));
```

Use `generateUnityNodeId(row.guid, kind, row.fileId)` and add `asset_contains_subasset` edges from the file node to each named sub-asset.

- [ ] **Step 6: Add catalog assets to the indexed file set**

After normal source scanning, union in all current catalog asset paths:

```ts
const catalogFiles = this.queries.getUnityGuidRows()
  .filter((row) =>
    row.fileId === '0' &&
    row.assetType !== 'folder' &&
    row.assetType !== 'script' &&
    fs.existsSync(path.join(this.rootDir, row.assetPath))
  )
  .map((row) => row.assetPath);

const files = [...new Set([...scannedFiles, ...catalogFiles])];
```

This includes unknown first-party binaries with `.meta` sidecars and puts them in the normal `files` table. A later delete or rename is therefore removed by Task 2 reconciliation.

- [ ] **Step 7: Avoid reading binary contents as UTF-8**

In bulk indexing, detect imported file-level assets before `readFile`:

```ts
if (isUnityImportedAssetPath(filePath)) {
  const stats = await fsp.stat(fullPath);
  return { filePath, content: '', stats, error: null };
}
```

Their nodes come from the GUID catalog; they do not need content parsing.

- [ ] **Step 8: Create file records for opaque imported assets**

For an opaque catalog file, create an extraction result containing its deterministic file-level Unity node and no parsed children. Store it through `storeExtractionResult` with a content hash derived from the owning `.meta` content plus file size/mtime:

```ts
const metaContent = fs.readFileSync(`${fullPath}.meta`, 'utf8');
const content = `unity-imported:${stats.size}:${Math.floor(stats.mtimeMs)}:${hashContent(metaContent)}`;
```

This avoids reading binary bytes while preserving change detection.

- [ ] **Step 9: Run imported asset tests**

Expected: PASS.

- [ ] **Step 10: Run a node-count idempotency test**

Index the same fixture twice and assert equal node/edge counts.

- [ ] **Step 11: Persist new module and patch**

Add `unity-meta-extractor.ts` under `custom/new`, synchronize GUID index, and generate `custom/patches/27-unity-imported-asset-nodes.patch`.

---

## Task 10: Preserve Ignore Boundaries

**Files:**
- Modify: `custom/new/__tests__/unity-ignore.test.ts`
- Modify: `codegraph/__tests__/unity-ignore.test.ts` through overlay
- Inspect: `codegraph/src/extraction/unity-preset.ts`

- [ ] **Step 1: Add explicit exclusion regressions**

Create representative files under:

```text
Library/
Packages/
Assets/Plugins/
Assets/Editor/
Assets/Firebase/
Assets/DOTween/
Assets/GeneratedLocalRepo/
```

Add first-party control files under:

```text
Assets/Prefabs/
Assets/Models/
Assets/Audio/
Assets/Data/
```

Assert `scanDirectory` includes controls and excludes every ignored location.

- [ ] **Step 2: Run tests before implementation**

Expected: controls newly added in Tasks 8-9 may fail until extension coverage is active; ignored paths must already remain absent.

- [ ] **Step 3: Fix only regressions**

Do not weaken:

```ts
UNITY_ENGINE_IGNORE_DIRS
UNITY_SDK_DIRS
UNITY_ASSET_MODE_IGNORE_DIRS
```

If an imported extension requires scanning, add the extension gate only. Do not remove ignored directory names.

- [ ] **Step 4: Run ignore suite**

Run:

```powershell
rtk npm test -- --run __tests__/unity-ignore.test.ts __tests__/unity-asset-mode-selection.test.ts
```

Expected: PASS.

---

## Task 11: Remove Dangling Unity Edges and Report Missing Targets Precisely

**Files:**
- Modify: `codegraph/src/resolution/unity/unity-reference-resolver.ts`
- Modify: `codegraph/src/extraction/index.ts`
- Test: `custom/new/__tests__/unity-object-graph.test.ts`
- Test: `custom/new/__tests__/unity-event-resolution.test.ts`
- Patch: `custom/patches/28-unity-resolution-validation.patch`

- [ ] **Step 1: Add missing-target tests**

Cover:

- Missing script GUID.
- Missing serialized asset GUID.
- UnityEvent target exists but method is missing.
- UnityEvent overload remains ambiguous.

Expected graph behavior:

```ts
expect(relation('missing_script')).toHaveLength(1);
expect(relation('missing_asset')).toHaveLength(1);
expect(relation('unity_event_calls_method')).toHaveLength(0);
expect(unresolved('MissingMethod')).toHaveLength(1);
```

- [ ] **Step 2: Run and verify RED**

Expected: missing non-script assets are silently dropped and ambiguous methods are not recorded.

- [ ] **Step 3: Use typed placeholders**

Create placeholder names:

```ts
Missing script <guid-prefix>
Missing asset <guid-prefix>
Missing object <guid-prefix>:<fileID>
```

Use deterministic GUID/fileID-based IDs so repeated indexing does not duplicate placeholders.

- [ ] **Step 4: Record unresolved UnityEvent metadata**

Write unresolved references with:

```ts
{
  fromNodeId: edge.source!,
  referenceName: metadata.methodName,
  referenceKind: 'references',
  line: edge.line ?? 1,
  column: edge.column ?? 0,
  candidates: candidateIds,
  filePath: edge.filePath,
  language: 'unity_asset',
}
```

- [ ] **Step 5: Validate endpoints before insertion**

Keep the existing database endpoint checks. Additionally deduplicate Unity edges by:

```ts
`${source}|${target}|${kind}|${unityRelation}|${fieldPath ?? ''}|${methodName ?? ''}`
```

before `insertEdges`.

- [ ] **Step 6: Run missing-target tests**

Expected: PASS.

- [ ] **Step 7: Persist validation patch**

Generate `custom/patches/28-unity-resolution-validation.patch`.

---

## Task 12: Dashboard and Query Surface Verification

**Files:**
- Test: `web/server/__tests__/graph-filter.test.mjs`
- Test: CodeGraph Unity integration tests

- [ ] **Step 1: Extend mapper tests for generic imported nodes**

Verify existing labels cover:

```js
unity_asset
unity_image
unity_sprite
unity_json
unity_text
unity_gameobject
unity_component
```

Generic model/audio/font/video/sub-assets intentionally use `UnityAsset`; do not add frontend labels unless a real usability problem appears.

- [ ] **Step 2: Verify component display names**

Assert mapped node properties preserve:

```text
Player / PlayerController
PlayButton / Button
Items / ItemDatabase
```

- [ ] **Step 3: Run server tests**

Run:

```powershell
node --test server/__tests__/graph-filter.test.mjs
```

Workdir: `web`

Expected: PASS.

No production dashboard change is planned in this task. A failing mapper/build test blocks completion and requires returning to the task whose new NodeKind or graph shape caused the mismatch.

- [ ] **Step 4: Build frontend**

Run:

```powershell
rtk npm run build
```

Workdir: `web`

Expected: PASS.

- [ ] **Step 5: Verify impact/query behavior**

Existing `codegraph_impact PlayerController` must still include prefab/scene attachments. Default symbol search must not become dominated by imported sub-assets.

---

## Task 13: Overlay Durability and Full Verification

**Files:**
- Modify: `custom/patches/20-*.patch` through `custom/patches/28-*.patch` as needed
- Modify: `custom/new/**` files created above
- Modify: `docs/design/unity-full-asset-pass-bar.md`

- [ ] **Step 1: Reapply the complete overlay**

Run:

```powershell
rtk bash update.sh --apply-custom-only
```

Expected: all patches apply once, no rejected hunks, no nested `.git`.

- [ ] **Step 2: Build CodeGraph**

Run:

```powershell
rtk npm run build
```

Workdir: `codegraph`

Timeout: 120 seconds.

Expected: PASS.

- [ ] **Step 3: Run focused Unity suites**

Run:

```powershell
rtk npm test -- --run __tests__/unity-index-reconcile.test.ts __tests__/unity-object-graph.test.ts __tests__/unity-event-resolution.test.ts __tests__/unity-imported-assets.test.ts __tests__/unity-ignore.test.ts __tests__/unity-asset-mode-selection.test.ts
```

Workdir: `codegraph`

Timeout: 120 seconds.

Expected: PASS.

- [ ] **Step 4: Run existing integration and sync suites**

Run:

```powershell
rtk npm test -- --run __tests__/sync.test.ts __tests__/integration/full-pipeline.test.ts
```

Timeout: 120 seconds.

Expected: PASS.

- [ ] **Step 5: Run full CodeGraph test suite**

Run:

```powershell
rtk npm test
```

Timeout: 180 seconds.

Expected: PASS. If the suite exceeds the timeout, stop and report the timeout; do not silently rerun indefinitely.

- [ ] **Step 6: Run web verification**

Run:

```powershell
node --test server/__tests__/graph-filter.test.mjs
rtk npm run build
```

Workdir: `web`

Expected: PASS.

- [ ] **Step 7: End-to-end rename and idempotency smoke**

On a temporary fixture:

1. Run `unity index --assets`.
2. Rename one prefab while preserving its `.meta`.
3. Run `unity index --assets` again.
4. Confirm no old path remains.
5. Confirm stable Unity IDs for the renamed prefab objects.
6. Run index a third time.
7. Confirm node and edge counts do not increase.

- [ ] **Step 8: Update pass-bar documentation**

Add results to `docs/design/unity-full-asset-pass-bar.md`:

```markdown
## Completeness pass

| Scenario | Expected | Result |
| --- | --- | --- |
| Rename with preserved GUID | No stale node/GUID; stable object IDs | Pass/Fail |
| ScriptableObject | `Items / ItemDatabase` + references | Pass/Fail |
| Local UnityEvent | Resolves to target method | Pass/Fail |
| Prefab override UnityEvent | Resolves overridden target/method | Pass/Fail |
| Imported assets | File + named sub-assets from `.meta` | Pass/Fail |
| Ignore boundaries | Plugin/SDK/Library remain absent | Pass/Fail |
| Re-index idempotency | Stable node/edge counts | Pass/Fail |
```

Do not mark a row Pass without command output or database assertions supporting it.

---

## Self-Review Checklist

- [ ] Rename/delete reconciliation is covered for both `files/nodes` and `unity_guids`.
- [ ] Unity IDs are path-independent when `.meta` GUID is preserved.
- [ ] Component display names are enriched after script resolution.
- [ ] ScriptableObjects with `m_GameObject.fileID = 0` become graph objects.
- [ ] Every YAML anchor is addressable through local fileID and global `GUID:fileID`.
- [ ] Stripped prefab objects link to source objects.
- [ ] UnityEvents support local, external, overloaded, and prefab-overridden targets.
- [ ] Hierarchy links map Transform relationships to GameObjects.
- [ ] YAML asset coverage is content-aware and extension-compatible.
- [ ] Imported/binary assets do not require UTF-8 parsing.
- [ ] Generic named sub-assets are parsed from importer metadata with 64-bit-safe fileIDs.
- [ ] Ignore directories and prior noise exclusions are unchanged.
- [ ] Missing/ambiguous targets produce placeholders or unresolved records, never incorrect edges.
- [ ] Re-indexing is idempotent.
- [ ] Wrapper overlay can reproduce the working upstream tree from scratch.
