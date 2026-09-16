import { AnchorError, describeInstant, readAnchor, resolveMoment } from '@buzzkit/api/engine/moments';
import { describe, expect, it } from 'vitest';

const trigger = { timestamp: '2026-08-29T10:00:00.000Z' };

const at = (moment: Parameters<typeof resolveMoment>[0], subscriberTimezone = 'UTC') =>
  resolveMoment(moment, trigger, subscriberTimezone).at;

describe('resolveMoment', () => {
  it('counts a delay from the start of the run', () => {
    expect(at({ delay: '2h' })).toBe(Date.parse('2026-08-29T12:00:00.000Z'));
    expect(resolveMoment({ delay: '2h' }, trigger, 'UTC').timezone).toBeNull();
  });

  it('snaps to a wall-clock time in a zone, rolling to the next day when that time already passed', () => {
    expect(at({ time: '18:00', timezone: 'Europe/Paris' })).toBe(Date.parse('2026-08-29T16:00:00.000Z'));
    expect(at({ time: '09:00', timezone: 'Europe/Paris' })).toBe(Date.parse('2026-08-30T07:00:00.000Z'));
    expect(at({ delay: '3d', time: '09:00', timezone: 'America/New_York' })).toBe(
      Date.parse('2026-09-01T13:00:00.000Z')
    );
  });

  it("reads the subscriber's own zone when the moment says so", () => {
    expect(resolveMoment({ time: '09:00', timezone: 'subscriber' }, trigger, 'Asia/Tokyo')).toEqual({
      at: Date.parse('2026-08-30T00:00:00.000Z'),
      timezone: 'Asia/Tokyo',
    });
  });
});

describe('describeInstant', () => {
  it('reads as a date and time in the zone', () => {
    expect(describeInstant(Date.parse('2026-09-01T07:00:00.000Z'), 'Europe/Paris')).toBe(
      'Sep 1, 2026, 9:00 AM Europe/Paris'
    );
    expect(describeInstant(Date.parse('2026-09-01T07:00:00.000Z'))).toBe('Sep 1, 2026, 7:00 AM UTC');
  });
});

describe('resolveMoment with an anchor', () => {
  const scope = {
    trigger: { data: { expiresAt: 1821157701000, endsOn: '2026-09-05T00:00:00.000Z' } },
    subscriber: { attributes: {} },
    steps: {},
    vars: {},
  };

  it('counts back from a timestamp in the trigger data', () => {
    expect(resolveMoment({ at: 'trigger.data.expiresAt', before: '2d' }, trigger, 'UTC', scope).at).toBe(
      1821157701000 - 2 * 86_400_000
    );
  });

  it('counts forward from the anchor with a delay', () => {
    expect(resolveMoment({ at: 'trigger.data.endsOn', delay: '1d' }, trigger, 'UTC', scope).at).toBe(
      Date.parse('2026-09-06T00:00:00.000Z')
    );
  });

  it('reads an anchor given as an ISO string or as epoch milliseconds', () => {
    expect(resolveMoment({ at: 'trigger.data.endsOn' }, trigger, 'UTC', scope).at).toBe(
      Date.parse('2026-09-05T00:00:00.000Z')
    );
    expect(resolveMoment({ at: 'trigger.data.expiresAt' }, trigger, 'UTC', scope).at).toBe(1821157701000);
  });

  it('snaps the anchored instant to a wall-clock time', () => {
    expect(
      resolveMoment(
        { at: 'trigger.data.endsOn', before: '2d', time: '09:00', timezone: 'Europe/Paris' },
        trigger,
        'UTC',
        scope
      ).at
    ).toBe(Date.parse('2026-09-03T07:00:00.000Z'));
  });

  it('throws when the anchor is missing or is not a timestamp', () => {
    expect(() => resolveMoment({ at: 'trigger.data.nope' }, trigger, 'UTC', scope)).toThrow(AnchorError);
    expect(() => resolveMoment({ at: 'subscriber.attributes' }, trigger, 'UTC', scope)).toThrow(AnchorError);
  });

  it('still anchors on the trigger when no anchor is given', () => {
    expect(resolveMoment({ delay: '2h' }, trigger, 'UTC', scope).at).toBe(
      Date.parse('2026-08-29T12:00:00.000Z')
    );
  });
});

describe('readAnchor guards the range a Date can hold', () => {
  const scope = (x: unknown) => ({ trigger: { data: { x } } });

  it('refuses a finite number beyond the Date range', () => {
    expect(() => readAnchor('trigger.data.x', scope(9_000_000_000_000_000))).toThrow(AnchorError);
    expect(() => readAnchor('trigger.data.x', scope(-9_000_000_000_000_000))).toThrow(AnchorError);
  });

  it('accepts the edges of the Date range and ordinary values', () => {
    expect(readAnchor('trigger.data.x', scope(8_640_000_000_000_000))).toBe(8_640_000_000_000_000);
    expect(readAnchor('trigger.data.x', scope(0))).toBe(0);
    expect(readAnchor('trigger.data.x', scope(1_821_157_701_000))).toBe(1_821_157_701_000);
  });

  it('never returns a value that cannot be rendered', () => {
    const value = readAnchor('trigger.data.x', scope(1_821_157_701_000));
    expect(() => new Date(value).toISOString()).not.toThrow();
  });
});

describe('the resolved target is checked, not only the anchor', () => {
  const edge = { trigger: { data: { x: 8_640_000_000_000_000 } } };

  it('refuses an anchor that its offset pushes out of range', () => {
    expect(() => resolveMoment({ at: 'trigger.data.x', delay: '1d' }, trigger, 'UTC', edge)).toThrow(
      AnchorError
    );
  });

  it('refuses an anchor that its wall-clock time pushes out of range', () => {
    expect(() =>
      resolveMoment({ at: 'trigger.data.x', time: '09:00', timezone: 'UTC' }, trigger, 'UTC', edge)
    ).toThrow(AnchorError);
  });

  it('still allows an offset that brings an extreme anchor back into range', () => {
    expect(resolveMoment({ at: 'trigger.data.x', before: '1d' }, trigger, 'UTC', edge).at).toBe(
      8_640_000_000_000_000 - 86_400_000
    );
  });
});
