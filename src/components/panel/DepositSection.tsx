import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  dateToInput,
  downloadCsv,
  formatCurrency,
  formatDate,
  parseDateInput,
  printReport,
} from "@/lib/export";
import { useMutation, useQuery } from "convex/react";

import { Banknote, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Owner = Doc<"owners">;
type Tenant = Doc<"tenants">;

const TODAY = dateToInput(Date.now());

const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  paid: "Ödendi",
  held: "Elde tutuluyor",
  returned: "İade edildi",
};

const CSV_HEADERS = [
  "Gayrimenkul",
  "Malik",
  "Kiracı",
  "Depozito",
  "Durum",
  "Sözleşme Başlangıcı",
  "İade Tarihi",
  "İade Notu",
];

type StatusFilter = "all" | "held" | "returned";

export function DepositSection() {
  const contracts = useQuery(api.contracts.list);
  const properties = useQuery(api.properties.list);
  const owners = useQuery(api.owners.list);
  const tenants = useQuery(api.tenants.list);
  const returnDeposit = useMutation(api.contracts.returnDeposit);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [returning, setReturning] = useState<Contract | null>(null);

  const propertyMap = useMemo(() => {
    const map = new Map<string, Property>();
    (properties ?? []).forEach((p) => map.set(p._id.toString(), p));
    return map;
  }, [properties]);
  const ownerMap = useMemo(() => {
    const map = new Map<string, Owner>();
    (owners ?? []).forEach((o) => map.set(o._id.toString(), o));
    return map;
  }, [owners]);
  const tenantMap = useMemo(() => {
    const map = new Map<string, Tenant>();
    (tenants ?? []).forEach((t) => map.set(t._id.toString(), t));
    return map;
  }, [tenants]);

  const depositContracts = useMemo(
    () => (contracts ?? []).filter((c) => c.depositAmount > 0),
    [contracts],
  );

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return depositContracts.filter((c) => {
      if (fromMs !== null && c.startDate < fromMs) return false;
      if (toMs !== null && c.startDate > toMs) return false;
      const status = c.depositStatus ?? "paid";
      if (statusFilter === "held" && status === "returned") return false;
      if (statusFilter === "returned" && status !== "returned") return false;
      if (q === "") return true;

      const property = propertyMap.get(c.propertyId.toString());
      const owner = ownerMap.get(c.ownerId.toString());
      const tenant = tenantMap.get(c.tenantId.toString());
      const haystack = [
        property?.name,
        property?.address,
        owner?.name,
        tenant?.name,
        DEPOSIT_STATUS_LABEL[status],
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [
    depositContracts,
    propertyMap,
    ownerMap,
    tenantMap,
    search,
    from,
    to,
    statusFilter,
  ]);

  const totals = useMemo(
    () => ({
      total: depositContracts.reduce((sum, c) => sum + c.depositAmount, 0),
      held: depositContracts
        .filter((c) => (c.depositStatus ?? "paid") !== "returned")
        .reduce((sum, c) => sum + c.depositAmount, 0),
      returned: depositContracts
        .filter((c) => c.depositStatus === "returned")
        .reduce((sum, c) => sum + c.depositAmount, 0),
      pendingCount: depositContracts.filter(
        (c) => (c.depositStatus ?? "paid") !== "returned",
      ).length,
    }),
    [depositContracts],
  );

  const rows = (c: Contract): (string | number | null)[] => {
    const property = propertyMap.get(c.propertyId.toString());
    const owner = ownerMap.get(c.ownerId.toString());
    const tenant = tenantMap.get(c.tenantId.toString());
    return [
      property?.name ?? "—",
      owner?.name ?? "—",
      tenant?.name ?? "—",
      c.depositAmount,
      DEPOSIT_STATUS_LABEL[c.depositStatus ?? "paid"],
      formatDate(c.startDate),
      c.depositReturnedAt ? formatDate(c.depositReturnedAt) : "",
      c.depositNote ?? "",
    ];
  };

  const exportCsv = () => {
    downloadCsv("depozitolar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Depozitolar", "Depozito takip dökümü", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleReturn = async (contract: Contract, date: string, note: string) => {
    const returnedAt = parseDateInput(date);
    if (!returnedAt) {
      toast.error("İade tarihi zorunludur.");
      return;
    }
    try {
      const result = await returnDeposit({
        contractId: contract._id,
        date: returnedAt,
        note: note.trim() || undefined,
      });
      toast.success(
        result.entriesPosted > 0
          ? "Depozito iadesi işlendi; kiracı ve malik cari hesaplarına kaydedildi."
          : "Depozito iade edildi olarak işaretlendi.",
      );
      setReturning(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const returningProperty = returning
    ? propertyMap.get(returning.propertyId.toString())
    : undefined;
  const returningTenant = returning
    ? tenantMap.get(returning.tenantId.toString())
    : undefined;

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Depozitolar"
        hint="Sözleşme bazında depozito takibi ve iade işlemleri"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Gayrimenkul, malik, kiracı ara…"
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

      {/* Özet şeridi */}
      <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">Toplam Depozito</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.total)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">Elde Tutulan</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.held)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">İade Edilen</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.returned)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">İade Bekleyen Kontrat</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {totals.pendingCount}
          </p>
        </div>
      </div>

      {contracts === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Banknote />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {depositContracts.length === 0
                ? "Henüz depozito kaydı yok. Kontrat oluştururken depozito tutarı girildiğinde burada izlenir."
                : "Arama, tarih aralığı veya durum filtrelerine uyan kayıt yok."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-44">Gayrimenkul</TableHead>
                  <TableHead>Malik</TableHead>
                  <TableHead>Kiracı</TableHead>
                  <TableHead className="text-right">Depozito</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>İade Tarihi</TableHead>
                  <TableHead className="max-w-40">İade Notu</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const property = propertyMap.get(c.propertyId.toString());
                  const owner = ownerMap.get(c.ownerId.toString());
                  const tenant = tenantMap.get(c.tenantId.toString());
                  const status = c.depositStatus ?? "paid";
                  return (
                    <TableRow key={c._id} className="align-middle">
                      <TableCell>
                        <div className="font-medium">{property?.name ?? "—"}</div>
                        <div className="max-w-44 truncate text-xs text-muted-foreground">
                          {property?.address}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{owner?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{tenant?.name ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(c.depositAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={status === "returned" ? "secondary" : "default"}
                          className={[
                            "rounded-none",
                            status === "held" && "bg-muted text-muted-foreground",
                            status === "returned" && "text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {DEPOSIT_STATUS_LABEL[status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.depositReturnedAt ? formatDate(c.depositReturnedAt) : "—"}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                        {c.depositNote ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {status !== "returned" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-none"
                            onClick={() => setReturning(c)}
                          >
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            İade Et
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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
              {filtered.length} / {depositContracts.length} kayıt gösteriliyor
            </span>
            <label className="flex items-center gap-2">
              <span className="eyebrow text-muted-foreground">Durum</span>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              >
                <SelectTrigger className="h-8 w-40 rounded-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="held">Elde tutulanlar</SelectItem>
                  <SelectItem value="returned">İade edilenler</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>
      )}

      <DepositReturnDialog
        contract={returning}
        property={returningProperty}
        tenant={returningTenant}
        onOpenChange={(open) => !open && setReturning(null)}
        onConfirm={handleReturn}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

function DepositReturnDialog({
  contract,
  property,
  tenant,
  onOpenChange,
  onConfirm,
}: {
  contract: Contract | null;
  property?: Property;
  tenant?: Tenant;
  onOpenChange: (open: boolean) => void;
  onConfirm: (contract: Contract, date: string, note: string) => void;
}) {
  const [form, setForm] = useState({ date: TODAY, note: "" });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = contract ? contract._id.toString() : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({ date: TODAY, note: "" });
    setError(null);
  }

  const submit = () => {
    if (!contract) return;
    if (form.date === "") {
      setError("İade tarihi zorunludur.");
      return;
    }
    onConfirm(contract, form.date, form.note);
  };

  return (
    <DialogShell
      open={contract !== null}
      onOpenChange={onOpenChange}
      title="Depozito İadesi"
      description={
        contract
          ? `${property?.name ?? "Gayrimenkul"} · ${tenant?.name ?? "Kiracı"} — ${formatCurrency(
              contract.depositAmount,
            )}`
          : undefined
      }
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            onClick={() => onOpenChange(false)}
          >
            Vazgeç
          </Button>
          <Button type="button" className="rounded-none" onClick={submit}>
            <RotateCcw className="mr-2 h-4 w-4" />
            İade Edildi Olarak İşaretle
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <p className="text-sm leading-6 text-muted-foreground">
          Depozito, kontrat sona erdiğinde ve gayrimenkulün boşaltılmış olduğu
          tespit edildiğinde kiracıya iade edilir. İade tarihini ve varsa
          notu girin.
        </p>
        <Field label="İade Tarihi" required>
          <Input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="rounded-none"
          />
        </Field>
        <Field label="İade Notu" hint="isteğe bağlı">
          <Input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="örn. Eksikler tespit edilmedi, tam iade"
            className="rounded-none"
          />
        </Field>
      </div>
    </DialogShell>
  );
}
