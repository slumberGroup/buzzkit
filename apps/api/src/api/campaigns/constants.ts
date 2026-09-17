import { campaignStatus } from '@buzzkit/database';

export const CAMPAIGN_STATUSES = campaignStatus.enumValues;

export const CAMPAIGN_RESERVED_SLUGS = new Set(['new']);

export const CAMPAIGN_CONFIRM_AUDIENCE = 1000;

export const CAMPAIGN_TEST_TARGETS = 20;

export const CAMPAIGN_DAILY_WINDOW_DAYS = 30;

export const MAX_THROTTLE_PER_MINUTE = 600_000;
