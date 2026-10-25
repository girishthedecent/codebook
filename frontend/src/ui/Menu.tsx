import type { ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { floatingClass } from './Popover';
import { Kbd } from './Kbd';

export type MenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

export function Menu({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  open,
  onOpenChange,
  className,
}: MenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(floatingClass, 'min-w-[180px]', className)}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const itemClass =
  'flex min-h-8 max-[719px]:min-h-10 cursor-default select-none items-center gap-2 rounded-xs px-2 text-sm text-ink outline-none ' +
  'data-[highlighted]:bg-paper-2 data-[disabled]:opacity-50 data-[disabled]:pointer-events-none';

export type MenuItemProps = {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Keyboard hint shown on the right, e.g. "⌘K". */
  shortcut?: string;
  /** Red text for destructive actions. */
  danger?: boolean;
  icon?: ReactNode;
};

export function MenuItem({ children, onSelect, disabled, shortcut, danger, icon }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(itemClass, danger && 'text-error data-[highlighted]:bg-error-wash')}
    >
      {icon && <span className="flex size-4 items-center justify-center text-ink-3">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </DropdownMenu.Item>
  );
}

export function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
  disabled,
}: {
  children: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(itemClass, 'pl-7')}
    >
      <DropdownMenu.ItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <Check size={14} weight="bold" />
      </DropdownMenu.ItemIndicator>
      <span className="relative flex-1">{children}</span>
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-xs text-ink-3">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-rule" />;
}
