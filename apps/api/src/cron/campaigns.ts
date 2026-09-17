import { reconcileCampaigns } from '@buzzkit/api/api/campaigns/index';
import { sweep } from './sweep';

const SWEEP_LIMIT = 200;

export async function advanceCampaigns(): Promise<void> {
  await sweep('campaigns', (db) => reconcileCampaigns(db, SWEEP_LIMIT));
}
