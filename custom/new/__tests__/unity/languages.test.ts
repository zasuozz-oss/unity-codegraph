import { describe, it, expect } from 'vitest';
import { LANGUAGES } from '../../src/types';

describe('unity languages registered', () => {
  it('includes unity_asset and unity_asmdef', () => {
    expect(LANGUAGES).toContain('unity_asset');
    expect(LANGUAGES).toContain('unity_asmdef');
  });
});
