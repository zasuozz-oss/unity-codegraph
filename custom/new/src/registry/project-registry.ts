/**
 * Global project registry — a single per-user list of every project that has been
 * initialized with CodeGraph, so a multi-project dashboard can enumerate and switch
 * between them without scanning the filesystem.
 *
 * Stored at `~/.codegraph/projects.json`. Written by `codegraph init` (register) and
 * `codegraph uninit` (unregister); read (and self-pruned) by the dashboard server.
 *
 * This is intentionally dependency-free and self-contained so the web server can use
 * a JS mirror of the same format (`web/server/registry.mjs`).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ProjectEntry {
  /** Display name — basename of the project root. */
  name: string;
  /** Absolute project root, forward-slash normalized. */
  path: string;
  registeredAt: number;
  lastInitAt: number;
}

interface RegistryFile {
  version: number;
  projects: ProjectEntry[];
}

const REGISTRY_DIR = path.join(os.homedir(), '.codegraph');
const REGISTRY_PATH = path.join(REGISTRY_DIR, 'projects.json');

function norm(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

function read(): RegistryFile {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as Partial<RegistryFile>;
    return { version: raw.version ?? 1, projects: Array.isArray(raw.projects) ? raw.projects : [] };
  } catch {
    return { version: 1, projects: [] };
  }
}

function write(reg: RegistryFile): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
}

/** Absolute path of the registry file. */
export function registryPath(): string {
  return REGISTRY_PATH;
}

/** Create an empty registry if none exists (used by setup). */
export function ensureRegistry(): void {
  if (!fs.existsSync(REGISTRY_PATH)) write({ version: 1, projects: [] });
}

/** Add or refresh a project entry (idempotent, keyed by normalized path). */
export function upsertProject(projectRoot: string): void {
  const root = norm(projectRoot);
  const reg = read();
  const now = Date.now();
  const existing = reg.projects.find((p) => p.path === root);
  if (existing) {
    existing.lastInitAt = now;
    existing.name = path.basename(root);
  } else {
    reg.projects.push({ name: path.basename(root), path: root, registeredAt: now, lastInitAt: now });
  }
  write(reg);
}

/** Remove a project entry by path (no-op if absent). */
export function removeProject(projectRoot: string): void {
  const root = norm(projectRoot);
  const reg = read();
  const next = reg.projects.filter((p) => p.path !== root);
  if (next.length !== reg.projects.length) {
    reg.projects = next;
    write(reg);
  }
}

/**
 * List registered projects. With `prune`, drops entries whose
 * `.codegraph/codegraph.db` no longer exists (project deleted on disk) and
 * persists the cleaned list.
 */
export function listProjects(opts: { prune?: boolean } = {}): ProjectEntry[] {
  const reg = read();
  if (!opts.prune) return reg.projects;
  const alive = reg.projects.filter((p) =>
    fs.existsSync(path.join(p.path, '.codegraph', 'codegraph.db')),
  );
  if (alive.length !== reg.projects.length) {
    reg.projects = alive;
    write(reg);
  }
  return alive;
}
