import type { ReactNode } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { VisuallyHidden } from './VisuallyHidden';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Read by screen readers; shown unless `hideDescription`. */
  description?: ReactNode;
  hideDescription?: boolean;
  children: ReactNode;
  /** Footer row, usually two buttons; right-aligned. */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const widths = { sm: 'max-w-[400px]', md: 'max-w-[520px]', lg: 'max-w-[720px]' };

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  hideDescription,
  children,
  actions,
  size = 'md',
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-x-4 top-[12vh] z-50 mx-auto flex max-h-[76vh] flex-col rounded-md border border-rule bg-paper shadow-float outline-none',
            'data-[state=open]:animate-[fade-in_150ms_ease-out]',
            widths[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4">
            <div>
              <RadixDialog.Title className="text-base font-semibold text-ink">
                {title}
              </RadixDialog.Title>
              {description &&
                (hideDescription ? (
                  <VisuallyHidden>
                    <RadixDialog.Description>{description}</RadixDialog.Description>
                  </VisuallyHidden>
                ) : (
                  <RadixDialog.Description className="mt-1 text-sm text-ink-2">
                    {description}
                  </RadixDialog.Description>
                ))}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-2 -mt-1 flex size-8 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <X size={16} />
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4 text-sm">{children}</div>
          {actions && (
            <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">{actions}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
