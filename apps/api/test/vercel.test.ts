import { describe, expect, it } from 'vitest';
import { restoreUrl } from '../src/vercel.js';

describe('reescrita da Vercel', () => {
  it('refaz o caminho original a partir de __path', () => {
    expect(restoreUrl('/api?__path=v1/trips&from=2026-09-01')).toBe('/api/v1/trips?from=2026-09-01');
    expect(restoreUrl('/api?__path=health')).toBe('/api/health');
    expect(restoreUrl('/api/v1/auth/me')).toBe('/api/v1/auth/me');
  });
});
