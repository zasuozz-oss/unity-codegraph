/**
 * Unity extraction is OPT-IN.
 *
 * Plain `codegraph init`/`index`/`sync` behave exactly like upstream and never
 * touch Unity asset files (`.prefab`, `.unity`, `.asset`, `.meta`, `.asmdef`)
 * nor apply the Unity-specific ignore dirs. Unity handling switches on only when
 * the `codegraph unity …` subcommands run — they set `CODEGRAPH_UNITY=1` and drop
 * a `.codegraph/unity` marker so later `sync`/`serve --mcp` stay Unity-aware on
 * the same project.
 */
import * as fs from 'fs';
import * as path from 'path';

/** True when the current process should extract Unity assets. */
export function isUnityMode(): boolean {
  return process.env.CODEGRAPH_UNITY === '1';
}

/** Force Unity mode on for this process (used by the `unity` CLI commands). */
export function enableUnityMode(): void {
  process.env.CODEGRAPH_UNITY = '1';
}

function markerPath(projectRoot: string): string {
  return path.join(projectRoot, '.codegraph', 'unity');
}

/** Persist the per-project Unity marker (project must already be initialized). */
export function writeUnityMarker(projectRoot: string): void {
  try {
    fs.writeFileSync(markerPath(projectRoot), 'Unity extraction enabled for this project.\n');
  } catch {
    /* non-fatal: the env var still drives this run */
  }
}

/** Whether this project was initialized in Unity mode. */
export function hasUnityMarker(projectRoot: string): boolean {
  try {
    return fs.existsSync(markerPath(projectRoot));
  } catch {
    return false;
  }
}

/** If the project carries the Unity marker, enable Unity mode for this process. */
export function enableUnityModeIfMarked(projectRoot: string): void {
  if (hasUnityMarker(projectRoot)) enableUnityMode();
}
