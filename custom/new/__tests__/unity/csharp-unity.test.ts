import { beforeAll, describe, it, expect } from 'vitest';
import { extractFromSource } from '../../src/extraction/tree-sitter';
import { initGrammars, loadGrammarsForLanguages } from '../../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadGrammarsForLanguages(['csharp']);
});

describe('C# Unity extraction', () => {
  it('captures MonoBehaviour bases and RequireComponent typeof references', () => {
    const result = extractFromSource(
      'Assets/Player.cs',
      `
using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class Player : MonoBehaviour
{
  [SerializeField] private int speed;
}
`,
      'csharp'
    );

    const player = result.nodes.find((n) => n.kind === 'class' && n.name === 'Player');
    expect(player).toBeTruthy();

    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      fromNodeId: player?.id,
      referenceName: 'MonoBehaviour',
      referenceKind: 'extends',
    }));
    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      fromNodeId: player?.id,
      referenceName: 'Rigidbody',
      referenceKind: 'references',
    }));
  });
});
