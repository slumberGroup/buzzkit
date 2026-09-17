import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@buzzkit/ui/components/alert-dialog';
import { Button } from '@buzzkit/ui/components/button';
import { Card, CardFooter, CardHeader, CardTitle } from '@buzzkit/ui/components/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@buzzkit/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@buzzkit/ui/components/dropdown-menu';
import { EmptyState } from '@buzzkit/ui/components/empty-state';
import { Field, FieldDescription, FieldLabel } from '@buzzkit/ui/components/field';
import { Input } from '@buzzkit/ui/components/input';
import { toast } from '@buzzkit/ui/components/sonner';
import { Table, TableBody, TableCell, TableRow } from '@buzzkit/ui/components/table';
import { cn } from '@buzzkit/ui/lib/utils';
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { cloudflareContext } from '@/app/cloudflare';
import { CampaignStatusBadge, MessageStatusBadge } from '@/app/components/badges';
import {
  AudienceFields,
  type CampaignChoices,
  type CampaignDraft,
  isCampaignReady,
  NotificationFields,
} from '@/app/components/campaigns/fields';
import { PageHeader } from '@/app/components/layout/page-header';
import { BlockSkeleton } from '@/app/components/loading/card';
import { Deferred } from '@/app/components/loading/deferred';
import type { PageHandle } from '@/app/components/loading/handle';
import { type TableColumn, TableColumns, TableSkeleton } from '@/app/components/loading/table';
import { useActionFetcher } from '@/app/hooks/use-action-fetcher';
import { useCanManage } from '@/app/hooks/use-known-role';
import { TimeAgo } from '@/app/hooks/use-time-ago';
import { campaignsAction } from '@/app/lib/actions/campaigns.server';
import {
  type CampaignAudience,
  type CampaignDetail,
  getCampaign,
  getCampaignAudience,
  listCampaignMessages,
  listSegments,
  listTopics,
} from '@/app/lib/api.server';
import { requireSession, resolveTenant } from '@/app/lib/session.server';
import type { WorkspaceOutletContext } from '@/app/routes/[slug]/layout';
import type { Route } from './+types/index';

export function meta() {
  return [{ title: 'Campaign · BuzzKit' }];
}

const CONFIRM_AUDIENCE = 1000;

const MESSAGE_COLUMNS: TableColumn[] = [
  { label: 'Message', className: 'w-56', fill: 'h-4 w-32' },
  { label: 'Status', className: 'w-28', fill: 'h-5 w-20 rounded-full' },
  { label: 'Sent', className: 'w-24', fill: 'h-4 w-12' },
  { label: 'Created', className: 'w-28', fill: 'h-4 w-16' },
];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { token } = requireSession(request);
  const tenant = await resolveTenant(request, params.slug);
  const ctx = { request, env };
  return {
    campaign: getCampaign(ctx, token, params.slug, tenant, params.campaignSlug),
    audience: getCampaignAudience(ctx, token, params.slug, tenant, params.campaignSlug),
    messages: listCampaignMessages(ctx, token, params.slug, tenant, params.campaignSlug),
    choices: (async () => {
      const [topics, segments] = await Promise.all([
        listTopics(ctx, token, params.slug, tenant),
        listSegments(ctx, token, params.slug, tenant),
      ]);
      return {
        topics: topics.items.map((topic) => ({ slug: topic.slug, name: topic.name })),
        segments: segments.map((segment) => ({ slug: segment.slug, name: segment.name })),
      };
    })(),
  };
}

export const action = campaignsAction;

export default function CampaignRoute({ loaderData, params }: Route.ComponentProps) {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { audience, campaign, choices, messages } = loaderData;
  const base = `/${params.slug}/campaigns`;
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5'>
      <Deferred resolve={campaign}>
        {(data) =>
          data === undefined ? (
            <CampaignHeader canManage={null} base={base} />
          ) : (
            <CampaignActions campaign={data} audience={audience} base={base} canManage={canManage} />
          )
        }
      </Deferred>

      <div className='-m-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-1 [&>*]:shrink-0'>
        <Deferred resolve={campaign}>
          {(data) => {
            if (data === undefined) return <BlockSkeleton className='h-64' />;
            if (data.status === 'draft') return <CampaignEditor campaign={data} choices={choices} />;
            return <CampaignStats campaign={data} />;
          }}
        </Deferred>

        <Card className='min-h-0 shrink'>
          <CardHeader divider className='py-3'>
            <CardTitle>Messages</CardTitle>
          </CardHeader>
          <Deferred resolve={messages}>
            {(data) => {
              const rows = data?.items ?? [];
              if (data === undefined) return <TableSkeleton columns={MESSAGE_COLUMNS} />;
              if (rows.length === 0) {
                return (
                  <EmptyState
                    icon='IconPaperPlaneTopRightFilled'
                    title='Nothing sent yet'
                    description='Launching the campaign creates the message its deliveries hang from.'
                    className='py-10'
                  />
                );
              }
              return (
                <Table className='table-fixed'>
                  <TableColumns columns={MESSAGE_COLUMNS} />
                  <TableBody>
                    {rows.map((message) => (
                      <TableRow key={message.id}>
                        <TableCell className='font-medium text-fg-4'>
                          <Link
                            to={`/${params.slug}/messages/${message.id}`}
                            className='outline-none focus-visible:underline'
                          >
                            {message.id}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <MessageStatusBadge status={message.status} />
                        </TableCell>
                        <TableCell className='text-fg-2 tabular-nums'>{message.counts.sent}</TableCell>
                        <TableCell>
                          <TimeAgo at={message.createdAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              );
            }}
          </Deferred>
        </Card>
      </div>
    </div>
  );
}

function CampaignActions({
  campaign,
  audience,
  base,
  canManage,
}: {
  campaign: CampaignDetail;
  audience: Promise<CampaignAudience>;
  base: string;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [to, setTo] = useState('');
  const { submit, pending } = useActionFetcher((data) => {
    if (data.launched) {
      setLaunchOpen(false);
      setConfirm('');
      toast.success('Campaign launched');
      return;
    }
    if (data.canceled) {
      setCancelOpen(false);
      toast.success('Campaign canceled', {
        description: 'Anything already sending finishes. Watch the messages below for what is still running.',
      });
      return;
    }
    if (data.tested) {
      setTestOpen(false);
      setTo('');
      toast.success('Test sent');
      return;
    }
    if (data.deleted) {
      toast.success('Campaign deleted');
      void navigate(base);
    }
  });

  const launchable = campaign.status === 'draft';
  const cancelable = campaign.status === 'scheduled' || campaign.status === 'sending';
  const deletable = !cancelable;

  return (
    <>
      <CampaignHeader
        canManage={canManage}
        base={base}
        campaign={campaign}
        launchable={launchable}
        cancelable={cancelable}
        deletable={deletable}
        pending={pending}
        onLaunch={() => setLaunchOpen(true)}
        onCancel={() => setCancelOpen(true)}
        onTest={() => setTestOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      <Dialog open={launchOpen} onOpenChange={setLaunchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Launch “{campaign.name}”?</DialogTitle>
          </DialogHeader>
          <Deferred resolve={audience}>
            {(data) => (
              <LaunchBody
                campaign={campaign}
                audience={data}
                confirm={confirm}
                onConfirm={setConfirm}
                pending={pending}
                onLaunch={() => submit('launch', { campaign: campaign.slug, confirm })}
              />
            )}
          </Deferred>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a test</DialogTitle>
          </DialogHeader>
          <div className='flex flex-col gap-4 p-4'>
            <Field>
              <FieldLabel htmlFor='campaign-test-to'>External ids</FieldLabel>
              <Input
                id='campaign-test-to'
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder='user_42, user_43'
                autoComplete='off'
                spellCheck={false}
              />
              <FieldDescription>
                The test goes to these subscribers only and is left out of the campaign results.
              </FieldDescription>
            </Field>
            <Button
              className='self-end'
              disabled={to.trim().length === 0}
              loading={pending}
              onClick={() => submit('test', { campaign: campaign.slug, to })}
            >
              Send test
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel “{campaign.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A send that has not started yet is stopped. One already under way runs to the end, because a
              notification on its way to a device cannot be recalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending}
              onClick={() => submit('cancel', { campaign: campaign.slug })}
            >
              Cancel campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{campaign.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The campaign and its results stop being listed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending}
              onClick={() => submit('delete', { campaign: campaign.slug })}
            >
              Delete campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LaunchBody({
  campaign,
  audience,
  confirm,
  onConfirm,
  pending,
  onLaunch,
}: {
  campaign: CampaignDetail;
  audience: CampaignAudience | undefined;
  confirm: string;
  onConfirm: (value: string) => void;
  pending: boolean;
  onLaunch: () => void;
}) {
  const estimate = audience?.estimate ?? null;
  const needsConfirm = estimate !== null && estimate >= CONFIRM_AUDIENCE;
  const ready = audience !== undefined && (!needsConfirm || confirm === campaign.name);

  return (
    <div className='flex flex-col gap-4 p-4'>
      <div className='rounded-md border border-bg-3 p-3'>
        <p className='font-medium text-fg-4 text-sm'>{campaign.payload.title}</p>
        <p className='text-fg-2 text-sm'>{campaign.payload.body}</p>
      </div>

      <dl className='flex flex-col gap-1 text-sm'>
        <div className='flex justify-between gap-3'>
          <dt className='text-fg-2'>Topic</dt>
          <dd className='text-fg-4'>{campaign.topic.name}</dd>
        </div>
        <div className='flex justify-between gap-3'>
          <dt className='text-fg-2'>Audience</dt>
          <dd className='text-fg-4 tabular-nums'>
            {estimate === null ? 'Counting' : `about ${estimate} subscribers`}
          </dd>
        </div>
        {campaign.schedule ? (
          <div className='flex justify-between gap-3'>
            <dt className='text-fg-2'>Sends</dt>
            <dd className='text-fg-4'>
              {campaign.schedule.at} {campaign.schedule.timezone}
            </dd>
          </div>
        ) : null}
      </dl>

      {needsConfirm ? (
        <Field>
          <FieldLabel htmlFor='campaign-confirm'>Type the campaign name to confirm</FieldLabel>
          <Input
            id='campaign-confirm'
            value={confirm}
            onChange={(event) => onConfirm(event.target.value)}
            placeholder={campaign.name}
            autoComplete='off'
          />
        </Field>
      ) : null}

      <Button className='self-end' disabled={!ready} loading={pending} onClick={onLaunch}>
        {campaign.schedule ? 'Schedule campaign' : 'Launch campaign'}
      </Button>
    </div>
  );
}

function draftOf(campaign: CampaignDetail): CampaignDraft {
  return {
    topic: campaign.topic.slug,
    segment: campaign.segment ?? '',
    title: campaign.payload.title ?? '',
    body: campaign.payload.body ?? '',
    imageUrl: campaign.payload.imageUrl ?? '',
    deepLink: campaign.payload.deepLink ?? '',
    throttlePerMinute: campaign.throttlePerMinute === null ? '' : String(campaign.throttlePerMinute),
  };
}

function CampaignEditor({
  campaign,
  choices,
}: {
  campaign: CampaignDetail;
  choices: Promise<CampaignChoices>;
}) {
  const saved = draftOf(campaign);
  const [draft, setDraft] = useState(saved);
  const { submit, pending } = useActionFetcher((data) => {
    if (data.updated) toast.success('Campaign saved');
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const change = (patch: Partial<CampaignDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const save = () => {
    void submit('update', {
      campaign: campaign.slug,
      topic: draft.topic,
      segment: draft.segment,
      title: draft.title.trim(),
      body: draft.body.trim(),
      imageUrl: draft.imageUrl.trim(),
      deepLink: draft.deepLink.trim(),
      throttlePerMinute: draft.throttlePerMinute,
    });
  };

  return (
    <div className='flex flex-col gap-5'>
      <Card>
        <CardHeader divider className='py-3'>
          <CardTitle>Audience</CardTitle>
        </CardHeader>
        <Deferred resolve={choices}>
          {(data) => <AudienceFields choices={data} draft={draft} onChange={change} />}
        </Deferred>
      </Card>

      <Card>
        <CardHeader divider className='py-3'>
          <CardTitle>Notification</CardTitle>
        </CardHeader>
        <NotificationFields draft={draft} onChange={change} />
        <CardFooter className='justify-end gap-2'>
          <Button variant='soft' disabled={!dirty || pending} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button disabled={!dirty || !isCampaignReady(draft) || pending} loading={pending} onClick={save}>
            Save draft
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function CampaignStats({ campaign }: { campaign: CampaignDetail }) {
  const stats = campaign.stats;
  if (!stats) return null;

  const { counts, engagement } = stats;
  return (
    <div className='grid gap-5 lg:grid-cols-2'>
      <Card>
        <CardHeader divider className='py-3'>
          <CardTitle>Delivery</CardTitle>
        </CardHeader>
        <dl>
          <StatRow label='Reachable' value={counts.total} />
          <StatRow label='Sent' value={counts.sent} tone='green' />
          <StatRow label='Delivered' value={counts.delivered} tone='green' />
          <StatRow label='Failed' value={counts.failed} tone='red' />
          <StatRow label='Invalid' value={counts.invalid} tone='red' />
        </dl>
      </Card>
      <Card>
        <CardHeader divider className='py-3'>
          <CardTitle>Engagement</CardTitle>
        </CardHeader>
        <dl>
          <StatRow label='Opened' value={engagement.opened} tone='green' />
          <StatRow label='Dismissed' value={engagement.dismissed} />
          <StatRow label='Messages' value={counts.messages} />
        </dl>
      </Card>
    </div>
  );
}

function StatRow({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  let color = 'text-fg-4';
  if (value > 0 && tone === 'green') color = 'text-green-text';
  if (value > 0 && tone === 'red') color = 'text-red-text';

  return (
    <div className='flex min-h-10 items-center justify-between gap-3 border-bg-3 border-b px-4 last:border-b-0'>
      <dt className='text-fg-2 text-sm'>{label}</dt>
      <dd className={cn('text-sm tabular-nums', color)}>{value}</dd>
    </div>
  );
}

function CampaignHeader({
  canManage,
  base,
  campaign,
  launchable,
  cancelable,
  deletable,
  pending,
  onLaunch,
  onCancel,
  onTest,
  onDelete,
}: {
  canManage: boolean | null;
  base: string;
  campaign?: CampaignDetail;
  launchable?: boolean;
  cancelable?: boolean;
  deletable?: boolean;
  pending?: boolean;
  onLaunch?: () => void;
  onCancel?: () => void;
  onTest?: () => void;
  onDelete?: () => void;
}) {
  const manage = useCanManage(canManage);

  return (
    <div className='flex shrink-0 flex-col gap-3'>
      <Button
        variant='ghost'
        size='sm'
        icon='IconChevronLeftMedium'
        className='-ml-2 w-fit shrink-0 text-fg-2 hover:text-fg-4'
        nativeButton={false}
        render={<Link to={base} />}
      >
        Campaigns
      </Button>
      <PageHeader
        title={
          <span className='flex items-center gap-2'>
            {campaign ? campaign.name : <span className='h-[1.15em] w-40 animate-pulse rounded bg-bg-3' />}
            {campaign ? <CampaignStatusBadge status={campaign.status} /> : null}
          </span>
        }
        description={campaign?.description ?? 'One notification to everyone opted in to a topic.'}
        actions={
          manage === false || !campaign ? null : (
            <div className='flex items-center gap-2'>
              {cancelable ? (
                <Button variant='soft' disabled={pending} onClick={onCancel}>
                  Cancel
                </Button>
              ) : null}
              {launchable ? (
                <Button icon='IconRocketFilled' disabled={manage === null || pending} onClick={onLaunch}>
                  Launch
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='soft'
                      size='icon'
                      icon='IconDotGrid1x3Horizontal'
                      aria-label='Campaign actions'
                    />
                  }
                />
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={onTest}>Send a test</DropdownMenuItem>
                  {deletable ? (
                    <DropdownMenuItem variant='destructive' onClick={onDelete}>
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
    </div>
  );
}

export const handle: PageHandle = {
  skeleton: (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5'>
      <CampaignHeader canManage={null} base='' />
      <BlockSkeleton className='h-64' />
      <TableSkeleton columns={MESSAGE_COLUMNS} />
    </div>
  ),
};
