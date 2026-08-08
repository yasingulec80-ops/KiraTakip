import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CalendarRange,
  FileSpreadsheet,
  FileText,
  Plus,
  Search,
  X,
} from "lucide-react";

export interface SectionToolbarProps {
  num: string;
  eyebrow?: string;
  title: string;
  hint: string;
  count: number;
  addLabel?: string;
  onAdd?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onClearRange: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
}

export function SectionToolbar({
  num,
  eyebrow,
  title,
  hint,
  count,
  addLabel,
  onAdd,
  search,
  onSearchChange,
  searchPlaceholder,
  from,
  to,
  onFromChange,
  onToChange,
  onClearRange,
  onExportCsv,
  onExportPdf,
}: SectionToolbarProps) {
  const hasRange = from !== "" || to !== "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-brand">{eyebrow ?? `Sekme ${num}`}</p>
          <h2 className="mt-2 font-display text-2xl font-light tracking-tight md:text-3xl">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hint} ·{" "}
            <span className="font-medium text-foreground">{count}</span> kayıt
          </p>
        </div>
        {onAdd && (
          <Button
            type="button"
            onClick={onAdd}
            className="rounded-none px-4"
            size="sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            {addLabel ?? "Yeni Ekle"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
        <div className="relative mr-2 min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? "Ara…"}
            className="h-9 rounded-none pl-9"
          />
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarRange className="h-4 w-4" />
          <Input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            aria-label="Başlangıç tarihi"
            className="h-9 w-36 rounded-none"
          />
          <span className="text-xs">–</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            aria-label="Bitiş tarihi"
            className="h-9 w-36 rounded-none"
          />
          {hasRange && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none"
              onClick={onClearRange}
              aria-label="Tarih aralığını temizle"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-none"
            onClick={onExportCsv}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-none"
            onClick={onExportPdf}
          >
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
