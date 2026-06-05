# Unity Full Asset-Graph cho CodeGraph — Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: dùng `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans` để triển khai theo từng task. Mỗi Phase bên dưới là một execution plan độc lập, tạo ra phần mềm chạy được và test được.

**Goal:** Cho phép CodeGraph index *quan hệ asset của Unity* (prefab / scene / ScriptableObject / asmdef / Addressables ↔ C#), không chỉ code C# thuần — để agent trả lời được "sửa script này thì prefab/scene nào hỏng".

**Architecture:** Thêm một **mode thứ ba** (`full-asset`) bên cạnh `default` và `csharp-only` hiện có. Khi bật, pipeline chạy thêm 3 lớp Unity (GUID index → asset YAML extractor → Unity reference resolver) ghi node/edge vào *cùng* SQLite graph, **tái dùng** `NodeKind`/`EdgeKind` generic + `metadata` discriminator thay vì bơm phình enum lõi. MCP value chủ yếu đến từ việc *lồng* edge Unity vào `codegraph_impact`/`codegraph_context` sẵn có, cộng vài tool mới cho thứ không có analog.

**Tech Stack:** TypeScript, tree-sitter (C#), `yaml@^2.9.0` (đã có sẵn trong deps), better-sqlite3 / node-sqlite3-wasm, MCP.

---

## 0. Tài liệu này thay thế gì

File này thay thế `docs/codegraph_unity_adapter.md` (bản proposal). Proposal đó đúng về *ý tưởng* nhưng (a) không biết repo đã cố ý chuyển sang **C#-only** (assets bị treat là noise), và (b) thiếu toàn bộ phần "how". Spec này lấp các khoảng trống đó với quyết định kỹ thuật cụ thể.

### 0.1 Bối cảnh code hiện tại (PHẢI đọc trước khi code)

| Sự thật | File | Hệ quả |
|---|---|---|
| `.prefab .unity .asset .meta .asmdef` bị **skip hoàn toàn** | `src/extraction/unity-preset.ts:28-30` (`UNITY_ASSET_EXTENSIONS`) + `src/extraction/grammars.ts:106-113` | Phải cho phép parse chúng trong mode mới |
| Thư mục `Prefabs/Scenes/Resources/ProjectSettings/Packages/...` **không được walk** | `unity-preset.ts:94-108` (`UNITY_ALL_IGNORE_DIRS`) | Mode mới cần ignore-list rút gọn |
| Mode hiện tại bật bằng `CODEGRAPH_UNITY=1` + marker `.codegraph/unity` | `src/extraction/unity-mode.ts` | Mode mới chồng thêm cờ riêng |
| `NodeKind` / `EdgeKind` là enum cố định, "must use these exact strings" | `src/types.ts:43-60`, `codegraph/CLAUDE.md` | Thêm có kiểm soát + ưu tiên reuse |
| `edges.metadata` là cột JSON; `nodes` **không** có cột metadata | `src/db/schema.sql:38-49` | Dữ liệu Unity của edge → `metadata`; của node → mã hoá vào `qualified_name` + bảng phụ |
| **Migration thật**: array `{version, up}` trong `src/db/migrations.ts`; `CURRENT_SCHEMA_VERSION = 4` hiện tại; `db/index.ts:73-75` chạy migration khi `currentVersion < CURRENT`, và set version trên DB mới để không re-apply | `src/db/migrations.ts`, `src/db/index.ts:73-75` | Migration mới = **version 5** trong `migrations.ts`; **đồng thời** thêm bảng vào `schema.sql` cho DB tạo mới |
| **`isSourceFile()` là gate DUY NHẤT** "file này có được index không"; hiện trả `false` cho `UNITY_ASSET_EXTENSIONS` vô điều kiện | `src/extraction/grammars.ts:126-133` (+ `detectLanguage`) | Sửa **một chỗ** này (gate theo `isUnityAssetMode()`) → orchestrator **và** watcher cùng thừa hưởng |
| Watcher dùng chính `isSourceFile` để lọc | `src/sync/watcher.ts:212` | **Không** cần sửa watcher riêng cho việc theo dõi asset |
| Standalone extractor (non-tree-sitter) dispatch trong `tree-sitter.ts`, theo pattern class `SvelteExtractor(filePath, source)` | `src/extraction/tree-sitter.ts:3084` (`SvelteExtractor`), `:25` (`VueExtractor`) | Unity asset extractor hook vào **đúng seam dispatch này**, không phải `index.ts` |
| `yaml@^2.9.0` (eemeli/yaml) đã là dependency | `package.json` | Không cần thêm dep để parse YAML |
| C# extractor chưa bắt `[SerializeField]` | `src/extraction/languages/csharp.ts` | Cần mở rộng để map field YAML ↔ field C# |
| Tool MCP mới thường bị agent ít chọn | `codegraph/CLAUDE.md` ("New tools fare worse") | Ưu tiên lồng vào tool sẵn có |
| Build phải copy `schema.sql` + `*.wasm` vào `dist/` | `codegraph/CLAUDE.md` | Mọi SQL mới phải được copy hoặc không ship |

### 0.2 Việc cần làm trước tiên (spike, không code production)
Comment ở `unity-preset.ts` nói *"Previously CodeGraph parsed these for prefab→script GUID links; that is intentionally dropped here."* → upstream `colbymchenry/codegraph` có thể đã có code parse prefab→script. **Trước Phase 1**, kiểm tra git history upstream:
```bash
git log --all --oneline -- '*unity*' 2>/dev/null
git log -S 'm_Script' --oneline --all 2>/dev/null | head
```
Nếu tìm thấy parser cũ → mine lại làm điểm khởi đầu cho Phase 3. Nếu không → build mới theo spec này. Ghi kết quả spike vào CHANGELOG `[Unreleased]`.

---

## 1. Quyết định kiến trúc cốt lõi (chốt — không để TBD)

### 1.1 Mode
- Thêm cờ `CODEGRAPH_UNITY_ASSETS=1` và marker `.codegraph/unity-assets`, **nằm trên** mode Unity hiện có (luôn ngụ ý `CODEGRAPH_UNITY=1`).
- Ba trạng thái:
  - `default` — y hệt upstream, không động tới Unity.
  - `csharp-only` (`CODEGRAPH_UNITY=1`) — như hiện tại: C# sạch, asset = noise.
  - `full-asset` (`CODEGRAPH_UNITY_ASSETS=1`) — C# + asset graph (mode mới này).
- CLI: thêm subcommand `codegraph unity index --assets` (và `sync`/`serve --mcp` đọc marker `unity-assets` để giữ chế độ). Không đổi hành vi mặc định của `codegraph unity` cũ → **backward compatible**.
- Hàm mới trong `unity-mode.ts`: `isUnityAssetMode()`, `enableUnityAssetMode()`, `writeUnityAssetMarker()`, `hasUnityAssetMarker()`, `enableUnityAssetModeIfMarked()` — gương theo các hàm sẵn có.

### 1.2 Skip-list reconciliation
Trong `full-asset` mode (sửa **đúng một gate**, mọi thứ thừa hưởng):
- **`isSourceFile()` + `detectLanguage()`** (`grammars.ts:126-133`) — gate DUY NHẤT. Hiện trả `false`/skip cho `UNITY_ASSET_EXTENSIONS` vô điều kiện. Đổi thành: nếu `isUnityAssetMode()` thì **không skip** `.prefab/.unity/.asset/.meta/.asmdef`. Vì orchestrator **và** `watcher.ts:212` đều gọi `isSourceFile`, chỉ cần sửa ở đây → cả index lẫn watch tự nhận asset (không cần đụng watcher).
- **Dispatch parse** (`tree-sitter.ts`, nơi `SvelteExtractor`/`VueExtractor` được route): khi `detectLanguage` trả `unity_asset`/`unity_asmdef`, route sang `UnityAssetExtractor`/`UnityAsmdefExtractor` (class `(filePath, source) → {nodes, edges}`, gương `SvelteExtractor`), **không** qua tree-sitter.
- **Dir walk** (`index.ts` dùng `UNITY_ALL_IGNORE_DIRS`): dùng ignore-list rút gọn mới `UNITY_ASSET_MODE_IGNORE_DIRS` = chỉ engine/generated/SDK (`Library, Temp, Logs, MemoryCaptures, Recordings, UserSettings, Build, Builds, obj, .claude` + `UNITY_SDK_DIRS`). **Bỏ** `Prefabs, Scenes, Resources, Sprites,..., AddressableAssetsData` và `ProjectSettings` khỏi ignore (cần walk để index asset). **Vẫn ignore** `Packages/` (lớn, third-party) **trừ** `Packages/manifest.json`.

### 1.3 Mô hình node/edge (TÁI DÙNG enum lõi + metadata discriminator)
**NodeKind mới (6, tối thiểu)** — thêm vào `NODE_KINDS` trong `types.ts`:
```
unity_scene        // file .unity
unity_prefab       // file .prefab
unity_asset        // .asset (ScriptableObject, settings,...)
unity_gameobject   // 1 GameObject trong scene/prefab
unity_component     // 1 component (MonoBehaviour/built-in) trên GameObject
unity_script       // placeholder cho script KHÔNG resolve được sang class C# (vd ở Package)
```
> `asmdef` → dùng lại `module` (asmdef = assembly). `UnitySerializedField` **không** là node — biểu diễn bằng *edge* `references` mang `metadata.fieldName`. `UnityAddressable` → dùng lại node asset + `metadata.addressable=true`. Script first-party → dùng lại `class` node có sẵn từ csharp.ts; chỉ tạo `unity_script` khi không resolve được.

**EdgeKind: KHÔNG thêm kind mới.** Dùng `contains` và `references` + discriminator `metadata.unityRelation`, `provenance:'unity'`:

| Quan hệ Unity | EdgeKind | metadata |
|---|---|---|
| scene → gameobject | `contains` | `unityRelation:'scene_contains_gameobject'` |
| prefab → gameobject | `contains` | `unityRelation:'prefab_contains_gameobject'` |
| gameobject → component | `contains` | `unityRelation:'gameobject_has_component'` |
| component → script(class) | `references` | `unityRelation:'component_uses_script'`, `guid`, `fileID` |
| component → asset (serialized field) | `references` | `unityRelation:'serialized_field_references_asset'`, `fieldName`, `guid`, `fileID` |
| component → prefab (serialized field) | `references` | `unityRelation:'serialized_field_references_prefab'`, `fieldName`, `guid` |
| scene → prefab (PrefabInstance) | `references` | `unityRelation:'scene_references_prefab'`, `guid` |
| asmdef → asmdef | `references` | `unityRelation:'asmdef_references_asmdef'` |
| addressable → asset | `references` | `unityRelation:'addressable_references_asset'`, `address` |
| UnityEvent → method | `references` | `unityRelation:'unity_event_calls_method'`, `fieldName`, `methodName`, `mode` |
| component → (guid không tồn tại) | `references` | `unityRelation:'missing_script'`, `guid` (target = node placeholder hoặc bỏ, xem 1.4) |

**Lý do:** `codegraph/CLAUDE.md` coi `NodeKind`/`EdgeKind` là enum cố định; bơm 12 edge kind làm phình lõi và đụng mọi nơi switch trên kind. Pattern `metadata` + `provenance` đã là cách repo làm với synthesized edges (`metadata.synthesizedBy`). Query/MCP lọc bằng `WHERE kind='references' AND json_extract(metadata,'$.unityRelation')=...`.

### 1.4 Định danh node Unity (không cần đổi cột `nodes`)
- File-level node (`unity_scene/prefab/asset`): `name` = tên file, `qualified_name` = `file_path`, `file_path` = đường dẫn, `language` = `unity_asset`, `start_line/end_line` = `1`/số dòng.
- Sub-object node (`unity_gameobject/unity_component`): `qualified_name` = `${file_path}::${fileID}`, `name` = `m_Name` (gameobject) hoặc tên class component, `start_line` = dòng của document trong file (từ anchor). → `fileID` được mã hoá trong `qualified_name`; không cần cột mới.
- `unity_script` placeholder (guid không resolve): `qualified_name` = `unity-script::${guid}`, `name` = guid rút gọn.
- GUID → asset_path map lưu ở **bảng phụ** `unity_guids` (xem 2.1), không nhét vào `nodes`.

### 1.5 Xử lý serialization & file không-text (graceful degrade)
- Đọc `ProjectSettings/EditorSettings.asset` → field `m_SerializationMode` (`0`=Mixed, `1`=ForceBinary, `2`=ForceText). Nếu `ForceBinary` → **không parse asset**, log warning, tự hạ xuống `csharp-only` cho run đó (vẫn index C#).
- Per-file guard: đọc vài byte đầu; nếu không bắt đầu bằng `%YAML` hoặc `---` → coi là binary, skip file đó (không fail toàn bộ index).

---

## 2. File structure

```
src/extraction/unity/
  unity-asset-mode.ts        # (gộp vào unity-mode.ts) cờ + marker full-asset
  unity-yaml-parser.ts       # tách Unity-YAML thành documents {classId, fileID, body}
  unity-guid-index.ts        # đọc .meta → bảng unity_guids; lookup guid↔path
  unity-asset-extractor.ts   # .prefab/.unity/.asset → unity_* nodes + edge thô (guid/fileID chưa resolve)
  unity-asmdef-extractor.ts  # .asmdef → module node + reference (theo name → guid)
src/resolution/unity/
  unity-reference-resolver.ts # resolve guid/fileID → node id; emit edge cuối; phát hiện missing script
src/db/
  schema.sql                  # +bảng unity_guids (base cho DB tạo mới)
  migrations.ts               # +migration { version: 5, up }; CURRENT_SCHEMA_VERSION 4 → 5 (cho DB đã tồn tại)
src/mcp/
  tools.ts                    # lồng Unity vào impact/context; thêm tool mới
  server-instructions.ts      # mô tả khả năng Unity (single source of truth)
__tests__/unity/
  fixtures/MiniProject/        # Unity project tí hon (xem Phase 0)
  unity-yaml-parser.test.ts
  unity-guid-index.test.ts
  unity-asset-extractor.test.ts
  unity-reference-resolver.test.ts
  unity-asset-integration.test.ts
```
Sửa: `src/types.ts` (NodeKind), `src/extraction/grammars.ts` (gate), `src/extraction/index.ts` (orchestrate Unity passes), `src/extraction/unity-preset.ts` (ignore-list rút gọn), `src/sync/*` (watch asset ext), `src/bin/codegraph.ts` (CLI `--assets`).

### 2.1 Schema bảng GUID
```sql
-- Unity GUID → asset map (chỉ điền ở full-asset mode)
CREATE TABLE IF NOT EXISTS unity_guids (
    guid       TEXT PRIMARY KEY,
    asset_path TEXT NOT NULL,
    asset_type TEXT NOT NULL,          -- 'script' | 'prefab' | 'scene' | 'asset' | 'folder' | 'other'
    main_file_id INTEGER,              -- 11500000 cho MonoScript; NULL nếu n/a
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unity_guids_path ON unity_guids(asset_path);
```
**Hai chỗ phải sửa** (không phải một):
1. `src/db/schema.sql` — thêm `CREATE TABLE`/`CREATE INDEX` trên (base cho DB tạo mới; `db/index.ts` set version = `CURRENT_SCHEMA_VERSION` ngay sau khi chạy schema.sql nên migration không re-apply).
2. `src/db/migrations.ts` — thêm object `{ version: 5, name: 'unity-asset-guid-index', up: (db) => { db.exec('CREATE TABLE IF NOT EXISTS unity_guids ...'); } }` vào mảng `MIGRATIONS` và đổi `CURRENT_SCHEMA_VERSION` từ `4` → `5` (nâng cấp DB đã tồn tại của user đang dùng `csharp-only`).

Dùng `CREATE TABLE IF NOT EXISTS` ở cả hai để idempotent. Nhớ `copy-assets` đã copy `schema.sql` → dist; không thêm dep build.

---

## 3. Mô hình parsing Unity YAML (phần dễ sai nhất — chốt cụ thể)

### 3.1 Vì sao không dùng YAML parser thẳng
File Unity text bắt đầu bằng:
```
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &123456789
GameObject:
  m_Name: Player
  m_Component:
  - component: {fileID: 987654321}
--- !u!114 &987654321
MonoBehaviour:
  m_GameObject: {fileID: 123456789}
  m_Script: {fileID: 11500000, guid: abc..., type: 3}
  speed: 5
  target: {fileID: 0, guid: def..., type: 2}
```
`!u!1`, `!u!114` là **custom tag** + multi-document + anchor `&id`. Parser YAML chuẩn fail ở dòng `--- !u!...`.

### 3.2 Chiến lược 2 lớp
1. **Split documents** bằng regex trên header (KHÔNG dùng YAML lib ở bước này):
   `/^--- !u!(\d+) &(\d+)(?:\s+stripped)?\s*$/gm` → mỗi match cho `{ classId, fileID, stripped, bodyStart }`. `classId` map: `1`=GameObject, `4`=Transform, `114`=MonoBehaviour, `1001`=PrefabInstance, ... (giữ bảng `UNITY_CLASS_IDS` tối thiểu cho các id ta dùng).
2. **Parse body từng document** bằng `yaml` lib (eemeli) ở chế độ an toàn — body sau khi bỏ header **là YAML hợp lệ**. Dùng `parseDocument(body, { strict: false })`; lấy `.toJS()`. Bọc try/catch: document lỗi → skip document đó, không vỡ file.

Module `unity-yaml-parser.ts` export:
```ts
export interface UnityDoc { classId: number; fileId: number; stripped: boolean; body: Record<string, any>; line: number; }
export function parseUnityYaml(content: string): UnityDoc[];   // [] nếu binary/không phải %YAML
export function isUnityTextAsset(content: string): boolean;    // bắt đầu bằng %YAML hoặc ---
```

### 3.3 fileID — semantics phải nắm
- `m_Script: {fileID: 11500000, guid, type:3}` → `11500000` = main object của MonoScript; resolve qua **guid** (không phải fileID) sang file `.cs`.
- `m_GameObject: {fileID: <local>}` → trỏ tới document GameObject **trong cùng file** (qua anchor). Resolve qua **anchor map nội bộ file** `{ fileId → node }`.
- `{fileID: 0}` = null reference (bỏ qua).
- Serialized field trỏ asset ngoài: `{fileID: <id>, guid: <X>, type: 2}` → resolve qua **guid**; nếu là sub-asset thì fileID phân biệt (MVP: chỉ tới file-level node theo guid, ghi fileID vào metadata).
- `PrefabInstance` (`!u!1001`): `m_SourcePrefab: {fileID:..., guid}` → scene/prefab → prefab nguồn (qua guid). `m_Modifications` (override) → **MVP bỏ qua**, ghi `metadata.hasModifications=true`; xử lý ở Phase tương lai.
- **Component built-in** (`!u!4` Transform, `!u!33` MeshFilter,...): **không** có `m_Script`/guid. Vẫn tạo node `unity_component` với `name` = tên từ `UNITY_CLASS_IDS[classId]` (vd `'Transform'`) và edge `gameobject_has_component`, **không** có edge `component_uses_script`. Chỉ MonoBehaviour (`!u!114`) mới có script edge.

### 3.4 UnityEvent
Trong body MonoBehaviour, field kiểu UnityEvent có dạng:
```yaml
m_OnClick:
  m_PersistentCalls:
    m_Calls:
    - m_Target: {fileID: 987, guid: abc, type: 3}
      m_MethodName: OnButtonPressed
      m_Mode: 1
```
Extractor lấy mỗi phần tử `m_Calls` → edge tới method (`m_Target` resolve sang class, `m_MethodName` → method node của class đó).

---

## 4. Reference resolution (2 pha, sau extraction)

`unity-reference-resolver.ts` chạy sau khi extractor đã ghi node + edge-thô (edge-thô lưu guid/fileID trong metadata, target tạm rỗng):

- **Pha A — local fileID**: với mỗi file, map `fileID → node.id` (anchor map). Resolve các edge `gameobject_has_component`, `m_GameObject` back-ref trong cùng file.
- **Pha B — guid**: lookup `unity_guids` cho mỗi guid trong edge.
  - guid → `.cs` → tìm `class` node first-party tương ứng (theo file_path + tên class trùng tên file, fallback class đầu tiên). Có → edge `component_uses_script` tới class. Không có class node (script ở Package/SDK đã ignore) → tạo `unity_script` placeholder.
  - guid → asset/prefab/scene file node.
  - guid **không có trong `unity_guids`** → `missing_script`: edge `references` với `metadata.unityRelation='missing_script'`, target = node placeholder `unity_script` tên `<missing:guid>`. Đây là nguồn cho tool `unity_find_missing_scripts`.
- Edge thô chưa resolve được (guid lẫn fileID đều fail) → ghi vào `unresolved_refs` (bảng sẵn có) để debug, không tạo edge rác.

### 4.1 Thứ tự build (quan trọng — guid index phải xong TRƯỚC resolver)
GUID là tham chiếu chéo file → không resolve được khi đang stream từng file. Bắt buộc 2 lượt:
- **Lượt 1 (trong extraction)**: mọi `.meta` không-bị-ignore được đọc → điền `unity_guids`. `.meta` **không** sinh node graph (chỉ là side-table). Đồng thời asset extractor sinh node `unity_*` + edge-thô (guid/fileID trong metadata, chưa có target).
- **Lượt 2 (post-pass, cùng chỗ `ReferenceResolver` chạy)**: `unity-reference-resolver.ts` chạy **sau khi toàn bộ `unity_guids` đã đầy** → resolve edge-thô. Phải đảm bảo resolver được gọi sau extraction toàn dự án, không phải per-file.
- **Khối lượng `.meta`**: project thật có hàng chục nghìn `.meta` (mỗi asset/script/folder một file). Đọc tất cả `.meta` không-bị-ignore là chấp nhận được (file ~vài trăm byte, chỉ cần regex lấy dòng `guid:`), nhưng **đo thời gian** và parse bằng đọc dòng (không YAML-parse toàn bộ). Quy tắc suy đường dẫn: `asset_path = <meta_path bỏ đuôi '.meta'>`; nếu path đó là thư mục → `asset_type='folder'`.

---

## 5. Mở rộng C# extractor cho serialized field (Phase 5)

Để map field YAML ↔ field C#, `csharp.ts` cần emit field node kèm attribute. Hiện đã có `fieldTypes: ['field_declaration']`. Thêm:
- Bắt attribute list của field; set `decorators` (cột sẵn có, JSON array) chứa `['SerializeField']` khi có `[SerializeField]`.
- Đánh dấu class kế thừa `MonoBehaviour`/`ScriptableObject` (đã có `extends` edge từ tree-sitter) — resolver dùng để biết field nào "serializable".
- KHÔNG đổi NodeKind (vẫn `field`/`property`). Resolver nối `serialized_field_references_asset` từ component → asset, và (tùy chọn, Phase 5) gắn `metadata.csharpFieldId` trỏ field node tương ứng để trace 2 chiều.

---

## 6. Sync / incremental (Phase 6)

- `FileWatcher` **tự** theo dõi asset một khi `isSourceFile()` ngừng skip chúng ở full-asset mode (watcher.ts:212 gọi chính `isSourceFile`) — **không cần sửa watcher**. Chỉ cần gate ở §1.2 đã đủ.
- `.meta` đổi/xoá → update/xoá row `unity_guids` tương ứng + re-resolve edge dùng guid đó.
- `.prefab/.unity/.asset` đổi → xoá mọi node có `file_path` = file đó (CASCADE xoá edge) + re-extract + re-resolve.
- Re-resolve giới hạn phạm vi tới guid/file đổi (không full rebuild).

---

## 7. MCP / query layer (Phase 7)

**Ưu tiên LỒNG vào tool sẵn có** (vì tool mới ít được agent chọn — `codegraph/CLAUDE.md`):
- `codegraph_impact <Class>`: khi class là MonoBehaviour/ScriptableObject, **thêm** mục "Unity attachments" liệt kê prefab/scene đính kèm (edge `component_uses_script` ngược) + asset reference. Một câu hỏi "sửa script X ảnh hưởng gì" trả lời trong 1 call, gồm cả asset.
- `codegraph_context <Class>`: thêm dòng "Used by N prefabs / M scenes".

**Tool mới — chỉ những thứ KHÔNG có analog** (ít, để khỏi loãng):
- `unity_find_missing_scripts` — quét edge `missing_script`. (Không có cách nào khác hỏi cái này.)
- `unity_find_references_to_asset <assetPath>` — ai dùng asset/prefab/SO này (edge ngược tới asset node).

`server-instructions.ts`: thêm 3-4 dòng mô tả khả năng Unity. **Không** kỳ vọng nó đổi hành vi agent (kênh low-salience) — giá trị thật nằm ở việc impact/context giờ tự kèm dữ liệu Unity.

**Tránh ô nhiễm search/traversal** (gap thiết kế cần chốt):
- `codegraph_search` đang trả symbol code; node `unity_*` (đặc biệt `unity_gameobject`/`unity_component`, có thể rất nhiều) **không** nên lẫn vào kết quả search mặc định → mặc định lọc bỏ `unity_*` khỏi `codegraph_search`, chỉ trả khi caller xin `kinds:['unity_*']`. Cần kiểm tra FTS5: nếu có trigger FTS trên `nodes`, node Unity sẽ tự vào FTS (name không được null) — thêm điều kiện loại trừ ở query layer, không bỏ trigger.
- `getImpactRadius`/`GraphTraverser`: edge Unity (`provenance:'unity'`) giờ nằm trong graph nên impact của một class C# sẽ lan sang prefab/scene — **đúng ý muốn** cho §7. Nhưng cần đảm bảo traversal C# thuần (không Unity) không vô tình đi vào node asset gây nhiễu: cho phép lọc theo `provenance`/`unityRelation` khi cần, mặc định impact của MonoBehaviour **có** kèm Unity, impact symbol thường thì không bị kéo dài vô lý (asset là leaf, không có out-edge code).

---

## 8. Testing & acceptance (BẮT BUỘC theo codegraph/CLAUDE.md)

### 8.1 Fixture (Phase 0)
Tạo `__tests__/unity/fixtures/MiniProject/` tối thiểu:
```
Assets/Scripts/PlayerController.cs (+ .cs.meta guid=AAAA)
Assets/Scripts/ItemDatabase.cs : ScriptableObject (+ .meta guid=BBBB)
Assets/Prefabs/Player.prefab  (GameObject + MonoBehaviour m_Script guid=AAAA, field target guid=CCCC)
Assets/Scenes/Main.unity      (chứa Player + PrefabInstance trỏ Player.prefab)
Assets/ScriptableObjects/Items.asset (m_Script guid=BBBB) (+ .meta guid=CCCC)
Assets/Game.asmdef            (+ .meta)
ProjectSettings/EditorSettings.asset (m_SerializationMode: 2)  # ForceText
ProjectSettings/ProjectVersion.txt
```
+ 1 fixture lỗi: prefab có `m_Script` guid không tồn tại (test missing-script) + 1 file binary giả (test graceful skip).

### 8.2 Mức test
- **Unit** mỗi module (yaml-parser tách đúng N docs; guid-index map đúng; extractor ra đúng node count; resolver nối đúng edge; missing-script phát hiện được; binary file → skip không throw).
- **Integration**: index `MiniProject` → assert tồn tại edge `component_uses_script` Player→PlayerController, `scene_references_prefab` Main→Player.prefab, `serialized_field_references_asset` Player→Items.asset, và 1 `missing_script`. Assert node count ổn định khi re-index (no explosion).
- **Mode isolation**: index `MiniProject` ở `csharp-only` → KHÔNG có node `unity_*` nào (đảm bảo backward compat).

### 8.3 Pass bar (A/B, theo playbook repo)
Trên 1 Unity repo thật (small) + `MiniProject`, câu hỏi *"sửa `<MonoBehaviour>` thì prefab/scene nào ảnh hưởng?"*: `codegraph_impact` trả lời kèm prefab/scene trong **1 call, 0 Read/Grep**. Ghi số vào `docs/design/` coverage matrix.

---

## 9. Phân rã Phase (mỗi Phase = 1 execution plan, ship được độc lập)

| Phase | Nội dung | Ship được gì |
|---|---|---|
| **0** | Spike upstream history (0.2) + fixture `MiniProject` + bật `full-asset` mode/CLI/cờ/marker (1.1) | `codegraph unity index --assets` chạy, chưa parse asset, test mode isolation pass |
| **1** | Schema `unity_guids` (2.1: schema.sql + migration v5 trong `migrations.ts`) + `unity-guid-index.ts` đọc `.meta` (lượt 1, §4.1) | Bảng GUID đầy đủ, lookup guid↔path test pass; DB cũ nâng cấp v4→v5 |
| **2** | `unity-yaml-parser.ts` (mục 3) | Tách document + parse body, test trên fixture |
| **3** | `unity-asset-extractor.ts` + NodeKind mới (1.3) + gate grammars + ignore-list rút gọn (1.2) | Node `unity_*` xuất hiện trong graph |
| **4** | `unity-reference-resolver.ts` (mục 4) — local fileID + guid + missing-script | Edge Unity resolve đầy đủ; integration test pass |
| **5** | C# `[SerializeField]` (mục 5) + edge `serialized_field_references_asset/_prefab` + UnityEvent (3.4) | Trace field→asset, UnityEvent→method |
| **6** | asmdef extractor + sync/incremental (mục 6) | Watch asset, asmdef graph |
| **7** | MCP: lồng vào impact/context + 2 tool mới + server-instructions (mục 7) + Addressables | Agent trả lời câu hỏi Unity; A/B pass bar |

Phase 5–7 phụ thuộc 1–4. Phase 0 phải xong trước hết. Mỗi Phase tự có CHANGELOG `[Unreleased]` entry (user-facing, theo rule release của repo).

---

## 10. Rủi ro / điều KHÔNG làm ở MVP

- **Không** xử lý `m_Modifications` (prefab override) — chỉ ghi cờ, để Phase sau.
- **Không** parse Animator/Timeline/ShaderGraph/VFXGraph (proposal mục 8.9).
- **Không** model runtime lifecycle (Awake/Update...) thành edge — để C# extractor lo phần code.
- **Không** đụng mode `default`/`csharp-only` (backward compat tuyệt đối — đã có test isolation ở Phase 0).
- Scene khổng lồ (vài chục MB): parser stream theo document, không load toàn bộ thành 1 object YAML; nếu file > ngưỡng cấu hình → vẫn parse nhưng log thời gian. **Không** đặt hard cap làm mất dữ liệu.
