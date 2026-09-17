import { MessagePayloadSchema, MessageScheduleSchema } from '@buzzkit/api/api/messages/index';
import { SegmentExpressionSchema } from '@buzzkit/api/api/segments/index';
import { ExternalIdSchema } from '@buzzkit/api/api/subscribers/index';
import { TopicSlugSchema } from '@buzzkit/api/api/topics/index';
import { ChannelSchema, NameSchema, SlugSchema } from '@buzzkit/api/libs/schemas';
import type { MessagePayload } from '@buzzkit/api/providers/index';
import { t } from 'elysia';
import { CAMPAIGN_STATUSES, CAMPAIGN_TEST_TARGETS, MAX_THROTTLE_PER_MINUTE } from './constants';

const ThrottleSchema = t.Integer({ minimum: 1, maximum: MAX_THROTTLE_PER_MINUTE });

export const CampaignPayloadSchema = t.Unsafe<MessagePayload>(MessagePayloadSchema);

export const CreateCampaignSchema = t.Object({
  slug: SlugSchema,
  name: NameSchema,
  description: t.Optional(t.String({ maxLength: 500 })),
  channel: t.Optional(ChannelSchema),
  topic: TopicSlugSchema,
  segment: t.Optional(SlugSchema),
  where: t.Optional(SegmentExpressionSchema),
  payload: CampaignPayloadSchema,
  schedule: t.Optional(MessageScheduleSchema),
  throttlePerMinute: t.Optional(ThrottleSchema),
});

export const UpdateCampaignSchema = t.Object({
  name: t.Optional(NameSchema),
  description: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
  topic: t.Optional(TopicSlugSchema),
  segment: t.Optional(t.Union([SlugSchema, t.Null()])),
  where: t.Optional(t.Union([SegmentExpressionSchema, t.Null()])),
  payload: t.Optional(CampaignPayloadSchema),
  schedule: t.Optional(t.Union([MessageScheduleSchema, t.Null()])),
  throttlePerMinute: t.Optional(t.Union([ThrottleSchema, t.Null()])),
});

export const LaunchCampaignSchema = t.Object({
  confirm: t.Optional(t.String({ maxLength: 100 })),
});

export const TestCampaignSchema = t.Object({
  to: t.Array(ExternalIdSchema, { minItems: 1, maxItems: CAMPAIGN_TEST_TARGETS }),
});

export const CampaignFiltersSchema = t.Object({
  q: t.Optional(t.String({ maxLength: 200 })),
  status: t.Optional(t.Union(CAMPAIGN_STATUSES.map((status) => t.Literal(status)))),
  channel: t.Optional(ChannelSchema),
  topic: t.Optional(TopicSlugSchema),
});
