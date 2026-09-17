import { Button } from '@buzzkit/ui/components/button';
import { Card, CardHeader, CardTitle } from '@buzzkit/ui/components/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@buzzkit/ui/components/field';
import { Input } from '@buzzkit/ui/components/input';
import { ScrollFade } from '@buzzkit/ui/components/scroll-fade';
import { toast } from '@buzzkit/ui/components/sonner';
import { Textarea } from '@buzzkit/ui/components/textarea';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cloudflareContext } from '@/app/cloudflare';
import {
  AudienceFields,
  type CampaignDraft,
  EMPTY_CAMPAIGN,
  isCampaignReady,
  NotificationFields,
} from '@/app/components/campaigns/fields';
import { PageHeader } from '@/app/components/layout/page-header';
import { BlockSkeleton } from '@/app/components/loading/card';
import { Deferred } from '@/app/components/loading/deferred';
import type { PageHandle } from '@/app/components/loading/handle';
import { describeSlugProblem, slugify, slugifyInput } from '@/app/components/workspace/fields';
import { useActionFetcher } from '@/app/hooks/use-action-fetcher';
import { campaignsAction } from '@/app/lib/actions/campaigns.server';
import { listSegments, listTopics } from '@/app/lib/api.server';
import { requireSession, resolveTenant } from '@/app/lib/session.server';
import type { Route } from './+types/index';

export function meta() {
  return [{ title: 'New campaign · BuzzKit' }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { token } = requireSession(request);
  const tenant = await resolveTenant(request, params.slug);
  const ctx = { request, env };
  return {
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

export default function NewCampaignRoute({ loaderData, params }: Route.ComponentProps) {
  const navigate = useNavigate();
  const base = `/${params.slug}/campaigns`;
  const { choices } = loaderData;
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_CAMPAIGN);
  const mainRef = useRef<HTMLDivElement>(null);
  const { submit, pending } = useActionFetcher((data) => {
    if (typeof data.slug !== 'string') return;
    toast.success('Campaign created');
    void navigate(`${base}/${data.slug}`);
  });

  const slugValue = slugTouched ? slug : slugify(name);
  const slugProblem = slugValue ? describeSlugProblem(slugValue) : null;
  const canCreate =
    name.trim().length > 0 && slugValue.length > 0 && !slugProblem && isCampaignReady(draft) && !pending;

  const change = (patch: Partial<CampaignDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const create = () => {
    void submit('create', {
      name: name.trim(),
      slug: slugValue,
      description: description.trim(),
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
    <NewCampaignFrame base={base}>
      <NewCampaignHeader canCreate={canCreate} pending={pending} onCreate={create} base={base} />

      <ScrollFade targetRef={mainRef} />
      <div
        ref={mainRef}
        className='-m-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-1 [&>*]:shrink-0'
      >
        <Card>
          <CardHeader divider className='py-3'>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <FieldGroup className='p-4'>
            <Field>
              <FieldLabel htmlFor='campaign-name'>Name</FieldLabel>
              <Input
                id='campaign-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder='New audiobook'
                maxLength={100}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='campaign-slug'>Slug</FieldLabel>
              <Input
                id='campaign-slug'
                value={slugValue}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(slugifyInput(event.target.value));
                }}
                placeholder='new-audiobook'
                maxLength={48}
                autoComplete='off'
                spellCheck={false}
                aria-invalid={slugProblem ? true : undefined}
              />
              {slugProblem ? (
                <FieldError>{slugProblem}</FieldError>
              ) : (
                <FieldDescription>Names the campaign in the API and on its messages.</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor='campaign-description'>Description</FieldLabel>
              <Textarea
                id='campaign-description'
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder='Announces the Tuesday release to everyone opted in.'
                maxLength={500}
                rows={3}
              />
            </Field>
          </FieldGroup>
        </Card>

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
        </Card>
      </div>
    </NewCampaignFrame>
  );
}

function NewCampaignFrame({ base, children }: { base: string; children: React.ReactNode }) {
  return (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5'>
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
      {children}
    </div>
  );
}

function NewCampaignHeader({
  canCreate,
  pending,
  onCreate,
  base,
}: {
  canCreate?: boolean;
  pending?: boolean;
  onCreate?: () => void;
  base?: string;
}) {
  const params = useParams();
  const href = base ?? `/${params.slug}/campaigns`;

  return (
    <PageHeader
      title='New campaign'
      description='Write the notification, choose who receives it, then launch it when it is ready.'
      actions={
        <div className='flex items-center gap-2'>
          <Button variant='soft' nativeButton={false} render={<Link to={href} />}>
            Cancel
          </Button>
          <Button icon='IconPlusMedium' disabled={!canCreate} loading={pending} onClick={onCreate}>
            Create campaign
          </Button>
        </div>
      }
    />
  );
}

function NewCampaignSkeleton() {
  return (
    <div className='flex min-h-0 flex-1 flex-col gap-5'>
      <BlockSkeleton className='h-64' />
      <BlockSkeleton className='h-52' />
      <BlockSkeleton className='h-80' />
    </div>
  );
}

export const handle: PageHandle = {
  skeleton: (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-5'>
      <NewCampaignHeader />
      <NewCampaignSkeleton />
    </div>
  ),
  live: false,
};
