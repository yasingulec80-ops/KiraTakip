import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

export interface KpiTile {
  id: string;
  label: string;
  value: string | number;
  caption?: string;
  muted?: boolean;
}

export function KpiGrid({
  tiles,
  onOpen,
}: {
  tiles: KpiTile[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((tile, i) => (
        <button
          key={tile.id}
          type="button"
          onClick={() => onOpen(tile.id)}
          className={cn(
            "group relative flex min-w-0 flex-col items-start overflow-hidden bg-card p-4 text-left transition-colors duration-300 sm:p-5",
            tile.muted
              ? "hover:bg-muted/50"
              : "hover:bg-accent/40 focus-visible:bg-accent/40",
          )}
        >
          <span className="font-display text-[11px] text-muted-foreground/70">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span
            className={cn(
              "mt-3 w-full min-w-0 break-words font-display text-2xl font-light leading-tight tracking-tight tabular-nums md:text-3xl",
              tile.muted && "text-muted-foreground/60",
            )}
          >
            {tile.value}
          </span>
          <span className="eyebrow mt-2 w-full min-w-0 break-words text-foreground/80">
            {tile.label}
          </span>
          <span className="mt-1 w-full min-w-0 break-words text-[11px] leading-4 text-muted-foreground">
            {tile.caption}
          </span>
          <ArrowUpRight
            className={cn(
              "absolute right-4 top-4 h-4 w-4 shrink-0 text-muted-foreground/50 transition-all duration-300",
              "group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand",
            )}
          />
        </button>
      ))}
    </div>
  );
}
