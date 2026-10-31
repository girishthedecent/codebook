import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import { createLink, type LinkComponent } from '@tanstack/react-router';
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

const listClass = 'flex gap-4 border-b border-rule';

// Radix marks the open tab with data-state, the router marks the current page with data-status.
const tabClass =
  '-mb-px flex min-h-10 items-center border-b-2 border-transparent px-0.5 text-sm text-ink-2 max-sm:min-h-11 ' +
  'transition-colors duration-150 ease-out hover:text-ink disabled:opacity-50 ' +
  'data-[state=active]:border-ink data-[state=active]:text-ink ' +
  'data-[status=active]:border-ink data-[status=active]:text-ink';

/** Underlined tabs on a hairline. Panels are `<TabPanel value>` children. */
export function Tabs({ items, value, onValueChange, children, label, className }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RadixTabs.List aria-label={label} className={listClass}>
        {items.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className={tabClass}
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

/** Tabs that are pages: a nav landmark of `LinkTab`s, the current one underlined. */
export function LinkTabs({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(listClass, className)}>
      {children}
    </nav>
  );
}

const TabAnchor = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>(function TabAnchor(
  { className, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={cn(tabClass, className)} {...rest}>
      {children}
    </a>
  );
});

const RouterTab = createLink(TabAnchor);

/** Takes the same `to`, `params` and `search` as a router Link. */
export const LinkTab: LinkComponent<typeof TabAnchor> = (props) => <RouterTab {...props} />;
