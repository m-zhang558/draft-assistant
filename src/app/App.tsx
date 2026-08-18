import { localJsonSource } from '@/data/sources';
import type { Format } from '@/domain';
import { PlayerList } from '@/features/board';

/**
 * Phase 1 has no format switcher (that's item 2.8) — render one format so the data layer
 * has something real to show.
 */
const PHASE_1_FORMAT: Format = 'redraft-ppr';

const FORMAT_LABELS: Record<Format, string> = {
  'redraft-ppr': 'Redraft PPR',
  'dynasty-sf': 'Dynasty Superflex',
};

export function App() {
  const dataset = localJsonSource.load(PHASE_1_FORMAT);
  const { provenance } = dataset;

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold text-text-primary">Fantasy Assist</h1>
        <div aria-hidden="true" />
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
        <section
          aria-labelledby="dataset-summary-heading"
          className="rounded-md border border-border bg-surface p-4"
        >
          <h2 id="dataset-summary-heading" className="text-lg font-medium text-text-primary">
            {FORMAT_LABELS[dataset.format]} — {dataset.players.length} players
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-text-muted sm:grid-cols-3">
            <div>
              <dt className="font-medium text-text-primary">Source</dt>
              <dd>{provenance.source}</dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">Season</dt>
              <dd>{provenance.season}</dd>
            </div>
            <div>
              <dt className="font-medium text-text-primary">Retrieved</dt>
              <dd>{provenance.retrievedAt}</dd>
            </div>
          </dl>
        </section>
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <PlayerList players={dataset.players} />
        </div>
      </main>
    </div>
  );
}
