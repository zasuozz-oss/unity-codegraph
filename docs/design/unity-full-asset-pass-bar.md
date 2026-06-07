# Unity Full-Asset Pass Bar

Ngay 2026-06-05.

## MCP Impact

| Target | Question | Tool path | Calls | Read/Grep | Result |
| --- | --- | --- | ---: | ---: | --- |
| MiniProject fixture | Sua `PlayerController` anh huong prefab/scene nao? | `codegraph_impact` | 1 | 0 | Pass: output co `Unity attachments` va `Assets/Prefabs/Player.prefab`. |

Bang tren duoc verify bang `__tests__/unity/unity-asset-integration.test.ts` case `codegraph_impact surfaces Unity prefab attachments for MonoBehaviour classes`, chay trong suite Unity.

## Real Unity Repo

Chua chay pass-bar tren repo Unity that ngoai workspace trong lan nay. Cac repo `/Users/zasuo/Unity/*` khong nam trong writable root hien tai; index truc tiep se ghi `.codegraph` vao do va can target/approval rieng.

## Completeness pass 2026-06-07

| Scenario | Expected | Result |
| --- | --- | --- |
| Rename voi GUID duoc giu | Khong con path/node/GUID cu; object ID on dinh | Pass |
| Component display | `Player / PlayerController`, `PlayButton / Button` | Pass |
| ScriptableObject | `Items / ItemDatabase` va asset containment | Pass |
| UnityEvent local/external | Resolve den method dich | Pass |
| UnityEvent overload | Chon overload theo `m_Mode` | Pass |
| Prefab override UnityEvent | Gom `m_Modification` theo call index va resolve method | Pass |
| Prefab source/stripped object | Resolve exact `GUID:fileID` | Pass |
| Imported assets | File node va named sub-assets tu `.meta` | Pass |
| Opaque first-party asset | Extension la co `.meta` van co node | Pass |
| Missing target | Tao `missing_asset`/`missing_object` placeholder | Pass |
| Ignore boundaries | Plugin/SDK/Library/Editor/generated van bi loai | Pass |
| Re-index idempotency | Node/edge count khong tang | Pass |

Bang chung:

- Focused Unity suites: 17/17 tests pass.
- Sync va full-pipeline: 18/18 tests pass.
- CodeGraph TypeScript build: pass.
- Dashboard mapper: 3/3 tests pass.
- Web production build: pass.
- Full CodeGraph suite: 1062 tests pass, 2 tests fail do baseline/environment:
  schema-version test van hard-code `4` trong khi schema hien tai la `7`;
  Windows daemon cleanup gap `EPERM`. Suite cung ghi nhan mot worker OOM.
