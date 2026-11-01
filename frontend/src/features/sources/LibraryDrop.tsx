import { useEffect, useEffectEvent, useState } from 'react';
import { strings } from './strings';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/**
 * Files dragged anywhere over the library: the page dims and a sheet of paper says where they
 * go. Drops that something else already took (the add dialog's own zone) are left alone.
 */
export function LibraryDrop({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const take = useEffectEvent((files: File[]) => onFiles(files));

  useEffect(() => {
    if (disabled) return;
    // Entering a child fires dragleave on the parent, so count the way in and the way out.
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overPage = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      depth = 0;
      setOver(false);
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      take([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overPage);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overPage);
      window.removeEventListener('drop', drop);
    };
  }, [disabled]);

  if (!over || disabled) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-overlay p-6 motion-safe:animate-[fade-in_120ms_ease-out]"
    >
      <div className="w-full max-w-md -rotate-1 rounded-xs bg-paper px-8 py-10 text-center shadow-float outline-2 -outline-offset-8 outline-edge outline-dashed">
        <p className="heading-section text-ink">{strings.drop.title}</p>
        <p className="mt-2 font-serif text-base text-ink-2">{strings.drop.body}</p>
      </div>
    </div>
  );
}
