import { countSegmentMembers, findSegmentBySlug } from '@buzzkit/api/api/segments/index';
import { type Channel, selectTopicById, topicDefault } from '@buzzkit/api/api/topics/index';
import { NotFoundError } from '@buzzkit/api/libs/error';
import { trace } from '@buzzkit/api/libs/telemetry';
import { and, type Db, eq, isNull, sql, tables } from '@buzzkit/database';
import type { Expression } from 'buzzkit/expressions';
import type { Campaign, CampaignTargets } from './types';

export type CampaignAudience = {
  estimate: number;
  reachable: number;
  matching: number | null;
};

async function countReachable(db: Db, campaign: Campaign): Promise<number> {
  const channel = campaign.channel as Channel;
  const topic = await selectTopicById(db, campaign.tenantId, campaign.topicId);
  if (!topic) throw new NotFoundError('Topic not found');

  const channelDefault = topicDefault(topic, channel);
  const [row] = await trace('campaigns.countReachable', async () => {
    return await db
      .select({ total: sql<number>`count(*)::int` })
      .from(tables.subscription)
      .innerJoin(tables.subscriber, eq(tables.subscriber.id, tables.subscription.subscriberId))
      .leftJoin(
        tables.subscriberPreference,
        and(
          eq(tables.subscriberPreference.subscriberId, tables.subscriber.id),
          eq(tables.subscriberPreference.topicId, topic.id),
          eq(tables.subscriberPreference.channel, channel)
        )
      )
      .where(
        and(
          eq(tables.subscription.tenantId, campaign.tenantId),
          eq(tables.subscriber.tenantId, campaign.tenantId),
          eq(tables.subscription.channel, channel),
          eq(tables.subscription.enabled, true),
          eq(tables.subscription.status, 'active'),
          isNull(tables.subscription.deletedAt),
          isNull(tables.subscriber.deletedAt),
          sql`coalesce(${tables.subscriberPreference.optedIn}, ${channelDefault}) = true`
        )
      );
  });

  return row?.total ?? 0;
}

async function countMatching(db: Db, campaign: Campaign): Promise<number | null> {
  const targets = campaign.targets as CampaignTargets;
  if (targets.where) return await countSegmentMembers(campaign.tenantId, targets.where);
  if (!targets.segment) return null;

  const segment = await findSegmentBySlug(db, campaign.tenantId, targets.segment);
  return await countSegmentMembers(campaign.tenantId, segment.version.expression as Expression);
}

export async function resolveCampaignAudience(db: Db, campaign: Campaign): Promise<CampaignAudience> {
  const [reachable, matching] = await Promise.all([
    countReachable(db, campaign),
    countMatching(db, campaign),
  ]);
  const estimate = matching === null ? reachable : Math.min(reachable, matching);

  return { estimate, reachable, matching };
}
