# Deployment

How this fork was deployed: the two Workers on Cloudflare, PostgreSQL on DigitalOcean, and the event stream on Tinybird. The steps are in the order they were run. No secrets, hostnames or account names appear here. Every secret lives on the Worker (`wrangler secret put`) or in a git-ignored file, and the values are in the team password manager.

| Part | Where |
| --- | --- |
| Dashboard | `apps/web`, Worker `buzzkit-web`, on the dashboard hostname |
| API | `apps/api`, Worker `buzzkit-api`, on the API hostname |
| PostgreSQL | DigitalOcean managed PostgreSQL 18, one node, the smallest size |
| Event stream | A Tinybird Forward workspace in the US East region |

## Prerequisites

- Bun 1.3.14 and Node 22, then `bun install --frozen-lockfile` at the root.
- `wrangler` logged in with a user who can deploy to the Cloudflare account: `bunx wrangler login`.
- `doctl` logged in to the DigitalOcean team.
- The Tinybird workspace admin token in `packages/tinybird/.env` as `TINYBIRD_TOKEN`, with `TINYBIRD_URL` set to the workspace's region host. The file is git-ignored and Bun loads it for `bun run` in that package.

The dashboard hostname and the API hostname share one registrable domain on purpose. The API sets the session cookie on the shared domain and the dashboard's server reads it. Two unrelated hostnames break sign-in.

## 1. Wrangler configuration

Both `wrangler.jsonc` files were changed and committed on the deployment branch:

- `account_id` to the Cloudflare account.
- `routes` to a custom domain each, the API hostname for the API and the dashboard hostname for the dashboard. Wrangler creates the DNS record and the certificate on deploy.
- `workers_dev` and `preview_urls` to `false`.
- API `vars`: `DASHBOARD_URL`, `BETTER_AUTH_URL` and `TINYBIRD_URL`. The Tinybird host must be the one the workspace's token was issued for. A token for a Forward workspace is rejected by the AWS region host the upstream config carries.
- Dashboard `vars`: `API_URL`.
- The KV namespace ids and the Hyperdrive id from the steps below.

## 2. PostgreSQL on DigitalOcean

```sh
doctl databases create buzzkit --engine pg --version 18 --region <region> --size db-s-1vcpu-1gb --num-nodes 1
doctl databases db create <cluster-id> buzzkit
```

The cluster was online in about two minutes. Migrations ran from `packages/database` with the direct connection string in its git-ignored `.env` as `DATABASE_URL_PRODUCTION`. The script forces `sslmode=require`.

```sh
bun run --cwd packages/database db:migrate:production
```

All 20 migrations applied. Local development and CI run `postgres:18-alpine` from `docker-compose.yml`, the same major version. The cluster's trusted sources are Cloudflare's 15 published IPv4 ranges (Hyperdrive connects from them, and DigitalOcean trusted sources do not accept IPv6) plus the IP of the machine that runs migrations. Nothing else can reach it.

```sh
curl -s https://www.cloudflare.com/ips-v4
# one rule per range, plus your own IP for migrations
doctl databases firewalls append <cluster-id> --rule ip_addr:<range>
```

Cloudflare changes these ranges rarely. When it does, append the new ones.

The smallest cluster size caps PostgreSQL at 22 backend connections, which this Worker and a few direct sessions can exhaust. Hyperdrive points at a PgBouncer pool rather than the database directly:

```sh
doctl databases pool create <cluster-id> buzzkit-pool --mode transaction --size 11 --db buzzkit --user doadmin
bunx wrangler hyperdrive update <hyperdrive-id> --connection-string="<pool URI>"
```

The pool URI uses port 25061 and database `buzzkit-pool`. Transaction mode cannot carry prepared statements, so `packages/database` sets `prepare: false` on the postgres client. Use `max: 1` for any script that connects directly, or it takes ten of the eleven backends.

## 3. Tinybird

The event stream runs as Tinybird Local on its own DigitalOcean droplet, not a cloud workspace. The free cloud tier allows 1,000 API requests a day, which the dashboard's five-second refresh spends in under an hour.

The droplet runs the `tinybirdco/tinybird-local` container behind Caddy, which terminates TLS and proxies to port 7181. Both start from cloud-init. Nothing backs up the volume.

The project is pushed over an SSH tunnel on port 7181, because the CLI's `--local` flag probes that port:

```sh
ssh -f -N -L 7181:localhost:7181 root@<droplet ip>
TINYBIRD_URL=http://localhost:7181 bun run --cwd packages/tinybird push
```

A push can create fewer resources than the project defines without failing, so run it twice and compare against `packages/tinybird/src/endpoints/`.

`TINYBIRD_URL` is the droplet's hostname. `TINYBIRD_TOKEN` is the container's `workspace_admin_token` from `GET /tokens`.

## 4. Cloudflare resources

Created before the first deploy, because a deploy does not create them:

- KV namespaces `buzzkit-api-AUTH_CACHE`, `buzzkit-api-PROVIDER_CACHE` and `buzzkit-api-ENGINE_DEFS`. Their ids went into `apps/api/wrangler.jsonc`.
- Queues `buzzkit-deliveries`, `buzzkit-deliveries-dlq`, `buzzkit-events`, `buzzkit-events-dlq`, `buzzkit-webhooks` and `buzzkit-webhooks-dlq`.
- The Hyperdrive config `buzzkit` pointing at the DigitalOcean cluster and the `buzzkit` database, created from `apps/api`:

```sh
bunx wrangler hyperdrive create buzzkit --connection-string="<direct connection string>"
```

The Durable Object `SubscriberActor`, the Workflow `buzzkit-workflows` and the two cron triggers are created from `wrangler.jsonc` on deploy.

## 5. API deploy and secrets

```sh
cd apps/api
bun run deploy
```

Then the four secrets, each piped into `bunx wrangler secret put <NAME>`:

| Secret | How it was made |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `CREDENTIAL_MASTER_KEY_V1` | `openssl rand -base64 32`, exactly 32 bytes |
| `SQIDS_ALPHABET` | All 62 of `0-9a-zA-Z` shuffled once. Never change it, public ids derive from it. |
| `TINYBIRD_TOKEN` | The workspace admin token from step 3 |

Axiom receives logs and traces. Two datasets were created in the Axiom organization, one for logs and one for traces, plus an API token with ingest access to those two datasets only. Three more secrets carry them to the Worker: `AXIOM_API_TOKEN`, `AXIOM_LOGS_DATASET` and `AXIOM_TRACES_DATASET`. Traces arrive over OTLP as the services `buzzkit-api`, `buzzkit-queue`, `buzzkit-scheduler`, `buzzkit-actor` and `buzzkit-workflows`. Logs ship after each invocation that produced a log line, so an idle deployment writes traces but no logs. `OTEL_EXPORTER_OTLP_ENDPOINT` stays unset, it would take precedence over Axiom for traces.

GitHub sign-in was not configured. Email and password sign-in is on.

## 6. Dashboard deploy

```sh
cd apps/web
bun run deploy
```

The script builds with Vite and the Cloudflare plugin, then runs `wrangler deploy` against the built configuration.

## 7. The zone redirect

The zone already had a Redirect Rule that sent every hostname to another site with a 301, so both new hostnames answered with that redirect after the deploy. The rule was changed from "All incoming requests" to a custom filter expression that excludes the two new hostnames:

```
not (http.host in {"<dashboard hostname>" "<api hostname>"})
```

The rest of the zone still redirects. Two disabled Page Rules did the same thing with no exclusions, and were deleted.

The Tinybird hostname needs the same exclusion and one more setting. The zone's SSL mode is Flexible, so a proxied record would make Cloudflare talk HTTP to Caddy and hit its redirect to HTTPS. A Configuration Rule scoped to that hostname pins it to Full (strict):

```
(http.host eq "<tinybird hostname>")  ->  ssl: strict
```

Both are required. Without the exclusion a Worker subrequest follows the 301 and parses the marketing site's HTML as JSON, which surfaces as `Unexpected token '<'` on any route that reads the event stream.

## 8. Continuous integration

The upstream workflows target Blacksmith runners this account has no subscription for, so every run queued until it was cancelled. Lint and Test now run on `ubuntu-latest`.

The other four are disabled in the repository's Actions settings rather than deleted, so their files stay as upstream wrote them. Each targets something this fork does not own: publishing the `buzzkit` package, scanning the upstream marketing domain, dispatching the iOS device suite, and deploying Tinybird to a cloud workspace.

## 9. Verification

- `GET /v1/health` on the API hostname returns `200` with `database.status = ok`, which proves the Worker, Hyperdrive and the cluster are connected.
- The dashboard hostname redirects to `/login` and renders the sign-in page.

## Upgrading

Same order every time: database, event stream, API, dashboard.

```sh
bun run --cwd packages/database db:migrate:production
ssh -f -N -L 7181:localhost:7181 root@<droplet ip>
TINYBIRD_URL=http://localhost:7181 bun run --cwd packages/tinybird push
bun run --cwd apps/api deploy
bun run --cwd apps/web deploy
```

The Tinybird step only matters when `packages/tinybird` changed. It pushes into the droplet; `deploy` would target a cloud workspace.

## Cost

Estimated for 10,000 notifications a day, about 300,000 a month, one device each, with event volume similar to notification volume and no webhooks. Prices come from the providers' pricing pages at the time of writing.

| Service | Plan | Monthly |
| --- | --- | --- |
| Cloudflare Workers Paid | Subscription | 5 USD |
| Cloudflare usage | Queues, Durable Objects, KV, Workers requests and CPU | 0 to 1 USD |
| DigitalOcean managed PostgreSQL | 1 vCPU, 1 GiB, 10 GiB, one node | 15 USD |
| DigitalOcean droplet for Tinybird | 2 vCPU, 4 GiB | 24 USD |
| Total | | about 44 to 45 USD |

How the Cloudflare usage line was derived from the plan's included quotas: about 3 Queues operations per delivery message plus the event flushes, so 1 to 2 million against 1 million included, which is the only line that may exceed its quota. Durable Object requests land around 600,000 against 1 million included, Durable Object rows written around 1 million against 50 million, Workers requests under 1 million against 10 million, CPU a few million milliseconds against 30 million. At ten times the volume the Cloudflare usage line grows to roughly 5 to 10 USD, driven by Queues.

The account runs on the Workers Free plan today, so the Cloudflare line is 0 USD, with the Free plan's limits: 10,000 Queues operations a day, 100 concurrent workflow runs, 1,000 KV writes a day, 10 ms of CPU per invocation and about 20 Hyperdrive connections. Those bind well below 10,000 notifications a day. Workers Paid is also what Email Sending requires.

Tinybird's free tier allows 1,000 API requests a day, which the dashboard's five-second refresh spends in under an hour, so the event stream runs on its own droplet instead. Email Sending is not included because its pricing page was not available when this was written.

## Known gaps

- Invite email sends from `buzz-mail.slumber.group`, set in `apps/api/wrangler.jsonc` as `EMAIL_FROM` and `EMAIL_FROM_NAME`. That subdomain must be onboarded under Compute > Email Service > Email Sending, which writes the `cf-bounce` MX, SPF, DKIM and DMARC records to the subdomain and leaves the apex MX with Google. Until it is onboarded, sends fail and the dashboard shows the invite link to copy instead.
- The OpenAPI document generated by the API lists the upstream API as its server.
- Provider credentials (an APNs key or a Firebase service account) are uploaded through the dashboard under Settings → Credentials, per tenant and environment. None were uploaded during the deploy.
