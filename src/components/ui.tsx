// Shared primitives. Same shapes (and Tailwind zinc/sky palette) as the
// sql-kai reference — see lib/themes.ts for how a theme re-colours them.
import clsx from "clsx";
import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

export const cn = clsx;

/** Full-screen dimmed backdrop; a mousedown on it (not its content) closes.
 *  Opt into `closeOnEsc` for dialogs that should also dismiss on Escape —
 *  saves each consumer hand-rolling the same keydown listener. */
export function Overlay({
  onClose,
  className,
  closeOnEsc = false,
  children,
}: {
  onClose: () => void;
  /** Vertical alignment + dim level, e.g. "items-center bg-black/60". */
  className?: string;
  closeOnEsc?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!closeOnEsc) return;
    // Capture phase + stopPropagation so an editor underneath the dialog
    // doesn't also react to the same Escape.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [closeOnEsc, onClose]);
  return (
    <div
      className={cn("fixed inset-0 z-50 flex justify-center", className)}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

/** Dropdown anchored to its trigger; closes on outside click / Esc. */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = "left",
  panelClassName,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  panelClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div
          className={cn(
            "absolute top-full z-40 mt-1 rounded-md border border-zinc-700",
            "bg-zinc-900 shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

type ButtonVariant = "primary" | "ghost" | "danger";

export function Button({
  variant = "ghost",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
        "disabled:opacity-40 disabled:pointer-events-none",
        variant === "primary" &&
          "bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-600",
        variant === "ghost" &&
          "text-zinc-300 hover:bg-zinc-800 active:bg-zinc-700/80",
        variant === "danger" &&
          "bg-red-600/90 text-white hover:bg-red-500 active:bg-red-600",
        className,
      )}
      {...props}
    />
  );
}

/** Toolbar dropdown trigger: label with a trailing chevron. */
export function MenuButton({
  className,
  children,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-zinc-400",
        "transition-colors hover:bg-zinc-700/60 hover:text-zinc-100",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown size={11} className="text-zinc-600" />
    </button>
  );
}

export function IconButton({
  className,
  title,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 text-zinc-400",
        "hover:bg-zinc-700/60 hover:text-zinc-100 transition-colors",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      // no macOS autocorrect/keychain popovers by default — every Input in
      // the app holds technical values; callers can override via props
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      className={cn(
        "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[13px]",
        "text-zinc-100 placeholder:text-zinc-600",
        "focus:border-sky-600 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-[11px] text-zinc-400 mb-1", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Keyboard shortcut chip. */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "rounded border border-zinc-700/70 bg-zinc-800/80 px-1.5 py-0.5 font-sans text-[10px] leading-none text-zinc-300",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={13} className={cn("animate-spin", className)} />;
}
