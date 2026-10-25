import type { ReactNode } from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import { cn } from '@/lib/cn';

export type TabItem = { value: string; label: ReactNode; disabled?: boolean };

export type TabsProps = {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
};

/** Underlined tabs on a hairline. Panels are `<TabPanel value>` children. */
export function Tabs({ items, value, onValueChange, children, label, className }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RadixTabs.List aria-label={label} className="flex gap-4 border-b border-rule">
        {items.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className={cn(
              '-mb-px flex min-h-10 items-center border-b-2 border-transparent px-0.5 text-sm text-ink-2 outline-none',
              'transition-colors duration-150 ease-out hover:text-ink',
              'data-[state=active]:border-ink data-[state=active]:text-ink disabled:opacity-50',
            )}
          >
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixTabs.Content value={value} className={cn('pt-4 outline-none', className)}>
      {children}
    </RadixTabs.Content>
  );
}
