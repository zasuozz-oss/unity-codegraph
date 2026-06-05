import { describe, it, expect } from 'vitest';
import { isUnityTextAsset, parseUnityYaml } from '../../src/extraction/unity/unity-yaml-parser';
import * as fs from 'fs';
import * as path from 'path';

describe('isUnityTextAsset', () => {
  it('true for %YAML header', () => {
    expect(isUnityTextAsset('%YAML 1.1\n%TAG !u! ...')).toBe(true);
  });

  it('true for --- header', () => {
    expect(isUnityTextAsset('--- !u!1 &1\n')).toBe(true);
  });

  it('false for binary-ish', () => {
    expect(isUnityTextAsset('\0\\x01garbage')).toBe(false);
  });
});

describe('parseUnityYaml', () => {
  it('splits a prefab into GameObject and MonoBehaviour docs with bodies', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'MiniProject', 'Assets', 'Prefabs', 'Player.prefab'),
      'utf8'
    );
    const docs = parseUnityYaml(src);
    const go = docs.find((d) => d.classId === 1);
    const mb = docs.find((d) => d.classId === 114);

    expect(go?.fileId).toBe(100);
    expect(go?.body.GameObject.m_Name).toBe('Player');
    expect(mb?.fileId).toBe(200);
    expect(mb?.body.MonoBehaviour.m_Script.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(mb?.body.MonoBehaviour.m_GameObject.fileID).toBe(100);
  });

  it('returns [] for binary content', () => {
    expect(parseUnityYaml('\0not yaml')).toEqual([]);
  });
});
