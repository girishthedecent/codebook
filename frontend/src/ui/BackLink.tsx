import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { createLink, type LinkComponent } from '@tanstack/react-router';
import { ArrowLeft } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

const Anchor = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>(function Anchor(
  { children, className, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      {...rest}
      className={cn(
        '-ml-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-sm px-1.5 text-sm text-ink-2 hover:text-ink max-[719px]:min-h-11',
        className,
      )}
    >
      <ArrowLeft size={14} aria-hidden className="shrink-0" />
      {children}
    </a>
  );
});

const RouterAnchor = createLink(Anchor);

/**
 * The way up one level from a page that has a parent list. Always names where it goes, and
 * is a full-height tap target on phones. Takes the same `to` and `params` as a Link.
 */
export const BackLink: LinkComponent<typeof Anchor> = (props) => <RouterAnchor {...props} />;
