import { forwardRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef } from 'react';
import { createLink, type LinkComponent } from '@tanstack/react-router';
import { cn } from '@/lib/cn';

/** For anchors that can't be router links, such as the prerendered landing page. */
export const textLinkClass = 'text-accent underline underline-offset-2 hover:text-accent-2';

const Anchor = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>(function Anchor(
  { className, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={cn(textLinkClass, className)} {...rest}>
      {children}
    </a>
  );
});

const RouterAnchor = createLink(Anchor);

/** An accent, underlined link. Takes the same `to`, `params` and `search` as a router Link. */
export const TextLink: LinkComponent<typeof Anchor> = (props) => <RouterAnchor {...props} />;

/** The same look on a button, for an action that doesn't go anywhere. */
export const TextButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function TextButton({ className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(textLinkClass, 'disabled:opacity-50', className)}
        {...rest}
      />
    );
  },
);
