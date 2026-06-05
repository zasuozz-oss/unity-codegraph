# Unity Full Asset-Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: dùng `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans` để thực thi từng task. Step dùng checkbox `- [ ]`. Spec nguồn: `docs/codegraph_unity_full_asset_spec.md`.

**Goal:** CodeGraph index được quan hệ asset Unity (prefab/scene/ScriptableObject/asmdef ↔ C#) ở một mode mới `full-asset`, không phá mode `default`/`csharp-only`.

**Architecture:** Mode thứ ba bật bằng `CODEGRAPH_UNITY_ASSETS=1` + marker. Gate duy nhất `isSourceFile()` mở cho asset; dispatch trong `extractFromSource()` route asset sang extractor mới; GUID index (`.meta`) lưu ở bảng phụ `unity_guids`; resolver post-extract nối edge. Tái dùng `contains`/`references` + `metadata.unityRelation`, không bơm `EdgeKind`.

**Tech Stack:** TypeScript, vitest, `yaml@^2.9.0`, CodeGraph `node:sqlite` adapter, tree-sitter (C#).

---

## Conventions (đọc trước mọi Phase)

- **Thư mục làm việc khi build/test:** `codegraph/` (upstream clone gitignored). Mọi path `src/...`, `__tests__/...` dưới đây là **upstream-relative**.
- **Nguồn lưu bền trong repo wrapper:** không commit trong `codegraph/`. File mới phải được đặt ở `custom/new/<upstream-relative-path>`. Sửa file upstream phải được regenerate vào `custom/patches/05-unity-full-asset-graph.patch` bằng `cd codegraph && git diff HEAD -- <paths> > ../custom/patches/05-unity-full-asset-graph.patch`, rồi kiểm bằng `cd .. && ./update.sh --apply-custom-only`.
- **Quy tắc overlay cho từng task:** khi một step nói `Create: src/foo.ts`, tạo/đặt bản tracked tại `custom/new/src/foo.ts`; khi một step nói `Modify: src/foo.ts`, sửa trong `codegraph/src/foo.ts` để test, sau đó cập nhật patch `custom/patches/05-unity-full-asset-graph.patch`.
- **Build:** `npm run build` (tsc + copy `schema.sql`/`*.wasm` vào `dist/`). Mọi thay đổi `schema.sql` PHẢI build lại để vào `dist/`.
- **Chạy 1 test:** `npx vitest run __tests__/unity/<file>.test.ts -t "<tên>"`.
- **Chạy cả suite Unity:** `npx vitest run __tests__/unity`.
- **Node engine:** theo `codegraph/package.json` hiện tại là `>=20 <25`; khi chạy từ source cần runtime có `node:sqlite`.
- **Git workflow:** KHÔNG commit/branch/worktree trong plan này trừ khi user yêu cầu trực tiếp. Các step "Commit" nếu còn sót chỉ được hiểu là "đồng bộ overlay + chạy verify", không chạy `git commit`.
- **Mode bật trong test:** set `process.env.CODEGRAPH_UNITY_ASSETS = '1'` trong `beforeEach`, xoá ở `afterEach` (tránh rò mode sang test khác).
- **API đã xác minh trong codebase** (dùng nguyên, đừng phát minh):
  - Tạo node id: `generateNodeId(filePath, kind, name, line)` từ `src/extraction/tree-sitter-helpers`.
  - `ExtractionResult = { nodes: Node[]; edges: Edge[]; unresolvedReferences: UnresolvedReference[]; errors: ExtractionError[]; durationMs: number }`.
  - `Edge = { source; target; kind: EdgeKind; metadata?; line?; column?; provenance? }`.
  - Extractor pattern: class `(filePath, source)` có method `extract(): ExtractionResult` (xem `src/extraction/svelte-extractor.ts`).
  - Dispatch: chuỗi `else if` trong `extractFromSource()` tại `src/extraction/tree-sitter.ts:3071`.
  - Persist tự động: `index.ts` gọi `storeExtractionResult` → `queries.insertNodes/insertEdges`.
  - Migration: mảng `migrations` + `CURRENT_SCHEMA_VERSION` trong `src/db/migrations.ts`.
  - `CodeGraph` public API: dùng `await CodeGraph.init(root)` hoặc `CodeGraph.initSync(root)`; constructor là private.
  - `searchNodes()` trả `SearchResult[]`; truy node bằng `result.node`, ví dụ `cg.searchNodes('Player').some((r) => r.node.kind === 'class')`.

---

# PHASE 0 — Mode `full-asset` + CLI + fixture + isolation

**Mục tiêu ship:** `CODEGRAPH_UNITY_ASSETS=1 codegraph unity index` chạy được (chưa parse asset), và test chứng minh mode `csharp-only` KHÔNG tạo node Unity.

**Files:**
- Modify: `src/extraction/unity-mode.ts`
- Modify: `src/bin/codegraph.ts:1752` (lệnh `unity`)
- Create: `__tests__/unity/fixtures/MiniProject/` (xem Task 0.3)
- Create: `__tests__/unity/unity-asset-mode.test.ts`

### Task 0.1: Hàm mode `full-asset`

- [ ] **Step 1 — Test fail trước**

Tạo `__tests__/unity/unity-asset-mode.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  isUnityAssetMode, enableUnityAssetMode,
} from '../../src/extraction/unity-mode';

describe('unity asset mode flag', () => {
  afterEach(() => { delete process.env.CODEGRAPH_UNITY_ASSETS; delete process.env.CODEGRAPH_UNITY; });

  it('is off by default', () => {
    expect(isUnityAssetMode()).toBe(false);
  });

  it('enableUnityAssetMode turns on BOTH asset mode and base unity mode', () => {
    enableUnityAssetMode();
    expect(isUnityAssetMode()).toBe(true);
    expect(process.env.CODEGRAPH_UNITY).toBe('1'); // asset mode ⇒ unity mode
  });
});
```

- [ ] **Step 2 — Chạy, xác nhận fail**

Run: `npx vitest run __tests__/unity/unity-asset-mode.test.ts`
Expected: FAIL — `isUnityAssetMode is not a function`.

- [ ] **Step 3 — Implement** trong `src/extraction/unity-mode.ts` (thêm cuối file, gương các hàm sẵn có):
```ts
/** True when the current process should extract Unity *assets* (not just C#). */
export function isUnityAssetMode(): boolean {
  return process.env.CODEGRAPH_UNITY_ASSETS === '1';
}

/** Force full-asset mode on. Implies base Unity mode. */
export function enableUnityAssetMode(): void {
  process.env.CODEGRAPH_UNITY_ASSETS = '1';
  enableUnityMode(); // asset mode is a superset of csharp-only unity mode
}

function assetMarkerPath(projectRoot: string): string {
  return path.join(projectRoot, '.codegraph', 'unity-assets');
}

/** Persist the per-project full-asset marker. */
export function writeUnityAssetMarker(projectRoot: string): void {
  try {
    fs.writeFileSync(assetMarkerPath(projectRoot), 'Unity full-asset extraction enabled.\n');
  } catch { /* non-fatal */ }
}

/** Whether this project was initialized in full-asset mode. */
export function hasUnityAssetMarker(projectRoot: string): boolean {
  try { return fs.existsSync(assetMarkerPath(projectRoot)); } catch { return false; }
}

/** If the project carries the full-asset marker, enable full-asset mode. */
export function enableUnityAssetModeIfMarked(projectRoot: string): void {
  if (hasUnityAssetMarker(projectRoot)) enableUnityAssetMode();
}
```

- [ ] **Step 4 — Chạy, xác nhận pass**

Run: `npx vitest run __tests__/unity/unity-asset-mode.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 0.2: CLI `--assets` cho lệnh `unity`

- [ ] **Step 1 — Đọc** `src/bin/codegraph.ts:1752-1800` để thấy cách lệnh `unity` re-dispatch argv và gọi `enableUnityMode()/writeUnityMarker()`.

- [ ] **Step 2 — Implement**: trong action của `.command('unity [command...]')`, giữ nguyên cơ chế redispatch hiện có nhưng strip cờ `--assets` trước khi gọi subcommand thật:
```ts
import {
  enableUnityAssetMode,
  writeUnityAssetMarker,
  enableUnityMode,
  writeUnityMarker,
} from '../extraction/unity-mode';

// Existing code already finds the literal `unity` token and builds `forwarded`.
const wantAssets = forwarded.includes('--assets');
const strippedForwarded = forwarded.filter((a) => a !== '--assets');

if (wantAssets) {
  enableUnityAssetMode();
} else {
  enableUnityMode();
}

const sub = strippedForwarded[0];
if (sub === 'init' || sub === 'index' || sub === 'sync') {
  const pathArg = strippedForwarded.slice(1).find((a) => !a.startsWith('-'));
  const projectPath = path.resolve(pathArg || process.cwd());
  process.once('exit', () => {
    if (wantAssets) writeUnityAssetMarker(projectPath);
    else writeUnityMarker(projectPath);
  });
}

await program.parseAsync(['node', 'codegraph', ...strippedForwarded]);
```
(Điểm quan trọng: không dùng `process.argv.includes('--assets')` sau khi forward nguyên cờ, vì subcommand thật không biết `--assets`; phải strip khỏi argv trước `parseAsync`.)

- [ ] **Step 3 — Đọc marker khi sync/serve**: ở chỗ `sync`/`serve --mcp` đang gọi `enableUnityModeIfMarked(projectRoot)`, thêm `enableUnityAssetModeIfMarked(projectRoot)` ngay sau (asset marker bật cả hai).

- [ ] **Step 4 — Build + smoke**

Run: `npm run build && node dist/bin/codegraph.js unity --help`
Expected: lệnh chạy, không lỗi; `--assets` được chấp nhận (không crash).

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 0.3: Fixture MiniProject

- [ ] **Step 1 — Tạo cây file** dưới `__tests__/unity/fixtures/MiniProject/`. Nội dung tối thiểu (GUID cố định để test assert):

`Assets/Scripts/PlayerController.cs`
```csharp
using UnityEngine;
public class PlayerController : MonoBehaviour {
    [SerializeField] private ItemDatabase database;
    public float speed = 5f;
    void Update() { }
}
```
`Assets/Scripts/PlayerController.cs.meta`
```yaml
fileFormatVersion: 2
guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
MonoImporter:
  executionOrder: 0
```
`Assets/Scripts/ItemDatabase.cs`
```csharp
using UnityEngine;
[CreateAssetMenu]
public class ItemDatabase : ScriptableObject { public int count; }
```
`Assets/Scripts/ItemDatabase.cs.meta`
```yaml
fileFormatVersion: 2
guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```
`Assets/ScriptableObjects/Items.asset.meta`
```yaml
fileFormatVersion: 2
guid: cccccccccccccccccccccccccccccccc
```
`Assets/ScriptableObjects/Items.asset`
```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}
  m_Name: Items
  count: 7
```
`Assets/Prefabs/Player.prefab.meta`
```yaml
fileFormatVersion: 2
guid: dddddddddddddddddddddddddddddddd
```
`Assets/Prefabs/Player.prefab`
```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: Player
  m_Component:
  - component: {fileID: 200}
--- !u!114 &200
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
  database: {fileID: 11400000, guid: cccccccccccccccccccccccccccccccc, type: 2}
  speed: 9
```
`Assets/Prefabs/Broken.prefab.meta`
```yaml
fileFormatVersion: 2
guid: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
```
`Assets/Prefabs/Broken.prefab` (missing-script: guid không tồn tại)
```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &300
GameObject:
  m_Name: Broken
  m_Component:
  - component: {fileID: 400}
--- !u!114 &400
MonoBehaviour:
  m_GameObject: {fileID: 300}
  m_Script: {fileID: 11500000, guid: ffffffffffffffffffffffffffffffff, type: 3}
```
`Assets/Scenes/Main.unity.meta`
```yaml
fileFormatVersion: 2
guid: 11111111111111111111111111111111
```
`Assets/Scenes/Main.unity`
```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &500
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: dddddddddddddddddddddddddddddddd, type: 3}
```
`ProjectSettings/ProjectVersion.txt`
```
m_EditorVersion: 2022.3.0f1
```
`ProjectSettings/EditorSettings.asset`
```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!159 &1
EditorSettings:
  m_SerializationMode: 2
```
`__tests__/unity/fixtures/MiniProject/.binaryasset` (test graceful skip — KHÔNG phải %YAML)
```
This is not a YAML file. Binary-ish content.
```

- [ ] **Step 2 — Đồng bộ overlay (không commit)** (chưa có test logic, chỉ fixture)
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 0.4: Test isolation — csharp-only KHÔNG tạo node Unity

- [ ] **Step 1 — Test** (append vào `unity-asset-mode.test.ts`):
```ts
import { CodeGraph } from '../../src/index';
import * as fsp from 'fs';
import * as os from 'os';
import * as pathlib from 'path';

function copyFixture(): string {
  const dst = fsp.mkdtempSync(pathlib.join(os.tmpdir(), 'cg-unity-'));
  fsp.cpSync(pathlib.join(__dirname, 'fixtures', 'MiniProject'), dst, { recursive: true });
  return dst;
}

describe('mode isolation', () => {
  afterEach(() => { delete process.env.CODEGRAPH_UNITY_ASSETS; delete process.env.CODEGRAPH_UNITY; });

  it('csharp-only mode produces ZERO unity_* nodes', async () => {
    process.env.CODEGRAPH_UNITY = '1';           // csharp-only, NOT assets
    const root = copyFixture();
    const cg = await CodeGraph.init(root);
    try {
      await cg.indexAll();
      const unity = cg.searchNodes('', { kinds: ['unity_scene','unity_prefab','unity_asset','unity_gameobject','unity_component','unity_script'] as any });
      expect(unity.length).toBe(0);
      // C# class vẫn được index; searchNodes returns SearchResult[], not Node[].
      const cls = cg.searchNodes('PlayerController');
      expect(cls.some((r) => r.node.kind === 'class')).toBe(true);
    } finally {
      cg.close();
      fsp.rmSync(root, { recursive: true, force: true });
    }
  });
});
```
> API này đã đối chiếu với `src/index.ts`: constructor `CodeGraph` là private; dùng `await CodeGraph.init(root)`. `searchNodes()` trả `SearchResult[]`, nên truy qua `.node`.

- [ ] **Step 2 — Chạy**

Run: `npx vitest run __tests__/unity/unity-asset-mode.test.ts -t "mode isolation"`
Expected: PASS (vì chưa có Unity extractor nào, unity nodes = 0; C# class có).

- [ ] **Step 3 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

---

# PHASE 1 — Schema `unity_guids` + GUID index từ `.meta`

**Ship:** đọc tất cả `.meta` (không-ignore) → bảng `unity_guids`; lookup guid↔path. DB cũ tự nâng v4→v5.

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.ts`
- Create: `src/extraction/unity/unity-guid-index.ts`
- Create: `__tests__/unity/unity-guid-index.test.ts`

### Task 1.1: Schema + migration v5

- [ ] **Step 1 — Thêm bảng vào `src/db/schema.sql`** (cuối phần Core Tables):
```sql
-- Unity GUID → asset map (full-asset mode only)
CREATE TABLE IF NOT EXISTS unity_guids (
    guid         TEXT PRIMARY KEY,
    asset_path   TEXT NOT NULL,
    asset_type   TEXT NOT NULL,
    main_file_id INTEGER,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unity_guids_path ON unity_guids(asset_path);
```

- [ ] **Step 2 — Migration** trong `src/db/migrations.ts`: đổi `CURRENT_SCHEMA_VERSION = 4` → `5`, và thêm object cuối mảng `migrations`:
```ts
  {
    version: 5,
    description: 'Add unity_guids table for Unity full-asset GUID index',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS unity_guids (
          guid         TEXT PRIMARY KEY,
          asset_path   TEXT NOT NULL,
          asset_type   TEXT NOT NULL,
          main_file_id INTEGER,
          updated_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_unity_guids_path ON unity_guids(asset_path);
      `);
    },
  },
```

- [ ] **Step 3 — Test migration** (`__tests__/unity/unity-guid-index.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../src/db/migrations';

describe('schema version', () => {
  it('is bumped to 5 for unity_guids', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
  });
});
```

- [ ] **Step 4 — Build + chạy**

Run: `npm run build && npx vitest run __tests__/unity/unity-guid-index.test.ts -t "schema version"`
Expected: PASS.

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 1.2: `unity-guid-index.ts` — đọc `.meta`

- [ ] **Step 1 — Test** (append):
```ts
import { parseMetaGuid, classifyAsset } from '../../src/extraction/unity/unity-guid-index';

describe('parseMetaGuid', () => {
  it('extracts guid from a .meta body', () => {
    expect(parseMetaGuid('fileFormatVersion: 2\nguid: abc123\nMonoImporter:\n')).toBe('abc123');
  });
  it('returns null when no guid line', () => {
    expect(parseMetaGuid('fileFormatVersion: 2\n')).toBeNull();
  });
});

describe('classifyAsset', () => {
  it('classifies by owning file extension', () => {
    expect(classifyAsset('A/B/Player.cs')).toBe('script');
    expect(classifyAsset('A/B/Player.prefab')).toBe('prefab');
    expect(classifyAsset('A/B/Main.unity')).toBe('scene');
    expect(classifyAsset('A/B/Items.asset')).toBe('asset');
    expect(classifyAsset('A/B/SomeFolder')).toBe('folder'); // no extension ⇒ folder
  });
});
```

- [ ] **Step 2 — Chạy fail**

Run: `npx vitest run __tests__/unity/unity-guid-index.test.ts -t "parseMetaGuid"`
Expected: FAIL — module/function chưa tồn tại.

- [ ] **Step 3 — Implement** `src/extraction/unity/unity-guid-index.ts`:
```ts
import * as fs from 'fs';

export type UnityAssetType = 'script' | 'prefab' | 'scene' | 'asset' | 'folder' | 'other';

/** Pull `guid: <hex>` from a .meta file body (line-based; .meta is tiny). */
export function parseMetaGuid(metaContent: string): string | null {
  const m = metaContent.match(/^guid:\s*([0-9a-fA-F]+)\s*$/m);
  return m ? m[1] : null;
}

/** Asset path = .meta path minus the '.meta' suffix. Classify by its extension. */
export function classifyAsset(assetPath: string): UnityAssetType {
  const dot = assetPath.lastIndexOf('.');
  if (dot < 0) return 'folder';
  const ext = assetPath.slice(dot).toLowerCase();
  if (ext === '.cs') return 'script';
  if (ext === '.prefab') return 'prefab';
  if (ext === '.unity') return 'scene';
  if (ext === '.asset') return 'asset';
  return 'other';
}

export interface GuidRow { guid: string; assetPath: string; assetType: UnityAssetType; mainFileId: number | null; }

/** Read one .meta file → row (assetPath strips the trailing '.meta'). */
export function readMetaFile(metaPath: string): GuidRow | null {
  let content: string;
  try { content = fs.readFileSync(metaPath, 'utf8'); } catch { return null; }
  const guid = parseMetaGuid(content);
  if (!guid) return null;
  const assetPath = metaPath.replace(/\.meta$/, '');
  const assetType = classifyAsset(assetPath);
  // MonoScript main object is always fileID 11500000
  const mainFileId = assetType === 'script' ? 11500000 : null;
  return { guid, assetPath, assetType, mainFileId };
}
```

- [ ] **Step 4 — Chạy pass**

Run: `npx vitest run __tests__/unity/unity-guid-index.test.ts`
Expected: PASS (schema + parseMetaGuid + classifyAsset).

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 1.3: Persist GUID index vào bảng (integration trên fixture)

- [ ] **Step 1 — Test** (đọc toàn bộ `.meta` của MiniProject, ghi vào DB tạm, query lại). Append:
```ts
import { createDatabase } from '../../src/db/sqlite-adapter';
import { buildGuidIndex } from '../../src/extraction/unity/unity-guid-index';
import * as p2 from 'path';

describe('buildGuidIndex (integration)', () => {
  it('indexes every .meta under MiniProject into unity_guids', () => {
    const { db } = createDatabase(':memory:');
    db.exec(`CREATE TABLE unity_guids (guid TEXT PRIMARY KEY, asset_path TEXT NOT NULL, asset_type TEXT NOT NULL, main_file_id INTEGER, updated_at INTEGER NOT NULL);`);
    const root = p2.join(__dirname, 'fixtures', 'MiniProject');
    try {
      const count = buildGuidIndex(root, db);
      expect(count).toBeGreaterThanOrEqual(6);
      const row = db.prepare('SELECT asset_path, asset_type FROM unity_guids WHERE guid = ?').get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') as any;
      expect(row.asset_path.endsWith('PlayerController.cs')).toBe(true);
      expect(row.asset_type).toBe('script');
    } finally {
      db.close();
    }
  });
});
```
> `buildGuidIndex(root, db)` nhận `SqliteDatabase` từ adapter hiện tại của repo (`node:sqlite`), không import `better-sqlite3` trực tiếp. Walk bỏ qua dir trong `UNITY_ASSET_MODE_IGNORE_DIRS` (Phase 3 định nghĩa; Phase 1 tạm dùng `UNITY_ENGINE_IGNORE_DIRS` + SDK).

- [ ] **Step 2 — Chạy fail** → `buildGuidIndex is not a function`.

- [ ] **Step 3 — Implement** thêm vào `unity-guid-index.ts`:
```ts
import * as path from 'path';
import { UNITY_ENGINE_IGNORE_DIRS, UNITY_SDK_DIRS } from '../unity-preset';

const GUID_WALK_IGNORE = new Set<string>([...UNITY_ENGINE_IGNORE_DIRS, ...Object.keys(UNITY_SDK_DIRS), 'Packages']);

function* walkMeta(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!GUID_WALK_IGNORE.has(e.name)) yield* walkMeta(path.join(dir, e.name)); }
    else if (e.isFile() && e.name.endsWith('.meta')) yield path.join(dir, e.name);
  }
}

/** Read every .meta under root, upsert into unity_guids. Returns count indexed. */
export function buildGuidIndex(root: string, db: { prepare(sql: string): { run(...a: any[]): unknown } }): number {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO unity_guids (guid, asset_path, asset_type, main_file_id, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  let n = 0;
  const now = Date.now();
  for (const metaPath of walkMeta(root)) {
    const r = readMetaFile(metaPath);
    if (!r) continue;
    stmt.run(r.guid, path.relative(root, r.assetPath), r.assetType, r.mainFileId, now);
    n++;
  }
  return n;
}
```

- [ ] **Step 4 — Chạy pass.** Run: `npx vitest run __tests__/unity/unity-guid-index.test.ts -t "buildGuidIndex"` → PASS.

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

---

# PHASE 2 — Unity YAML parser

**Ship:** tách file Unity-text thành documents `{classId, fileId, body}`; bỏ qua binary.

**Files:**
- Create: `src/extraction/unity/unity-yaml-parser.ts`
- Create: `__tests__/unity/unity-yaml-parser.test.ts`

### Task 2.1: Detect text vs binary

- [ ] **Step 1 — Test** (`__tests__/unity/unity-yaml-parser.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { isUnityTextAsset } from '../../src/extraction/unity/unity-yaml-parser';

describe('isUnityTextAsset', () => {
  it('true for %YAML header', () => expect(isUnityTextAsset('%YAML 1.1\n%TAG !u! ...')).toBe(true));
  it('true for --- header', () => expect(isUnityTextAsset('--- !u!1 &1\n')).toBe(true));
  it('false for binary-ish', () => expect(isUnityTextAsset('\0\\x01garbage')).toBe(false));
});
```

- [ ] **Step 2 — Chạy fail.**

- [ ] **Step 3 — Implement** `src/extraction/unity/unity-yaml-parser.ts`:
```ts
import { parseDocument } from 'yaml';

export interface UnityDoc { classId: number; fileId: number; stripped: boolean; body: Record<string, any>; line: number; }

const HEADER_RE = /^--- !u!(\d+) &(\d+)(\s+stripped)?\s*$/;

/** Cheap guard: Unity text assets start with %YAML or a --- doc marker. */
export function isUnityTextAsset(content: string): boolean {
  const head = content.slice(0, 64).trimStart();
  return head.startsWith('%YAML') || head.startsWith('---');
}
```

- [ ] **Step 4 — Chạy pass.**

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 2.2: Split + parse documents

- [ ] **Step 1 — Test** (append):
```ts
import { parseUnityYaml } from '../../src/extraction/unity/unity-yaml-parser';
import * as fs3 from 'fs'; import * as p3 from 'path';

describe('parseUnityYaml', () => {
  it('splits a prefab into GameObject + MonoBehaviour docs with bodies', () => {
    const src = fs3.readFileSync(p3.join(__dirname, 'fixtures', 'MiniProject', 'Assets', 'Prefabs', 'Player.prefab'), 'utf8');
    const docs = parseUnityYaml(src);
    const go = docs.find((d) => d.classId === 1);
    const mb = docs.find((d) => d.classId === 114);
    expect(go?.fileId).toBe(100);
    expect(go?.body.GameObject.m_Name).toBe('Player');
    expect(mb?.fileId).toBe(200);
    expect(mb?.body.MonoBehaviour.m_Script.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(mb?.body.MonoBehaviour.m_GameObject.fileID).toBe(100);
  });
  it('returns [] for binary content', () => {
    expect(parseUnityYaml('\0not yaml')).toEqual([]);
  });
});
```

- [ ] **Step 2 — Chạy fail.**

- [ ] **Step 3 — Implement** thêm vào `unity-yaml-parser.ts`:
```ts
export function parseUnityYaml(content: string): UnityDoc[] {
  if (!isUnityTextAsset(content)) return [];
  const lines = content.split('\n');
  const docs: UnityDoc[] = [];
  let cur: { classId: number; fileId: number; stripped: boolean; line: number; bodyLines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    try {
      const parsed = parseDocument(cur.bodyLines.join('\n'), { strict: false }).toJS() || {};
      docs.push({ classId: cur.classId, fileId: cur.fileId, stripped: cur.stripped, body: parsed, line: cur.line });
    } catch { /* skip malformed doc, keep the rest */ }
  };
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER_RE.exec(lines[i]);
    if (m) { flush(); cur = { classId: +m[1], fileId: +m[2], stripped: !!m[3], line: i + 1, bodyLines: [] }; }
    else if (cur) cur.bodyLines.push(lines[i]);
  }
  flush();
  return docs;
}
```

- [ ] **Step 4 — Chạy pass.** (Nếu `parseDocument` xử lý được `!u!` tag inline trong body thì không cần xử lý thêm; HEADER_RE đã loại dòng `--- !u!...` khỏi body nên body là YAML hợp lệ.)

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

---

# PHASE 3 — Asset extractor + NodeKind + dispatch + gate

**Ship:** `.prefab/.unity/.asset` → node `unity_*` + edge-thô; gate mở; `csharp-only` vẫn 0 node Unity.

**Files:**
- Modify: `src/types.ts` (NodeKind + provenance)
- Modify: `src/extraction/unity-preset.ts` (`UNITY_ASSET_MODE_IGNORE_DIRS`)
- Modify: `src/extraction/grammars.ts` (`isSourceFile`/`detectLanguage` gate theo `isUnityAssetMode`)
- Modify: `src/extraction/tree-sitter.ts:3071` (dispatch)
- Create: `src/extraction/unity/unity-asset-extractor.ts`
- Modify: `src/extraction/index.ts` (orchestrate: build guid index + gọi resolver — phần resolver ở Phase 4, Phase 3 chỉ wire extractor)
- Create: `__tests__/unity/unity-asset-extractor.test.ts`

### Task 3.1: NodeKind mới + provenance 'unity'

- [ ] **Step 1 — Test** (`__tests__/unity/unity-asset-extractor.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '../../src/types';

describe('unity node kinds registered', () => {
  it('includes the 6 unity node kinds', () => {
    for (const k of ['unity_scene','unity_prefab','unity_asset','unity_gameobject','unity_component','unity_script'])
      expect(NODE_KINDS).toContain(k);
  });
});
```

- [ ] **Step 2 — Chạy fail.**

- [ ] **Step 3 — Implement**: trong `src/types.ts` thêm vào mảng `NODE_KINDS` (trước `'component'` hoặc cuối, miễn trong `as const`):
```ts
  'unity_scene', 'unity_prefab', 'unity_asset',
  'unity_gameobject', 'unity_component', 'unity_script',
```
Và mở rộng union `provenance` của `Edge`:
```ts
  provenance?: 'tree-sitter' | 'scip' | 'heuristic' | 'unity';
```

- [ ] **Step 4 — Build + chạy pass.** Run: `npm run build && npx vitest run __tests__/unity/unity-asset-extractor.test.ts -t "node kinds"`.

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 3.2: Ignore-list rút gọn + gate mở theo mode

- [ ] **Step 1 — Test**: csharp-only vẫn skip asset; full-asset thì không.
```ts
import { afterEach } from 'vitest';
import { isSourceFile } from '../../src/extraction/grammars';
import { buildDefaultIgnore } from '../../src/extraction/index';
describe('isSourceFile gate by mode', () => {
  afterEach(() => { delete process.env.CODEGRAPH_UNITY_ASSETS; delete process.env.CODEGRAPH_UNITY; });
  it('skips .prefab in csharp-only', () => { expect(isSourceFile('A/X.prefab')).toBe(false); });
  it('accepts node-producing assets in full-asset, but NEVER .meta', () => {
    process.env.CODEGRAPH_UNITY_ASSETS = '1';
    expect(isSourceFile('A/X.prefab')).toBe(true);
    expect(isSourceFile('A/X.unity')).toBe(true);
    expect(isSourceFile('A/X.asset')).toBe(true);
    expect(isSourceFile('A/X.asmdef')).toBe(true);
    // .meta is consumed out-of-band by buildGuidIndex — it must NEVER become a node,
    // otherwise the dashboard/graph fills with stray .meta file nodes.
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
```

- [ ] **Step 2 — Chạy fail** (test full-asset fail: hiện luôn skip hoặc vẫn ignore `Assets/Prefabs` vì asset mode đang imply base Unity mode).

- [ ] **Step 3 — Implement**:
  - `src/extraction/unity-preset.ts`: thêm 2 export. **Quan trọng:** tách `.meta` ra khỏi tập sinh-node.
```ts
/** Asset extensions that produce graph NODES in full-asset mode. EXCLUDES `.meta`
 *  (.meta is the GUID sidecar — consumed only by buildGuidIndex, never a node) and
 *  `.asmdef` (handled by the dedicated unity_asmdef dispatch). */
export const UNITY_ASSET_NODE_EXTENSIONS = new Set<string>(['.prefab', '.unity', '.asset']);

/** Dirs ignored in full-asset mode: engine/generated + SDKs + Packages (but NOT asset dirs). */
export const UNITY_ASSET_MODE_IGNORE_DIRS: readonly string[] = [
  ...UNITY_ENGINE_IGNORE_DIRS.filter((d) => d !== 'ProjectSettings'),
  ...Object.keys(UNITY_SDK_DIRS),
];
```
  (Bỏ `ProjectSettings` khỏi ignore để index `*.asset` trong đó; `Packages` vẫn nằm trong `UNITY_ENGINE_IGNORE_DIRS`.)
  - `src/extraction/index.ts`: sửa `buildDefaultIgnore()` để base Unity mode và full-asset mode dùng ignore list khác nhau. Hiện code có `if (isUnityMode()) ig.add(UNITY_ALL_IGNORE_DIRS...)`; asset mode gọi `enableUnityMode()`, nên nếu không sửa đoạn này thì `Prefabs/Scenes/Resources` vẫn bị skip.
```ts
import { isUnityAssetMode, isUnityMode } from './unity-mode';
import { UNITY_ALL_IGNORE_DIRS, UNITY_ASSET_MODE_IGNORE_DIRS } from './unity-preset';

// inside buildDefaultIgnore(rootDir):
if (isUnityAssetMode()) {
  ig.add(UNITY_ASSET_MODE_IGNORE_DIRS.map((d) => `${d}/`));
} else if (isUnityMode()) {
  ig.add(UNITY_ALL_IGNORE_DIRS.map((d) => `${d}/`));
}
```
  - `src/extraction/grammars.ts` `isSourceFile`: đổi nhánh Unity — mở gate cho node-asset + `.asmdef`, **`.meta` luôn `false`**:
```ts
import { isUnityAssetMode } from './unity-mode';
import { UNITY_ASSET_NODE_EXTENSIONS } from './unity-preset';
// ... thay dòng `if (UNITY_ASSET_EXTENSIONS.has(ext)) return false;`:
  if (UNITY_ASSET_EXTENSIONS.has(ext)) {
    if (ext === '.meta') return false;                 // GUID sidecar: never indexed as a node
    if (!isUnityAssetMode()) return false;             // csharp-only: skip all assets
    return UNITY_ASSET_NODE_EXTENSIONS.has(ext) || ext === '.asmdef';
  }
```
  - `detectLanguage`: khi `isUnityAssetMode()`, trả `'unity_asset'` cho `.prefab/.unity/.asset` và `'unity_asmdef'` cho `.asmdef`. KHÔNG cần xử lý `.meta` (gate đã chặn nó trước khi tới đây). (Tìm chỗ short-circuit Unity trong `detectLanguage` và gate y hệt.)

- [ ] **Step 4 — Chạy pass.**

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 3.3: UnityAssetExtractor — nodes + edge-thô

- [ ] **Step 1 — Test** (append): parse Player.prefab → đúng node + edge-thô.
```ts
import { UnityAssetExtractor } from '../../src/extraction/unity/unity-asset-extractor';
import * as fs4 from 'fs'; import * as p4 from 'path';

describe('UnityAssetExtractor', () => {
  const src = fs4.readFileSync(p4.join(__dirname,'fixtures','MiniProject','Assets','Prefabs','Player.prefab'),'utf8');
  const r = new UnityAssetExtractor('Assets/Prefabs/Player.prefab', src).extract();

  it('emits a prefab node + gameobject + component', () => {
    expect(r.nodes.some((n) => n.kind === 'unity_prefab')).toBe(true);
    expect(r.nodes.some((n) => n.kind === 'unity_gameobject' && n.name === 'Player')).toBe(true);
    expect(r.nodes.some((n) => n.kind === 'unity_component')).toBe(true);
  });
  it('emits raw component→script edge carrying guid in metadata (target unresolved)', () => {
    const e = r.unityRawEdges.find((x) => (x.metadata as any)?.unityRelation === 'component_uses_script');
    expect(e).toBeTruthy();
    expect((e!.metadata as any).guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(e!.provenance).toBe('unity');
  });
  it('emits raw serialized-field→asset edge with fieldName', () => {
    const e = r.unityRawEdges.find((x) => (x.metadata as any)?.unityRelation === 'serialized_field_references_asset');
    expect((e!.metadata as any).fieldName).toBe('database');
    expect((e!.metadata as any).guid).toBe('cccccccccccccccccccccccccccccccc');
  });
});
```

- [ ] **Step 2 — Chạy fail.**

- [ ] **Step 3 — Implement** `src/extraction/unity/unity-asset-extractor.ts`. Node id qua `generateNodeId`; `edges` chỉ chứa quan hệ đã có source/target hợp lệ; GUID/fileID cần resolve để trong `unityRawEdges` (resolver Phase 4 điền target rồi mới persist).
```ts
import { Node, Edge, ExtractionResult } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';
import { parseUnityYaml, UnityDoc } from './unity-yaml-parser';

export interface RawUnityEdge extends Omit<Edge, 'source' | 'target'> {
  source?: string;
  target?: string;
  filePath: string;
}
export interface UnityAssetExtractionResult extends ExtractionResult {
  unityRawEdges: RawUnityEdge[];
}

const FILE_KIND: Record<string, 'unity_prefab'|'unity_scene'|'unity_asset'> = {
  '.prefab': 'unity_prefab', '.unity': 'unity_scene', '.asset': 'unity_asset',
};
// reference-like value: { fileID, guid?, type? }
function isRef(v: any): v is { fileID: number; guid?: string; type?: number } {
  return v && typeof v === 'object' && typeof v.fileID === 'number';
}

export class UnityAssetExtractor {
  constructor(private filePath: string, private source: string) {}

  extract(): UnityAssetExtractionResult {
    const start = Date.now();
    const nodes: Node[] = []; const edges: Edge[] = []; const unityRawEdges: RawUnityEdge[] = [];
    const docs = parseUnityYaml(this.source);
    const ext = this.filePath.slice(this.filePath.lastIndexOf('.')).toLowerCase();
    const fileKind = FILE_KIND[ext] ?? 'unity_asset';

    // 1. file-level node
    const fileName = this.filePath.split(/[/\\]/).pop() || this.filePath;
    const fileNode: Node = mkNode(this.filePath, fileKind, fileName, 1, docs.length);
    nodes.push(fileNode);

    const goNodeByFileId = new Map<number, Node>();
    // 2. GameObjects
    for (const d of docs.filter((x) => x.classId === 1)) {
      const go = d.body.GameObject ?? {};
      const n = mkNode(this.filePath, 'unity_gameobject', go.m_Name ?? `GameObject_${d.fileId}`, d.line, d.fileId);
      nodes.push(n); goNodeByFileId.set(d.fileId, n);
      edges.push(unityEdge(fileNode.id, n.id, 'contains', fileKind === 'unity_scene' ? 'scene_contains_gameobject' : 'prefab_contains_gameobject', { childFileId: d.fileId }));
    }
    // 3. MonoBehaviours / components
    for (const d of docs.filter((x) => x.classId === 114)) {
      const mb = d.body.MonoBehaviour ?? {};
      const comp = mkNode(this.filePath, 'unity_component', `Component_${d.fileId}`, d.line, d.fileId);
      nodes.push(comp);
      // gameobject_has_component (resolved locally in Phase 4 via m_GameObject.fileID)
      if (isRef(mb.m_GameObject)) {
        const owner = goNodeByFileId.get(mb.m_GameObject.fileID);
        if (owner) edges.push(unityEdge(owner.id, comp.id, 'contains', 'gameobject_has_component', { ownerFileId: mb.m_GameObject.fileID }));
      }
      // component_uses_script
      if (isRef(mb.m_Script) && mb.m_Script.guid)
        unityRawEdges.push(rawUnityEdge(this.filePath, comp.id, 'references', 'component_uses_script', { guid: mb.m_Script.guid, fileID: mb.m_Script.fileID }));
      // serialized field references (any other ref-valued field)
      for (const [k, v] of Object.entries(mb)) {
        if (k === 'm_Script' || k === 'm_GameObject') continue;
        if (isRef(v) && v.guid && v.fileID !== 0)
          unityRawEdges.push(rawUnityEdge(this.filePath, comp.id, 'references', 'serialized_field_references_asset', { fieldName: k, guid: v.guid, fileID: v.fileID }));
      }
    }
    // 4. PrefabInstance (scene/prefab → source prefab)
    for (const d of docs.filter((x) => x.classId === 1001)) {
      const src = d.body.PrefabInstance?.m_SourcePrefab;
      if (isRef(src) && src.guid)
        unityRawEdges.push(rawUnityEdge(this.filePath, fileNode.id, 'references', 'scene_references_prefab', { guid: src.guid }));
    }
    return { nodes, edges, unityRawEdges, unresolvedReferences: [], errors: [], durationMs: Date.now() - start };
  }
}

function mkNode(filePath: string, kind: Node['kind'], name: string, line: number, fileId: number): Node {
  return {
    id: generateNodeId(filePath, kind, name, line),
    kind, name,
    qualifiedName: `${filePath}::${fileId}`,
    filePath, language: 'unity_asset' as any,
    startLine: line, endLine: line, startColumn: 0, endColumn: 0,
    updatedAt: Date.now(),
  };
}
function unityEdge(source: string, target: string, kind: Edge['kind'], unityRelation: string, extra: Record<string, unknown>): Edge {
  return { source, target, kind, provenance: 'unity', metadata: { unityRelation, ...extra } };
}
function rawUnityEdge(filePath: string, source: string, kind: Edge['kind'], unityRelation: string, extra: Record<string, unknown>): RawUnityEdge {
  return { filePath, source, kind, provenance: 'unity', metadata: { unityRelation, ...extra } };
}
```
> `ExtractionResult.edges` không được chứa edge thiếu endpoint vì `queries.insertEdges()` sẽ skip hoặc vi phạm FK. Mọi edge cần GUID resolver nằm trong `unityRawEdges` và chỉ được insert sau Phase 4 resolve. Local containment (`prefab_contains_gameobject`, `gameobject_has_component`) có đủ endpoint nên vẫn nằm trong `edges`.

- [ ] **Step 4 — Chạy pass.**

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 3.4: Dispatch trong `extractFromSource`

- [ ] **Step 1 — Implement** `src/extraction/tree-sitter.ts` (import + nhánh mới ngay sau nhánh `xml`):
```ts
import { UnityAssetExtractor } from './unity/unity-asset-extractor';
// ...
  } else if (detectedLanguage === 'unity_asset') {
    const extractor = new UnityAssetExtractor(filePath, source);
    result = extractor.extract();
  }
```

- [ ] **Step 2 — Test integration** (full-asset mode index MiniProject → có node unity_prefab; csharp-only → 0). Append vào `unity-asset-mode.test.ts` (mở rộng `mode isolation`):
```ts
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
    fsp.rmSync(root, { recursive: true, force: true });
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  }
});
```

- [ ] **Step 3 — Build + chạy.** `npm run build && npx vitest run __tests__/unity` — isolation test (csharp-only=0) PHẢI vẫn pass.

- [ ] **Step 4 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

---

# PHASE 4 — Reference resolver (guid + local fileID + missing script)

**Ship:** edge Unity được nối target thật; missing-script phát hiện; integration trên MiniProject pass.

**Files:**
- Create: `src/resolution/unity/unity-reference-resolver.ts`
- Modify: `src/extraction/index.ts` (gọi resolver post-extract, sau khi guid index đã đầy)
- Modify: `__tests__/unity/unity-asset-integration.test.ts` (mới)

### Task 4.1: Resolver thuần (unit, không DB)

- [ ] **Step 1 — Test** (`__tests__/unity/unity-asset-integration.test.ts`): dựng input giả lập (nodes + raw edges + guid map + local anchor map) → resolver điền target.
```ts
import { describe, it, expect } from 'vitest';
import { resolveUnityEdges } from '../../src/resolution/unity/unity-reference-resolver';

it('resolves component_uses_script via guid→class node', () => {
  const guidToNodeId = new Map([['aaaa', 'class:PlayerController']]);
  const localAnchors = new Map<string, Map<number, string>>(); // perFile fileId→nodeId
  const rawEdges = [{ source: 'comp1', kind: 'references', provenance: 'unity',
    metadata: { unityRelation: 'component_uses_script', guid: 'aaaa', fileID: 11500000 }, filePath: 'P.prefab' } as any];
  const { resolved, missing, placeholderNodes } = resolveUnityEdges(rawEdges, guidToNodeId, localAnchors);
  expect(resolved[0].target).toBe('class:PlayerController');
  expect(missing.length).toBe(0);
  expect(placeholderNodes.length).toBe(0);
});

it('flags missing script when guid not in map', () => {
  const rawEdges = [{ source: 'comp1', kind: 'references', provenance: 'unity',
    metadata: { unityRelation: 'component_uses_script', guid: 'ffff' }, filePath: 'B.prefab' } as any];
  const { resolved, missing, placeholderNodes } = resolveUnityEdges(rawEdges, new Map(), new Map());
  expect(missing.length).toBe(1);
  expect(placeholderNodes.length).toBe(1);
  expect((resolved[0].metadata as any).unityRelation).toBe('missing_script');
  expect(resolved[0].target).toBe(placeholderNodes[0].id);
});
```

- [ ] **Step 2 — Chạy fail.**

- [ ] **Step 3 — Implement** `src/resolution/unity/unity-reference-resolver.ts`:
```ts
import { Edge, Node } from '../../types';
import { generateNodeId } from '../../extraction/tree-sitter-helpers';

export interface RawUnityEdge extends Omit<Edge, 'source' | 'target'> {
  source?: string;
  target?: string;
  filePath: string;
}

/**
 * Resolve raw Unity edges (target/source possibly empty) to real node ids.
 * - guid edges → guidToNodeId
 * - local fileID edges (gameobject_has_component) → per-file anchor map
 * - unresolved component_uses_script guid → missing_script
 */
export function resolveUnityEdges(
  raw: RawUnityEdge[],
  guidToNodeId: Map<string, string>,
  localAnchorsByFile: Map<string, Map<number, string>>
): { resolved: Edge[]; missing: Edge[]; placeholderNodes: Node[] } {
  const resolved: Edge[] = []; const missing: Edge[] = []; const placeholderNodes: Node[] = [];
  for (const e of raw) {
    const md = (e.metadata ?? {}) as any;
    const rel = md.unityRelation as string;
    if (md.guid) {
      const tgt = guidToNodeId.get(md.guid);
      if (tgt && e.source) { resolved.push({ ...e, source: e.source, target: tgt }); continue; }
      if (rel === 'component_uses_script') {
        if (!e.source) continue;
        const node = missingScriptNode(md.guid, e.filePath);
        placeholderNodes.push(node);
        const miss: Edge = { ...e, source: e.source, target: node.id, metadata: { ...md, unityRelation: 'missing_script' } };
        resolved.push(miss); missing.push(miss); continue;
      }
      continue; // dangling non-script guid → drop (logged elsewhere)
    }
    // local fileID edge (gameobject_has_component: ownerFileId → gameobject node)
    if (rel === 'gameobject_has_component' && e.filePath) {
      const anchors = localAnchorsByFile.get(e.filePath);
      const ownerId = anchors?.get(md.ownerFileId);
      if (ownerId) { resolved.push({ ...e, source: ownerId }); continue; }
    }
    if (rel?.endsWith('contains') === false && e.source && e.target) {
      resolved.push({ ...e, source: e.source, target: e.target });
    }
  }
  return { resolved, missing, placeholderNodes };
}

function missingScriptNode(guid: string, filePath: string): Node {
  return {
    id: generateNodeId(filePath, 'unity_script', guid, 1),
    kind: 'unity_script',
    name: `Missing script ${guid.slice(0, 8)}`,
    qualifiedName: `unity-script::${guid}`,
    filePath,
    language: 'unity_asset',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}
```
> Đây là lõi thuần. Bản ghép DB (build `guidToNodeId` từ bảng `unity_guids` + node C# class theo asset_path; build anchor map từ `qualifiedName = path::fileId`) làm ở Task 4.2. Khi có `placeholderNodes`, orchestration phải insert nodes trước rồi mới insert resolved edges.

- [ ] **Step 4 — Chạy pass.**

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 4.2: Wire vào orchestration (build guid index + resolve + persist)

- [ ] **Step 1 — Đọc** `src/extraction/index.ts` quanh `storeExtractionResult` và `src/index.ts:349-470` (chỗ `resolver.runPostExtract()`), để biết điểm chèn: **sau khi tất cả file đã extract, trước/cùng post-extract**.

- [ ] **Step 2 — Implement** một đường orchestration Unity trong `ExtractionOrchestrator`, gọi ở cuối `indexAll` khi `isUnityAssetMode()`:
  0. Thêm private buffer trên orchestrator:
```ts
private unityRawEdges: import('../resolution/unity/unity-reference-resolver').RawUnityEdge[] = [];
```
     Trong mỗi lần `indexAll()`/`sync()` bắt đầu, reset buffer này về `[]`.
  1. `buildGuidIndex(root, db)` (Phase 1).
  2. Build `guidToNodeId`: với mỗi row `unity_guids` type=script → tìm node `class` có `file_path = asset_path` (tên class = tên file, fallback class đầu); type khác → node file unity tương ứng `file_path`.
  3. Build `localAnchorsByFile`: query node `unity_gameobject`/`unity_component`, parse `qualifiedName` `path::fileId`.
  4. `resolveUnityEdges(this.unityRawEdges, guidToNodeId, localAnchorsByFile)` → `queries.insertNodes(placeholderNodes)` trước, rồi `queries.insertEdges(resolved)`.

> **Ghi chú lưu edge-thô:** `UnityAssetExtractor` trả `UnityAssetExtractionResult` có property phụ `unityRawEdges`; KHÔNG đặt raw GUID edges trong `result.edges`. Trong `storeExtractionResult`, sau khi insert nodes/valid local edges, nếu `isUnityAssetMode()` thì đọc `(result as UnityAssetExtractionResult).unityRawEdges ?? []` và append vào `this.unityRawEdges`. Như vậy `queries.insertEdges()` chỉ thấy edge có endpoint hợp lệ.
> **Ghi chú idempotency:** chỉ resolve buffer sau khi vòng extract của `indexAll()` đã xong và GUID index đã sẵn sàng. Với `sync()`/incremental, Phase 6 phải xoá edge Unity scoped theo file đổi trước khi re-insert resolved edges mới, để không giữ edge cũ khi serialized reference đổi GUID.

- [ ] **Step 3 — Test integration** (append `unity-asset-integration.test.ts`): index MiniProject ở full-asset, assert edge resolved.
```ts
import { CodeGraph } from '../../src/index';
import * as os5 from 'os'; import * as p5 from 'path'; import * as f5 from 'fs';
function copyFx() { const d = f5.mkdtempSync(p5.join(os5.tmpdir(),'cg-u-')); f5.cpSync(p5.join(__dirname,'fixtures','MiniProject'), d, {recursive:true}); return d; }

it('builds resolved Unity graph on MiniProject', async () => {
  process.env.CODEGRAPH_UNITY_ASSETS = '1';
  const root = copyFx();
  const cg = await CodeGraph.init(root);
  try {
    await cg.indexAll();
    // component_uses_script Player→PlayerController class resolved
    const player = cg.searchNodes('PlayerController').find((r) => r.node.kind === 'class')!.node;
    const edges = cg.getEdgesByRelation('component_uses_script');
    expect(edges.some((e) => e.target === player.id)).toBe(true);
    // missing script detected for Broken.prefab guid ffff…
    const missing = cg.getEdgesByRelation('missing_script');
    expect(missing.length).toBeGreaterThanOrEqual(1);
  } finally {
    cg.close();
    f5.rmSync(root, { recursive: true, force: true });
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  }
});
```
> Thêm public helper nhỏ trên `QueryBuilder` và wrapper `CodeGraph.getEdgesByRelation(rel)` trong Task này. Không dùng `(cg as any)`. SQL: `SELECT * FROM edges WHERE kind IN ('references','contains') AND json_extract(metadata,'$.unityRelation')=?`; map row bằng `rowToEdge`.

- [ ] **Step 4 — Build + chạy cả suite.** `npm run build && npx vitest run __tests__/unity` — tất cả pass, node count ổn định khi re-index (chạy `indexAll` 2 lần, so số node unity bằng nhau).

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

---

# PHASE 5 — SerializeField (C#) + UnityEvent

**Ship:** trace field C# ↔ asset; UnityEvent → method.

**Files:**
- Modify: `src/extraction/tree-sitter.ts` (bắt `[SerializeField]` → `decorators` khi tạo node `field`)
- Inspect only if needed: `src/extraction/languages/csharp.ts` (`fieldTypes: ['field_declaration']` đã dispatch qua extractor chung)
- Modify: `src/extraction/unity/unity-asset-extractor.ts` (UnityEvent `m_PersistentCalls`)
- Modify: `src/resolution/unity/unity-reference-resolver.ts` (edge `unity_event_calls_method`, `serialized_field_references_prefab`)
- Modify: `__tests__/unity/unity-asset-integration.test.ts`

### Task 5.1: C# field `[SerializeField]`
- [ ] **Step 1 — Test**: index PlayerController.cs → field `database` có `decorators` chứa `'SerializeField'`.
```ts
it('csharp extractor tags [SerializeField] fields', async () => {
  process.env.CODEGRAPH_UNITY_ASSETS = '1';
  const root = copyFx();
  const cg = await CodeGraph.init(root);
  try {
    await cg.indexAll();
    const fld = cg.searchNodes('database').find((r) => r.node.kind === 'field')?.node;
    expect(fld?.decorators?.includes('SerializeField')).toBe(true);
  } finally {
    cg.close();
    f5.rmSync(root, { recursive: true, force: true });
    delete process.env.CODEGRAPH_UNITY_ASSETS;
  }
});
```
- [ ] **Step 2 — Chạy fail.**
- [ ] **Step 3 — Implement**: sửa đúng chỗ tạo field node trong `TreeSitterExtractor.extractField()` (`src/extraction/tree-sitter.ts`). `src/extraction/languages/csharp.ts` chỉ cần inspect để xác nhận `fieldTypes: ['field_declaration']` đã dispatch vào extractor chung.
  - Đọc `attribute_list` con của `field_declaration` (tree-sitter C#), thu tên attribute (`SerializeField`, `FormerlySerializedAs`, ...).
  - Khi gọi `createNode('field', ...)`, truyền `decorators: attributeNames` để test `fld.decorators` pass.
  - Vẫn giữ `extractDecoratorsFor(node, fieldNode.id)` sau đó để emit decorator reference edges theo cơ chế hiện tại; không thay bằng parser riêng làm mất behavior cũ.
  - Nếu helper `extractDecoratorsFor` không tự ghi `decorators` vào node hiện tại, thêm helper nhỏ chỉ đọc C# `attribute_list` và merge vào `decorators` trong payload tạo node.
- [ ] **Step 4 — Build + chạy pass.**
- [ ] **Step 5 — Đồng bộ overlay (không commit)** `feat(unity): capture [SerializeField] attribute on C# fields`.

### Task 5.2: UnityEvent persistent calls
- [ ] **Step 1 — Thêm fixture**: vào `Player.prefab` MonoBehaviour thêm:
```yaml
  m_OnClick:
    m_PersistentCalls:
      m_Calls:
      - m_Target: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
        m_MethodName: Respawn
        m_Mode: 1
```
và thêm method `public void Respawn() {}` vào `PlayerController.cs`.
- [ ] **Step 2 — Test**: edge `unity_event_calls_method` resolve tới method `PlayerController.Respawn`.
- [ ] **Step 3 — Implement**: trong `UnityAssetExtractor`, khi value field là object có `m_PersistentCalls.m_Calls`, duyệt từng call → raw edge `unity_event_calls_method` `{ guid: m_Target.guid, methodName: m_MethodName, mode: m_Mode, fieldName: <key> }`. Resolver: guid→class, rồi tìm node `method` của class có `name === methodName` → target.
- [ ] **Step 4 — Chạy pass.**
- [ ] **Step 5 — Đồng bộ overlay (không commit)** `feat(unity): resolve UnityEvent persistent calls to methods`.

---

# PHASE 6 — asmdef + sync/incremental

**Ship:** asmdef graph; watcher cập nhật asset.

**Files:**
- Create: `src/extraction/unity/unity-asmdef-extractor.ts`
- Modify: `src/extraction/tree-sitter.ts` (dispatch `unity_asmdef`)
- Modify: `src/extraction/index.ts` (incremental: .meta/.asset đổi → re-resolve)
- Modify: `__tests__/unity/unity-asmdef.test.ts` (mới)

### Task 6.1: asmdef extractor
- [ ] **Step 1 — Fixture** `Assets/Game.asmdef` (+ `.meta` guid) :
```json
{ "name": "Game", "references": ["GUID:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] }
```
- [ ] **Step 2 — Test**: node `module` name `Game`; edge `asmdef_references_asmdef`.
- [ ] **Step 3 — Implement** `UnityAsmdefExtractor`: `.asmdef` là JSON → `JSON.parse`; node `module` (kind reuse `module`), mỗi entry `references` (dạng `GUID:<hex>` hoặc tên) → raw edge `asmdef_references_asmdef` (resolve bằng guid hoặc name→asmdef node). Dispatch `unity_asmdef` trong `extractFromSource`.
- [ ] **Step 4 — Chạy pass.**
- [ ] **Step 5 — Đồng bộ overlay (không commit)** `feat(unity): asmdef assembly graph`.

### Task 6.2: Incremental sync
- [ ] **Step 1 — Test**: index → sửa `Player.prefab` (đổi guid script sang `bbbb`) → `sync` → edge `component_uses_script` giờ trỏ ItemDatabase class; số node ổn định.
- [ ] **Step 2 — Implement**: trong path `sync`/`updateFile` của `index.ts`, khi file `.meta` đổi → update row `unity_guids`; khi `.prefab/.unity/.asset` đổi → xoá node theo `file_path` (CASCADE xoá edge) + re-extract + re-resolve phạm vi file đó. Watcher đã tự nhận asset (Phase 3 gate) — không sửa watcher.
- [ ] **Step 3 — Chạy pass.**
- [ ] **Step 4 — Đồng bộ overlay (không commit)** `feat(unity): incremental re-index of Unity assets on change`.

---

# PHASE 7 — MCP: lồng vào impact/context + tool mới + search hygiene

**Ship:** `codegraph_impact <MonoBehaviour>` kèm prefab/scene; 2 tool mới; `search` không lẫn node Unity.

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server-instructions.ts`
- Modify: `src/graph/*.ts` (query helper)
- Modify: `__tests__/unity/unity-mcp.test.ts` (mới)

### Task 7.1: Search hygiene
- [ ] **Step 1 — Test**: `codegraph_search "Player"` (qua tool) KHÔNG trả node `unity_gameobject`/`unity_component` mặc định.
- [ ] **Step 2 — Implement**: ở query layer của `codegraph_search`, mặc định `WHERE kind NOT IN ('unity_gameobject','unity_component')` (giữ `unity_prefab/scene/asset` vì hữu ích khi search tên file); cho override qua `kinds`.
- [ ] **Step 3 — Chạy pass.**
- [ ] **Step 4 — Đồng bộ overlay (không commit)** `feat(unity): exclude unity sub-object nodes from default search`.

### Task 7.2: Impact lồng Unity
- [ ] **Step 1 — Test**: `codegraph_impact "PlayerController"` (full-asset, MiniProject) → output chứa `Player.prefab`.
- [ ] **Step 2 — Implement**: trong handler `codegraph_impact` (`src/mcp/tools.ts`), sau khi tính impact C#, nếu target là class: query edge `component_uses_script` có target = class → lấy component → `gameobject_has_component` ngược → file prefab/scene; thêm mục "Unity attachments" vào output. Dùng helper `getEdgesByRelation`.
- [ ] **Step 3 — Chạy pass.**
- [ ] **Step 4 — Đồng bộ overlay (không commit)** `feat(unity): surface prefab/scene attachments in codegraph_impact`.

### Task 7.3: Tool mới + Addressables + server-instructions
- [ ] **Step 1 — Test**: tool `unity_find_missing_scripts` trả Broken.prefab; `unity_find_references_to_asset "Items.asset"` trả Player.prefab.
- [ ] **Step 2 — Implement**: 2 tool dùng `getEdgesByRelation('missing_script')` và truy edge ngược tới node asset theo path. Addressables: parse `AddressableAssetsData/*.asset` (đã walk ở Phase 3) → edge `addressable_references_asset` (entry `m_GUID` + `m_Address`). Thêm 3-4 dòng mô tả Unity vào `server-instructions.ts`.
- [ ] **Step 3 — Build + chạy cả suite + A/B pass-bar** (spec §8.3) trên 1 repo Unity nhỏ: câu hỏi "sửa <MonoBehaviour> ảnh hưởng prefab/scene nào" → impact trả lời trong 1 call, 0 Read/Grep. Ghi số vào `docs/design/`.
- [ ] **Step 4 — Đồng bộ overlay (không commit)** `feat(unity): add missing-scripts + asset-references MCP tools + Addressables`.

---

# PHASE 8 — Dashboard: ẩn `.meta` + render node Unity

**Bối cảnh:** dashboard là app web tại `web/` (root repo, KHÔNG phải `codegraph/`). `web/server/server.mjs` đọc trực tiếp `.codegraph/codegraph.db` (read-only), build graph từ bảng `nodes`/`edges`, map `kind → NodeLabel` qua `KIND_TO_LABEL`, rồi frontend (`web/src/lib/constants.ts`) tô màu/kích thước/ẩn-hiện theo label.

**Mục tiêu ship:**
1. `.meta` KHÔNG bao giờ xuất hiện trên dashboard (defense-in-depth: dù gate Phase 3.2 đã chặn `.meta` thành node, server vẫn lọc cứng).
2. 6 `unity_*` kind hiển thị đúng (có label/màu riêng) thay vì rơi về `CodeElement` chung chung.
3. Sub-object nhiễu (`unity_gameobject`, `unity_component`) bị ẩn mặc định trong bộ lọc label (như `Import`/`Variable` hiện tại) để khỏi rối đồ thị.

> **Lưu ý môi trường:** mọi path Phase 8 tương đối tới **root repo** (`/Users/zasuo/AI-Tool/unity-codegraph/web`), không phải `codegraph/`. Test chạy bằng `node --test` (web dùng node thuần + Vite, không có vitest). Nếu `web/` chưa có test runner, Task 8.1 dùng một script kiểm tra nhỏ `web/server/__tests__/graph-filter.test.mjs` chạy bằng `node --test`.

**Files:**
- Modify: `web/server/server.mjs` (lọc `.meta` + map `unity_*` label)
- Create: `web/server/graph-mapper.mjs` (module thuần để test, không start HTTP server)
- Modify: `web/src/types.ts` (thêm `NodeLabel` Unity)
- Modify: `web/src/lib/constants.ts` (màu, size, default-visible)
- Create: `web/server/__tests__/graph-filter.test.mjs`

### Task 8.1: Server lọc `.meta` + map kind Unity

- [ ] **Step 1 — Tách hàm thuần để test được.** Không import trực tiếp `web/server/server.mjs` trong test vì file đó gọi `.listen()` khi load. Tạo module mới `web/server/graph-mapper.mjs` chứa mapper thuần, rồi để `server.mjs` import các hàm đó. Trước hết viết test (`web/server/__tests__/graph-filter.test.mjs`):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNodeRow, KIND_TO_LABEL, isHiddenNodeRow } from '../graph-mapper.mjs';

test('unity kinds map to dedicated labels', () => {
  assert.equal(KIND_TO_LABEL['unity_prefab'], 'UnityPrefab');
  assert.equal(KIND_TO_LABEL['unity_scene'], 'UnityScene');
  assert.equal(KIND_TO_LABEL['unity_asset'], 'UnityAsset');
  assert.equal(KIND_TO_LABEL['unity_gameobject'], 'UnityGameObject');
  assert.equal(KIND_TO_LABEL['unity_component'], 'UnityComponent');
  assert.equal(KIND_TO_LABEL['unity_script'], 'File');
});

test('isHiddenNodeRow drops .meta rows', () => {
  assert.equal(isHiddenNodeRow({ file_path: 'Assets/X.cs.meta', kind: 'unity_asset' }), true);
  assert.equal(isHiddenNodeRow({ file_path: 'Assets/X.prefab', kind: 'unity_prefab' }), false);
  assert.equal(isHiddenNodeRow({ file_path: 'src/a.ts', kind: 'function' }), false);
});
```

- [ ] **Step 2 — Chạy fail**

Run: `cd /Users/zasuo/AI-Tool/unity-codegraph/web && node --test server/__tests__/graph-filter.test.mjs`
Expected: FAIL — `mapNodeRow`/`isHiddenNodeRow` chưa export; label Unity chưa có.

- [ ] **Step 3 — Implement** `web/server/graph-mapper.mjs`:
  - Chuyển `KIND_TO_LABEL` hiện có từ `server.mjs` sang module mới, rồi thêm các entry Unity (giữ nguyên các entry cũ):
```js
export const KIND_TO_LABEL = {
  file: 'File', module: 'Module', namespace: 'Namespace',
  class: 'Class', struct: 'Struct', interface: 'Interface', trait: 'Trait',
  protocol: 'Interface', enum: 'Enum', enum_member: 'CodeElement',
  function: 'Function', method: 'Method', property: 'Property', field: 'Property',
  variable: 'Variable', constant: 'Const', parameter: 'CodeElement',
  type_alias: 'TypeAlias', import: 'Import', export: 'CodeElement',
  route: 'Route', component: 'Class',
  // Unity full-asset nodes
  unity_scene: 'UnityScene', unity_prefab: 'UnityPrefab', unity_asset: 'UnityAsset',
  unity_gameobject: 'UnityGameObject', unity_component: 'UnityComponent',
  unity_script: 'File',
};
```
  - Thêm bộ lọc + mapper:
```js
/** Rows we never surface on the dashboard: Unity .meta sidecars (defense-in-depth —
 *  Phase 3.2 gate already prevents them becoming nodes, but old DBs may still have them). */
export function isHiddenNodeRow(r) {
  return typeof r.file_path === 'string' && r.file_path.endsWith('.meta');
}

export function mapNodeRow(r) {
  return {
    id: r.id,
    label: KIND_TO_LABEL[r.kind] || 'CodeElement',
    properties: {
      name: r.name, filePath: r.file_path,
      startLine: r.start_line, endLine: r.end_line,
      language: r.language, kind: r.kind,
    },
  };
}
```
  - Trong `web/server/server.mjs`, xoá const `KIND_TO_LABEL` cũ và import mapper thuần; giữ `EDGE_TO_TYPE` ở `server.mjs` trừ khi Task này cũng chuyển edge mapper sang module mới:
```js
import { isHiddenNodeRow, mapNodeRow } from './graph-mapper.mjs';
```
  - Nếu muốn test edge mapper sau này, chuyển `EDGE_TO_TYPE` sang `graph-mapper.mjs` trong cùng patch; nếu không chuyển thì tuyệt đối không import `EDGE_TO_TYPE` từ mapper để tránh lỗi runtime.
  - Trong `buildGraph`, lọc trước khi map (và trước khi tính `nodeIds`):
```js
  const nodeRows = db.prepare(`
    SELECT id, kind, name, qualified_name, file_path, language, start_line, end_line
    FROM nodes ${includeImports ? '' : "WHERE kind != 'import'"}
  `).all().filter((r) => !isHiddenNodeRow(r));
  const nodeIds = new Set(nodeRows.map((r) => r.id));
  const nodes = nodeRows.map(mapNodeRow);
```
  (Edge build giữ nguyên — nó đã bỏ edge có source/target không nằm trong `nodeIds`, nên edge dính `.meta` tự rụng.)

- [ ] **Step 4 — Chạy pass**

Run: `cd /Users/zasuo/AI-Tool/unity-codegraph/web && node --test server/__tests__/graph-filter.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 8.2: Frontend labels — màu/size/ẩn-hiện

- [ ] **Step 1 — Thêm `NodeLabel`** vào `web/src/types.ts` (nối vào union, sau `'Tool'`):
```ts
  | 'UnityScene' | 'UnityPrefab' | 'UnityAsset' | 'UnityGameObject' | 'UnityComponent';
```

- [ ] **Step 2 — Màu + size** trong `web/src/lib/constants.ts` (thêm vào `NODE_COLORS` và `NODE_SIZES`):
```ts
// NODE_COLORS — Unity (xanh-Unity nhạt dần theo độ chi tiết)
  UnityScene: '#22d3ee',
  UnityPrefab: '#0ea5e9',
  UnityAsset: '#38bdf8',
  UnityGameObject: '#7dd3fc',
  UnityComponent: '#a5f3fc',
```
```ts
// NODE_SIZES
  UnityScene: 12,
  UnityPrefab: 9,
  UnityAsset: 7,
  UnityGameObject: 4,
  UnityComponent: 3,
```

- [ ] **Step 3 — Default-visible**: trong `DEFAULT_VISIBLE_LABELS` thêm các label asset cấp file nhưng ẩn sub-object (giữ đồ thị gọn, đồng nhất triết lý "ẩn Import/Variable"):
```ts
  'UnityScene', 'UnityPrefab', 'UnityAsset',
  // 'UnityGameObject' / 'UnityComponent' cố ý KHÔNG bật mặc định (nhiễu — bật qua bộ lọc)
```

- [ ] **Step 4 — Type-check + build dashboard**

Run: `cd /Users/zasuo/AI-Tool/unity-codegraph/web && npx tsc --noEmit && npm run build`
Expected: build pass, không lỗi `NodeLabel` thiếu key trong `NODE_COLORS`/`NODE_SIZES` (cả hai là `Record<NodeLabel, …>` nên thiếu key sẽ fail type-check — đó là chốt kiểm tra).

- [ ] **Step 5 — Đồng bộ overlay (không commit)**
```bash
# Đồng bộ file mới vào custom/new hoặc regenerate custom/patches/05-unity-full-asset-graph.patch.
# Không chạy git commit trong plan này.
```

### Task 8.3: Smoke end-to-end (thủ công, ghi lại)

- [ ] **Step 1**: index fixture/real Unity ở full-asset mode (`CODEGRAPH_UNITY_ASSETS=1 codegraph unity index --assets`), khởi động dashboard (`bash dashboard.sh` hoặc `node web/server/server.mjs` + `npm --prefix web run dev`).
- [ ] **Step 2 — Verify mắt thường**: đồ thị hiện `unity_prefab/scene/asset` (xanh), KHÔNG có node nào tên `*.meta`; bật filter `UnityComponent`/`UnityGameObject` thì sub-object mới hiện.
- [ ] **Step 3 — Ghi lại** kết quả vào `docs/design/` (1 đoạn + screenshot path). Không commit ảnh nếu nặng.

---

## Self-review checklist (chạy trước khi đóng plan)

- [ ] **Spec coverage:** mọi mục §1–§7 của spec có task tương ứng (mode §1.1→P0; gate §1.2→P3.2; node/edge §1.3→P3.1/P3.3; guid §2.1→P1; yaml §3→P2; resolver §4→P4; serializefield/unityevent §5→P5; asmdef/sync §6→P6; mcp §7→P7; dashboard/`.meta`→P8).
- [ ] **`.meta` không sinh node:** gate Phase 3.2 trả `false` cho `.meta` ngay cả ở full-asset (test P3.2 Step 1); `.meta` chỉ được `buildGuidIndex` đọc out-of-band (P1.3). Dashboard lọc cứng `.meta` lần nữa (P8.1).
- [ ] **Provenance type:** `'unity'` đã thêm vào union `Edge.provenance` (P3.1) — nếu không TS build fail.
- [ ] **Schema 2 chỗ:** `schema.sql` (DB mới) + `migrations.ts` v5 (DB cũ) — cả hai (P1.1).
- [ ] **Gate 1 chỗ:** chỉ sửa `isSourceFile`/`detectLanguage`; watcher tự thừa hưởng (P3.2) — KHÔNG sửa watcher.
- [ ] **Node-ext nhất quán:** gate (P3.2) mở cho `UNITY_ASSET_NODE_EXTENSIONS` = `{.prefab,.unity,.asset}` + `.asmdef`; `FILE_KIND` trong extractor (P3.3) khớp đúng 3 ext này.
- [ ] **Tên nhất quán:** `unityRelation`, `generateNodeId`, `buildGuidIndex`, `resolveUnityEdges`, `getEdgesByRelation`, `UnityAssetExtractor`, `UNITY_ASSET_NODE_EXTENSIONS` dùng đồng nhất xuyên các phase.
- [ ] **Label dashboard:** mỗi `unity_*` kind (P3.1) có key trong `KIND_TO_LABEL` (P8.1) và `NodeLabel` mới có key trong cả `NODE_COLORS` + `NODE_SIZES` (P8.2 — `Record<NodeLabel,…>` sẽ fail type-check nếu thiếu).
- [ ] **Isolation:** test "csharp-only = 0 unity nodes" pass ở mọi phase sau (P0.4, tái kiểm P3.4).

## Mở/cần xác minh khi thực thi (đã ghi trong spec §"verify khi code")
1. P2: thử `parseAllDocuments` của `yaml` nuốt `%TAG !u!` trực tiếp → có thể bỏ HEADER_RE split.
2. P5.1: cách set `decorators` cho field trong tree-sitter C# (grep `decorators:` trong `tree-sitter.ts`).
3. P4.2/P7: chữ ký thật của `GraphQueryManager`/`storeExtractionResult` — đọc trước khi chèn helper.
