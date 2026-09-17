import { Button } from '@buzzkit/ui/components/button';
import { EmptyState } from '@buzzkit/ui/components/empty-state';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@buzzkit/ui/components/field';
import { Input } from '@buzzkit/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@buzzkit/ui/components/select';
import { Textarea } from '@buzzkit/ui/components/textarea';
import { Link, useParams } from 'react-router';
import { InputSkeleton } from '@/app/components/loading/field';

export type CampaignChoices = {
  topics: Array<{ slug: string; name: string }>;
  segments: Array<{ slug: string; name: string }>;
};

export type CampaignDraft = {
  topic: string;
  segment: string;
  title: string;
  body: string;
  imageUrl: string;
  deepLink: string;
  throttlePerMinute: string;
};

export const EMPTY_CAMPAIGN: CampaignDraft = {
  topic: '',
  segment: '',
  title: '',
  body: '',
  imageUrl: '',
  deepLink: '',
  throttlePerMinute: '',
};

export function isCampaignReady(draft: CampaignDraft): boolean {
  return draft.topic.length > 0 && (draft.title.trim().length > 0 || draft.body.trim().length > 0);
}

export function AudienceFields({
  choices,
  draft,
  onChange,
}: {
  choices: CampaignChoices | undefined;
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
}) {
  const params = useParams();

  if (choices === undefined) {
    return (
      <FieldGroup className='p-4'>
        <Field>
          <FieldLabel>Topic</FieldLabel>
          <InputSkeleton />
        </Field>
        <Field>
          <FieldLabel>Segment</FieldLabel>
          <InputSkeleton />
        </Field>
      </FieldGroup>
    );
  }

  if (choices.topics.length === 0) {
    return (
      <EmptyState
        size='sm'
        icon='IconTagFilled'
        title='No topics yet'
        description='Create a topic and this campaign can send to the subscribers opted in to it.'
        className='py-8'
      >
        <Button
          variant='soft'
          size='sm'
          icon='IconPlusMedium'
          nativeButton={false}
          render={<Link to={`/${params.slug}/topics`} />}
        >
          Create topic
        </Button>
      </EmptyState>
    );
  }

  return (
    <FieldGroup className='p-4'>
      <Field>
        <FieldLabel htmlFor='campaign-topic'>Topic</FieldLabel>
        <Select
          items={choices.topics.map((entry) => ({ value: entry.slug, label: entry.name }))}
          value={draft.topic}
          onValueChange={(value) => onChange({ topic: String(value) })}
        >
          <SelectTrigger id='campaign-topic' className='w-full'>
            <SelectValue placeholder='Choose a topic' />
          </SelectTrigger>
          <SelectContent>
            {choices.topics.map((entry) => (
              <SelectItem key={entry.slug} value={entry.slug}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Only subscribers opted in to this topic receive the campaign.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='campaign-segment'>Segment</FieldLabel>
        <Select
          items={[
            { value: '', label: 'Everyone opted in' },
            ...choices.segments.map((entry) => ({ value: entry.slug, label: entry.name })),
          ]}
          value={draft.segment}
          onValueChange={(value) => onChange({ segment: String(value) })}
        >
          <SelectTrigger id='campaign-segment' className='w-full'>
            <SelectValue placeholder='Everyone opted in' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=''>Everyone opted in</SelectItem>
            {choices.segments.map((entry) => (
              <SelectItem key={entry.slug} value={entry.slug}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Narrows the topic to the subscribers a segment matches.</FieldDescription>
      </Field>
    </FieldGroup>
  );
}

export function NotificationFields({
  draft,
  onChange,
}: {
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
}) {
  return (
    <FieldGroup className='p-4'>
      <Field>
        <FieldLabel htmlFor='campaign-title'>Title</FieldLabel>
        <Input
          id='campaign-title'
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder='A new story tonight'
          maxLength={500}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor='campaign-body'>Body</FieldLabel>
        <Textarea
          id='campaign-body'
          value={draft.body}
          onChange={(event) => onChange({ body: event.target.value })}
          placeholder='Tap to start listening.'
          maxLength={4000}
          rows={3}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor='campaign-image'>Image</FieldLabel>
        <Input
          id='campaign-image'
          value={draft.imageUrl}
          onChange={(event) => onChange({ imageUrl: event.target.value })}
          placeholder='https://cdn.example.com/cover.png'
          autoComplete='off'
          spellCheck={false}
        />
        <FieldDescription>Shown as rich media on the notification.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='campaign-deeplink'>Deep link</FieldLabel>
        <Input
          id='campaign-deeplink'
          value={draft.deepLink}
          onChange={(event) => onChange({ deepLink: event.target.value })}
          placeholder='app://books/42'
          autoComplete='off'
          spellCheck={false}
        />
        <FieldDescription>Opened by the app when the notification is tapped.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='campaign-throttle'>Deliveries per minute</FieldLabel>
        <Input
          id='campaign-throttle'
          value={draft.throttlePerMinute}
          onChange={(event) => onChange({ throttlePerMinute: event.target.value.replace(/[^0-9]/g, '') })}
          placeholder='No limit'
          inputMode='numeric'
          autoComplete='off'
        />
        <FieldDescription>
          Paces the send so a large audience does not reach the providers at once. Leave it empty to send as
          fast as the queue allows.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
