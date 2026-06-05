// CodeGraph web API — multi-project.
//
// Reads the global project registry (~/.codegraph/projects.json, written by
// `codegraph init`) and serves each project's .codegraph/codegraph.db on demand.
//
//   node server/server.mjs            # serve all registered projects
//   PORT=4319 node server/server.mjs
//
// Routes:
//   GET    /api/projects             -> [{name, path, dbPath, nodes, edges}]
//   GET    /api/graph?project=<path> -> {nodes, relationships}
//   GET    /api/node/:id?project=<path>
//   DELETE /api/projects?project=<path>  -> rm .codegraph + unregister
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { listProjects, removeProject, dbPathFor, registryPath } from './registry.mjs';
import { isHiddenNodeRow, mapNodeRow } from './graph-mapper.mjs';

const PORT = Number(process.env.PORT) || 4319;

// --- codegraph edge kind -> GitNexus RelationshipType ---
const EDGE_TO_TYPE = {
  contains: 'CONTAINS', calls: 'CALLS', imports: 'IMPORTS', exports: 'DEFINES',
  extends: 'EXTENDS', implements: 'IMPLEMENTS', references: 'USES',
  type_of: 'USES', returns: 'USES', instantiates: 'USES',
  overrides: 'METHOD_OVERRIDES', decorates: 'DECORATES',
};

// --- per-project DB handle cache ---
const dbCache = new Map(); // dbPath -> DatabaseSync

function openDb(dbPath) {
  let db = dbCache.get(dbPath);
  if (db) return db;
  db = new DatabaseSync(dbPath, { readOnly: true });
  dbCache.set(dbPath, db);
  return db;
}

function closeDb(dbPath) {
  const db = dbCache.get(dbPath);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    dbCache.delete(dbPath);
  }
}

/** Resolve a registered project by its `path` (the id the UI passes). */
function resolveProject(projectPath) {
  if (!projectPath) return null;
  const norm = projectPath.replace(/\\/g, '/');
  return listProjects().find((p) => p.path === norm) || null;
}

function buildGraph(db, { includeImports }) {
  const nodeRows = db.prepare(`
    SELECT id, kind, name, qualified_name, file_path, language, start_line, end_line
    FROM nodes ${includeImports ? '' : "WHERE kind != 'import'"}
  `).all().filter((r) => !isHiddenNodeRow(r));
  const nodeIds = new Set(nodeRows.map((r) => r.id));

  const nodes = nodeRows.map(mapNodeRow);

  const edgeRows = db.prepare(`SELECT id, source, target, kind FROM edges`).all();
  const relationships = [];
  for (const e of edgeRows) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    relationships.push({
      id: String(e.id), sourceId: e.source, targetId: e.target,
      type: EDGE_TO_TYPE[e.kind] || 'USES', confidence: 1, reason: 'codegraph',
    });
  }
  return { nodes, relationships };
}

function nodeDetail(db, projectRoot, id) {
  const row = db.prepare(`
    SELECT id, kind, name, qualified_name, file_path, language,
           start_line, end_line, signature, docstring
    FROM nodes WHERE id = ?
  `).get(id);
  if (!row) return null;

  let source = null;
  const filePath = join(projectRoot, row.file_path);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    try {
      const lines = readFileSync(filePath, 'utf8').split('\n');
      const start = Math.max(0, (row.start_line || 1) - 1);
      const end = Math.min(lines.length, row.end_line || row.start_line || 1);
      source = lines.slice(start, end).join('\n');
    } catch { /* ignore */ }
  }
  return { ...row, source };
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function countGraph(dbPath) {
  try {
    const db = openDb(dbPath);
    const n = db.prepare('SELECT count(*) c FROM nodes').get().c;
    const e = db.prepare('SELECT count(*) c FROM edges').get().c;
    return { nodes: n, edges: e };
  } catch {
    return { nodes: 0, edges: 0, error: true };
  }
}

createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'OPTIONS') return json(res, 204, {});

    // GET /api/projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const list = listProjects().map((p) => {
        const dbPath = dbPathFor(p.path);
        return { name: p.name, path: p.path, dbPath, lastInitAt: p.lastInitAt, ...countGraph(dbPath) };
      });
      return json(res, 200, { projects: list, registry: registryPath() });
    }

    // DELETE /api/projects?project=<path>  -> rm .codegraph + unregister
    if (url.pathname === '/api/projects' && req.method === 'DELETE') {
      const proj = resolveProject(url.searchParams.get('project'));
      if (!proj) return json(res, 404, { error: 'project not found' });
      const dbPath = dbPathFor(proj.path);
      closeDb(dbPath);
      const cgDir = join(proj.path, '.codegraph');
      try {
        if (existsSync(cgDir)) rmSync(cgDir, { recursive: true, force: true });
      } catch (e) {
        return json(res, 500, { error: `failed to delete .codegraph: ${e.message}` });
      }
      removeProject(proj.path);
      return json(res, 200, { deleted: proj.path });
    }

    // routes below require a resolved project
    const proj = resolveProject(url.searchParams.get('project'));

    if (url.pathname === '/api/graph' && req.method === 'GET') {
      if (!proj) return json(res, 404, { error: 'project not found or not registered' });
      const dbPath = dbPathFor(proj.path);
      if (!existsSync(dbPath)) return json(res, 410, { error: 'db missing (project deleted?)' });
      const includeImports = url.searchParams.get('imports') === '1';
      const t0 = Date.now();
      const g = buildGraph(openDb(dbPath), { includeImports });
      console.log(`[graph] ${proj.name}: ${g.nodes.length} nodes / ${g.relationships.length} edges in ${Date.now() - t0}ms`);
      return json(res, 200, g);
    }

    const m = url.pathname.match(/^\/api\/node\/(.+)$/);
    if (m && req.method === 'GET') {
      if (!proj) return json(res, 404, { error: 'project not found' });
      const dbPath = dbPathFor(proj.path);
      const detail = nodeDetail(openDb(dbPath), proj.path, decodeURIComponent(m[1]));
      return detail ? json(res, 200, detail) : json(res, 404, { error: 'node not found' });
    }

    json(res, 404, { error: 'unknown route' });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
}).listen(PORT, () => {
  console.log(`[codegraph-web] API on http://localhost:${PORT}`);
  console.log(`[codegraph-web] registry: ${registryPath()}`);
  const n = listProjects().length;
  console.log(`[codegraph-web] ${n} project(s) registered`);
});
