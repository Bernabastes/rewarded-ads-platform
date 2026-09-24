import type { CampaignDetail } from '@rap/shared';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/primitives';
import { CreativeUploader, ExistingCreatives } from './creative-uploader';
import { creativeRequired } from './machine';

export function CreativeStep({ campaign, onBack, onContinue }: { campaign: CampaignDetail; onBack: () => void; onContinue: () => void }) {
  const required = creativeRequired(campaign.targetActionType);
  const hasAds = campaign.ads.length > 0;
  const canContinue = hasAds || !required;

  return (
    <div className="flex flex-col gap-6">
      {!required && (
        <Alert tone="info" title="Creatives are optional for this campaign type">
          Surveys and app-install offers are set up with our team after review. Attach a video or image only if you want viewers to see it
          before they start.
        </Alert>
      )}
      {hasAds && (
        <section className="flex flex-col gap-3" aria-labelledby="existing-creatives">
          <h3 id="existing-creatives" className="text-sm font-semibold text-fg">
            Added creatives ({campaign.ads.length})
          </h3>
          <ExistingCreatives campaign={campaign} />
        </section>
      )}
      <section className="flex flex-col gap-3" aria-labelledby="add-creative">
        <h3 id="add-creative" className="text-sm font-semibold text-fg">
          {hasAds ? 'Add another creative' : 'Upload a creative'}
        </h3>
        <CreativeUploader campaign={campaign} />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack} leadingIcon={<ArrowLeft className="size-4" />}>
          Back
        </Button>
        <Tooltip content={canContinue ? 'Review your campaign' : 'Video campaigns need at least one creative'}>
          <span>
            <Button type="button" size="lg" onClick={onContinue} disabled={!canContinue} trailingIcon={<ArrowRight className="size-4" />}>
              {hasAds || required ? 'Continue to review' : 'Skip and review'}
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
