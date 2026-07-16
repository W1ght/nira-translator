import { describe, expect, it } from 'vitest';

import { getProviderOriginPattern } from './url';

describe('getProviderOriginPattern', () => {
  it('omits ports because extension match patterns apply to every port', () => {
    expect(getProviderOriginPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(getProviderOriginPattern('https://gateway.example.com:8443/v1')).toBe('https://gateway.example.com/*');
  });

  it('keeps a standard provider origin unchanged', () => {
    expect(getProviderOriginPattern('https://api.example.com/v1')).toBe('https://api.example.com/*');
  });
});
