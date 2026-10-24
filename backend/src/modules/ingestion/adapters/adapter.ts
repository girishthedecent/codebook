import type { IngestStage } from '../../../generated/prisma/client.js';
import type { findIngestSource } from '../ingestion.repository.js';
import type {
  DraftDocument,
  DraftGraph,
  RepoDraftStats,
  WebsiteDraftStats,
} from '../ingestion.types.js';

export type IngestSource = NonNullable<Awaited<ReturnType<typeof findIngestSource>>>;

export type AdapterContext = {
  stage(stage: IngestStage, progress: number): Promise<unknown>;
  // True when the source's last complete ingest had this hash and nothing is missing.
  unchanged(contentHash: string): boolean;
};

/**
 * What a source type's adapter makes of a source in the prepare step. `failed` carries a
 * message for the user; such failures aren't retried.
 */
export type AdapterResult =
  | { outcome: 'failed'; error: string }
  | { outcome: 'unchanged' }
  | {
      outcome: 'draft';
      contentHash: string;
      documents: DraftDocument[];
      repo?: RepoDraftStats;
      graph?: DraftGraph;
      website?: WebsiteDraftStats;
      // A new title for the source (a website's page title), used from this run on.
      title?: string;
    };
