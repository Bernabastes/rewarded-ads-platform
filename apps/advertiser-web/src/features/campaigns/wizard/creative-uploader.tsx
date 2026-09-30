import { zodResolver } from '@hookform/resolvers/zod';
import { UPLOAD_LIMITS, type AdSummary, type CampaignDetail, type MediaType } from '@rap/shared';
import { CheckCircle2, FileVideo, ImageIcon, Plus, Trash2, UploadCloud, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { UploadIllustration } from '@/components/feedback/illustrations';
import { Alert } from '@/components/ui/alert';
import { ReviewStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { uploadCreative, type UploadProgress } from '@/lib/api/upload';
import { useAddAd, useRemoveAd } from '@/features/campaigns/hooks';
import { AdPreview, CreativePreview } from '@/features/campaigns/creative-preview';
import { MediaProbeDetails, MediaStatusBadge } from '@/features/campaigns/media-status';
import { handleFormError, toastApiError } from '@/lib/forms';
import { cn } from '@/lib/utils/cn';
import { formatBytes, formatDuration } from '@/lib/utils/format';
import { readVideoDuration, validateCreativeFile } from '@/lib/utils/media';
import { creativeSchema, type CreativeValues } from './schemas';

const ACCEPT = [...UPLOAD_LIMITS.video.mimeTypes, ...UPLOAD_LIMITS.image.mimeTypes].join(',');
const VIDEO_MAX_MB = Math.round(UPLOAD_LIMITS.video.maxBytes / (1024 * 1024));
const IMAGE_MAX_MB = Math.round(UPLOAD_LIMITS.image.maxBytes / (1024 * 1024));

interface SelectedFile {
  file: File;
  mediaType: MediaType;
  objectUrl: string;
  detectedDurationSeconds: number | null;
}

type UploadPhase =
  { kind: 'idle' } | { kind: 'uploading'; progress: UploadProgress } | { kind: 'registering' };

export function CreativeUploader({
  campaign,
  onAdded,
}: {
  campaign: CampaignDetail;
  onAdded?: (ad: AdSummary) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const addAd = useAddAd();

  const form = useForm<CreativeValues>({
    resolver: zodResolver(creativeSchema),
    defaultValues: { title: '', description: '', durationSeconds: 15, attentionQuestion: null },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, reset, control, setValue } = form;
  const question = useWatch({ control, name: 'attentionQuestion' });
  const liveTitle = useWatch({ control, name: 'title' });

  useEffect(
    () => () => {
      if (selected) URL.revokeObjectURL(selected.objectUrl);
    },
    [selected],
  );

  const chooseFile = async (file: File) => {
    setFileError(null);
    const validation = validateCreativeFile(file);
    if (!validation.ok || !validation.mediaType) {
      setFileError(validation.reason ?? 'Unsupported file');
      return;
    }
    let detected: number | null = null;
    if (validation.mediaType === 'video') {
      try {
        detected = await readVideoDuration(file);
        if (detected > UPLOAD_LIMITS.video.maxDurationSeconds) {
          setFileError(
            `This video is ${formatDuration(detected)} long. Creatives must be ${UPLOAD_LIMITS.video.maxDurationSeconds} seconds or shorter.`,
          );
          return;
        }
        if (detected < 5) {
          setFileError('This video is shorter than 5 seconds.');
          return;
        }
      } catch (error) {
        setFileError(error instanceof Error ? error.message : 'Could not read the video.');
        return;
      }
    }
    if (selected) URL.revokeObjectURL(selected.objectUrl);
    setSelected({
      file,
      mediaType: validation.mediaType,
      objectUrl: URL.createObjectURL(file),
      detectedDurationSeconds: detected,
    });
    reset({
      title:
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .trim()
          .slice(0, 160) || 'Creative',
      description: '',
      durationSeconds: detected ?? 10,
      attentionQuestion: campaign.attentionCheckEnabled
        ? { prompt: '', promptAm: '', options: ['', ''], correctIndex: 0 }
        : null,
    });
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void chooseFile(file);
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (selected) URL.revokeObjectURL(selected.objectUrl);
    setSelected(null);
    setPhase({ kind: 'idle' });
    setFileError(null);
    reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  const onValid = async (values: CreativeValues) => {
    if (!selected) return;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase({ kind: 'uploading', progress: { loaded: 0, total: selected.file.size, ratio: 0 } });
      const uploaded = await uploadCreative(selected.file, {
        signal: controller.signal,
        onProgress: (progress) => setPhase({ kind: 'uploading', progress }),
      });
      setPhase({ kind: 'registering' });
      const ad = await addAd.mutateAsync({
        campaignId: campaign.id,
        dto: {
          title: values.title,
          description: values.description || undefined,
          storageKey: uploaded.storageKey,
          mediaType: uploaded.mediaType,
          durationSeconds: values.durationSeconds,
          attentionQuestions: values.attentionQuestion
            ? [
                {
                  prompt: values.attentionQuestion.prompt,
                  promptAm: values.attentionQuestion.promptAm || undefined,
                  options: values.attentionQuestion.options,
                  correctIndex: values.attentionQuestion.correctIndex,
                },
              ]
            : undefined,
        },
      });
      toast.success('Creative added', {
        description:
          ad.mediaType === 'video' && ad.mediaStatus === 'processing'
            ? `“${ad.title}” is being processed (duration check, 720p transcode, poster) — usually under a minute.`
            : `“${ad.title}” is queued for review with the campaign.`,
      });
      onAdded?.(ad);
      cancel();
    } catch (error) {
      setPhase({ kind: 'idle' });
      if (error instanceof DOMException && error.name === 'AbortError') return;
      handleFormError(error, form);
    }
  };

  // Call handleSubmit inside the event so the validated callback (which touches refs) never runs during render.
  const submit = (event: FormEvent<HTMLFormElement>) => void handleSubmit(onValid)(event);

  const busy = phase.kind !== 'idle';

  if (!selected) {
    return (
      <div className="flex flex-col gap-3">
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging
              ? 'border-primary bg-primary-soft'
              : 'border-border-strong bg-surface-muted/40 hover:border-primary/60 hover:bg-surface-muted',
          )}
        >
          <UploadIllustration className="h-auto w-36" />
          <span className="text-base font-semibold text-fg">
            Drag & drop your creative, or{' '}
            <span className="text-primary underline-offset-4 hover:underline">browse</span>
          </span>
          <span className="max-w-md text-sm text-fg-muted">
            Video: MP4 or WebM, up to {VIDEO_MAX_MB} MB and {UPLOAD_LIMITS.video.maxDurationSeconds} seconds.
            Image: JPEG, PNG or WebP up to {IMAGE_MAX_MB} MB. Vertical 9:16 or square creatives perform best
            in the app.
          </span>
          <span className="inline-flex items-center gap-2 text-xs text-fg-subtle">
            <FileVideo className="size-4" /> mp4 · webm <span aria-hidden="true">·</span>{' '}
            <ImageIcon className="size-4" /> jpg · png · webp
          </span>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void chooseFile(file);
            }}
          />
        </label>
        {fileError && <Alert tone="danger">{fileError}</Alert>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-5" aria-label="Creative details">
      <div className="flex flex-col gap-3 lg:col-span-2">
        <CreativePreview
          src={selected.objectUrl}
          mediaType={selected.mediaType}
          title={liveTitle || selected.file.name}
        />
        <div className="flex items-center justify-between gap-3 text-xs text-fg-subtle">
          <span className="truncate">
            {selected.file.name} · {formatBytes(selected.file.size)}
            {selected.detectedDurationSeconds !== null &&
              ` · ${formatDuration(selected.detectedDurationSeconds)}`}
          </span>
          {!busy && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancel}
              leadingIcon={<X className="size-4" />}
            >
              Replace
            </Button>
          )}
        </div>
        {phase.kind !== 'idle' && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-fg">
                {phase.kind === 'uploading' ? 'Uploading to secure storage…' : 'Registering creative…'}
              </span>
              <span className="tabular-nums text-fg-muted">
                {phase.kind === 'uploading' ? `${Math.round(phase.progress.ratio * 100)}%` : '100%'}
              </span>
            </div>
            <Progress
              value={phase.kind === 'uploading' ? phase.progress.ratio : 1}
              size="sm"
              label="Upload progress"
            />
            {phase.kind === 'uploading' && (
              <Button type="button" variant="ghost" size="sm" className="self-end" onClick={cancel}>
                Cancel upload
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:col-span-3">
        {formState.errors.root?.server && <Alert tone="danger">{formState.errors.root.server.message}</Alert>}
        <Field
          label="Creative title"
          required
          error={formState.errors.title?.message}
          hint="Internal name, also used as the accessible description of the media."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={busy}
              {...register('title')}
            />
          )}
        </Field>
        <Field
          label="Description"
          error={formState.errors.description?.message}
          hint={
            selected.mediaType === 'image'
              ? 'Describe the image for viewers who use a screen reader.'
              : 'Optional notes for the reviewers.'
          }
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={2}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={busy}
              {...register('description')}
            />
          )}
        </Field>
        <Field
          label={selected.mediaType === 'video' ? 'Duration (seconds)' : 'Viewing time (seconds)'}
          required
          error={formState.errors.durationSeconds?.message}
          hint={
            selected.mediaType === 'video'
              ? 'Read from the file. Viewers must watch at least 90% of it, server-timed.'
              : 'How long the image is shown before the viewer can continue (5–120 seconds).'
          }
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="number"
              min={5}
              max={UPLOAD_LIMITS.video.maxDurationSeconds}
              step={1}
              className="max-w-40 tabular-nums"
              aria-describedby={describedBy}
              invalid={invalid}
              readOnly={selected.mediaType === 'video' && selected.detectedDurationSeconds !== null}
              disabled={busy}
              {...register('durationSeconds', { valueAsNumber: true })}
            />
          )}
        </Field>

        {campaign.attentionCheckEnabled && question && (
          <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-fg">Attention question</legend>
            <p className="-mt-2 text-sm text-fg-muted">
              Asked right after the ad. Only viewers who answer correctly are counted — and charged.
            </p>
            <Field
              label="Question (English)"
              required
              error={formState.errors.attentionQuestion?.prompt?.message}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  placeholder="Which product was shown in the video?"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  disabled={busy}
                  {...register('attentionQuestion.prompt')}
                />
              )}
            </Field>
            <Field
              label="Question (Amharic)"
              error={formState.errors.attentionQuestion?.promptAm?.message}
              hint="Optional but recommended — most viewers use the app in Amharic."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  lang="am"
                  placeholder="በቪዲዮው ላይ የታየው ምርት ምንድን ነው?"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  disabled={busy}
                  {...register('attentionQuestion.promptAm')}
                />
              )}
            </Field>
            <div
              className="flex flex-col gap-2"
              role="radiogroup"
              aria-label="Answer options; select the correct one"
            >
              <p className="text-sm font-medium text-fg">
                Answers <span className="font-normal text-fg-subtle">— select the correct one</span>
              </p>
              {question.options.map((_option, index) => {
                const error = formState.errors.attentionQuestion?.options?.[index]?.message;
                return (
                  <div key={index} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="correctIndex"
                      className="mt-3 size-4 accent-[var(--primary)]"
                      checked={question.correctIndex === index}
                      onChange={() =>
                        setValue('attentionQuestion.correctIndex', index, { shouldValidate: true })
                      }
                      aria-label={`Option ${index + 1} is the correct answer`}
                      disabled={busy}
                    />
                    <div className="flex-1">
                      <Input
                        placeholder={`Option ${index + 1}`}
                        aria-label={`Option ${index + 1}`}
                        invalid={!!error}
                        disabled={busy}
                        {...register(`attentionQuestion.options.${index}` as const)}
                      />
                      {error && (
                        <p role="alert" className="mt-1 text-sm text-danger">
                          {error}
                        </p>
                      )}
                    </div>
                    {question.options.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove option ${index + 1}`}
                        disabled={busy}
                        onClick={() => {
                          const next = question.options.filter((_, i) => i !== index);
                          setValue('attentionQuestion.options', next, { shouldValidate: true });
                          if (question.correctIndex >= next.length)
                            setValue('attentionQuestion.correctIndex', 0);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
              {formState.errors.attentionQuestion?.correctIndex?.message && (
                <p role="alert" className="text-sm text-danger">
                  {formState.errors.attentionQuestion.correctIndex.message}
                </p>
              )}
              {question.options.length < 4 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={busy}
                  onClick={() => setValue('attentionQuestion.options', [...question.options, ''])}
                  leadingIcon={<Plus className="size-4" />}
                >
                  Add option
                </Button>
              )}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} leadingIcon={<UploadCloud className="size-4" />}>
            Upload & add creative
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ExistingCreatives({ campaign }: { campaign: CampaignDetail }) {
  const removeAd = useRemoveAd();
  if (campaign.ads.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {campaign.ads.map((ad) => (
        <li key={ad.id} className="flex gap-3 rounded-md border border-border p-3">
          <div className="w-32 shrink-0">
            <AdPreview ad={ad} compact />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-medium text-fg">{ad.title}</p>
              <ReviewStatusBadge status={ad.reviewStatus} />
            </div>
            <p className="text-xs text-fg-subtle">
              {formatDuration(ad.durationSeconds)} · {ad.attentionQuestionsCount} question
              {ad.attentionQuestionsCount === 1 ? '' : 's'}
            </p>
            {ad.mediaType === 'video' && (
              <div>
                <MediaStatusBadge status={ad.mediaStatus} size="sm" />
              </div>
            )}
            <MediaProbeDetails ad={ad} compact />
            {ad.rejectionReason && <p className="text-xs text-danger">{ad.rejectionReason}</p>}
            {ad.reviewStatus === 'approved' ? (
              <span className="mt-auto inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" /> Approved
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-auto self-start text-danger hover:bg-danger/10 hover:text-danger"
                loading={removeAd.isPending && removeAd.variables?.adId === ad.id}
                onClick={() =>
                  removeAd
                    .mutateAsync({ campaignId: campaign.id, adId: ad.id })
                    .then(() => toast.success('Creative removed'))
                    .catch(toastApiError)
                }
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
