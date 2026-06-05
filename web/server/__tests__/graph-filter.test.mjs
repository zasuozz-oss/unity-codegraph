import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNodeRow, KIND_TO_LABEL, isHiddenNodeRow } from '../graph-mapper.mjs';

test('unity kinds map to dedicated labels', () => {
  assert.equal(KIND_TO_LABEL.unity_prefab, 'UnityPrefab');
  assert.equal(KIND_TO_LABEL.unity_scene, 'UnityScene');
  assert.equal(KIND_TO_LABEL.unity_asset, 'UnityAsset');
  assert.equal(KIND_TO_LABEL.unity_gameobject, 'UnityGameObject');
  assert.equal(KIND_TO_LABEL.unity_component, 'UnityComponent');
  assert.equal(KIND_TO_LABEL.unity_script, 'File');
});

test('isHiddenNodeRow drops .meta rows', () => {
  assert.equal(isHiddenNodeRow({ file_path: 'Assets/X.cs.meta', kind: 'unity_asset' }), true);
  assert.equal(isHiddenNodeRow({ file_path: 'Assets/X.prefab', kind: 'unity_prefab' }), false);
  assert.equal(isHiddenNodeRow({ file_path: 'src/a.ts', kind: 'function' }), false);
});

test('mapNodeRow preserves dashboard node shape', () => {
  const row = {
    id: 'n1',
    kind: 'unity_prefab',
    name: 'Player',
    file_path: 'Assets/Prefabs/Player.prefab',
    start_line: 1,
    end_line: 20,
    language: 'unity_asset',
  };

  assert.deepEqual(mapNodeRow(row), {
    id: 'n1',
    label: 'UnityPrefab',
    properties: {
      name: 'Player',
      filePath: 'Assets/Prefabs/Player.prefab',
      startLine: 1,
      endLine: 20,
      language: 'unity_asset',
      kind: 'unity_prefab',
    },
  });
});
