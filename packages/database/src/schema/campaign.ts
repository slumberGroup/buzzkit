import { CAMPAIGN_STATUSES } from 'buzzkit';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { bigId, bigRef, channel, createdAt, deletedAt, timestamptz, updatedAt } from './shared';
import { tenant } from './tenant';
import { topic } from './topic';

export const campaignStatus = pgEnum('campaign_status', CAMPAIGN_STATUSES);

export const campaign = pgTable(
  'campaign',
  {
    id: bigId(),
    tenantId: bigRef('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    channel: channel('channel').notNull(),
    topicId: bigRef('topic_id')
      .notNull()
      .references(() => topic.id, { onDelete: 'restrict' }),
    targets: jsonb('targets').$type<Record<string, unknown>>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    schedule: jsonb('schedule').$type<{ at: string; timezone: string; defaultTimezone?: string }>(),
    status: campaignStatus('status').notNull().default('draft'),
    throttlePerMinute: integer('throttle_per_minute'),
    audienceEstimate: integer('audience_estimate'),
    launchedAt: timestamptz('launched_at'),
    completedAt: timestamptz('completed_at'),
    canceledAt: timestamptz('canceled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('campaign_tenant_slug_unique')
      .on(table.tenantId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    index('campaign_tenant_idx').on(table.tenantId, table.id),
    check('campaign_targets_object', sql`jsonb_typeof(${table.targets}) = 'object'`),
    check('campaign_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      'campaign_throttle_positive',
      sql`${table.throttlePerMinute} is null or ${table.throttlePerMinute} > 0`
    ),
  ]
);

export const campaignTables = { campaign };
