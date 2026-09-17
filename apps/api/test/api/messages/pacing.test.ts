import { MAX_QUEUE_DELAY_SECONDS } from '@buzzkit/api/api/messages/constants';
import { pacingDelaySeconds } from '@buzzkit/api/api/messages/fanout';
import { describe, expect, it } from 'vitest';

describe('pacingDelaySeconds', () => {
  it('does not pace a message without a throttle', () => {
    expect(pacingDelaySeconds(500, null)).toBe(0);
  });

  it('does not pace a page that enqueued nothing', () => {
    expect(pacingDelaySeconds(0, 600)).toBe(0);
  });

  it('waits long enough for the page it just enqueued to fit the rate', () => {
    expect(pacingDelaySeconds(600, 600)).toBe(60);
    expect(pacingDelaySeconds(300, 600)).toBe(30);
    expect(pacingDelaySeconds(500, 1000)).toBe(30);
  });

  it('rounds up, so the rate is a ceiling and never exceeded', () => {
    expect(pacingDelaySeconds(1, 600)).toBe(1);
    expect(pacingDelaySeconds(7, 600)).toBe(1);
  });

  it('caps at the longest delay a queue accepts', () => {
    expect(pacingDelaySeconds(5000, 1)).toBe(MAX_QUEUE_DELAY_SECONDS);
  });
});
