import type { Message } from '@buzzkit/api/api/messages/index';
import type { Channel } from '@buzzkit/api/api/topics/index';
import type { MessagePayload } from '@buzzkit/api/providers/index';
import type { tables } from '@buzzkit/database';
import type { Expression } from 'buzzkit/expressions';

export type Campaign = typeof tables.campaign.$inferSelect;

export type CampaignStatus = Campaign['status'];

export type CampaignTargets = {
  segment?: string;
  segmentVersionId?: number;
  where?: Expression;
};

export type CampaignSchedule = { at: string; timezone: string; defaultTimezone?: string };

export type CampaignInput = {
  slug: string;
  name: string;
  description?: string | null;
  channel?: Channel;
  topic: string;
  segment?: string;
  where?: Expression;
  payload: MessagePayload;
  schedule?: { at: string; timezone?: string; defaultTimezone?: string } | null;
  throttlePerMinute?: number | null;
};

export type CampaignUpdate = {
  name?: string;
  description?: string | null;
  topic?: string;
  segment?: string | null;
  where?: Expression | null;
  payload?: MessagePayload;
  schedule?: { at: string; timezone?: string; defaultTimezone?: string } | null;
  throttlePerMinute?: number | null;
};

export type CampaignCounts = {
  messages: number;
  total: number;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
  invalid: number;
};

export type CampaignEngagement = { opened: number; dismissed: number };

export type CampaignDay = { date: string; total: number; sent: number; failed: number };

export type CampaignStats = {
  counts: CampaignCounts;
  engagement: CampaignEngagement;
  daily: CampaignDay[];
};

export type CampaignWithTopic = Campaign & { topicSlug: string; topicName: string };

export type CampaignView = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  channel: Channel;
  topic: { slug: string; name: string };
  segment: string | null;
  where: Expression | null;
  payload: MessagePayload;
  schedule: CampaignSchedule | null;
  throttlePerMinute: number | null;
  audienceEstimate: number | null;
  launchedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  stats?: CampaignStats;
};

export type LaunchedCampaign = { campaign: Campaign; message: Message; created: boolean };

export type CanceledCampaign = { campaign: Campaign; stopped: number; running: number };
