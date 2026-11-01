import { ProgressRule, Skeleton } from '@/ui';
import { cn } from '@/lib/cn';
import { shellStrings } from './strings';

type Presentation = 'pane' | 'panel' | 'sheet';

/**
 * Holds the viewer's place while its code loads: the same frame and header height, so the
 * page beside it doesn't move when the real pane arrives.
 */
export function ViewerFallback({ presentation }: { presentation: Presentation }) {
  const body = (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <Skeleton className="h-4 w-40" />
      </header>
      <ProgressRule label={shellStrings.viewerLoading} />
      <div className="min-h-0 flex-1 overflow-hidden p-5">
        <Skeleton className="mx-auto aspect-[3/4] w-full max-w-[420px]" />
      </div>
    </>
  );

  if (presentation === 'sheet') {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-overlay" />
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[55dvh] flex-col rounded-t-md border-t border-rule bg-paper">
          {body}
        </div>
      </>
    );
  }
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col bg-paper',
        presentation === 'pane' && 'sticky top-0 h-dvh',
        presentation === 'panel' &&
          'fixed inset-y-0 right-0 z-30 w-[min(520px,calc(100vw-4rem))] border-l border-rule shadow-float',
      )}
    >
      {body}
    </section>
  );
}
