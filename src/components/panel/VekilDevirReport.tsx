import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { downloadCsv, formatCurrency, printReport } from "@/lib/export";
import { useQuery } from "convex/react";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionToolbar } from "./SectionToolbar";

type LedgerEntry = Doc<"ledgerEntries">;
type Owner = Doc<"owners">;

const CSV_HEADERS = [
  "Malik",
  "Vekil",
  "Tahsil Edilen Kira",
  "Tahsil Edilen Depozito",
  "Kira Devri",
  "Depozito Devri",
  "Teslim Bekleyen",
];

interface ReportRow {
  ownerId: string;
  ownerName: string;
  vekilName: string;
  collectedRent: number;
  collectedDeposit: number;
  rentTransfer: number;
  depositTransfer: number;
}

const remainingOf = (r: ReportRow): number =>
  r.collectedRent + r.collectedDeposit - r.rentTransfer - r.depositTransfer;

/** Vekil tahsilat ve devirlerinin malik bazında özet raporu. */
export function VekilDevirReport() {
  const owners = useQuery(api.owners.list);
  const entries = useQuery(api.ledgers.list);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rangeFiltered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return (entries ?? []).filter((e) => {
      if (fromMs !== null && e.date < fromMs) return false;
      if (toMs !== null && e.date > toMs) return false;
      return true;
    });
  }, [entries, from, to]);

  const rows = useMemo<ReportRow[]>(() => {
    const proxyEntries = rangeFiltered.filter((e) => e.personType === "proxy");
    const list: ReportRow[] = [];
    (owners ?? [])
      .filter((o) => o.proxy)
      .forEach((o: Owner) => {
        let collectedRent = 0;
        let collectedDeposit = 0;
        let rentTransfer = 0;
        let depositTransfer = 0;
        for (const e of proxyEntries) {
          if (e.personId.toString() !== o._id.toString()) continue;
          const isDeposit = e.description.includes("depozito");
          if (
            e.kind === "collection" &&
            e.description.startsWith("Vekil tahsilatı")
          ) {
            if (isDeposit) collectedDeposit += Math.abs(e.amount);
            else collectedRent += Math.abs(e.amount);
          } else if (e.kind === "transfer") {
            if (isDeposit) depositTransfer += e.amount;
            else rentTransfer += e.amount;
          }
        }
        list.push({
          ownerId: o._id.toString(),
          ownerName: o.name,
          vekilName: o.proxy?.name ?? "—",
          collectedRent,
          collectedDeposit,
          rentTransfer,
          depositTransfer,
        });
      });

    const q = search.trim().toLocaleLowerCase("tr");
    return list
      .filter(
        (r) =>
          q === "" ||
          r.ownerName.toLocaleLowerCase("tr").includes(q) ||
          r.vekilName.toLocaleLowerCase("tr").includes(q),
      )
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName, "tr"));
  }, [owners, rangeFiltered, search]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          collectedRent: acc.collectedRent + r.collectedRent,
          collectedDeposit: acc.collectedDeposit + r.collectedDeposit,
          rentTransfer: acc.rentTransfer + r.rentTransfer,
          depositTransfer: acc.depositTransfer + r.depositTransfer,
        }),
        {
          collectedRent: 0,
          collectedDeposit: 0,
          rentTransfer: 0,
          depositTransfer: 0,
        },
      ),
    [rows],
  );
  const totalRemaining =
    totals.collectedRent +
    totals.collectedDeposit -
    totals.rentTransfer -
    totals.depositTransfer;

  const exportRows = rows.map((r) => [
    r.ownerName,
    r.vekilName,
    r.collectedRent,
    r.collectedDeposit,
    r.rentTransfer,
    r.depositTransfer,
    remainingOf(r),
  ]);

  const exportCsv = () => {
    downloadCsv("vekil-devir-raporu", CSV_HEADERS, exportRows);
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport(
      "Vekil Devir Raporu",
      "Vekil tahsilat ve devirlerinin malik bazında özeti",
      CSV_HEADERS,
      exportRows,
    );
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const hasProxyOwners = (owners ?? []).some((o) => o.proxy);

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Vekil Devir Raporu"
        hint="Vekil tahsilat ve devirlerinin malik bazında özeti"
        count={rows.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Malik veya vekil ara…"
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onClearRange={() => {
          setFrom("");
          setTo("");
        }}
        onExportCsv={exportCsv}
        onExportPdf={exportPdf}
      />

      {entries === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : !hasProxyOwners ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 />
            </EmptyMedia>
            <EmptyTitle>Rapor için vekil kaydı gerekli</EmptyTitle>
            <EmptyDescription>
              Malik kaydı oluştururken vekil bilgisi girildiğinde, vekilin
              tahsilat ve devirleri burada malik bazında özetlenir.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              Arama veya tarih aralığı filtrelerine uyan kayıt yok.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Malik</TableHead>
                  <TableHead>Vekil</TableHead>
                  <TableHead className="text-right">Tahsil Edilen Kira</TableHead>
                  <TableHead className="text-right">Tahsil Edilen Depozito</TableHead>
                  <TableHead className="text-right">Kira Devri</TableHead>
                  <TableHead className="text-right">Depozito Devri</TableHead>
                  <TableHead className="text-right">Teslim Bekleyen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const remaining = remainingOf(r);
                  return (
                    <TableRow key={r.ownerId} className="align-middle">
                      <TableCell className="font-medium">{r.ownerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.vekilName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.collectedRent > 0 ? formatCurrency(r.collectedRent) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.collectedDeposit > 0
                          ? formatCurrency(r.collectedDeposit)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.rentTransfer > 0 ? formatCurrency(r.rentTransfer) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.depositTransfer > 0
                          ? formatCurrency(r.depositTransfer)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {remaining > 0 ? (
                          <span className="text-amber-700">
                            {formatCurrency(remaining)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {rows.length} malik · tahsil edilen kira{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(totals.collectedRent)}
              </span>{" "}
              · depozito{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(totals.collectedDeposit)}
              </span>
            </span>
            <span>
              Devredilen kira{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(totals.rentTransfer)}
              </span>{" "}
              · depozito{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(totals.depositTransfer)}
              </span>
              {totalRemaining > 0 && (
                <>
                  {" "}
                  · teslim bekleyen{" "}
                  <span className="font-medium text-amber-700">
                    {formatCurrency(totalRemaining)}
                  </span>
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
