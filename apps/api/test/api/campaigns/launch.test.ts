import { resolveSendWindow } from '@buzzkit/api/api/campaigns/launch';
import { DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS } from '@buzzkit/api/api/messages/constants';
import { describe, expect, it } from 'vitest';

describe('resolveSendWindow', () => {
  it('leaves an unpaced send on the default lifetime', () => {
    expect(resolveSendWindow(100_000, null)).toBe(DEFAULT_TTL_SECONDS);
  });

  it('covers the whole paced send and still leaves the default headroom', () => {
    expect(resolveSendWindow(2000, 1)).toBe(2000 * 60 + DEFAULT_TTL_SECONDS);
  });

  it('outlasts the default lifetime where a slow rate needs more than a day', () => {
    expect(resolveSendWindow(2000, 1)).toBeGreaterThan(DEFAULT_TTL_SECONDS);
  });

  it('refuses a rate that cannot finish before a message may expire', () => {
    expect(() => resolveSendWindow(100_000, 1)).toThrow(/takes longer than a message can live/);
  });

  it('names a rate that does fit', () => {
    const minimum = Math.ceil((100_000 * 60) / (MAX_TTL_SECONDS - DEFAULT_TTL_SECONDS));
    expect(() => resolveSendWindow(100_000, 1)).toThrow(new RegExp(`${minimum} a minute`));
    expect(resolveSendWindow(100_000, minimum)).toBeLessThanOrEqual(MAX_TTL_SECONDS);
  });
});
