import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Compact row action buttons (view / edit / delete). */
export function RowActions({
  onView,
  onEdit,
  onDelete,
}: {
  onView: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-none"
        onClick={onView}
        aria-label="Detayı görüntüle"
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-none"
        onClick={onEdit}
        aria-label="Düzenle"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      {onDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Sil"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/** Editorial labeled form field. */
export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="flex items-baseline gap-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {required && <span className="text-brand">*</span>}
        {hint && (
          <span className="normal-case tracking-normal text-muted-foreground/70">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

/** Responsive grid of fields. */
export function Row({
  children,
  cols = 2,
}: {
  children: ReactNode;
  cols?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

/** Studio-styled dialog shell for create/edit forms. */
export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
  xwide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  xwide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto rounded-none border-border bg-card sm:max-w-lg",
          wide && "sm:max-w-2xl",
          xwide && "sm:max-w-5xl",
        )}
      >
        <DialogHeader className="border-b border-border pb-4 text-left">
          <DialogTitle className="font-display text-xl font-medium tracking-tight">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-sm text-muted-foreground">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="py-4">{children}</div>
        {footer && (
          <DialogFooter className="border-t border-border pt-4">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Label/value row for read-only detail screens. */
export function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "col-span-2 text-sm leading-6",
          mono && "font-mono text-[13px]",
        )}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
