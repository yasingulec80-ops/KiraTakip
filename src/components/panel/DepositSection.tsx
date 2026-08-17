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
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  dateToInput,
  downloadCsv,
  formatCurrency,
  formatDate,
  parseDateInput,
  parseNumber,
  printReport,
} from "@/lib/export";
import {
  DEPOSIT_STATUS_LABEL,
  depositCollectedOf,
  depositDisposalOf,
  depositHeldOf,
  depositRemainingOf,
  depositStatusOf,
  depositTotalsOf,
  type DepositStatus,
} from "@/lib/deposit-math";
import { useMutation, useQuery } from "convex/react";

import { Banknote, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field, Row } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Owner = Doc<"owners">;
type Tenant = Doc<"tenants">;

const TODAY = dateToInput(Date.now());

const CSV_HEADERS = [
  "Gayrimenkul",
  "Malik",
  "Kiracı",
  "Depozito",
  "Tahsil Edilen",
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
  const collections = useQuery(api.collections.list);
  const ledgerEntries = useQuery(api.ledgers.list);
  const returnDeposit = useMutation(api.contracts.returnDeposit);
  const createDepositRecord = useMutation(api.deposits.createDepositRecord);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [returning, setReturning] = useState<Contract | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [recordContractId, setRecordContractId] = useState("");

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

  /** Kontrat başına tahsil edilen / dağıtılan tutarlar. */
  const positionsByContract = useMemo(() => {
    const map = new Map<
      string,
      { collected: number; disposal: ReturnType<typeof depositDisposalOf> }
    >();
    for (const c of depositContracts) {
      const key = c._id.toString();
      map.set(key, {
        collected: depositCollectedOf(collections ?? [], c._id),
        disposal: depositDisposalOf(ledgerEntries ?? [], c._id),
      });
    }
    return map;
  }, [depositContracts, collections, ledgerEntries]);

  const heldOf = (c: Contract): number => {
    const pos = positionsByContract.get(c._id.toString());
    if (!pos) return 0;
    return depositHeldOf(pos.collected, pos.disposal);
  };

  const statusOf = (c: Contract): DepositStatus => {
    const pos = positionsByContract.get(c._id.toString());
    if (!pos) return "pending";
    return depositStatusOf(c, pos.collected, pos.disposal);
  };

  const collectedOf = (c: Contract): number =>
    positionsByContract.get(c._id.toString())?.collected ?? 0;

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return depositContracts.filter((c) => {
      if (fromMs !== null && c.startDate < fromMs) return false;
      if (toMs !== null && c.startDate > toMs) return false;
      const status = statusOf(c);
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
    positionsByContract,
    search,
    from,
    to,
    statusFilter,
  ]);

  const totals = useMemo(
    () =>
      depositTotalsOf(
        depositContracts,
        collections ?? [],
        ledgerEntries ?? [],
      ),
    [depositContracts, collections, ledgerEntries],
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
      collectedOf(c),
      DEPOSIT_STATUS_LABEL[statusOf(c)],
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

  const handleReturn = async (
    contract: Contract,
    date: string,
    note: string,
    returnedByOwnerId: string,
  ) => {
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
        returnedByProxyOwnerId: returnedByOwnerId
          ? (returnedByOwnerId as Id<"owners">)
          : undefined,
      });
      toast.success(
        result.entriesPosted > 0
          ? "Depozito iadesi işlendi; cari hesaplara kaydedildi."
          : "Depozito iade edildi olarak işaretlendi.",
      );
      setReturning(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const handleSaveRecord = async (form: DepositRecordState) => {
    const date = parseDateInput(form.date);
    if (!form.contractId || !date) {
      toast.error("Kontrat ve kayıt tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      toast.error("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    try {
      await createDepositRecord({
        contractId: form.contractId as Id<"contracts">,
        action: form.action,
        amount,
        date,
        note: form.note.trim() || undefined,
        collectedByProxyOwnerId: form.collectedByProxyOwnerId
          ? (form.collectedByProxyOwnerId as Id<"owners">)
          : undefined,
        category:
          form.action === "mahsup"
            ? (form.category as
                | "aidat"
                | "yatirim"
                | "sigorta"
                | "tadilat"
                | "boya"
                | "diger")
            : undefined,
        description:
          form.action === "mahsup"
            ? form.description.trim() || undefined
            : undefined,
      });
      toast.success("Depozito kaydı işlendi ve cari hesaplara kaydedildi.");
      setFormOpen(false);
      setRecordContractId("");
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

  // Depozitoyu tahsil eden vekiller — iade bu vekiller üzerinden yapılabilir.
  const returningCollectingVekils = useMemo(() => {
    if (!returning) return [];
    const seen = new Set<string>();
    const list: { ownerId: string; name: string }[] = [];
    (collections ?? [])
      .filter(
        (c) =>
          c.contractId.toString() === returning._id.toString() &&
          (c.collectionType ?? "rent") === "deposit" &&
          c.collectedByProxyOwnerId,
      )
      .forEach((c) => {
        const ownerId = c.collectedByProxyOwnerId!.toString();
        if (seen.has(ownerId)) return;
        seen.add(ownerId);
        const owner = ownerMap.get(ownerId);
        list.push({
          ownerId,
          name: owner?.proxy?.name ?? owner?.name ?? "Vekil",
        });
      });
    return list;
  }, [returning, collections, ownerMap]);

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Depozitolar"
        hint="Sözleşme bazında depozito takibi, tahsilat ve dağıtım işlemleri"
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
        addLabel="Yeni Kayıt"
        onAdd={() => {
          setRecordContractId("");
          setFormOpen(true);
        }}
      />

      {/* Özet şeridi — elde tutulan yalnızca tahsilatı yapılan kısmı içerir. */}
      <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">Toplam Depozito</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.total)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-emerald-700">Elde Tutulan</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums text-emerald-700">
            {formatCurrency(totals.held)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {totals.heldCount} kontrat · yalnızca tahsil edilenler
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">İade Edilen</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.returned)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">Malike Ödenen</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.paidToOwner)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-muted-foreground">Mahsup Edilen</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums">
            {formatCurrency(totals.writtenOff)}
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="eyebrow text-amber-700">Ödeme Bekleyen</p>
          <p className="mt-2 font-display text-2xl font-light tabular-nums text-amber-700">
            {formatCurrency(totals.pending)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {totals.pendingCount} kontrat · henüz tahsil edilmemiş
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
                ? "Henüz depozito kaydı yok. Kontrat kaydedildiğinde burada izlenir; “Yeni Kayıt” ile tahsilat, iade, malike ödeme veya mahsup işleyebilirsiniz."
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
                  <TableHead className="text-right">Tahsil Edilen</TableHead>
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
                  const status = statusOf(c);
                  const held = heldOf(c);
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
                      <TableCell className="text-right tabular-nums">
                        {collectedOf(c) > 0 ? (
                          <span className="text-emerald-700">
                            {formatCurrency(collectedOf(c))}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            status === "returned" ? "secondary" : "outline"
                          }
                          className={[
                            "rounded-none",
                            (status === "pending" || status === "partial") &&
                              "bg-amber-50 text-amber-700",
                            status === "paid" &&
                              "bg-emerald-50 text-emerald-700",
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-none"
                            onClick={() => {
                              setRecordContractId(c._id.toString());
                              setFormOpen(true);
                            }}
                            aria-label="Kayıt gir"
                            title="Kayıt gir (tahsil / iade / malike ödeme / mahsup)"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          {held > 0 && (
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
                          )}
                        </div>
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
                <SelectTrigger className="h-8 w-44 rounded-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="held">Elde tutulanlar</SelectItem>
                  <SelectItem value="returned">İade / dağıtılanlar</SelectItem>
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
        collectingVekils={returningCollectingVekils}
        onOpenChange={(open) => !open && setReturning(null)}
        onConfirm={handleReturn}
      />

      <DepositRecordDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setRecordContractId("");
        }}
        initialContractId={recordContractId}
        contracts={depositContracts}
        propertyMap={propertyMap}
        tenantMap={tenantMap}
        owners={owners ?? []}
        positionsByContract={positionsByContract}
        onSave={handleSaveRecord}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

function DepositReturnDialog({
  contract,
  property,
  tenant,
  collectingVekils,
  onOpenChange,
  onConfirm,
}: {
  contract: Contract | null;
  property?: Property;
  tenant?: Tenant;
  collectingVekils: { ownerId: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (contract: Contract, date: string, note: string, returnedByOwnerId: string) => void;
}) {
  const [form, setForm] = useState({
    date: TODAY,
    note: "",
    returnedBy: "office",
  });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = contract ? contract._id.toString() : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({ date: TODAY, note: "", returnedBy: "office" });
    setError(null);
  }

  const submit = () => {
    if (!contract) return;
    if (form.date === "") {
      setError("İade tarihi zorunludur.");
      return;
    }
    onConfirm(
      contract,
      form.date,
      form.note,
      form.returnedBy === "office" ? "" : form.returnedBy,
    );
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
        {collectingVekils.length > 0 && (
          <Field
            label="İadeyi Kim Yapıyor?"
            hint="vekil seçilirse devir akışına işlenir"
          >
            <Select
              value={form.returnedBy}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, returnedBy: value }))
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="office">Malik / Ofis üzerinden</SelectItem>
                {collectingVekils.map((v) => (
                  <SelectItem key={v.ownerId} value={v.ownerId}>
                    Vekil · {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
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
        {collectingVekils.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            Depozito bu vekil tarafından tahsil edilmişti. Vekil üzerinden
            iade seçilirse vekilin cari hesabındaki borç devir olarak kapanır;
            aksi halde vekilin borcu korunur ve tahsil ettiği tutarı ayrıca
            malike devredebilir.
          </p>
        )}
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */

interface DepositRecordState {
  action: "tahsil" | "iade" | "malikeOdeme" | "mahsup";
  contractId: string;
  amount: string;
  date: string;
  note: string;
  collectedByProxyOwnerId: string; // tahsil — tahsilatı yapan vekil
  category: string; // mahsup — masraf kalemi
  description: string; // mahsup — açıklama
}

const ACTION_OPTIONS: {
  id: DepositRecordState["action"];
  label: string;
  desc: string;
}[] = [
  { id: "tahsil", label: "Tahsil", desc: "Kiracı depozitoyu öder; cari hesaplara işlenir." },
  { id: "iade", label: "İade", desc: "Tahsil edilen depozito kiracıya iade edilir." },
  { id: "malikeOdeme", label: "Malike Ödeme", desc: "Tahsil edilen depozito malike ödenir." },
  { id: "mahsup", label: "Zarara / Gidere Mahsup", desc: "Depozito zarar veya gidere sayılır; masraf kaydı oluşur." },
];

function DepositRecordDialog({
  open,
  onOpenChange,
  initialContractId,
  contracts,
  propertyMap,
  tenantMap,
  owners,
  positionsByContract,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContractId: string;
  contracts: Contract[];
  propertyMap: Map<string, Property>;
  tenantMap: Map<string, Tenant>;
  owners: Owner[];
  positionsByContract: Map<
    string,
    { collected: number; disposal: ReturnType<typeof depositDisposalOf> }
  >;
  onSave: (form: DepositRecordState) => void;
}) {
  const [form, setForm] = useState<DepositRecordState>({
    action: "tahsil",
    contractId: "",
    amount: "",
    date: TODAY,
    note: "",
    collectedByProxyOwnerId: "",
    category: "diger",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? `new-${initialContractId}` : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({
      action: "tahsil",
      contractId: initialContractId,
      amount: "",
      date: TODAY,
      note: "",
      collectedByProxyOwnerId: "",
      category: "diger",
      description: "",
    });
    setError(null);
  }

  const set = <K extends keyof DepositRecordState>(
    key: K,
    value: DepositRecordState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const selectedContract = contracts.find(
    (c) => c._id.toString() === form.contractId,
  );
  const selectedPos = selectedContract
    ? positionsByContract.get(selectedContract._id.toString())
    : undefined;
  const collected = selectedPos?.collected ?? 0;
  const disposal = selectedPos?.disposal ?? {
    returned: 0,
    paidToOwner: 0,
    writtenOff: 0,
  };
  const held = selectedContract
    ? depositHeldOf(collected, disposal)
    : 0;
  const remaining = selectedContract
    ? depositRemainingOf(selectedContract, collected)
    : 0;

  const proxyOwners = useMemo(
    () => owners.filter((o) => o.proxy !== null),
    [owners],
  );

  const limitLabel =
    form.action === "tahsil"
      ? `Tahsil edilebilir: ${formatCurrency(remaining)}`
      : `Elde tutulan: ${formatCurrency(held)}`;

  const submit = () => {
    if (form.contractId === "" || form.date === "") {
      setError("Kontrat ve kayıt tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      setError("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    if (form.action === "tahsil" && amount > remaining) {
      setError(`Tahsil edilebilecek depozito ${formatCurrency(remaining)} ile sınırlıdır.`);
      return;
    }
    if (form.action !== "tahsil" && amount > held) {
      setError(`Elde tutulan depozito ${formatCurrency(held)} ile sınırlıdır.`);
      return;
    }
    if (form.action === "mahsup" && form.description.trim() === "") {
      setError("Mahsup için gider açıklaması zorunludur.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Depozito Kaydı"
      description="Tahsil, iade, malike ödeme veya zarara/gidere mahsup kaydı işlenir; cari hesaplara otomatik yansır."
      wide
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
            Kaydı İşle
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

        <Field label="İşlem Türü" required>
          <Select
            value={form.action}
            onValueChange={(value) =>
              set("action", value as DepositRecordState["action"])
            }
          >
            <SelectTrigger className="rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="-mt-2 text-xs leading-5 text-muted-foreground">
          {ACTION_OPTIONS.find((a) => a.id === form.action)?.desc}
        </p>

        <Field label="Kontrat" required hint="gayrimenkul · kiracı">
          <Select
            value={form.contractId}
            onValueChange={(value) => set("contractId", value)}
          >
            <SelectTrigger className="rounded-none">
              <SelectValue placeholder="Kontrat seçin" />
            </SelectTrigger>
            <SelectContent>
              {contracts.map((c) => {
                const property = propertyMap.get(c.propertyId.toString());
                const tenant = tenantMap.get(c.tenantId.toString());
                return (
                  <SelectItem key={c._id} value={c._id}>
                    {property?.name ?? "Gayrimenkul"} · {tenant?.name ?? "Kiracı"}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>

        {selectedContract && (
          <p className="-mt-2 text-xs leading-5 text-muted-foreground">
            Depozito {formatCurrency(selectedContract.depositAmount)} · tahsil
            edilen {formatCurrency(collected)} · {limitLabel}
          </p>
        )}

        <Row>
          <Field label="Tutar" required hint="₺">
            <Input
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="15000"
              className="rounded-none"
            />
          </Field>
          <Field label="Tarih" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className="rounded-none"
            />
          </Field>
        </Row>

        {form.action === "tahsil" && (
          <Field
            label="Tahsilatı Yapan"
            hint="vekil seçilirse cari hesabına borç işlenir"
          >
            <Select
              value={
                form.collectedByProxyOwnerId === ""
                  ? "office"
                  : form.collectedByProxyOwnerId
              }
              onValueChange={(value) =>
                set(
                  "collectedByProxyOwnerId",
                  value === "office" ? "" : value,
                )
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="office">Malik / Ofis</SelectItem>
                {proxyOwners.map((o) => (
                  <SelectItem key={o._id} value={o._id}>
                    {o.proxy?.name} ({o.name} adına)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {form.action === "mahsup" && (
          <Row>
            <Field label="Masraf Kalemi">
              <Select
                value={form.category}
                onValueChange={(value) => set("category", value)}
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aidat">Aidat</SelectItem>
                  <SelectItem value="yatirim">Yatırım</SelectItem>
                  <SelectItem value="sigorta">Sigorta</SelectItem>
                  <SelectItem value="tadilat">Tadilat-Bakım/Onarım</SelectItem>
                  <SelectItem value="boya">Boya</SelectItem>
                  <SelectItem value="diger">Diğer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Gider Açıklaması" required hint="örn. hasar tespiti">
              <Input
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="örn. kombi arızası, cam kırığı…"
                className="rounded-none"
              />
            </Field>
          </Row>
        )}

        <Field label="Not" hint="isteğe bağlı">
          <Input
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="İşleme dair açıklama"
            className="rounded-none"
          />
        </Field>
      </div>
    </DialogShell>
  );
}
