import { encodeId } from '@buzzkit/api/libs/sqids';
import type { MessagePayload } from '@buzzkit/api/providers/index';
import type { CampaignStats, CampaignTargets, CampaignView, CampaignWithTopic } from './types';

export function serializeCampaign(
  campaign: CampaignWithTopic,
  stats: CampaignStats | null = null
): CampaignView {
  const targets = campaign.targets as CampaignTargets;
  return {
    id: encodeId('campaign', campaign.id),
    slug: campaign.slug,
    name: campaign.name,
    description: campaign.description,
    status: campaign.status,
    channel: campaign.channel,
    topic: { slug: campaign.topicSlug, name: campaign.topicName },
    segment: targets.segment ?? null,
    where: targets.where ?? null,
    payload: campaign.payload as MessagePayload,
    schedule: campaign.schedule,
    throttlePerMinute: campaign.throttlePerMinute,
    audienceEstimate: campaign.audienceEstimate,
    launchedAt: campaign.launchedAt,
    completedAt: campaign.completedAt,
    canceledAt: campaign.canceledAt,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    ...(stats ? { stats } : {}),
  };
}
