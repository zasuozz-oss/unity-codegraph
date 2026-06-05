import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../src/db/migrations';
import { createDatabase } from '../../src/db/sqlite-adapter';
import { parseMetaGuid, classifyAsset, buildGuidIndex } from '../../src/extraction/unity/unity-guid-index';
import * as path from 'path';

describe('schema version', () => {
  it('is bumped to 5 for unity_guids', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
  });
});

describe('parseMetaGuid', () => {
  it('extracts guid from a .meta body', () => {
    expect(parseMetaGuid('fileFormatVersion: 2\nguid: abc123\nMonoImporter:\n')).toBe('abc123');
  });

  it('returns null when no guid line', () => {
    expect(parseMetaGuid('fileFormatVersion: 2\n')).toBeNull();
  });
});

describe('classifyAsset', () => {
  it('classifies by owning file extension', () => {
    expect(classifyAsset('A/B/Player.cs')).toBe('script');
    expect(classifyAsset('A/B/Player.prefab')).toBe('prefab');
    expect(classifyAsset('A/B/Main.unity')).toBe('scene');
    expect(classifyAsset('A/B/Items.asset')).toBe('asset');
    expect(classifyAsset('A/B/SomeFolder')).toBe('folder');
  });
});

describe('buildGuidIndex (integration)', () => {
  it('indexes every .meta under MiniProject into unity_guids', () => {
    const { db } = createDatabase(':memory:');
    db.exec(`
      CREATE TABLE unity_guids (
        guid TEXT PRIMARY KEY,
        asset_path TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        main_file_id INTEGER,
        updated_at INTEGER NOT NULL
      );
    `);
    const root = path.join(__dirname, 'fixtures', 'MiniProject');
    try {
      const count = buildGuidIndex(root, db);
      expect(count).toBeGreaterThanOrEqual(6);
      const row = db
        .prepare('SELECT asset_path, asset_type FROM unity_guids WHERE guid = ?')
        .get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') as any;
      expect(row.asset_path.endsWith('PlayerController.cs')).toBe(true);
      expect(row.asset_type).toBe('script');
    } finally {
      db.close();
    }
  });
});
