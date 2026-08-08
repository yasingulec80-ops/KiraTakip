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
import { downloadCsv, formatCurrency, formatDate, printReport } from "@/lib/export";
import { useQuery } from "convex/react";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionToolbar } from "./SectionToolbar";

type LedgerEntry = Doc<"ledgerEntries">;
type Owner = Doc<"owners">;
type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Tenant = Doc<"tenants">;

const SUMMARY_HEADERS = [
  "Malik",
  "Vekil",
  "Tahsil Edilen Kira",
  "Tahsil Edilen Depozito",
  "Kira Devri",
  "Depozito Devri",
  "Teslim Bekleyen",
];

const DETAIL_HEADERS = [
  "Malik",
  "Vekil",
  "Gayrimenkul",
  "Kontrat",
  "Tahsil Edilen Kira",
  "Tahsil Edilen Depozito",
  "Kira Devri",
  "Depozito Devri",
  "Teslim Bekleyen",
];

interface SummaryRow {
  ownerId: string;
  ownerName: string;
  vekilName: string;
  collectedRent: number;
  collectedDeposit: number;
  rentTransfer: number;
  depositTransfer: number;
}

interface DetailRow extends SummaryRow {
  propertyName: string;
  contractLabel: string;
}

interface ContractData {
  propertyId: string;
  collectedRent: number;
  collectedDeposit: number;
  rentTransfer: number;
  depositTransfer: number;
  firstCollectionDate: number;
}

const remainingOf = (c: number, d: number, rt: number, dt: number): number =>
  c + d - rt - dt;

/** Vekil tahsilat ve devirlerinin malik bazında özet raporu + kontrat ayrıntısı. */
export function VekilDevirReport() {
  const owners = useQuery(api.owners.list);
  const entries = useQuery(api.ledgers.list);
  const contracts = useQuery(api.contracts.list);
  const properties = useQuery(api.properties.list);
  const tenants = useQuery(api.tenants.list);

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

  const propertyMap = useMemo(() => {
    const map = new Map<string, Property>();
    (properties ?? []).forEach((p) => map.set(p._id.toString(), p));
    return map;
  }, [properties]);
  const contractMap = useMemo(() => {
    const map = new Map<string, Contract>();
    (contracts ?? []).forEach((c) => map.set(c._id.toString(), c));
    return map;
  }, [contracts]);
  const tenantMap = useMemo(() => {
    const map = new Map<string, Tenant>();
    (tenants ?? []).forEach((t) => map.set(t._id.toString(), t));
    return map;
  }, [tenants]);

  const { summaryRows, detailRows } = useMemo(() => {
    const proxyEntries = rangeFiltered.filter((e) => e.personType === "proxy");

    // Her vekilli malik için kontrat bazında toplamlar.
    const vekilData = new Map<
      string,
      {
        ownerName: string;
        vekilName: string;
        contracts: Map<string, ContractData>;
        rentTransfers: { amount: number; date: number }[]; // kontrata bağlı olmayan kira devirleri
      }
    >();
    (owners ?? [])
      .filter((o) => o.proxy)
      .forEach((o: Owner) => {
        vekilData.set(o._id.toString(), {
          ownerName: o.name,
          vekilName: o.proxy?.name ?? "—",
          contracts: new Map<string, ContractData>(),
          rentTransfers: [],
        });
      });

    for (const e of proxyEntries) {
      const vd = vekilData.get(e.personId.toString());
      if (!vd) continue;
      const isDeposit = e.description.includes("depozito");

      if (
        e.kind === "collection" &&
        e.description.startsWith("Vekil tahsilatı")
      ) {
        const cid = e.contractId?.toString() ?? "";
        let cd = vd.contracts.get(cid);
        if (!cd) {
          cd = {
            propertyId: e.propertyId?.toString() ?? "",
            collectedRent: 0,
            collectedDeposit: 0,
            rentTransfer: 0,
            depositTransfer: 0,
            firstCollectionDate: e.date,
          };
          vd.contracts.set(cid, cd);
        }
        cd.firstCollectionDate = Math.min(cd.firstCollectionDate, e.date);
        if (isDeposit) cd.collectedDeposit += Math.abs(e.amount);
        else cd.collectedRent += Math.abs(e.amount);
      } else if (e.kind === "transfer") {
        if (e.contractId) {
          // Depozito üzerinden iade (vekil) — doğrudan kontrata bağlı.
          const cid = e.contractId.toString();
          let cd = vd.contracts.get(cid);
          if (!cd) {
            cd = {
              propertyId: e.propertyId?.toString() ?? "",
              collectedRent: 0,
              collectedDeposit: 0,
              rentTransfer: 0,
              depositTransfer: 0,
              firstCollectionDate: e.date,
            };
            vd.contracts.set(cid, cd);
          }
          cd.depositTransfer += e.amount;
        } else {
          // Genel kira devri — en eski tahsilat öncelikli olarak kontratlara dağıtılır.
          vd.rentTransfers.push({ amount: e.amount, date: e.date });
        }
      }
    }

    // FIFO: kontrata bağlı olmayan kira devirleri, en eski açık tahsilattan başlayarak
    // kontratlara paylaştırılır (toplamlar malik özetiyle birebir örtüşür).
    for (const vd of vekilData.values()) {
      const ordered = [...vd.contracts.entries()]
        .map(([cid, cd]) => ({ cid, cd }))
        .sort((a, b) => a.cd.firstCollectionDate - b.cd.firstCollectionDate);
      const remaining = new Map<string, number>();
      ordered.forEach(({ cid, cd }) => remaining.set(cid, cd.collectedRent));
      const transfers = [...vd.rentTransfers].sort((a, b) => a.date - b.date);
      for (const t of transfers) {
        let left = t.amount;
        for (const { cid } of ordered) {
          if (left <= 0) break;
          const avail = remaining.get(cid) ?? 0;
          if (avail <= 0) continue;
          const take = Math.min(left, avail);
          remaining.set(cid, avail - take);
          const cd = vd.contracts.get(cid);
          if (cd) cd.rentTransfer += take;
          left -= take;
        }
      }
    }

    const summary: SummaryRow[] = [];
    const detail: DetailRow[] = [];

    for (const [ownerId, vd] of vekilData) {
      let collectedRent = 0;
      let collectedDeposit = 0;
      let rentTransfer = 0;
      let depositTransfer = 0;
      for (const cd of vd.contracts.values()) {
        collectedRent += cd.collectedRent;
        collectedDeposit += cd.collectedDeposit;
        rentTransfer += cd.rentTransfer;
        depositTransfer += cd.depositTransfer;
      }
      summary.push({
        ownerId,
        ownerName: vd.ownerName,
        vekilName: vd.vekilName,
        collectedRent,
        collectedDeposit,
        rentTransfer,
        depositTransfer,
      });

      for (const [cid, cd] of vd.contracts) {
        if (
          cd.collectedRent === 0 &&
          cd.collectedDeposit === 0 &&
          cd.rentTransfer === 0 &&
          cd.depositTransfer === 0
        ) {
          continue;
        }
        const contract = contractMap.get(cid);
        const property = contract
          ? propertyMap.get(contract.propertyId.toString())
          : undefined;
        const tenant = contract
          ? tenantMap.get(contract.tenantId.toString())
          : undefined;
        detail.push({
          ownerId,
          ownerName: vd.ownerName,
          vekilName: vd.vekilName,
          propertyName: property?.name ?? "—",
          contractLabel: contract
            ? `${tenant?.name ?? "Kiracı"} · ${formatDate(contract.startDate)}`
            : "Kontrat yok",
          collectedRent: cd.collectedRent,
          collectedDeposit: cd.collectedDeposit,
          rentTransfer: cd.rentTransfer,
          depositTransfer: cd.depositTransfer,
        });
      }
    }

    const q = search.trim().toLocaleLowerCase("tr");
    const matches = (s: SummaryRow) =>
      q === "" ||
      s.ownerName.toLocaleLowerCase("tr").includes(q) ||
      s.vekilName.toLocaleLowerCase("tr").includes(q);

    const filteredSummary = summary
      .filter(matches)
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName, "tr"));
    const allowedOwnerIds = new Set(filteredSummary.map((s) => s.ownerId));
    const filteredDetail = detail
      .filter(
        (d) =>
          allowedOwnerIds.has(d.ownerId) &&
          (q === "" ||
            d.propertyName.toLocaleLowerCase("tr").includes(q) ||
            d.contractLabel.toLocaleLowerCase("tr").includes(q)),
      )
      .sort(
        (a, b) =>
          a.ownerName.localeCompare(b.ownerName, "tr") ||
          a.propertyName.localeCompare(b.propertyName, "tr") ||
          a.contractLabel.localeCompare(b.contractLabel, "tr"),
      );

    return { summaryRows: filteredSummary, detailRows: filteredDetail };
  }, [owners, rangeFiltered, search, contractMap, propertyMap, tenantMap]);

  const summaryTotals = useMemo(
    () =>
      summaryRows.reduce(
        (acc, r) => ({
          collectedRent: acc.collectedRent + r.collectedRent,
          collectedDeposit: acc.collectedDeposit + r.collectedDeposit,
          rentTransfer: acc.rentTransfer + r.rentTransfer,
          depositTransfer: acc.depositTransfer + r.depositTransfer,
        }),
        { collectedRent: 0, collectedDeposit: 0, rentTransfer: 0, depositTransfer: 0 },
      ),
    [summaryRows],
  );
  const totalRemaining = remainingOf(
    summaryTotals.collectedRent,
    summaryTotals.collectedDeposit,
    summaryTotals.rentTransfer,
    summaryTotals.depositTransfer,
  );

  const detailExportRows = detailRows.map((r) => [
    r.ownerName,
    r.vekilName,
    r.propertyName,
    r.contractLabel,
    r.collectedRent,
    r.collectedDeposit,
    r.rentTransfer,
    r.depositTransfer,
    remainingOf(
      r.collectedRent,
      r.collectedDeposit,
      r.rentTransfer,
      r.depositTransfer,
    ),
  ]);

  const exportCsv = () => {
    downloadCsv("vekil-devir-raporu", DETAIL_HEADERS, detailExportRows);
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport(
      "Vekil Devir Raporu",
      "Vekil tahsilat ve devirlerinin kontrat bazında özeti",
      DETAIL_HEADERS,
      detailExportRows,
    );
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const hasProxyOwners = (owners ?? []).some((o) => o.proxy);

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Vekil Devir Raporu"
        hint="Vekil tahsilat ve devirlerinin malik, gayrimenkul ve kontrat bazında özeti"
        count={detailRows.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Malik, vekil, gayrimenkul veya kiracı ara…"
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
      ) : (
        <div className="space-y-6">
          {/* Malik özeti */}
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
                  {summaryRows.map((r) => {
                    const remaining = remainingOf(
                      r.collectedRent,
                      r.collectedDeposit,
                      r.rentTransfer,
                      r.depositTransfer,
                    );
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
                {summaryRows.length} malik · tahsil edilen kira{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(summaryTotals.collectedRent)}
                </span>{" "}
                · depozito{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(summaryTotals.collectedDeposit)}
                </span>
              </span>
              <span>
                Devredilen kira{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(summaryTotals.rentTransfer)}
                </span>{" "}
                · depozito{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(summaryTotals.depositTransfer)}
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

          {/* Kontrat ayrıntısı */}
          <div>
            <div className="mb-3 flex items-center gap-4">
              <span className="eyebrow text-muted-foreground">
                Kontrat Bazında Ayrıntı
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {detailRows.length === 0 ? (
              <p className="border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                Bu filtrelerle eşleşen kontrat hareketi yok.
              </p>
            ) : (
              <div className="border border-border bg-card">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Malik</TableHead>
                        <TableHead>Vekil</TableHead>
                        <TableHead>Gayrimenkul</TableHead>
                        <TableHead>Kontrat</TableHead>
                        <TableHead className="text-right">Tahsil Edilen Kira</TableHead>
                        <TableHead className="text-right">Tahsil Edilen Depozito</TableHead>
                        <TableHead className="text-right">Kira Devri</TableHead>
                        <TableHead className="text-right">Depozito Devri</TableHead>
                        <TableHead className="text-right">Teslim Bekleyen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailRows.map((r, i) => {
                        const remaining = remainingOf(
                          r.collectedRent,
                          r.collectedDeposit,
                          r.rentTransfer,
                          r.depositTransfer,
                        );
                        return (
                          <TableRow key={`${r.ownerId}-${i}`} className="align-middle">
                            <TableCell className="font-medium">{r.ownerName}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {r.vekilName}
                            </TableCell>
                            <TableCell className="text-sm">{r.propertyName}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {r.contractLabel}
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
                <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  {detailRows.length} kontrat hareketi gösteriliyor
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
