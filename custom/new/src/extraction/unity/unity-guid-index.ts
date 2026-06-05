import * as fs from 'fs';
import * as path from 'path';
import { UNITY_ENGINE_IGNORE_DIRS, UNITY_SDK_DIRS } from '../unity-preset';

export type UnityAssetType = 'script' | 'prefab' | 'scene' | 'asset' | 'asmdef' | 'folder' | 'other';

export interface GuidRow {
  guid: string;
  assetPath: string;
  assetType: UnityAssetType;
  mainFileId: number | null;
}

/** Pull `guid: <hex>` from a .meta file body. */
export function parseMetaGuid(metaContent: string): string | null {
  const match = metaContent.match(/^guid:\s*([0-9a-fA-F]+)\s*$/m);
  return match?.[1] ?? null;
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
  if (ext === '.asmdef') return 'asmdef';
  return 'other';
}

/** Read one .meta file into a GUID row. */
export function readMetaFile(metaPath: string): GuidRow | null {
  let content: string;
  try {
    content = fs.readFileSync(metaPath, 'utf8');
  } catch {
    return null;
  }

  const guid = parseMetaGuid(content);
  if (!guid) return null;

  const assetPath = metaPath.replace(/\.meta$/, '');
  const assetType = classifyAsset(assetPath);
  return {
    guid,
    assetPath,
    assetType,
    mainFileId: assetType === 'script' ? 11500000 : null,
  };
}

const GUID_WALK_IGNORE = new Set<string>([
  ...UNITY_ENGINE_IGNORE_DIRS,
  ...Object.keys(UNITY_SDK_DIRS),
  'Packages',
]);

function* walkMeta(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!GUID_WALK_IGNORE.has(entry.name)) yield* walkMeta(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.meta')) {
      yield fullPath;
    }
  }
}

/** Read every .meta under root, upsert into unity_guids. Returns count indexed. */
export function buildGuidIndex(
  root: string,
  db: { prepare(sql: string): { run(...args: any[]): unknown } }
): number {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO unity_guids (guid, asset_path, asset_type, main_file_id, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = Date.now();
  let count = 0;

  for (const metaPath of walkMeta(root)) {
    const row = readMetaFile(metaPath);
    if (!row) continue;
    stmt.run(
      row.guid,
      path.relative(root, row.assetPath),
      row.assetType,
      row.mainFileId,
      now
    );
    count++;
  }

  return count;
}
