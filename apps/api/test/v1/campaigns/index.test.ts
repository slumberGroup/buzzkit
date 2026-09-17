import { cancelCampaign, findCampaignBySlug, softDeleteCampaign } from '@buzzkit/api/api/campaigns/index';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, BASE_URL } from '../../utils/api';
import { db, eq, tables, tenantIdFor } from '../../utils/db';
import { eventually } from '../../utils/eventually';
import { fakeToken } from '../../utils/fixtures';
import { createKey, setupWorkspace, uniq } from '../../utils/setup';

type Headers = Record<string, string>;

type CampaignBody = {
  id: string;
  slug: string;
  name: string;
  status: string;
  channel: string;
  topic: { slug: string; name: string };
  segment: string | null;
  payload: Record<string, unknown>;
  schedule: { at: string; timezone: string; defaultTimezone?: string } | null;
  throttlePerMinute: number | null;
  audienceEstimate: number | null;
  launchedAt: string | null;
  canceledAt: string | null;
  deleted?: boolean;
  stats?: { counts: { messages: number; sent: number } };
};

type TopicBody = { id: string; slug: string; name: string };

type MessageBody = {
  id: string;
  status: string;
  counts: { total: number };
  throttlePerMinute: number | null;
  expiresAt: string;
  createdAt: string;
  schedule?: { at: string; timezone: string; defaultTimezone?: string } | null;
};

type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null; total?: number };

let session: Headers;
let keyBearer: Headers;
let topic: TopicBody;

function createTopic(headers: Headers) {
  return api<TopicBody>('/v1/topics', {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug: `tpc-${uniq()}`, name: 'Releases', channels: ['push'] }),
  });
}

function createCampaign(headers: Headers, input: Record<string, unknown> = {}) {
  return api<CampaignBody>('/v1/campaigns', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      slug: `cmp-${uniq()}`,
      name: 'New audiobook',
      topic: topic.slug,
      payload: { title: 'A new story tonight', body: 'Tap to start listening.' },
      ...input,
    }),
  });
}

beforeAll(async () => {
  const base = await setupWorkspace({ push: 'unusable' });
  session = { ...base.ownerBearer, 'buzzkit-workspace': base.workspace.slug };
  keyBearer = base.keyBearer;
  const created = await createTopic(session);
  if (!created.body.data) throw new Error(`topic ${created.status} ${JSON.stringify(created.body)}`);
  topic = created.body.data;
});

describe('POST /v1/campaigns', () => {
  it('creates a draft carrying its topic', async () => {
    const { status, body } = await createCampaign(session);
    expect(status).toBe(201);
    expect(body.data!.status).toBe('draft');
    expect(body.data!.topic.slug).toBe(topic.slug);
    expect(body.data!.id).toMatch(/^cmp_/);
  });

  it('refuses a campaign with no topic', async () => {
    const { status } = await api<CampaignBody>('/v1/campaigns', {
      method: 'POST',
      headers: session,
      body: JSON.stringify({
        slug: `cmp-${uniq()}`,
        name: 'No topic',
        payload: { title: 'Hello' },
      }),
    });
    expect(status).toBe(400);
  });

  it('refuses an empty payload', async () => {
    const { status, body } = await createCampaign(session, { payload: {} });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('payload_missing');
  });

  it('refuses a duplicate slug', async () => {
    const first = await createCampaign(session);
    const { status, body } = await createCampaign(session, { slug: first.body.data!.slug });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('slug_taken');
  });
});

describe('PATCH /v1/campaigns/:campaignSlug', () => {
  it('edits a draft and returns the unchanged campaign for an empty body', async () => {
    const created = (await createCampaign(session)).body.data!;

    const renamed = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, {
      method: 'PATCH',
      headers: session,
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data!.name).toBe('Renamed');

    const empty = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, {
      method: 'PATCH',
      headers: session,
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(200);
    expect(empty.body.data!.name).toBe('Renamed');
  });

  it('keeps the fallback timezone on a subscriber schedule', async () => {
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    const schedule = { at, timezone: 'subscriber', defaultTimezone: 'America/Toronto' };
    const created = await createCampaign(session, { schedule });
    expect(created.status).toBe(201);
    expect(created.body.data!.schedule).toEqual(schedule);

    const updated = await api<CampaignBody>(`/v1/campaigns/${created.body.data!.slug}`, {
      method: 'PATCH',
      headers: session,
      body: JSON.stringify({ schedule }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data!.schedule).toEqual(schedule);

    const launched = await api<CampaignBody>(`/v1/campaigns/${created.body.data!.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });
    expect(launched.status).toBe(200);
    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.body.data!.slug}/messages`, {
      headers: session,
    });
    expect(messages.body.data!.items[0]?.schedule?.defaultTimezone).toBe('America/Toronto');
  });
});

describe('the throttle', () => {
  it('rides onto the message it launches, so a later edit cannot repace a send', async () => {
    const created = (await createCampaign(session, { throttlePerMinute: 120 })).body.data!;
    expect(created.throttlePerMinute).toBe(120);

    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
      headers: session,
    });
    expect(messages.body.data!.items[0]?.throttlePerMinute).toBe(120);
  });

  it('gives a paced send a lifetime long enough to finish it', async () => {
    for (let index = 0; index < 3; index += 1) {
      await api('/v1/subscriptions', {
        method: 'POST',
        headers: session,
        body: JSON.stringify({
          externalId: `paced_${uniq()}`,
          channel: 'push',
          platform: 'ios',
          token: fakeToken(),
        }),
      });
    }

    const created = (await createCampaign(session, { throttlePerMinute: 1 })).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
      headers: session,
    });
    const message = messages.body.data!.items[0]!;
    const lifetimeSeconds =
      (new Date(message.expiresAt).getTime() - new Date(message.createdAt).getTime()) / 1000;
    expect(lifetimeSeconds).toBeGreaterThan(24 * 60 * 60);
  });

  it('refuses a rate of zero or less', async () => {
    const { status } = await createCampaign(session, { throttlePerMinute: 0 });
    expect(status).toBe(400);
  });
});

describe('POST /v1/campaigns/:campaignSlug/launch', () => {
  it('launches, becomes sending, and produces one message', async () => {
    const created = (await createCampaign(session)).body.data!;

    const launched = await api<CampaignBody>(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });
    expect(launched.status).toBe(200);
    expect(launched.body.data!.status).toBe('sending');
    expect(launched.body.data!.launchedAt).not.toBeNull();

    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
      headers: session,
    });
    expect(messages.body.data!.items).toHaveLength(1);
  });

  it('fans the launched message out to the subscribers opted in to the topic', async () => {
    const externalId = `user_${uniq()}`;
    const registered = await api('/v1/subscriptions', {
      method: 'POST',
      headers: session,
      body: JSON.stringify({ externalId, channel: 'push', platform: 'ios', token: fakeToken() }),
    });
    expect(registered.status).toBe(201);

    const created = (await createCampaign(session)).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const delivered = await eventually(
      async () => {
        const page = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
          headers: session,
        });
        const message = page.body.data?.items[0];
        return message && message.counts.total > 0 ? message : false;
      },
      { label: 'the campaign message fans out' }
    );
    expect(delivered.counts.total).toBeGreaterThan(0);
  });

  it('is idempotent, so a repeated launch never sends twice', async () => {
    const created = (await createCampaign(session)).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const again = await api<CampaignBody>(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('campaign_not_launchable');

    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
      headers: session,
    });
    expect(messages.body.data!.items).toHaveLength(1);
  });

  it('refuses an API key, because launching is session only', async () => {
    const created = (await createCampaign(session)).body.data!;
    const { status } = await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: keyBearer,
      body: JSON.stringify({}),
    });
    expect(status).toBe(403);
  });

  it('refuses to edit a campaign once it has launched', async () => {
    const created = (await createCampaign(session)).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const { status, body } = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, {
      method: 'PATCH',
      headers: session,
      body: JSON.stringify({ name: 'Too late' }),
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('campaign_not_editable');
  });
});

async function releaseSchedules() {
  const response = await fetch(`${BASE_URL}/__scheduled?cron=*+*+*+*+*`);
  if (!response.ok) throw new Error(`minute sweep failed: ${response.status}`);
}

async function reconcileCampaigns() {
  const response = await fetch(`${BASE_URL}/__scheduled?cron=*/5+*+*+*+*`);
  if (!response.ok) throw new Error(`five minute sweep failed: ${response.status}`);
}

describe('the campaign lifecycle', () => {
  it('walks an immediate campaign from sending to completed', async () => {
    const created = (await createCampaign(session)).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const completed = await eventually(
      async () => {
        await reconcileCampaigns();
        const { body } = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, { headers: session });
        return body.data?.status === 'completed' ? body.data : false;
      },
      { label: 'the campaign completes' }
    );
    expect(completed.status).toBe('completed');
  });

  it('does not strand a campaign whose message was canceled on its own', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
    const created = (await createCampaign(session, { schedule: { at, timezone: 'UTC' } })).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
      headers: session,
    });
    const messageId = messages.body.data!.items[0]!.id;
    const canceled = await api(`/v1/messages/${messageId}/cancel`, { method: 'POST', headers: session });
    expect(canceled.status).toBe(200);

    const settled = await eventually(
      async () => {
        await reconcileCampaigns();
        const { body } = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, { headers: session });
        return body.data?.status === 'completed' ? body.data : false;
      },
      { label: 'the campaign stops waiting on a canceled message' }
    );
    expect(settled.status).toBe('completed');
  });

  it('moves a scheduled campaign on to sending once its message is released', async () => {
    const at = new Date(Date.now() + 60_000).toISOString().slice(0, 16);
    const created = (await createCampaign(session, { schedule: { at, timezone: 'UTC' } })).body.data!;
    const launched = await api<CampaignBody>(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });
    if (!launched.body.data)
      throw new Error(`launch ${launched.status} ${JSON.stringify(launched.body.error)}`);
    expect(launched.body.data.status).toBe('scheduled');

    const sending = await eventually(
      async () => {
        await releaseSchedules();
        await reconcileCampaigns();
        const { body } = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, { headers: session });
        return body.data && body.data.status !== 'scheduled' ? body.data : false;
      },
      { label: 'the scheduled campaign leaves scheduled', timeoutMs: 120_000 }
    );
    expect(['sending', 'completed']).toContain(sending.status);
  }, 150_000);
});

describe('POST /v1/campaigns/:campaignSlug/cancel', () => {
  it('cancels a scheduled campaign and its unsent message', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
    const created = (await createCampaign(session, { schedule: { at, timezone: 'UTC' } })).body.data!;

    const launched = await api<CampaignBody>(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });
    if (!launched.body.data)
      throw new Error(`launch ${launched.status} ${JSON.stringify(launched.body.error)}`);
    expect(launched.body.data.status).toBe('scheduled');

    const canceled = await api<CampaignBody>(`/v1/campaigns/${created.slug}/cancel`, {
      method: 'POST',
      headers: session,
    });
    expect(canceled.status).toBe(200);
    expect(canceled.body.data!.status).toBe('canceled');

    const messages = await api<Page<MessageBody>>(`/v1/campaigns/${created.slug}/messages`, {
      headers: session,
    });
    expect(messages.body.data!.items[0]?.status).toBe('canceled');
  });
});

describe('GET /v1/campaigns/:campaignSlug/audience', () => {
  it('answers an estimate before anything is sent', async () => {
    const created = (await createCampaign(session)).body.data!;
    const { status, body } = await api<{ estimate: number; reachable: number; matching: number | null }>(
      `/v1/campaigns/${created.slug}/audience`,
      { headers: session }
    );
    expect(status).toBe(200);
    expect(body.data!.estimate).toBeGreaterThanOrEqual(0);
    expect(body.data!.matching).toBeNull();
  });
});

describe('DELETE /v1/campaigns/:campaignSlug', () => {
  it('refuses a stale draft after launch has changed its status', async () => {
    const created = (await createCampaign(session)).body.data!;
    const tenantId = await tenantIdFor(session['buzzkit-workspace']);
    const stale = await findCampaignBySlug(db, tenantId, created.slug);
    await db.update(tables.campaign).set({ status: 'sending' }).where(eq(tables.campaign.id, stale.id));

    await expect(softDeleteCampaign(db, stale)).rejects.toMatchObject({
      code: 'campaign_not_deletable',
    });
    const current = await findCampaignBySlug(db, tenantId, created.slug);
    expect(current.deletedAt).toBeNull();
    await expect(cancelCampaign(db, current)).rejects.toMatchObject({
      code: 'campaign_not_cancelable',
    });
  });

  it('refuses to delete a campaign that can still send, so its handle is never lost', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
    const created = (await createCampaign(session, { schedule: { at, timezone: 'UTC' } })).body.data!;
    await api(`/v1/campaigns/${created.slug}/launch`, {
      method: 'POST',
      headers: session,
      body: JSON.stringify({}),
    });

    const refused = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, {
      method: 'DELETE',
      headers: session,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe('campaign_not_deletable');

    await api(`/v1/campaigns/${created.slug}/cancel`, { method: 'POST', headers: session });
    const deleted = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, {
      method: 'DELETE',
      headers: session,
    });
    expect(deleted.status).toBe(200);
  });

  it('soft deletes and stops listing it', async () => {
    const created = (await createCampaign(session)).body.data!;
    const deleted = await api<CampaignBody>(`/v1/campaigns/${created.slug}`, {
      method: 'DELETE',
      headers: session,
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data!.deleted).toBe(true);

    const listed = await api<Page<CampaignBody>>('/v1/campaigns', { headers: session });
    expect(listed.body.data!.items.some((item) => item.slug === created.slug)).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('hides another workspace campaigns', async () => {
    const created = (await createCampaign(session)).body.data!;
    const other = await setupWorkspace({ push: 'unusable' });
    const otherKey = await createKey(other.owner.token, other.workspace.slug);

    const { status } = await api(`/v1/campaigns/${created.slug}`, {
      headers: { Authorization: `Bearer ${otherKey.secret}` },
    });
    expect(status).toBe(404);
  });
});
