import type { ActionFunctionArgs } from 'react-router';
import { beginAction } from '@/app/lib/actions/context.server';
import {
  ApiError,
  type CampaignPatch,
  type CampaignPayload,
  cancelCampaign,
  createCampaign,
  launchCampaign,
  removeCampaign,
  testCampaign,
  updateCampaign,
} from '@/app/lib/api.server';

function readPayload(form: FormData): CampaignPayload {
  const payload: CampaignPayload = {};
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const imageUrl = String(form.get('imageUrl') ?? '').trim();
  const deepLink = String(form.get('deepLink') ?? '').trim();
  if (title) payload.title = title;
  if (body) payload.body = body;
  if (imageUrl) payload.imageUrl = imageUrl;
  if (deepLink) payload.deepLink = deepLink;
  return payload;
}

function readThrottle(form: FormData): number | null {
  const raw = String(form.get('throttlePerMinute') ?? '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readSchedule(form: FormData) {
  const at = String(form.get('at') ?? '').trim();
  if (!at) return null;
  const timezone = String(form.get('timezone') ?? '').trim();
  return { at, ...(timezone ? { timezone } : {}) };
}

export async function campaignsAction(args: ActionFunctionArgs) {
  const { token, ctx, form, intent, tenant } = await beginAction(args);
  const slug = String(args.params.slug);
  const campaignSlug = String(form.get('campaign') ?? '').trim();

  try {
    switch (intent) {
      case 'create': {
        const name = String(form.get('name') ?? '').trim();
        const createdSlug = String(form.get('slug') ?? '').trim();
        const topic = String(form.get('topic') ?? '').trim();
        const description = String(form.get('description') ?? '').trim();
        const segment = String(form.get('segment') ?? '').trim();
        const payload = readPayload(form);
        if (!name) return { error: 'Name the campaign.' };
        if (!createdSlug) return { error: 'Give the campaign a slug.' };
        if (!topic) return { error: 'Choose a topic.' };
        if (!payload.title && !payload.body) return { error: 'Write a title or a body.' };

        const schedule = readSchedule(form);
        const throttlePerMinute = readThrottle(form);
        const created = await createCampaign(ctx, token, slug, tenant, {
          name,
          slug: createdSlug,
          topic,
          payload,
          ...(description ? { description } : {}),
          ...(segment ? { segment } : {}),
          ...(schedule ? { schedule } : {}),
          ...(throttlePerMinute ? { throttlePerMinute } : {}),
        });
        return { ok: true, slug: created.slug };
      }
      case 'update': {
        const patch: CampaignPatch = {};
        if (form.has('name')) {
          const name = String(form.get('name') ?? '').trim();
          if (!name) return { error: 'Name the campaign.' };
          patch.name = name;
        }
        if (form.has('description')) patch.description = String(form.get('description') ?? '').trim() || null;
        if (form.has('topic')) patch.topic = String(form.get('topic') ?? '').trim();
        if (form.has('segment')) patch.segment = String(form.get('segment') ?? '').trim() || null;
        if (form.has('title') || form.has('body')) {
          const payload = readPayload(form);
          if (!payload.title && !payload.body) return { error: 'Write a title or a body.' };
          patch.payload = payload;
        }
        if (form.has('at')) patch.schedule = readSchedule(form);
        if (form.has('throttlePerMinute')) patch.throttlePerMinute = readThrottle(form);
        await updateCampaign(ctx, token, slug, tenant, campaignSlug, patch);
        return { ok: true, updated: true };
      }
      case 'launch': {
        const confirm = String(form.get('confirm') ?? '').trim();
        await launchCampaign(ctx, token, slug, tenant, campaignSlug, confirm || undefined);
        return { ok: true, launched: true };
      }
      case 'cancel': {
        await cancelCampaign(ctx, token, slug, tenant, campaignSlug);
        return { ok: true, canceled: true };
      }
      case 'test': {
        const to = String(form.get('to') ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (to.length === 0) return { error: 'Name at least one subscriber.' };
        await testCampaign(ctx, token, slug, tenant, campaignSlug, to);
        return { ok: true, tested: true };
      }
      case 'delete': {
        await removeCampaign(ctx, token, slug, tenant, campaignSlug);
        return { ok: true, deleted: true };
      }
      default:
        return { error: 'Unknown action.' };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: describeFailure(intent), description: error.message };
    throw error;
  }
}

function describeFailure(intent: string): string {
  switch (intent) {
    case 'create':
      return 'Failed to create campaign';
    case 'update':
      return 'Failed to save changes';
    case 'launch':
      return 'Failed to launch campaign';
    case 'cancel':
      return 'Failed to cancel campaign';
    case 'test':
      return 'Failed to send the test';
    case 'delete':
      return 'Failed to delete campaign';
    default:
      return 'Something went wrong';
  }
}
