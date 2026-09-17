# Campaigns

A plan for broadcast campaigns in buzzkit, written because Slumber is replacing Firebase Cloud
Messaging and needs the part Firebase's console gave us: compose a notification, choose an audience,
schedule it, launch it safely, and read how it did afterwards.

This file lives at the repository root with `Deployment.md` and `Divergence.md` because it describes
work this fork is deciding to do. It moves into `docs/` when it is built.

## What already works

Most of a campaign exists. The gap is a place to keep the parts together and look at them later.

| Need | Where it already is |
| --- | --- |
| Compose a push with title, body, cover image, deep link | `apps/web/app/components/messages/send-dialog.tsx` |
| Target explicit ids, a topic, or a segment | `MessageTargets` in `apps/api/src/api/messages/types.ts` |
| Schedule for a fixed time or each subscriber's own evening | `MessageSchedule`, `releaseDueMessages` in `apps/api/src/api/messages/index.ts:348` |
| Fan out to an audience, resumably, 500 at a time | `apps/api/src/api/messages/fanout.ts`, `FANOUT_PAGE_SIZE` |
| Respect per-subscriber topic opt-outs | `fanout.ts:70` |
| Quiet hours, tenant daily cap, per-topic daily cap | `apps/api/src/api/messages/send.ts:205` |
| Retry, back off, settle, record the provider outcome | `apps/api/src/api/deliveries/` |
| Per-message funnel of reachable, sent, delivered, failed, invalid | counters on `message`, rendered at `apps/web/app/routes/[slug]/messages/[id]/index.tsx:662` |
| Opens and dismissals tied to a message | `notification.opened` etc. in `apps/api/src/api/events/catalog.ts:69`, `message_id` column on the Tinybird `events` datasource |
| Estimate how many subscribers a segment holds | `countSegmentMembers` in `apps/api/src/api/segments/index.ts:177` |
| Cancel a send already queued | `POST /v1/messages/:id/cancel` |

What is missing is one entity above a message, the screens around it, and four safety rails named
below.

## The model

**A campaign is a named plan that produces messages.** One campaign, many occurrences, one message
per occurrence, many deliveries per message.

```
campaign  →  message (one per occurrence)  →  delivery (one per device)
```

**Campaigns stay separate from workflows.** A workflow run belongs to one subscriber and can live for
weeks. A broadcast is a single fan-out across an audience. Putting both in one table makes most
columns nullable and every query branch on which kind it is. They can share one place in the
navigation without sharing a schema.

**No campaign version table.** A message already snapshots its own `payload` and `targets` as JSON at
creation, so editing a campaign between occurrences cannot rewrite what was already sent. Workflows
need versions because a run outlives an edit. A campaign occurrence does not.

## Data model

### New table `campaign`

Modelled on `segment` (`packages/database/src/schema/segment.ts`): tenant scoped, slug unique per
tenant among live rows, soft delete.

| Column | Notes |
| --- | --- |
| `id`, `tenantId`, `slug`, `name`, `description` | `segment` has the same head |
| `channel` | one channel per campaign, as a message has |
| `targets` jsonb | `{ topic?, segment?, where? }`, the same shape a message takes |
| `payload` jsonb | title, body, imageUrl, deepLink, data, sound, interruptionLevel |
| `schedule` jsonb | `{ kind: 'now' \| 'once' \| 'recurring', at?, cron?, timezone }` |
| `status` | `draft`, `scheduled`, `sending`, `completed`, `paused`, `canceled` |
| `segmentVersionId` | pinned at launch so the audience cannot move mid-send |
| `lastSentAt`, `nextSendAt` | drives the release sweep for recurring campaigns |
| `createdAt`, `updatedAt`, `deletedAt` | soft delete only, as everywhere |

### Changes to existing things

- `message` gets a nullable `campaignId` plus an index on `(tenantId, campaignId, id)`. It already
  carries `runId` and `runStep` for the workflow case, so this follows the pattern.
- `ID_PREFIXES` gets `campaign: 'cmp'`, `TARGET_ENTITIES` and `FIELD_ENTITIES` get the matching
  entries (`apps/api/src/libs/sqids.ts:14`, `apps/api/src/libs/response.ts:50`).
- `AUDIT_CATALOG` gets `campaign.created`, `campaign.updated`, `campaign.launched`,
  `campaign.paused`, `campaign.canceled`, `campaign.deleted`, all `webhook: true`.

### Scopes

Three, not two, because launching is the dangerous verb:

```ts
'campaigns:read':   { context: 'tenant', role: 'member', key: true },
'campaigns:write':  { context: 'tenant', role: 'member', key: true },  // draft and edit
'campaigns:launch': { context: 'tenant', role: 'admin',  key: false }, // session only
```

`campaigns:launch` being session only keeps a key from operating campaigns: it cannot launch one, so
it cannot reach the audience pinning, the typed confirmation or the campaign record. It does not make
a broadcast impossible for a key, and it should not be read as one. `POST /v1/messages` accepts a
topic with no recipient list and takes `messages:send`, which is key-grantable, so a key that leaks
can already send to everyone opted in to a topic. Closing that is a decision about `messages:send`,
not something the campaign scopes can do.

Session-only mirrors `keys:*` and `invites:*` (`apps/api/src/libs/scopes.ts`).

## API

Routes follow the flat file convention, every file an `index.ts`, domain logic in
`apps/api/src/api/campaigns/`.

```
GET    /v1/campaigns                      list
POST   /v1/campaigns                      create a draft
GET    /v1/campaigns/:campaignSlug        read
PATCH  /v1/campaigns/:campaignSlug        edit a draft
DELETE /v1/campaigns/:campaignSlug        soft delete
GET    /v1/campaigns/:campaignSlug/estimate   audience size, from Tinybird
POST   /v1/campaigns/:campaignSlug/test       send to explicit external ids
POST   /v1/campaigns/:campaignSlug/launch     send now, or schedule
POST   /v1/campaigns/:campaignSlug/cancel     stop everything not yet sent
GET    /v1/campaigns/:campaignSlug/messages   the occurrences
GET    /v1/campaigns/:campaignSlug/stats      the roll-up
```

`launch` creates a message with
`idempotencyKey = "campaign:<campaignId>:<occurrence>"`. The existing unique index on
`(tenantId, idempotencyKey)` makes a retried launch a no-op rather than a second broadcast.

## Where every number comes from

| Number | Source | Cost |
| --- | --- | --- |
| Reachable, sent, delivered, failed, invalid | `sum()` over the campaign's `message` rows | one indexed query, a handful of rows |
| Sends per day | the same rows grouped by `date_trunc('day', createdAt)` | the same |
| Opens, dismissals, open rate | Tinybird `events` filtered by `name` and `message_id` | `message_id` is already a column on the datasource |
| Audience size before launch | `countSegmentMembers`, which queries Tinybird | already used by the segment preview |

No new Tinybird datasource, materialization or endpoint. The `delivery` table is never scanned for
statistics, because the counters on `message` are maintained incrementally as deliveries settle
(`apps/api/src/api/deliveries/attempts.ts:226`).

## The four safety rails

This is the part that matters for replacing Firebase. Everything above is plumbing.

**1. Estimate then confirm.** The launch dialog shows the audience count from `estimate` and the
rendered notification before the button is live. Above a threshold the confirmation needs the
campaign name typed, the same as deleting a workflow does today.

**2. Pin the audience at launch.** `segmentVersionId` is written when the campaign launches, and
fan-out reads the pinned version. A segment edited while a broadcast is running cannot change who is
still to receive it. Messages already carry `segmentVersionId`, so this is a matter of setting it
rather than building it.

**2b. A campaign that can still send cannot be deleted.** Delete is a soft delete, and the read path
filters deleted rows, so deleting a `scheduled` or `sending` campaign would hide the only handle on a
send that is still going to happen. Delete is refused in those two states with
`campaign_not_deletable`, and the dashboard does not offer it. Cancel first, then delete.

**3. One cancel that stops everything.** `POST /v1/campaigns/:slug/cancel` sets the campaign to
`canceled` and cancels every message of that campaign that can still be stopped.

The reach of this is narrower than it sounds, and the limit is upstream's. `cancelMessage` only stops
a message that is still `scheduled`, or one sending zone by zone through subscriber timezones. A
campaign launched for immediate delivery is already fanning out, and nothing in buzzkit can stop that
mid-flight. So cancel is a real stop for a scheduled campaign and only a status change for one
already sending. Making an in-flight fan-out stoppable is its own piece of work.

The dialog therefore does not claim which case you are in, because the status it would read from is
written by a sweep and can lag the message by up to a minute. It states the rule instead, and the
messages table below it shows what each message is actually doing. The counts of what was stopped and
what was left running go to the audit entry and the cancel span.

## Status is swept, not pushed

A campaign's status follows its messages through `reconcileCampaigns`, which both cron schedules run:
`scheduled` becomes `sending` once a message has left `scheduled`, and `sending` becomes `completed`
once every message has settled. A message counts as settled when it is `completed` or `canceled`, so
a message canceled on its own through `POST /v1/messages/:id/cancel` cannot strand its campaign in
`sending` forever.

Running it on the minute schedule as well as the five-minute one keeps the lag near a minute. Nothing
in the message path writes the campaign directly, because `api/messages` cannot import `api/campaigns`
without a cycle.

**4. A throttle.** A campaign takes an optional ceiling of deliveries per minute. Fan-out already
walks the audience in pages of 500 behind a cursor, and each page chains the next one, so the seam is
delaying that chain. After a page enqueues `k` deliveries the next page waits `k / rate` minutes.

The pacing is snapshotted onto the message at launch, next to its schedule and topic, so a throttle
edited afterwards cannot change a send already under way, and so the fan-out never has to read the
campaign back.

Only deliveries that reach a provider count. A page whose deliveries all fail as `no_credential` is
not paced, because nothing left the system.

What this gives is a rate the send converges to, not a hard ceiling from the first second. The first
page goes out with no wait, so a send can be up to one page (500) ahead of the rate at the start, and
from there each page of 500 costs `500 / rate` minutes. Measured on a 705-subscriber audience at 300
a minute: 500 deliveries at once, the remaining 205 at 104 seconds, against a predicted 100.

A paced send also has to outlive itself. A message expires 24 hours after it is created and an
expired delivery fails rather than sends, so an audience that takes longer than a day to walk at its
own rate would silently lose its tail. Launch therefore sizes the message lifetime from the audience
estimate and the rate, with the usual day of headroom on top, and refuses a rate that cannot finish
inside the longest lifetime a message may have, naming a rate that would.

The stalled-fan-out recovery has to know about this. It re-enqueues a fan-out that has not moved in
ten minutes, and a page paced below fifty a minute waits longer than that, so left alone the
recovery would undo the pacing exactly where the rate matters most.

Rather than infer the wait, the page writes it down: `fanout_resume_at` holds the instant the next
page is due, or null when nothing is holding it. Recovery keeps its ten-minute cutoff and skips only
messages that are genuinely not due yet. Inferring it instead was wrong twice, because the guess has
to assume the worst case: a page with no usable credential enqueues its next page immediately, and a
message paced at one a minute would have waited more than eight hours to recover a job that was
never delayed at all.

Existing protections that keep working and need no change: per-tenant quiet hours, per-tenant daily
cap, per-topic daily cap, per-subscriber topic opt-out, provider retry with back-off.

## Dashboard

| Route | Purpose |
| --- | --- |
| `/:slug/campaigns` | list with status, audience, sent, open rate, next send |
| `/:slug/campaigns/new` | composer, reusing the fields already in `send-dialog.tsx` |
| `/:slug/campaigns/:campaignSlug` | funnel, charts, occurrence list, launch and cancel |

The Messages page stays as it is and becomes purely the log. Its button says "Send test message" and
its description says "Inspect every message sent from this workspace", which is honest once campaigns
exist and misleading until then.

## Out of scope for the first version

Named so they are decisions, not omissions.

- **A/B variants.** The seam is a `variant` column on `message`, so one occurrence can be two
  messages. Not built.
- **Recurrence.** The `schedule` column carries `kind: 'recurring'` from the start, but the first
  version ships `now` and `once` only. A repeating broadcast can be a schedule-triggered workflow
  until then.
- **Conversion tracking past the open.** buzzkit records delivered, opened and dismissed. Anything
  after the tap is the app's own event.
- **Per-locale content.** One payload per campaign. Localised copy would be a variant.

## Before the Firebase cutover

Independent of this plan, and currently blocking:

- **Identity.** Source deliveries are dropping as "No matching subscriber" because buzzkit
  subscribers are `anon_*` SDK ids. The app must call buzzkit `identify` with the same id it gives
  RevenueCat `logIn`, or no event-triggered campaign reaches anyone.
- **Topic parity.** Every FCM topic the app subscribes to needs a buzzkit topic with the same
  meaning, and the migration has to decide the default opt-in for each.
- **Opens.** Firebase reported opens by itself. buzzkit reports them only when the SDK sends
  `notification.opened`. Confirm the app does before trusting any open rate.
- **Parallel run.** Send through both for a period and compare delivered counts before switching off
  the Firebase path.

## Build order

1. **Schema and domain.** Done. `campaign` table and migration `0022`, `campaignId` on `message`,
   sqids, audit and scope entries, `apps/api/src/api/campaigns/`.
2. **API.** Done. Nine routes on one prefixed router, the three scopes, the contract re-emitted, and
   an integration suite covering the idempotent relaunch, the cancel cascade, the session-only
   launch and tenant isolation.
3. **Dashboard.** Done. The list, the composer and the campaign page, with the launch dialog, the
   test dialog, cancel and delete.
4. **Safety rails.** Done. Audience pinning at launch, the typed confirmation, the campaign-wide
   cancel and the throttle.
5. **Recurrence**, once one-off campaigns have sent real traffic.

A draft is edited on its own page: the audience and notification cards become editable while the
status is `draft`, and the fields are one component the composer and the editor share, so the two
cannot drift.

## Decisions taken

1. Campaigns and workflows sit apart, in the data model and in the navigation.
2. Three scopes: `campaigns:read`, `campaigns:write`, `campaigns:launch`.
3. Every campaign carries a topic. `topic_id` is `not null` on the table, so a campaign without one
   cannot exist.
4. An audience of 1000 or more needs the campaign name typed to confirm.
5. This is a fork divergence with an entry in `Divergence.md`, not a pull request upstream.

Because there is no recurrence, a campaign has no `paused` state. The statuses are `draft`,
`scheduled`, `sending`, `completed` and `canceled`.

## One thing the build uncovered

The API contract was already at TypeScript's declaration-serialization ceiling before this work.
Adding the `campaign` table alone, with no routes at all, pushed `bun types:emit` over it with
TS7056, because `Db` was parameterised by the whole `tables` object and `Db` appears in the inferred
context of every single route.

The fix was to stop passing `schema: tables` to the Drizzle client. The relational query API it
enables (`db.query.<table>.findMany()`) is used nowhere in this repository, and dropping it collapses
the `Db` type and with it the emitted contract. Without this, no new table could be added to buzzkit
at all.
