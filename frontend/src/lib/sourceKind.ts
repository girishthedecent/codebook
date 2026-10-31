import { BookOpen, GitBranch, Globe, type Icon } from '@phosphor-icons/react';
import type { SourceType } from '@/api/types';

export type SourceKind = 'book' | 'repo' | 'site';

type KindMeta = { kind: SourceKind; label: string; Icon: Icon };

const kinds: Record<SourceType, KindMeta> = {
  PDF: { kind: 'book', label: 'Book', Icon: BookOpen },
  GITHUB_REPO: { kind: 'repo', label: 'Repository', Icon: GitBranch },
  WEBSITE: { kind: 'site', label: 'Website', Icon: Globe },
};

/** What to call a source and which glyph stands for it. The tone is the `kind-*` colour. */
export function sourceKind(type: SourceType): KindMeta {
  return kinds[type];
}
