// JS mirror of codegraph/src/registry/project-registry.ts — reads/writes the same
// ~/.codegraph/projects.json so the dashboard and the CLI share one project list.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const REGISTRY_DIR = path.join(os.homedir(), '.codegraph');
const REGISTRY_PATH = path.join(REGISTRY_DIR, 'projects.json');

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return { version: raw.version ?? 1, projects: Array.isArray(raw.projects) ? raw.projects : [] };
  } catch {
    return { version: 1, projects: [] };
  }
}

function write(reg) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
}

export function registryPath() {
  return REGISTRY_PATH;
}

export function dbPathFor(projectRoot) {
  return path.join(projectRoot, '.codegraph', 'codegraph.db');
}

/** List registered projects, pruning entries whose .codegraph/codegraph.db is gone. */
export function listProjects() {
  const reg = read();
  const alive = reg.projects.filter((p) =>
    fs.existsSync(path.join(p.path, '.codegraph', 'codegraph.db')),
  );
  if (alive.length !== reg.projects.length) {
    reg.projects = alive;
    write(reg);
  }
  return alive;
}

/** Remove a project from the registry by path. */
export function removeProject(projectRoot) {
  const root = path.resolve(projectRoot).replace(/\\/g, '/');
  const reg = read();
  const next = reg.projects.filter((p) => p.path !== root);
  if (next.length !== reg.projects.length) {
    reg.projects = next;
    write(reg);
  }
}
