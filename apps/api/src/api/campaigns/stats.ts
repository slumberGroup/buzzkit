import { reservedEventName } from '@buzzkit/api/api/events/index';
import { encodeId } from '@buzzkit/api/libs/sqids';
import { trace } from '@buzzkit/api/libs/telemetry';
import { DAY_MS } from '@buzzkit/api/libs/timezone';
import { queryTinybird } from '@buzzkit/api/libs/tinybird';
import { and, type Db, eq, gte, isNull, sql, tables } from '@buzzkit/database';
import { CAMPAIGN_DAILY_WINDOW_DAYS } from './constants';
import type { Campaign, CampaignCounts, CampaignDay, CampaignEngagement, CampaignStats } from './types';

const EMPTY_COUNTS: CampaignCounts = {
  messages: 0,
  total: 0,
  sent: 0,
  delivered: 0,
  bounced: 0,
  failed: 0,
  invalid: 0,
};

function scope(campaign: Campaign) {
  return and(
    eq(tables.message.tenantId, campaign.tenantId),
    eq(tables.message.campaignId, campaign.id),
    isNull(tables.message.deletedAt)
  );
}

async function countCampaignMessages(db: Db, campaign: Campaign): Promise<CampaignCounts> {
  const [row] = await trace('campaigns.count', async () => {
    return await db
      .select({
        messages: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${tables.message.total}), 0)::int`,
        sent: sql<number>`coalesce(sum(${tables.message.sent}), 0)::int`,
        delivered: sql<number>`coalesce(sum(${tables.message.delivered}), 0)::int`,
        bounced: sql<number>`coalesce(sum(${tables.message.bounced}), 0)::int`,
        failed: sql<number>`coalesce(sum(${tables.message.failed}), 0)::int`,
        invalid: sql<number>`coalesce(sum(${tables.message.invalid}), 0)::int`,
      })
      .from(tables.message)
      .where(scope(campaign));
  });
  return row ?? EMPTY_COUNTS;
}

async function listCampaignDays(db: Db, campaign: Campaign, from: Date): Promise<CampaignDay[]> {
  const day = sql<string>`to_char(date_trunc('day', ${tables.message.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  return await trace('campaigns.listDays', async () => {
    return await db
      .select({
        date: day,
        total: sql<number>`coalesce(sum(${tables.message.total}), 0)::int`,
        sent: sql<number>`coalesce(sum(${tables.message.sent}), 0)::int`,
        failed: sql<number>`coalesce(sum(${tables.message.failed} + ${tables.message.invalid}), 0)::int`,
      })
      .from(tables.message)
      .where(and(scope(campaign), gte(tables.message.createdAt, from)))
      .groupBy(day)
      .orderBy(day);
  });
}

async function listCampaignMessageIds(db: Db, campaign: Campaign): Promise<string[]> {
  const rows = await db.select({ id: tables.message.id }).from(tables.message).where(scope(campaign));
  return rows.map((row) => encodeId('message', row.id));
}

async function countCampaignEngagement(tenantId: number, messageIds: string[]): Promise<CampaignEngagement> {
  if (messageIds.length === 0) return { opened: 0, dismissed: 0 };

  const opened = reservedEventName('notification.opened');
  const dismissed = reservedEventName('notification.dismissed');
  const quoted = messageIds.map((id) => `'${id}'`).join(', ');
  const rows = await trace('campaigns.engagement', async () => {
    return await queryTinybird<{ name: string; total: number | string }>(
      `SELECT name, count() AS total FROM events
       WHERE tenant_id = ${tenantId}
         AND name IN ('${opened}', '${dismissed}')
         AND message_id IN (${quoted})
       GROUP BY name`
    );
  });

  const totals = new Map(rows.map((row) => [row.name, Number(row.total)]));
  return { opened: totals.get(opened) ?? 0, dismissed: totals.get(dismissed) ?? 0 };
}

export async function resolveCampaignStats(db: Db, campaign: Campaign): Promise<CampaignStats> {
  const from = new Date(Date.now() - CAMPAIGN_DAILY_WINDOW_DAYS * DAY_MS);
  const [counts, daily, messageIds] = await Promise.all([
    countCampaignMessages(db, campaign),
    listCampaignDays(db, campaign, from),
    listCampaignMessageIds(db, campaign),
  ]);
  const engagement = await countCampaignEngagement(campaign.tenantId, messageIds);

  return { counts, daily, engagement };
}
