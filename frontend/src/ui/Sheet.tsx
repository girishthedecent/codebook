import type { ReactNode } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { Drawer } from 'vaul';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Desktop and tablet: which edge the panel comes from. */
  side?: 'right' | 'left';
  /** Panel width on desktop/tablet. */
  width?: number;
  className?: string;
};

/**
 * One API, two shapes: a side panel on wide screens, a draggable bottom drawer on phones.
 * The viewer and the add-source flow use it, so the choice lives here and nowhere else.
 */
export function Sheet(props: SheetProps) {
  const bp = useBreakpoint();
  return bp === 'phone' ? <BottomSheet {...props} /> : <SidePanel {...props} />;
}

function Header({
  title,
  description,
  close,
}: Pick<SheetProps, 'title' | 'description'> & { close: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">{title}</div>
        {description && <div className="mt-0.5 text-xs text-ink-3">{description}</div>}
      </div>
      {close}
    </div>
  );
}

const closeClass =
  '-mr-1.5 flex size-8 max-[719px]:size-10 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink';

function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = 'right',
  width = 480,
  className,
}: SheetProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content
          style={{ width: `min(${width}px, 100vw)` }}
          className={cn(
            'fixed inset-y-0 z-50 flex flex-col border-rule bg-paper shadow-float outline-none',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            className,
          )}
        >
          <RadixDialog.Title asChild>
            <span className="sr-only">{title}</span>
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="sr-only">{description}</RadixDialog.Description>
          )}
          <Header
            title={title}
            description={description}
            close={
              <RadixDialog.Close aria-label="Close" className={closeClass}>
                <X size={16} />
              </RadixDialog.Close>
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function BottomSheet({ open, onOpenChange, title, description, children, className }: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} snapPoints={[0.55, 1]} fadeFromIndex={0}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-2rem)] flex-col rounded-t-md border-t border-rule bg-paper outline-none',
            className,
          )}
        >
          <Drawer.Handle className="mx-auto mt-2 h-1 w-9 rounded-full bg-rule-2" />
          <Drawer.Title asChild>
            <span className="sr-only">{title}</span>
          </Drawer.Title>
          {description && (
            <Drawer.Description className="sr-only">{description}</Drawer.Description>
          )}
          <Header
            title={title}
            description={description}
            close={
              <Drawer.Close aria-label="Close" className={closeClass}>
                <X size={16} />
              </Drawer.Close>
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
