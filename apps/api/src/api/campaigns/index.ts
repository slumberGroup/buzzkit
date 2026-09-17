import { resolveSchedule } from '@buzzkit/api/api/messages/index';
import { compileSegment, findSegmentBySlug } from '@buzzkit/api/api/segments/index';
import { type Channel, findTopicBySlug, type Topic } from '@buzzkit/api/api/topics/index';
import { BadRequestError, ConflictError, NotFoundError } from '@buzzkit/api/libs/error';
import { SlugSchema } from '@buzzkit/api/libs/schemas';
import { trace } from '@buzzkit/api/libs/telemetry';
import { and, type Db, eq, ilike, inArray, isNull, or, tables } from '@buzzkit/database';
import { t } from 'elysia';
import { CAMPAIGN_RESERVED_SLUGS } from './constants';
import type { Campaign, CampaignInput, CampaignTargets, CampaignUpdate, CampaignWithTopic } from './types';

export const CampaignSlugParamsSchema = t.Object({ campaignSlug: SlugSchema });

export * from './audience';
export * from './constants';
export * from './launch';
export * from './schemas';
export { serializeCampaign } from './serialize';
export * from './stats';
export type * from './types';

type CampaignFilters = { q?: string; status?: Campaign['status']; channel?: Channel; topic?: string };

function withTopic(campaign: Campaign, slug: string, name: string): CampaignWithTopic {
  return { ...campaign, topicSlug: slug, topicName: name };
}

async function assertSlugAvailable(db: Db, tenantId: number, slug: string): Promise<void> {
  if (CAMPAIGN_RESERVED_SLUGS.has(slug)) {
    throw new BadRequestError(`'${slug}' is reserved`, { code: 'slug_reserved', param: 'slug' });
  }
  const [existing] = await db
    .select({ id: tables.campaign.id })
    .from(tables.campaign)
    .where(
      and(
        eq(tables.campaign.tenantId, tenantId),
        eq(tables.campaign.slug, slug),
        isNull(tables.campaign.deletedAt)
      )
    );
  if (existing) {
    throw new ConflictError(`A campaign with the slug '${slug}' already exists`, {
      code: 'slug_taken',
      param: 'slug',
    });
  }
}

async function resolveTargets(
  db: Db,
  tenantId: number,
  input: Pick<CampaignInput, 'segment' | 'where'>
): Promise<CampaignTargets> {
  if (input.segment && input.where) {
    throw new BadRequestError('Provide only one of `segment`, `where`', {
      code: 'targets_conflict',
      param: 'where',
    });
  }
  if (input.where) {
    compileSegment(tenantId, input.where, 'where');
    return { where: input.where };
  }
  if (!input.segment) return {};

  const segment = await findSegmentBySlug(db, tenantId, input.segment);
  return { segment: segment.slug };
}

async function resolveTopic(db: Db, tenantId: number, slug: string, channel: Channel) {
  const topic = await findTopicBySlug(db, tenantId, slug);
  if (!topic.channels.includes(channel)) {
    throw new BadRequestError(`Topic '${topic.slug}' is not offered on the '${channel}' channel`, {
      code: 'channel_not_offered',
      param: 'topic',
    });
  }
  return topic;
}

function assertPayload(payload: CampaignInput['payload']): void {
  if (payload.title === undefined && payload.body === undefined && payload.data === undefined) {
    throw new BadRequestError('Provide at least a title, body, or data', {
      code: 'payload_missing',
      param: 'payload',
    });
  }
}

function assertDraft(campaign: Campaign): void {
  if (campaign.status === 'draft') return;

  throw new ConflictError(`A ${campaign.status} campaign cannot be edited`, {
    code: 'campaign_not_editable',
    param: 'status',
  });
}

export async function findCampaignBySlug(db: Db, tenantId: number, slug: string): Promise<CampaignWithTopic> {
  const [row] = await trace('campaigns.find', async () => {
    return await db
      .select({ campaign: tables.campaign, topicSlug: tables.topic.slug, topicName: tables.topic.name })
      .from(tables.campaign)
      .innerJoin(tables.topic, eq(tables.topic.id, tables.campaign.topicId))
      .where(
        and(
          eq(tables.campaign.tenantId, tenantId),
          eq(tables.campaign.slug, slug),
          isNull(tables.campaign.deletedAt)
        )
      );
  });
  if (!row) throw new NotFoundError('Campaign not found');
  return withTopic(row.campaign, row.topicSlug, row.topicName);
}

export async function listCampaigns(
  db: Db,
  tenantId: number,
  filters: CampaignFilters = {}
): Promise<CampaignWithTopic[]> {
  const conditions = [eq(tables.campaign.tenantId, tenantId), isNull(tables.campaign.deletedAt)];
  if (filters.status) conditions.push(eq(tables.campaign.status, filters.status));
  if (filters.channel) conditions.push(eq(tables.campaign.channel, filters.channel));
  if (filters.topic) conditions.push(eq(tables.topic.slug, filters.topic));
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(or(ilike(tables.campaign.name, pattern), ilike(tables.campaign.slug, pattern))!);
  }

  const rows = await trace('campaigns.list', async () => {
    return await db
      .select({ campaign: tables.campaign, topicSlug: tables.topic.slug, topicName: tables.topic.name })
      .from(tables.campaign)
      .innerJoin(tables.topic, eq(tables.topic.id, tables.campaign.topicId))
      .where(and(...conditions))
      .orderBy(tables.campaign.name);
  });

  return rows.map((row) => withTopic(row.campaign, row.topicSlug, row.topicName));
}

export async function createCampaign(
  db: Db,
  tenantId: number,
  input: CampaignInput
): Promise<CampaignWithTopic> {
  const channel: Channel = input.channel ?? 'push';
  assertPayload(input.payload);
  await assertSlugAvailable(db, tenantId, input.slug);

  const topic = await resolveTopic(db, tenantId, input.topic, channel);
  const targets = await resolveTargets(db, tenantId, input);

  const [created] = await trace('campaigns.create', async () => {
    return await db
      .insert(tables.campaign)
      .values({
        tenantId,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        channel,
        topicId: topic.id,
        targets,
        payload: input.payload,
        schedule: input.schedule ? resolveSchedule(input.schedule, new Date()) : null,
        throttlePerMinute: input.throttlePerMinute ?? null,
      })
      .returning();
  });

  return withTopic(created!, topic.slug, topic.name);
}

export async function updateCampaign(
  db: Db,
  existing: CampaignWithTopic,
  input: CampaignUpdate
): Promise<CampaignWithTopic> {
  assertDraft(existing);
  if (input.payload !== undefined) assertPayload(input.payload);

  const channel = existing.channel as Channel;
  let topic: Topic | null = null;
  if (input.topic !== undefined) topic = await resolveTopic(db, existing.tenantId, input.topic, channel);

  let targets: CampaignTargets | null = null;
  if (input.segment !== undefined || input.where !== undefined) {
    targets = await resolveTargets(db, existing.tenantId, {
      segment: input.segment ?? undefined,
      where: input.where ?? undefined,
    });
  }

  const [updated] = await trace('campaigns.update', async () => {
    return await db
      .update(tables.campaign)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(topic && { topicId: topic.id }),
        ...(targets && { targets }),
        ...(input.payload !== undefined && { payload: input.payload }),
        ...(input.schedule !== undefined && {
          schedule: input.schedule ? resolveSchedule(input.schedule, new Date()) : null,
        }),
        ...(input.throttlePerMinute !== undefined && { throttlePerMinute: input.throttlePerMinute }),
      })
      .where(
        and(
          eq(tables.campaign.id, existing.id),
          eq(tables.campaign.status, 'draft'),
          isNull(tables.campaign.deletedAt)
        )
      )
      .returning();
  });

  if (!updated) {
    throw new ConflictError('This campaign can no longer be edited', {
      code: 'campaign_not_editable',
      param: 'status',
    });
  }

  return withTopic(updated, topic?.slug ?? existing.topicSlug, topic?.name ?? existing.topicName);
}

export async function softDeleteCampaign(db: Db, campaign: Campaign): Promise<Campaign> {
  if (campaign.status === 'scheduled' || campaign.status === 'sending') {
    throw new ConflictError(`A ${campaign.status} campaign must be canceled before it is deleted`, {
      code: 'campaign_not_deletable',
      param: 'status',
    });
  }

  const [deleted] = await trace('campaigns.softDelete', async () => {
    return await db
      .update(tables.campaign)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(tables.campaign.id, campaign.id),
          inArray(tables.campaign.status, ['draft', 'completed', 'canceled']),
          isNull(tables.campaign.deletedAt)
        )
      )
      .returning();
  });
  if (!deleted) {
    throw new ConflictError('This campaign can no longer be deleted', {
      code: 'campaign_not_deletable',
      param: 'status',
    });
  }
  return deleted;
}
