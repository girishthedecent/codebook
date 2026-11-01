import { useStudyAttempts, type StudyAttempt } from '@/api/queries/study';
import { cn } from '@/lib/cn';
import { relativeDate } from './format';
import { s } from './strings';

const HEIGHT = 32;

/** The history under a result, once there is more than the attempt just made to compare. */
export function RecentAttempts({ studyId, className }: { studyId: string; className?: string }) {
  const attempts = useStudyAttempts(studyId);
  if (!attempts.data || attempts.data.length < 2) return null;
  return <AttemptHistory attempts={attempts.data} className={className} />;
}

/**
 * Recent attempts as a row of thin bars, oldest on the left, each as tall as its score; the
 * newest is drawn in the accent. Screen readers get the same list as text.
 */
export function AttemptHistory({
  attempts,
  className,
}: {
  /** Newest first, as the server sends them. */
  attempts: StudyAttempt[];
  className?: string;
}) {
  const oldestFirst = [...attempts].reverse();
  return (
    <figure className={cn('m-0', className)}>
      <ol aria-label={s.history.label} className="flex items-end gap-1" style={{ height: HEIGHT }}>
        {oldestFirst.map((a, i) => {
          const share = a.total > 0 ? a.score / a.total : 0;
          const newest = i === oldestFirst.length - 1;
          const text = s.history.item(a.score, a.total, relativeDate(a.createdAt));
          return (
            <li key={a.id} title={text} className="flex h-full w-2 items-end">
              <span
                aria-hidden
                className={cn('block w-full rounded-xs', newest ? 'bg-accent' : 'bg-edge')}
                // A zero still shows as a sliver, so the attempt is visibly there.
                style={{ height: Math.max(2, Math.round(share * HEIGHT)) }}
              />
              <span className="sr-only">{text}</span>
            </li>
          );
        })}
      </ol>
      <figcaption className="mt-1.5 text-xs text-ink-3">
        {s.history.caption(attempts.length)}
      </figcaption>
    </figure>
  );
}
