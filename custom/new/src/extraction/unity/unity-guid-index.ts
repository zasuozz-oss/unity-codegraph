import * as fs from 'fs';
import * as path from 'path';
import type { SqliteDatabase } from '../../db/sqlite-adapter';
import { UNITY_ENGINE_IGNORE_DIRS, UNITY_SDK_DIRS } from '../unity-preset';

export type UnityAssetType =
  | 'script'
  | 'prefab'
  | 'scene'
  | 'asset'
  | 'asmdef'
  | 'asmref'
  | 'image'
  | 'model'
  | 'audio'
  | 'font'
  | 'video'
  | 'sprite'
  | 'subasset'
  | 'folder'
  | 'other';

export interface GuidRow {
  guid: string;
  assetPath: string;
  assetType: UnityAssetType;
  fileId: string;
  name: string | null;
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
  if (ext === '.asmref') return 'asmref';
  if (['.png', '.jpg', '.jpeg', '.tga', '.psd', '.webp', '.bmp', '.tif', '.tiff'].includes(ext)) return 'image';
  if (['.fbx', '.obj', '.blend', '.dae', '.3ds', '.dxf'].includes(ext)) return 'model';
  if (['.wav', '.mp3', '.ogg', '.aiff', '.aif', '.flac'].includes(ext)) return 'audio';
  if (['.ttf', '.otf'].includes(ext)) return 'font';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  return 'other';
}

/** Read one .meta file into a GUID row. */
export function readMetaFile(metaPath: string): GuidRow[] {
  let content: string;
  try {
    content = fs.readFileSync(metaPath, 'utf8');
  } catch {
    return [];
  }

  const guid = parseMetaGuid(content);
  if (!guid) return [];

  const assetPath = metaPath.replace(/\.meta$/, '');
  const assetType = classifyAsset(assetPath);
  const rows: GuidRow[] = [{
    guid,
    assetPath,
    assetType,
    fileId: assetType === 'script' ? '11500000' : '0',
    name: null,
  }];

  for (const [fileId, name] of parseNamedSubAssets(content)) {
    rows.push({
      guid,
      assetPath,
      assetType: assetType === 'image' ? 'sprite' : 'subasset',
      fileId,
      name,
    });
  }

  return rows;
}

function parseNamedSubAssets(content: string): Map<string, string> {
  const byFileId = new Map<string, string>();
  collectRecycleTableNames(content, byFileId);
  collectInternalIdTableNames(content, byFileId);
  collectSpriteSheetNames(content, byFileId);
  return byFileId;
}

function collectRecycleTableNames(content: string, byFileId: Map<string, string>): void {
  let tableIndent: number | null = null;
  for (const line of content.split(/\r?\n/)) {
    const tableMatch = /^(\s*)fileIDToRecycleName:\s*$/.exec(line);
    if (tableMatch) {
      tableIndent = tableMatch[1]!.length;
      continue;
    }
    if (tableIndent === null) continue;

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (line.trim() && indent <= tableIndent) {
      tableIndent = null;
      continue;
    }
    const direct = /^\s+(-?\d+):\s*(.+?)\s*$/.exec(line);
    if (direct) {
      byFileId.set(direct[1]!, unquoteYamlScalar(direct[2]!));
    }
  }
}

function collectInternalIdTableNames(content: string, byFileId: Map<string, string>): void {
  let pendingFileId: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const fileIdMatch = /^\s+\d+:\s*(-?\d+)\s*$/.exec(line);
    if (fileIdMatch) {
      pendingFileId = fileIdMatch[1]!;
      continue;
    }

    const nameMatch = /^\s*second:\s*(.+?)\s*$/.exec(line);
    if (nameMatch && pendingFileId) {
      byFileId.set(pendingFileId, unquoteYamlScalar(nameMatch[1]!));
      pendingFileId = null;
    }
  }
}

function collectSpriteSheetNames(content: string, byFileId: Map<string, string>): void {
  let pendingName: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const nameMatch = /^\s*name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch) {
      pendingName = unquoteYamlScalar(nameMatch[1]!);
      continue;
    }

    const fileIdMatch = /^\s*internalID:\s*(-?\d+)\s*$/.exec(line);
    if (fileIdMatch && pendingName) {
      byFileId.set(fileIdMatch[1]!, pendingName);
      pendingName = null;
    }
  }
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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

/** Rebuild unity_guids from every current .meta file. Returns count indexed. */
export function buildGuidIndex(root: string, db: SqliteDatabase): number {
  let count = 0;
  const rebuild = db.transaction(() => {
    db.exec('DELETE FROM unity_guids');
    const stmt = db.prepare(
      'INSERT INTO unity_guids (guid, file_id, asset_path, asset_type, name, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const now = Date.now();

    for (const metaPath of walkMeta(root)) {
      for (const row of readMetaFile(metaPath)) {
        stmt.run(
          row.guid,
          row.fileId,
          path.relative(root, row.assetPath).replace(/\\/g, '/'),
          row.assetType,
          row.name,
          now
        );
        count++;
      }
    }
  });
  rebuild();

  return count;
}
