/**
 * Default `RankingSource` adapter: statically imports the checked-in JSON datasets
 * (`src/data/rankings/*.json`) and validates each through `parseRankingDataset` at load.
 * A corrupt or malformed dataset throws — there is no try/catch here to swallow it.
 */
import redraftPprRaw from '@/data/rankings/redraft-ppr-2026.json';
import dynastySfRaw from '@/data/rankings/dynasty-sf-2026.json';
import type { Format } from '@/domain';
import type { RankingDataset, RankingSource } from './ranking-source';
import { parseRankingDataset } from './validate-dataset';

const redraftPprDataset = parseRankingDataset(redraftPprRaw, 'redraft-ppr');
const dynastySfDataset = parseRankingDataset(dynastySfRaw, 'dynasty-sf');

const datasetsByFormat: Record<Format, RankingDataset> = {
  'redraft-ppr': redraftPprDataset,
  'dynasty-sf': dynastySfDataset,
};

export const localJsonSource: RankingSource = {
  load(format) {
    return datasetsByFormat[format];
  },
};
