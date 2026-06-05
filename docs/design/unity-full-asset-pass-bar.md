# Unity Full-Asset Pass Bar

Ngay 2026-06-05.

## MCP Impact

| Target | Question | Tool path | Calls | Read/Grep | Result |
| --- | --- | --- | ---: | ---: | --- |
| MiniProject fixture | Sua `PlayerController` anh huong prefab/scene nao? | `codegraph_impact` | 1 | 0 | Pass: output co `Unity attachments` va `Assets/Prefabs/Player.prefab`. |

Bang tren duoc verify bang `__tests__/unity/unity-asset-integration.test.ts` case `codegraph_impact surfaces Unity prefab attachments for MonoBehaviour classes`, chay trong suite Unity.

## Real Unity Repo

Chua chay pass-bar tren repo Unity that ngoai workspace trong lan nay. Cac repo `/Users/zasuo/Unity/*` khong nam trong writable root hien tai; index truc tiep se ghi `.codegraph` vao do va can target/approval rieng.
