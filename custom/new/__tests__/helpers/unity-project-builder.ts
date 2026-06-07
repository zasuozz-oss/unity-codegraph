import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface UnityProjectFixture {
  root: string;
  path(relativePath: string): string;
  write(relativePath: string, content: string | Buffer): void;
  move(from: string, to: string): void;
  remove(relativePath: string): void;
}

export function createUnityProject(): UnityProjectFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-unity-assets-'));
  const resolve = (relativePath: string): string =>
    path.join(root, ...relativePath.split('/'));

  const write = (relativePath: string, content: string | Buffer): void => {
    const target = resolve(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  write(
    'ProjectSettings/ProjectVersion.txt',
    'm_EditorVersion: 2022.3.20f1\n'
  );
  write(
    'Assets/Scripts/PlayerController.cs',
    [
      'using UnityEngine;',
      '',
      'public sealed class PlayerController : MonoBehaviour',
      '{',
      '    public void Respawn() { }',
      '    public void SetCount(int count) { }',
      '    public void SetCount(string count) { }',
      '}',
      '',
    ].join('\n')
  );
  write(
    'Assets/Scripts/PlayerController.cs.meta',
    [
      'fileFormatVersion: 2',
      'guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'MonoImporter:',
      '  externalObjects: {}',
      '',
    ].join('\n')
  );

  return {
    root,
    path: resolve,
    write,
    move(from: string, to: string): void {
      const target = resolve(to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(resolve(from), target);
    },
    remove(relativePath: string): void {
      fs.rmSync(resolve(relativePath), { recursive: true, force: true });
    },
  };
}
