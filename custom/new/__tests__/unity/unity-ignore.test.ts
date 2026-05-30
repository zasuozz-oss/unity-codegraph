import { describe, it, expect } from 'vitest';
import { UNITY_ALL_IGNORE_DIRS } from '../../src/extraction/unity-preset';

describe('unity ignored dirs', () => {
  it('ignores Unity engine-managed, SDK, and asset-only dirs', () => {
    const set = new Set(UNITY_ALL_IGNORE_DIRS);
    for (const dir of ['Library', 'Temp', 'Logs', 'Packages', 'Plugins', 'DOTween', 'Prefabs', 'Scenes']) {
      expect(set.has(dir)).toBe(true);
    }
  });
});
