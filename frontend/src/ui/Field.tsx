import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Label } from 'radix-ui';
import { cn } from '@/lib/cn';

type FieldContext = { id: string; hintId?: string; errorId?: string; invalid: boolean };
const Ctx = createContext<FieldContext | null>(null);

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Shown after the label in the muted color, e.g. "optional". */
  note?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint/error, wired together with ids so screen readers read all of it. */
export function Field({ label, hint, error, note, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Ctx.Provider value={{ id, hintId, errorId, invalid: Boolean(error) }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <Label.Root htmlFor={id} className="text-xs font-medium text-ink">
          {label}
          {note && <span className="ml-1.5 font-normal text-ink-3">{note}</span>}
        </Label.Root>
        {children}
        {error ? (
          <p id={errorId} className="text-xs text-error">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-ink-3">
            {hint}
          </p>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

function useControlProps() {
  const ctx = useContext(Ctx);
  if (!ctx) return {};
  return {
    id: ctx.id,
    'aria-describedby': ctx.errorId ?? ctx.hintId,
    'aria-invalid': ctx.invalid || undefined,
  };
}

export const controlClass =
  'w-full rounded-sm border border-rule-2 bg-paper px-3 text-sm text-ink placeholder:text-ink-3 ' +
  'transition-colors duration-150 ease-out hover:border-ink-3 focus:border-accent focus:outline-none ' +
  'aria-invalid:border-error disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(controlClass, 'h-9', className)}
        {...useControlProps()}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(controlClass, 'resize-y py-2 leading-normal', className)}
      {...useControlProps()}
      {...rest}
    />
  );
});
