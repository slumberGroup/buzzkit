import {
  cancelMessage,
  createMessage,
  DEFAULT_TTL_SECONDS,
  enqueueFanout,
  MAX_TTL_SECONDS,
  type Message,
} from '@buzzkit/api/api/messages/index';
import { findSegmentBySlug, type SegmentWithVersion } from '@buzzkit/api/api/segments/index';
import type { Tenant } from '@buzzkit/api/api/tenants/index';
import { selectTopicById } from '@buzzkit/api/api/topics/index';
import { BadRequestError, ConflictError, NotFoundError } from '@buzzkit/api/libs/error';
import { encodeId } from '@buzzkit/api/libs/sqids';
import { trace } from '@buzzkit/api/libs/telemetry';
import type { MessagePayload } from '@buzzkit/api/providers/index';
import { and, type Db, eq, inArray, isNull, sql, tables } from '@buzzkit/database';
import { resolveCampaignAudience } from './audience';
import { CAMPAIGN_CONFIRM_AUDIENCE } from './constants';
import type {
  Campaign,
  CampaignSchedule,
  CampaignTargets,
  CanceledCampaign,
  LaunchedCampaign,
} from './types';

const OPEN_STATUSES = ['queued', 'processing', 'scheduled'] as const;

function assertLaunchable(campaign: Campaign): void {
  if (campaign.status !== 'draft') {
    throw new ConflictError(`A ${campaign.status} campaign cannot be launched again`, {
      code: 'campaign_not_launchable',
      param: 'status',
    });
  }
}

export function resolveSendWindow(estimate: number, throttlePerMinute: number | null): number {
  if (!throttlePerMinute) return DEFAULT_TTL_SECONDS;

  const paced = Math.ceil((estimate / throttlePerMinute) * 60);
  const needed = paced + DEFAULT_TTL_SECONDS;
  if (needed <= MAX_TTL_SECONDS) return needed;

  const minimum = Math.ceil((estimate * 60) / (MAX_TTL_SECONDS - DEFAULT_TTL_SECONDS));
  throw new BadRequestError(
    `About ${estimate} subscribers at ${throttlePerMinute} a minute takes longer than a message can live. Send at ${minimum} a minute or more.`,
    { code: 'campaign_rate_too_slow', param: 'throttlePerMinute' }
  );
}

function assertConfirmed(campaign: Campaign, estimate: number, confirm?: string): void {
  if (estimate < CAMPAIGN_CONFIRM_AUDIENCE) return;
  if (confirm === campaign.name) return;

  throw new BadRequestError(
    `This campaign reaches about ${estimate} subscribers. Repeat the campaign name to confirm.`,
    { code: 'campaign_confirmation_required', param: 'confirm' }
  );
}

export async function launchCampaign(
  db: Db,
  tenant: Tenant,
  campaign: Campaign,
  options: { confirm?: string } = {}
): Promise<LaunchedCampaign> {
  assertLaunchable(campaign);

  const topic = await selectTopicById(db, campaign.tenantId, campaign.topicId);
  if (!topic) throw new NotFoundError('Topic not found');

  const audience = await resolveCampaignAudience(db, campaign);
  assertConfirmed(campaign, audience.estimate, options.confirm);
  const ttlSeconds = resolveSendWindow(audience.estimate, campaign.throttlePerMinute);

  const targets = campaign.targets as CampaignTargets;
  const schedule = campaign.schedule as CampaignSchedule | null;
  let segment: SegmentWithVersion | null = null;
  if (targets.segment) segment = await findSegmentBySlug(db, campaign.tenantId, targets.segment);

  const [launched] = await db
    .update(tables.campaign)
    .set({
      status: schedule ? 'scheduled' : 'sending',
      launchedAt: new Date(),
      audienceEstimate: audience.estimate,
      targets: {
        ...targets,
        ...(segment ? { segmentVersionId: segment.version.id } : {}),
      },
    })
    .where(
      and(
        eq(tables.campaign.id, campaign.id),
        eq(tables.campaign.status, 'draft'),
        isNull(tables.campaign.deletedAt)
      )
    )
    .returning();
  if (!launched) {
    throw new ConflictError('This campaign can no longer be launched', {
      code: 'campaign_not_launchable',
      param: 'status',
    });
  }

  let result: Awaited<ReturnType<typeof createMessage>>;
  try {
    result = await trace('campaigns.launch', async (t) => {
      t.set('campaign.audience', audience.estimate);
      return await createMessage(db, tenant, {
        ...(campaign.payload as MessagePayload),
        channel: campaign.channel,
        topic: topic.slug,
        ...(segment ? { segment: segment.slug } : {}),
        ...(targets.where ? { where: targets.where } : {}),
        ...(schedule ? { schedule } : {}),
        campaignId: campaign.id,
        throttlePerMinute: campaign.throttlePerMinute,
        ttlSeconds,
        idempotencyKey: `campaign:${encodeId('campaign', campaign.id)}:1`,
      });
    });
  } catch (error) {
    await db
      .update(tables.campaign)
      .set({ status: 'draft', launchedAt: null, audienceEstimate: null, targets })
      .where(
        and(
          eq(tables.campaign.id, campaign.id),
          eq(tables.campaign.status, schedule ? 'scheduled' : 'sending'),
          eq(tables.campaign.launchedAt, launched.launchedAt!)
        )
      );
    throw error;
  }
  const { message, created } = result;
  if (created && !schedule) await enqueueFanout(message.id);
  return { campaign: launched, message, created };
}

export async function testCampaign(
  db: Db,
  tenant: Tenant,
  campaign: Campaign,
  to: string[]
): Promise<Message> {
  const topic = await selectTopicById(db, campaign.tenantId, campaign.topicId);
  if (!topic) throw new NotFoundError('Topic not found');

  const { message, created } = await trace('campaigns.test', async () => {
    return await createMessage(db, tenant, {
      ...(campaign.payload as MessagePayload),
      channel: campaign.channel,
      topic: topic.slug,
      to,
    });
  });
  if (created) await enqueueFanout(message.id);

  return message;
}

export async function cancelCampaign(db: Db, campaign: Campaign): Promise<CanceledCampaign> {
  if (campaign.status === 'canceled' || campaign.status === 'completed') {
    throw new ConflictError(`A ${campaign.status} campaign cannot be canceled`, {
      code: 'campaign_not_cancelable',
      param: 'status',
    });
  }

  const [updated] = await db
    .update(tables.campaign)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(
      and(
        eq(tables.campaign.id, campaign.id),
        inArray(tables.campaign.status, ['draft', 'scheduled', 'sending']),
        isNull(tables.campaign.deletedAt),
        sql`(${tables.campaign.status} = 'draft' or exists (
          select 1 from ${tables.message}
          where ${tables.message.campaignId} = ${tables.campaign.id}
            and ${tables.message.deletedAt} is null
        ))`
      )
    )
    .returning();
  if (!updated) {
    throw new ConflictError('This campaign cannot be canceled while launch is in progress', {
      code: 'campaign_not_cancelable',
      param: 'status',
    });
  }

  const open = await db
    .select({ id: tables.message.id })
    .from(tables.message)
    .where(
      and(
        eq(tables.message.tenantId, campaign.tenantId),
        eq(tables.message.campaignId, campaign.id),
        inArray(tables.message.status, OPEN_STATUSES),
        isNull(tables.message.deletedAt)
      )
    );

  let stopped = 0;
  for (const row of open) {
    try {
      await cancelMessage(db, campaign.tenantId, encodeId('message', row.id));
      stopped += 1;
    } catch (error) {
      if (!(error instanceof BadRequestError)) throw error;
    }
  }

  return { campaign: updated, stopped, running: open.length - stopped };
}

export async function reconcileCampaigns(
  db: Db,
  limit: number
): Promise<{ started: number; completed: number }> {
  const released = await db
    .select({ id: tables.campaign.id })
    .from(tables.campaign)
    .where(
      and(
        eq(tables.campaign.status, 'scheduled'),
        isNull(tables.campaign.deletedAt),
        sql`exists (
          select 1 from ${tables.message}
          where ${tables.message.campaignId} = ${tables.campaign.id}
            and ${tables.message.status} <> 'scheduled'
            and ${tables.message.deletedAt} is null
        )`
      )
    )
    .limit(limit);

  if (released.length > 0) {
    await db
      .update(tables.campaign)
      .set({ status: 'sending' })
      .where(
        and(
          inArray(
            tables.campaign.id,
            released.map((row) => row.id)
          ),
          eq(tables.campaign.status, 'scheduled')
        )
      );
  }

  const settled = await db
    .select({ id: tables.campaign.id })
    .from(tables.campaign)
    .where(
      and(
        eq(tables.campaign.status, 'sending'),
        isNull(tables.campaign.deletedAt),
        sql`not exists (
          select 1 from ${tables.message}
          where ${tables.message.campaignId} = ${tables.campaign.id}
            and ${tables.message.status} not in ('completed', 'canceled')
            and ${tables.message.deletedAt} is null
        )`,
        sql`exists (
          select 1 from ${tables.message}
          where ${tables.message.campaignId} = ${tables.campaign.id}
            and ${tables.message.deletedAt} is null
        )`
      )
    )
    .limit(limit);

  if (settled.length > 0) {
    await db
      .update(tables.campaign)
      .set({ status: 'completed', completedAt: new Date() })
      .where(
        and(
          inArray(
            tables.campaign.id,
            settled.map((row) => row.id)
          ),
          eq(tables.campaign.status, 'sending')
        )
      );
  }

  return { started: released.length, completed: settled.length };
}
