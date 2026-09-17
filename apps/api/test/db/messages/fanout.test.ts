import { listStalledFanouts } from '@buzzkit/api/api/messages/index';
import { eq, tables } from '@buzzkit/database';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../utils/db';
import { uniq } from '../../utils/setup';

const MINUTE_MS = 60 * 1000;

let tenantId: number;

async function idleMessage(options: { minutesIdle: number; resumesInMinutes?: number }): Promise<number> {
  const [message] = await db
    .insert(tables.message)
    .values({
      tenantId,
      channel: 'push',
      targets: {},
      payload: { title: 'Stall probe' },
      status: 'processing',
      fanoutResumeAt:
        options.resumesInMinutes === undefined
          ? null
          : new Date(Date.now() + options.resumesInMinutes * MINUTE_MS),
      expiresAt: new Date(Date.now() + 24 * 60 * MINUTE_MS),
    })
    .returning({ id: tables.message.id });
  await db
    .update(tables.message)
    .set({ updatedAt: new Date(Date.now() - options.minutesIdle * MINUTE_MS) })
    .where(eq(tables.message.id, message!.id));
  return message!.id;
}

async function isStalled(id: number): Promise<boolean> {
  const stalled = await listStalledFanouts(db, 500);
  return stalled.some((row) => row.id === id);
}

beforeAll(async () => {
  const [workspace] = await db
    .insert(tables.workspace)
    .values({ name: 'Stall probe', slug: `stall-${uniq()}` })
    .returning({ id: tables.workspace.id });
  const [tenant] = await db
    .insert(tables.tenant)
    .values({ workspaceId: workspace!.id, name: 'Default', slug: 'default', isDefault: true })
    .returning({ id: tables.tenant.id });
  tenantId = tenant!.id;
});

describe('listStalledFanouts', () => {
  it('recovers a fan-out that has genuinely stopped', async () => {
    const id = await idleMessage({ minutesIdle: 12 });
    expect(await isStalled(id)).toBe(true);
  });

  it('recovers a lost job the moment nothing is holding it back, whatever the rate', async () => {
    const id = await idleMessage({ minutesIdle: 12, resumesInMinutes: -1 });
    expect(await isStalled(id)).toBe(true);
  });

  it('leaves a paced fan-out alone while its next page is not due', async () => {
    const id = await idleMessage({ minutesIdle: 12, resumesInMinutes: 20 });
    expect(await isStalled(id)).toBe(false);
  });

  it('recovers a paced fan-out once its next page came due and never arrived', async () => {
    const id = await idleMessage({ minutesIdle: 40, resumesInMinutes: -20 });
    expect(await isStalled(id)).toBe(true);
  });
});
