import { nextLocalTime, parseWallTime } from '@buzzkit/api/libs/timezone';
import { durationMs, type Moment, SUBSCRIBER_TIMEZONE } from '@buzzkit/schema/workflows';

export type ResolvedMoment = { at: number; timezone: string | null };

export class AnchorError extends Error {}

function assertInstant(value: number, label: string): number {
  if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) {
    throw new AnchorError(`${label} is not a moment a date can hold, got ${value}`);
  }
  return value;
}

function readLocalTime(target: number, hour: number, minute: number, timezone: string): number {
  try {
    return nextLocalTime(new Date(target), hour, minute, timezone).getTime();
  } catch {
    throw new AnchorError(`The anchor at its wall-clock time is not a moment a date can hold, got ${target}`);
  }
}

export function readAnchor(path: string, scope: unknown): number {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, scope);

  const instant =
    typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(instant) || Number.isNaN(new Date(instant).getTime())) {
    throw new AnchorError(`"${path}" is not a timestamp, got ${JSON.stringify(value) ?? 'nothing'}`);
  }
  return instant;
}

export function resolveMoment(
  moment: Moment,
  trigger: { timestamp: string },
  subscriberTimezone: string,
  scope?: unknown
): ResolvedMoment {
  const anchor = moment.at ? readAnchor(moment.at, scope) : Date.parse(trigger.timestamp);
  const offset = moment.before ? -durationMs(moment.before) : moment.delay ? durationMs(moment.delay) : 0;
  const target = assertInstant(anchor + offset, 'The anchor and its offset');
  const timezone = moment.timezone === SUBSCRIBER_TIMEZONE ? subscriberTimezone : (moment.timezone ?? null);
  if (!moment.time || !timezone) return { at: target, timezone };
  const { hour, minute } = parseWallTime(moment.time);
  const local = readLocalTime(target, hour, minute, timezone);

  return { at: assertInstant(local, 'The anchor at its wall-clock time'), timezone };
}

export function describeInstant(instant: number, timezone: string | null = null): string {
  const zone = timezone ?? 'UTC';
  const text = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(new Date(instant));
  return `${text} ${zone.replace(/_/g, ' ')}`;
}
