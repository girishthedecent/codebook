import { createContext, use, type ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { cn } from '@/lib/cn';

const Grouped = createContext(false);

function Delays({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

/**
 * Optional: tooltips below share one delay, so moving between neighbours opens the next at once.
 * Without it each tooltip brings its own, which keeps the Radix tooltip code out of the first
 * load of pages that have none.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Grouped value>
      <Delays>{children}</Delays>
    </Grouped>
  );
}

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
};

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const grouped = use(Grouped);
  const tip = (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 max-w-[320px] rounded-sm border border-rule bg-paper px-2.5 py-1.5 text-xs text-ink shadow-float',
            'data-[state=delayed-open]:animate-[fade-in_120ms_ease-out]',
            className,
          )}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
  return grouped ? tip : <Delays>{tip}</Delays>;
}
