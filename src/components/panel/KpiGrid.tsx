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
    <div className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {tiles.map((tile, i) => (
        <button
          key={tile.id}
          type="button"
          onClick={() => onOpen(tile.id)}
          className={cn(
            "group relative flex flex-col items-start bg-card p-5 text-left transition-colors duration-300",
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
              "mt-4 font-display text-3xl font-light tracking-tight tabular-nums md:text-4xl",
              tile.muted && "text-muted-foreground/60",
            )}
          >
            {tile.value}
          </span>
          <span className="eyebrow mt-2 text-foreground/80">{tile.label}</span>
          <span className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {tile.caption}
          </span>
          <ArrowUpRight
            className={cn(
              "absolute right-4 top-4 h-4 w-4 text-muted-foreground/50 transition-all duration-300",
              "group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand",
            )}
          />
        </button>
      ))}
    </div>
  );
}
