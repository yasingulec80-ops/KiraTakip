import { Button } from "@/components/ui/button";
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
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  downloadCsv,
  formatCurrency,
  formatDate,
  parseDateInput,
  printReport,
} from "@/lib/export";
import { useMutation, useQuery } from "convex/react";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DevirDialog } from "./DevirDialog";
import { SectionToolbar } from "./SectionToolbar";
import { devirablesFor, remainingOf } from "@/lib/vekil-math";
import { transferIsDeposit } from "@/lib/ledger-kind";

type Owner = Doc<"owners">;
type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Tenant = Doc<"tenants">;

const DETAIL_HEADERS = [
  "Malik",
  "Vekil",
  "Gayrimenkul",
  "Kontrat",
  "Tahsil Edilen Kira",
  "Tahsil Edilen Depozito",
  "Vekil Alacak",
  "Teslim Bekleyen",
];

const PROPERTY_HEADERS = [
  "Gayrimenkul",
  "Vekil",
  "Tahsil Edilen Kira",
  "Tahsil Edilen Depozito",
  "Vekil Alacak",
  "Masraf",
  "Teslim Bekleyen",
];

interface PropertyRow {
  propertyId: string;
  propertyName: string;
  vekilName: string;
  collectedRent: number;
  collectedDeposit: number;
  // Internal: needed for remainingOf but not displayed
  rentTransfer: number;
  depositTransfer: number;
  vekilAlacak: number;
  masraf: number;
}

interface SummaryRow {
  ownerId: string;
  ownerName: string;
  vekilName: string;
  collectedRent: number;
  collectedDeposit: number;
  // Internal: needed for remainingOf but not displayed
  rentTransfer: number;
  depositTransfer: number;
  vekilAlacak: number;
}

interface DetailRow extends SummaryRow {
  propertyId: string;
  propertyName: string;
  contractLabel: string;
}

interface ContractData {
  propertyId: string;
  collectedRent: number;
  collectedDeposit: number;
  rentTransfer: number;
  vekilAlacak: number;
  depositTransfer: number;
  firstCollectionDate: number;
}

/** Vekil tahsilat ve devirlerinin malik bazında özet raporu + kontrat ayrıntısı. */
export function VekilDevirReport() {
  const owners = useQuery(api.owners.list);
  const entries = useQuery(api.ledgers.list);
  const contracts = useQuery(api.contracts.list);
  const properties = useQuery(api.properties.list);
  const tenants = useQuery(api.tenants.list);
  const expenses = useQuery(api.expenses.list);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [viewMode, setViewMode] = useState<"malik" | "property" | "contract">("malik");

  const devir = useMutation(api.ledgers.devir);
  const [deviring, setDeviring] = useState<{
    ownerId: string;
    name: string;
    subtitle: string;
  } | null>(null);

  const openDevir = (ownerId: string, ownerName: string, vekilName: string) => {
    setDeviring({
      ownerId,
      name: vekilName,
      subtitle: `Vekil · ${ownerName}`,
    });
  };

  const handleDevir = async (
    amount: number,
    date: string,
    note: string,
    transferType: "rent" | "deposit",
  ) => {
    if (!deviring) return;
    const parsedDate = parseDateInput(date);
    if (!parsedDate) {
      toast.error("Devir tarihi zorunludur.");
      return;
    }
    try {
      await devir({
        ownerId: deviring.ownerId as Id<"owners">,
        amount,
        date: parsedDate,
        note: note.trim() || undefined,
        transferType,
      });
      toast.success(
        transferType === "deposit"
          ? "Depozito devri işlendi; vekilin cari hesabındaki borç kapatıldı."
          : "Kira devri işlendi; vekilin cari hesabındaki borç kapatıldı.",
      );
      setDeviring(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

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
      const isDeposit = transferIsDeposit(e.description);

      const ensureContract = (cid: string, date: number): ContractData => {
        let cd = vd.contracts.get(cid);
        if (!cd) {
          cd = {
            propertyId: e.propertyId?.toString() ?? "",
            collectedRent: 0,
            collectedDeposit: 0,
            rentTransfer: 0,
            depositTransfer: 0,
            vekilAlacak: 0,
            firstCollectionDate: date,
          };
          vd.contracts.set(cid, cd);
        }
        return cd;
      };

      if (
        e.kind === "collection" &&
        e.description.startsWith("Vekil tahsilatı")
      ) {
        const cid = e.contractId?.toString() ?? "";
        const cd = ensureContract(cid, e.date);
        cd.firstCollectionDate = Math.min(cd.firstCollectionDate, e.date);
        if (isDeposit) cd.collectedDeposit += Math.abs(e.amount);
        else cd.collectedRent += Math.abs(e.amount);
      } else if (e.kind === "transfer") {
        if (e.contractId) {
          // Depozito üzerinden iade (vekil) — doğrudan kontrata bağlı.
          const cd = ensureContract(e.contractId.toString(), e.date);
          cd.depositTransfer += e.amount;
        } else {
          // Genel kira devri — en eski tahsilat öncelikli olarak kontratlara dağıtılır.
          vd.rentTransfers.push({ amount: e.amount, date: e.date });
        }
      } else if (e.amount > 0) {
        // Vekil alacak — vekil adına ödenen kira, masraflar ve pozitif düzeltmeler.
        const cid = e.contractId?.toString() ?? "";
        const cd = ensureContract(cid, e.date);
        cd.vekilAlacak += e.amount;
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
      let vekilAlacak = 0;
      for (const cd of vd.contracts.values()) {
        collectedRent += cd.collectedRent;
        collectedDeposit += cd.collectedDeposit;
        rentTransfer += cd.rentTransfer;
        depositTransfer += cd.depositTransfer;
        vekilAlacak += cd.vekilAlacak;
      }
      summary.push({
        ownerId,
        ownerName: vd.ownerName,
        vekilName: vd.vekilName,
        collectedRent,
        collectedDeposit,
        rentTransfer,
        depositTransfer,
        vekilAlacak,
      });

      for (const [cid, cd] of vd.contracts) {
        if (
          cd.collectedRent === 0 &&
          cd.collectedDeposit === 0 &&
          cd.rentTransfer === 0 &&
          cd.depositTransfer === 0 &&
          cd.vekilAlacak === 0
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
          propertyId: property?._id.toString() ?? "",
          propertyName: property?.name ?? "—",
          contractLabel: contract
            ? `${tenant?.name ?? "Kiracı"} · ${formatDate(contract.startDate)}`
            : "Kontrat yok",
          collectedRent: cd.collectedRent,
          collectedDeposit: cd.collectedDeposit,
          rentTransfer: cd.rentTransfer,
          depositTransfer: cd.depositTransfer,
          vekilAlacak: cd.vekilAlacak,
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
          vekilAlacak: acc.vekilAlacak + r.vekilAlacak,
        }),
        {
          collectedRent: 0,
          collectedDeposit: 0,
          rentTransfer: 0,
          depositTransfer: 0,
          vekilAlacak: 0,
        },
      ),
    [summaryRows],
  );
  const totalRemaining = remainingOf(
    summaryTotals.collectedRent,
    summaryTotals.collectedDeposit,
    summaryTotals.rentTransfer,
    summaryTotals.depositTransfer,
    summaryTotals.vekilAlacak,
  );

  // Gayrimenkul bazında toplamlar — detailRows'ı propertyId'ye göre gruplar.
  const propertyRows = useMemo(() => {
    const map = new Map<string, PropertyRow>();
    for (const r of detailRows) {
      // Same property ID → merge; fallback to name for entries without a propertyId
      const key = r.propertyId || r.propertyName;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          propertyId: key,
          propertyName: r.propertyName,
          vekilName: r.vekilName,
          collectedRent: 0,
          collectedDeposit: 0,
          rentTransfer: 0,
          depositTransfer: 0,
          vekilAlacak: 0,
          masraf: 0,
        };
        map.set(key, entry);
      }
      // Use the real property name if we have one (upgrade from "—")
      if (entry.propertyName === "—" && r.propertyName !== "—") {
        entry.propertyName = r.propertyName;
      }
      entry.collectedRent += r.collectedRent;
      entry.collectedDeposit += r.collectedDeposit;
      entry.rentTransfer += r.rentTransfer;
      entry.depositTransfer += r.depositTransfer;
      entry.vekilAlacak += r.vekilAlacak;
    }
    // Vekil adına ödenen masrafları gayrimenkul bazında ekle
    const proxyOwnerIds = new Set(
      (owners ?? [])
        .filter((o) => o.proxy)
        .map((o) => o._id.toString()),
    );
    for (const exp of (expenses ?? [])) {
      if (exp.paidByType !== "proxy" || !exp.payerOwnerId) continue;
      if (!proxyOwnerIds.has(exp.payerOwnerId.toString())) continue;
      const prop = propertyMap.get(exp.propertyId.toString());
      if (!prop) continue;
      const expKey = prop._id.toString();
      let entry = map.get(expKey);
      if (!entry) {
        entry = {
          propertyId: expKey,
          propertyName: prop.name,
          vekilName: "",
          collectedRent: 0,
          collectedDeposit: 0,
          rentTransfer: 0,
          depositTransfer: 0,
          vekilAlacak: 0,
          masraf: 0,
        };
        map.set(expKey, entry);
      }
      entry.masraf += exp.amount;
    }
    return [...map.values()].sort((a, b) =>
      a.propertyName.localeCompare(b.propertyName, "tr"),
    );
  }, [detailRows, owners, expenses, propertyMap]);

  const propertyExportRows = propertyRows.map((r) => [
    r.propertyName,
    r.vekilName,
    r.collectedRent,
    r.collectedDeposit,
    r.vekilAlacak,
    r.masraf,
    remainingOf(
      r.collectedRent,
      r.collectedDeposit,
      0,
      0,
      r.vekilAlacak,
    ),
  ]);

  const detailExportRows = detailRows.map((r) => [
    r.ownerName,
    r.vekilName,
    r.propertyName,
    r.contractLabel,
    r.collectedRent,
    r.collectedDeposit,
    r.vekilAlacak,
    remainingOf(
      r.collectedRent,
      r.collectedDeposit,
      0,
      0,
      r.vekilAlacak,
    ),
  ]);

  const exportCsv = () => {
    if (viewMode === "property") {
      downloadCsv("vekil-devir-gayrimenkul", PROPERTY_HEADERS, propertyExportRows);
    } else {
      downloadCsv("vekil-devir-raporu", DETAIL_HEADERS, detailExportRows);
    }
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    const headers = viewMode === "property" ? PROPERTY_HEADERS : DETAIL_HEADERS;
    const rows = viewMode === "property" ? propertyExportRows : detailExportRows;
    const subtitle = viewMode === "property"
      ? "Vekil tahsilat ve devirlerinin gayrimenkul bazında özeti"
      : "Vekil tahsilat ve devirlerinin kontrat bazında özeti";
    printReport("Vekil Devir Raporu", subtitle, headers, rows);
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
          {/* Görünüm seçimi */}
          <div className="flex items-center gap-1">
            {[
              { id: "malik" as const, label: "Malik Özeti" },
              { id: "property" as const, label: "Gayrimenkul Bazında" },
              { id: "contract" as const, label: "Kontrat Ayrıntısı" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setViewMode(t.id)}
                className={`rounded-none px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === t.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Malik özeti */}
          {viewMode === "malik" && (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Malik</TableHead>
                    <TableHead>Vekil</TableHead>
                    <TableHead className="text-right">Tahsil Edilen Kira</TableHead>
                    <TableHead className="text-right">Tahsil Edilen Depozito</TableHead>
                    <TableHead className="text-right">Vekil Alacak</TableHead>
                    <TableHead className="text-right">Teslim Bekleyen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.map((r) => {
                    const remaining = remainingOf(
                      r.collectedRent,
                      r.collectedDeposit,
                      0,
                      0,
                      r.vekilAlacak,
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
                          {r.vekilAlacak > 0 ? formatCurrency(r.vekilAlacak) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {remaining > 0 ? (
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto rounded-none p-0 font-medium text-amber-700 underline-offset-4 hover:underline"
                              onClick={() =>
                                openDevir(r.ownerId, r.ownerName, r.vekilName)
                              }
                              title="Devir penceresini aç"
                            >
                              {formatCurrency(remaining)}
                            </Button>
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
                </span>{" "}
                
              </span>
              <span>

                {summaryTotals.vekilAlacak > 0 && (
                  <>
                    {" "}
                    · vekil alacak{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(summaryTotals.vekilAlacak)}
                    </span>
                  </>
                )}
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

          {/* Gayrimenkul bazında */}
          {viewMode === "property" && (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Gayrimenkul</TableHead>
                    <TableHead>Vekil</TableHead>
                    <TableHead className="text-right">Tahsil Edilen Kira</TableHead>
                    <TableHead className="text-right">Tahsil Edilen Depozito</TableHead>
                    <TableHead className="text-right">Vekil Alacak</TableHead>
                    <TableHead className="text-right">Masraf</TableHead>
                    <TableHead className="text-right">Teslim Bekleyen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {propertyRows.map((r) => {
                    const remaining = remainingOf(
                      r.collectedRent,
                      r.collectedDeposit,
                      0,
                      0,
                      r.vekilAlacak,
                    );
                    return (
                      <TableRow key={r.propertyId} className="align-middle">
                        <TableCell className="font-medium">{r.propertyName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.vekilName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.collectedRent > 0 ? formatCurrency(r.collectedRent) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.collectedDeposit > 0 ? formatCurrency(r.collectedDeposit) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.vekilAlacak > 0 ? formatCurrency(r.vekilAlacak) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.masraf > 0 ? (
                            <span className="text-muted-foreground">{formatCurrency(r.masraf)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {remaining > 0 ? (
                            <span className="text-amber-700">{formatCurrency(remaining)}</span>
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
              {propertyRows.length} gayrimenkul gösteriliyor
            </div>
          </div>
          )}

          {/* Kontrat ayrıntısı */}
          {viewMode === "contract" && (
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
                        <TableHead className="text-right">Vekil Alacak</TableHead>
                        <TableHead className="text-right">Teslim Bekleyen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailRows.map((r, i) => {
                        const remaining = remainingOf(
                          r.collectedRent,
                          r.collectedDeposit,
                          0,
                          0,
                          r.vekilAlacak,
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
                              {r.vekilAlacak > 0 ? formatCurrency(r.vekilAlacak) : "—"}
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
          )}
        </div>
      )}
      <DevirDialog
        open={deviring !== null}
        account={
          deviring
            ? {
                key: `report:${deviring.ownerId}`,
                name: deviring.name,
                subtitle: deviring.subtitle,
                ownerId: deviring.ownerId,
              }
            : null
        }
        devirableRent={
          deviring ? devirablesFor(entries ?? [], deviring.ownerId).rent : 0
        }
        devirableDeposit={
          deviring ? devirablesFor(entries ?? [], deviring.ownerId).deposit : 0
        }
        onOpenChange={(open) => !open && setDeviring(null)}
        onDevir={handleDevir}
      />
    </section>
  );
}
