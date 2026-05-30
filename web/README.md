# CodeGraph Dashboard (web)

Trình xem đồ thị tri thức (knowledge graph) đa-project cho CodeGraph — port phần
graph-viz từ GitNexus. Liệt kê mọi project đã index, chọn project để xem graph,
xóa project ngay trên UI. Đọc dữ liệu trực tiếp từ `.codegraph/codegraph.db`.

Stack: React 19 + Vite + sigma.js + graphology (ForceAtlas2). Không phụ thuộc GitNexus.

## Project registry

Mọi project được liệt kê trong `~/.codegraph/projects.json` (registry global per-user):
- `codegraph init` / `codegraph unity init` **tự đăng ký** project vào registry.
- `codegraph uninit` **gỡ** khỏi registry.
- Server **tự prune** entry nào mất `.codegraph/codegraph.db` (project bị xóa ngoài đĩa).
- Nút **Delete** trên UI xóa `.codegraph` + gỡ registry.
- `setup.sh` tạo registry rỗng nếu chưa có.

## Kiến trúc

```
~/.codegraph/projects.json  (registry, viết bởi `codegraph init`)
        │
        ▼
server/server.mjs (node:sqlite, HTTP :4319)
   │  GET    /api/projects             -> [{name, path, nodes, edges}]  (+prune)
   │  GET    /api/graph?project=<path> -> {nodes, relationships}
   │  GET    /api/node/:id?project=<path> -> node + source slice
   │  DELETE /api/projects?project=<path> -> rm .codegraph + unregister
   │  (mở .db mỗi project on-demand, cache handle)
        ▼
Vite dev (:5173, proxy /api) ──> React: project picker → sigma canvas
```

Mapping codegraph → model đồ thị:
- node `kind` → `NodeLabel` (file→File, class→Class, method→Method, component→Class…)
- edge `kind` → `RelationshipType` (contains→CONTAINS, calls→CALLS, references→USES…)

Xem `server/server.mjs` (`KIND_TO_LABEL`, `EDGE_TO_TYPE`).

## Chạy

Cách nhanh (1 lệnh, từ repo root):

```bash
./dashboard.sh            # khởi động server + UI, mở browser tới project picker
```

Hoặc thủ công:

```bash
npm install
npm run server           # Terminal 1 — API :4319, serve mọi project trong registry
npm run dev              # Terminal 2 — UI :5173
```

Đổi cổng: `PORT=xxxx npm run server` + `API_PORT=xxxx npm run dev`.

## Tính năng (vertical slice hiện tại)

- Render toàn graph bằng sigma + ForceAtlas2 layout (chạy trong web worker).
- Toggle hiển thị theo loại quan hệ (CALLS / IMPORTS / EXTENDS / USES …). CONTAINS ẩn mặc định.
- Click node → panel chi tiết: label/kind/lang/file + slice source code.
- Zoom / fit / focus-selected / re-run layout.
- Mặc định ẩn node `import` (GUID noise của Unity); thêm `?imports=1` để hiện.

## Chưa có (port tiếp nếu cần)

- AI chat / tool-calls (langchain) — đã loại khỏi scope.
- Search box, file-tree panel, depth filter UI, community clustering.
- Production serve gộp (hiện FE+API tách cổng).
