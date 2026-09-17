import { Button } from '@buzzkit/ui/components/button';
import { Card } from '@buzzkit/ui/components/card';
import { EmptyState } from '@buzzkit/ui/components/empty-state';
import { Table, TableBody, TableCell, TableRow } from '@buzzkit/ui/components/table';
import { Truncate } from '@buzzkit/ui/components/truncate';
import { Link, useOutletContext } from 'react-router';
import { cloudflareContext } from '@/app/cloudflare';
import { CampaignStatusBadge } from '@/app/components/badges';
import { PageHeader } from '@/app/components/layout/page-header';
import { Deferred } from '@/app/components/loading/deferred';
import type { PageHandle } from '@/app/components/loading/handle';
import { type TableColumn, TableColumns, TableSkeleton } from '@/app/components/loading/table';
import { useCanManage } from '@/app/hooks/use-known-role';
import { TimeAgo } from '@/app/hooks/use-time-ago';
import { campaignsAction } from '@/app/lib/actions/campaigns.server';
import { type Campaign, listCampaigns } from '@/app/lib/api.server';
import { requireSession, resolveTenant } from '@/app/lib/session.server';
import type { WorkspaceOutletContext } from '@/app/routes/[slug]/layout';
import type { Route } from './+types/index';

export function meta() {
  return [{ title: 'Campaigns · BuzzKit' }];
}

const COLUMNS: TableColumn[] = [
  { label: 'Campaign', className: 'w-64', fill: 'h-4 w-40' },
  { label: 'Topic', className: 'w-40', fill: 'h-4 w-24' },
  { label: 'Audience', className: 'w-28', fill: 'h-4 w-16' },
  { label: 'Status', className: 'w-28', fill: 'h-5 w-20 rounded-full' },
  { label: 'Updated', className: 'w-28', fill: 'h-4 w-16' },
];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { token } = requireSession(request);
  const tenant = await resolveTenant(request, params.slug);
  return { campaigns: listCampaigns({ request, env }, token, params.slug, tenant) };
}

export const action = campaignsAction;

function CampaignRow({ campaign, base }: { campaign: Campaign; base: string }) {
  return (
    <TableRow>
      <TableCell className='font-medium text-fg-4'>
        <Link
          to={`${base}/${campaign.slug}`}
          className='flex min-w-0 flex-col outline-none focus-visible:underline'
        >
          <Truncate>{campaign.name}</Truncate>
          <Truncate className='font-normal text-fg-2 text-xs'>
            {campaign.payload.title ?? campaign.slug}
          </Truncate>
        </Link>
      </TableCell>
      <TableCell className='text-fg-2'>
        <Truncate>{campaign.topic.name}</Truncate>
      </TableCell>
      <TableCell className='text-fg-2'>
        {campaign.audienceEstimate === null ? '—' : campaign.audienceEstimate}
      </TableCell>
      <TableCell>
        <CampaignStatusBadge status={campaign.status} />
      </TableCell>
      <TableCell>
        <TimeAgo at={campaign.updatedAt} />
      </TableCell>
    </TableRow>
  );
}

export default function CampaignsRoute({ loaderData, params }: Route.ComponentProps) {
  const { workspace } = useOutletContext<WorkspaceOutletContext>();
  const { campaigns } = loaderData;
  const base = `/${params.slug}/campaigns`;
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5'>
      <CampaignsHeader canManage={canManage} base={base} />

      <Deferred resolve={campaigns}>
        {(data) => {
          const rows = data ?? [];
          return data === undefined ? (
            <CampaignsSkeleton />
          ) : (
            <Card className='min-h-0 shrink'>
              {rows.length === 0 ? (
                <EmptyState
                  icon='IconRocketFilled'
                  title='No campaigns yet'
                  description='A campaign sends one notification to everyone opted in to a topic.'
                  className='py-10'
                />
              ) : (
                <Table className='table-fixed'>
                  <TableColumns columns={COLUMNS} />
                  <TableBody>
                    {rows.map((campaign) => (
                      <CampaignRow key={campaign.id} campaign={campaign} base={base} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          );
        }}
      </Deferred>
    </div>
  );
}

function CampaignsHeader({ canManage, base }: { canManage: boolean | null; base?: string }) {
  const manage = useCanManage(canManage);

  return (
    <PageHeader
      title='Campaigns'
      description='Send one notification to everyone opted in to a topic.'
      actions={
        manage === false ? null : (
          <Button
            icon='IconPlusMedium'
            disabled={manage === null}
            nativeButton={false}
            render={<Link to={`${base}/new`} />}
          >
            Create campaign
          </Button>
        )
      }
    />
  );
}

function CampaignsSkeleton() {
  return <TableSkeleton columns={COLUMNS} />;
}

export const handle: PageHandle = {
  skeleton: (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5'>
      <CampaignsHeader canManage={null} />
      <CampaignsSkeleton />
    </div>
  ),
};
