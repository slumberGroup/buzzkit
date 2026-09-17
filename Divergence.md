# Divergence

How this fork's code differs from upstream, and why. A sync can use this to ask, one entry at a time, whether a divergence is still worth carrying.

Configuration is not listed. Account ids, hostnames and endpoints live in `Deployment.md` and are expected to differ forever.

## Expiration anchoring in workflows

A workflow can wait until a timestamp the run carries, not only a fixed duration from when the run started. A moment takes `at`, a path into the trigger data, the subscriber, an earlier step or a variable, with `before` counting back from it and `delay` counting forward.

Subscription campaigns fire relative to an expiry date that arrives in a webhook and differs per subscriber. Upstream can only express a fixed offset, so a trial reminder needs the trial length in the definition and drifts whenever a trial is extended or a plan differs.

Touches the moment type, its lint, the API request schema, the engine's moment resolution and the dashboard's flow diagram. Additive: without `at`, a moment behaves as upstream's does.

Retire when upstream supports anchoring a wait on a value from the run. The best candidate to send upstream.

## Broadcast campaigns

A campaign is a named plan that produces messages: pick a topic and an audience, write the
notification, schedule it, launch it, and read how it did. `Campaigns.md` holds the design.

Buzzkit can already compose, target, schedule, fan out and report on a single message. What it has no
concept of is one named thing above a message, so a broadcast has nowhere to live and nothing to
report against. Slumber is replacing Firebase Cloud Messaging and needs the part the Firebase console
gave us.

Adds a `campaign` table, a `campaign_id` on `message`, the `/v1/campaigns` routes, three scopes and a
dashboard section. Also drops `schema: tables` from the Drizzle client: the relational query API it
enabled is used nowhere, and keeping it put the emitted API contract over TypeScript's serialization
limit as soon as any new table was added.

Retire when upstream ships broadcast campaigns. The largest divergence this fork carries, and the one
most likely to conflict on a sync.

## API failures are logged in the dashboard

`apps/web` logs every API failure it turns into an `ApiError`, with status, code and path.

Upstream's own `apps/web/CLAUDE.md` says this line exists and is "the place to look first", but the code never wrote it. Without it a rejected loader promise renders "Unexpected Server Error" with a 200 status, a clean console and nothing in any server log.

Retire when upstream implements what its documentation promises. A bug fix, so also a good pull request.

## The invite sender is configurable

`EMAIL_FROM` and `EMAIL_FROM_NAME` carry the sender address instead of the hardcoded `mail@tm.buzzkit.dev` in `apps/api/src/libs/email.ts`.

Cloudflare Email Sending only sends from a domain onboarded to the sending account, so a hardcoded address makes invite email impossible on any deployment but upstream's. This deployment sends from a subdomain of its own, so the apex MX records stay with the company's mail provider.

Retire when upstream takes the same change. A hardcoded sender in a self-hostable product is a bug, so this is a good pull request.

## Prepared statements are off in the database client

`packages/database` sets `prepare: false`.

The database is the smallest managed size, capped at 22 connections, so Hyperdrive connects through a PgBouncer pool in transaction mode, which cannot carry prepared statements.

Retire when the database is large enough to drop the pooler. Specific to this deployment; does not belong upstream.

## Lint and Test run on GitHub-hosted runners

Both workflows target `ubuntu-latest` instead of Blacksmith runners, which belong to upstream's account. Every run on this fork queued until it was cancelled.

Retire when this fork has its own Blacksmith subscription. The four workflows the fork does not use are unchanged and disabled in the repository settings, so they stay out of the diff.
