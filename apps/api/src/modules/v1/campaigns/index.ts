import { diffForEvent } from '@buzzkit/api/api/audit/index';
import {
  CampaignFiltersSchema,
  CampaignSlugParamsSchema,
  CreateCampaignSchema,
  cancelCampaign,
  createCampaign,
  findCampaignBySlug,
  LaunchCampaignSchema,
  launchCampaign,
  listCampaigns,
  resolveCampaignAudience,
  resolveCampaignStats,
  serializeCampaign,
  softDeleteCampaign,
  TestCampaignSchema,
  testCampaign,
  UpdateCampaignSchema,
  updateCampaign,
} from '@buzzkit/api/api/campaigns/index';
import { listMessages, serializeMessage } from '@buzzkit/api/api/messages/index';
import { auth } from '@buzzkit/api/libs/auth/index';
import { markDeleted, Response } from '@buzzkit/api/libs/response';
import { PaginationQuerySchema } from '@buzzkit/api/utils/pagination';
import Elysia from 'elysia';

const OPAQUE = ['where', 'payload', 'data'];

export const campaigns = new Elysia({ prefix: '/campaigns' })
  .use(auth)
  .guard({ detail: { tags: ['Campaigns'] } })
  .get(
    '/',
    async ({ db, query, tenant }) => {
      const rows = await listCampaigns(db, tenant.id, query);
      return Response.list(
        rows.map((row) => serializeCampaign(row)),
        { ignoreTransform: OPAQUE }
      ).send();
    },
    { tenant: 'campaigns:read', query: CampaignFiltersSchema }
  )
  .get(
    '/:campaignSlug',
    async ({ db, params, tenant }) => {
      const found = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      const stats = await resolveCampaignStats(db, found);
      return Response.success(serializeCampaign(found, stats), { ignoreTransform: OPAQUE }).send();
    },
    { tenant: 'campaigns:read', params: CampaignSlugParamsSchema }
  )
  .get(
    '/:campaignSlug/audience',
    async ({ db, params, tenant }) => {
      const found = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      return Response.success(await resolveCampaignAudience(db, found)).send();
    },
    { tenant: 'campaigns:read', params: CampaignSlugParamsSchema }
  )
  .get(
    '/:campaignSlug/messages',
    async ({ db, params, query, tenant }) => {
      const found = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      const page = await listMessages(db, tenant.id, { ...query, campaignId: found.id });
      return Response.page(page, {
        entity: 'message',
        ignoreTransform: ['payload', 'targets', 'schedule'],
      }).send();
    },
    { tenant: 'campaigns:read', params: CampaignSlugParamsSchema, query: PaginationQuerySchema }
  )
  .post(
    '/',
    async ({ audit, body, db, set, tenant }) => {
      const created = await createCampaign(db, tenant.id, body);
      await audit({
        event: 'campaign.created',
        tenantId: tenant.id,
        target: { type: 'campaign', id: created.id },
        data: { slug: created.slug, name: created.name, topic: created.topicSlug },
      });
      return Response.success(serializeCampaign(created), { ignoreTransform: OPAQUE }).status(201).send(set);
    },
    { tenant: 'campaigns:write', body: CreateCampaignSchema }
  )
  .post(
    '/:campaignSlug/launch',
    async ({ audit, body, db, params, tenant }) => {
      const existing = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      const launched = await launchCampaign(db, tenant, existing, body);

      await audit({
        event: 'campaign.launched',
        tenantId: tenant.id,
        target: { type: 'campaign', id: existing.id },
        data: {
          slug: existing.slug,
          messageId: launched.message.id,
          audienceEstimate: launched.campaign.audienceEstimate,
        },
      });

      return Response.success(serializeCampaign({ ...existing, ...launched.campaign }), {
        ignoreTransform: OPAQUE,
      }).send();
    },
    { tenant: 'campaigns:launch', params: CampaignSlugParamsSchema, body: LaunchCampaignSchema }
  )
  .post(
    '/:campaignSlug/cancel',
    async ({ audit, db, params, tenant }) => {
      const existing = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      const canceled = await cancelCampaign(db, existing);

      await audit({
        event: 'campaign.canceled',
        tenantId: tenant.id,
        target: { type: 'campaign', id: existing.id },
        data: { slug: existing.slug, stopped: canceled.stopped, running: canceled.running },
      });

      return Response.success(serializeCampaign({ ...existing, ...canceled.campaign }), {
        ignoreTransform: OPAQUE,
      }).send();
    },
    { tenant: 'campaigns:launch', params: CampaignSlugParamsSchema }
  )
  .post(
    '/:campaignSlug/test',
    async ({ body, db, params, tenant }) => {
      const existing = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      const message = await testCampaign(db, tenant, existing, body.to);
      return Response.success(serializeMessage(message), {
        entity: 'message',
        ignoreTransform: ['payload', 'targets', 'schedule'],
      }).send();
    },
    { tenant: 'campaigns:write', params: CampaignSlugParamsSchema, body: TestCampaignSchema }
  )
  .patch(
    '/:campaignSlug',
    async ({ audit, body, db, params, tenant }) => {
      const existing = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      if (Object.keys(body).length === 0) {
        return Response.success(serializeCampaign(existing), { ignoreTransform: OPAQUE }).send();
      }
      const updated = await updateCampaign(db, existing, body);

      const { changes, previousAttributes } = diffForEvent(
        { name: existing.name, description: existing.description, topic: existing.topicSlug },
        { name: updated.name, description: updated.description, topic: updated.topicSlug }
      );
      if (changes.length > 0) {
        await audit({
          event: 'campaign.updated',
          tenantId: tenant.id,
          target: { type: 'campaign', id: existing.id },
          data: { slug: existing.slug, changes, previousAttributes },
        });
      }

      return Response.success(serializeCampaign(updated), { ignoreTransform: OPAQUE }).send();
    },
    { tenant: 'campaigns:write', params: CampaignSlugParamsSchema, body: UpdateCampaignSchema }
  )
  .delete(
    '/:campaignSlug',
    async ({ audit, db, params, tenant }) => {
      const existing = await findCampaignBySlug(db, tenant.id, params.campaignSlug);
      await softDeleteCampaign(db, existing);

      await audit({
        event: 'campaign.deleted',
        tenantId: tenant.id,
        target: { type: 'campaign', id: existing.id },
        data: { slug: existing.slug },
      });

      return Response.success(markDeleted(serializeCampaign(existing)), { ignoreTransform: OPAQUE }).send();
    },
    { tenant: 'campaigns:write', params: CampaignSlugParamsSchema }
  );
