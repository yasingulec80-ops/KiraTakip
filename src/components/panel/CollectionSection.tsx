import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  dateToInput,
  downloadCsv,
  formatCurrency,
  formatDate,
  parseDateInput,
  parseNumber,
  printReport,
} from "@/lib/export";
import { sameProxyCollectionConflict } from "@/lib/collection-guard";
import { useMutation, useQuery } from "convex/react";
import { HandCoins, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field, Row } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Collection = Doc<"collections">;
type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Tenant = Doc<"tenants">;
type Owner = Doc<"owners">;

const TODAY = dateToInput(Date.now());

const CSV_HEADERS = [
  "Tarih",
  "Gayrimenkul",
  "Kiracı",
  "Dönem",
  "Tür",
  "Ödeyen",
  "Tahsil Eden",
  "Tutar",
  "Not",
];

const COLLECTION_TYPE_LABEL: Record<string, string> = {
  rent: "Kira",
  deposit: "Depozito",
};

export function CollectionSection() {
  const { user } = useAuth();
  const collections = useQuery(api.collections.list);
  const contracts = useQuery(api.contracts.list);
  const properties = useQuery(api.properties.list);
  const tenants = useQuery(api.tenants.list);
  const owners = useQuery(api.owners.list);
  const accruals = useQuery(api.accruals.list);
  const createCollection = useMutation(api.collections.create);
  const removeCollection = useMutation(api.collections.remove);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Collection | null>(null);

  const contractMap = useMemo(() => {
    const map = new Map<string, Contract>();
    (contracts ?? []).forEach((c) => map.set(c._id.toString(), c));
    return map;
  }, [contracts]);
  const propertyMap = useMemo(() => {
    const map = new Map<string, Property>();
    (properties ?? []).forEach((p) => map.set(p._id.toString(), p));
    return map;
  }, [properties]);
  const tenantMap = useMemo(() => {
    const map = new Map<string, Tenant>();
    (tenants ?? []).forEach((t) => map.set(t._id.toString(), t));
    return map;
  }, [tenants]);
  const ownerMap = useMemo(() => {
    const map = new Map<string, Owner>();
    (owners ?? []).forEach((o) => map.set(o._id.toString(), o));
    return map;
  }, [owners]);
  const accrualMap = useMemo(() => {
    const map = new Map<string, Doc<"accruals">>();
    (accruals ?? []).forEach((a) => map.set(a._id.toString(), a));
    return map;
  }, [accruals]);

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (collections ?? []).filter((c) => {
      if (fromMs !== null && c.date < fromMs) return false;
      if (toMs !== null && c.date > toMs) return false;
      if (q === "") return true;

      const contract = contractMap.get(c.contractId.toString());
      const property = contract
        ? propertyMap.get(contract.propertyId.toString())
        : undefined;
      const tenant = c.tenantId
        ? tenantMap.get(c.tenantId.toString())
        : undefined;
      const proxyOwner = c.proxyOwnerId
        ? ownerMap.get(c.proxyOwnerId.toString())
        : undefined;
      const haystack = [
        property?.name,
        tenant?.name,
        proxyOwner?.proxy?.name,
        c.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [collections, contractMap, propertyMap, tenantMap, ownerMap, search, from, to]);

  const isAdmin = user?.role === "admin";

  const total = useMemo(
    () => filtered.reduce((sum, c) => sum + c.amount, 0),
    [filtered],
  );

  const payerLabel = (c: Collection): string => {
    if (c.paidByType === "proxy" && c.proxyOwnerId) {
      const owner = ownerMap.get(c.proxyOwnerId.toString());
      return `Vekil · ${owner?.proxy?.name ?? owner?.name ?? "—"}`;
    }
    const tenant = c.tenantId ? tenantMap.get(c.tenantId.toString()) : undefined;
    return tenant?.name ?? "Kiracı";
  };

  const collectedByLabel = (c: Collection): string => {
    if (c.collectedByProxyOwnerId) {
      const owner = ownerMap.get(c.collectedByProxyOwnerId.toString());
      return owner?.proxy?.name ?? owner?.name ?? "Vekil";
    }
    return "Malik";
  };

  const rows = (c: Collection): (string | number | null)[] => {
    const contract = contractMap.get(c.contractId.toString());
    const property = contract
      ? propertyMap.get(contract.propertyId.toString())
      : undefined;
    const tenant = contract
      ? tenantMap.get(contract.tenantId.toString())
      : undefined;
    const accrual = c.accrualId ? accrualMap.get(c.accrualId.toString()) : undefined;
    return [
      formatDate(c.date),
      property?.name ?? "—",
      tenant?.name ?? "—",
      accrual?.period ?? "—",
      COLLECTION_TYPE_LABEL[c.collectionType ?? "rent"],
      payerLabel(c),
      collectedByLabel(c),
      c.amount,
      c.notes ?? "",
    ];
  };

  const exportCsv = () => {
    downloadCsv("tahsilatlar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Tahsilatlar", "Kira tahsilat dökümü", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: CollectionFormState) => {
    const date = parseDateInput(form.date);
    if (!form.contractId || !date) {
      toast.error("Kontrat ve tahsilat tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      toast.error("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    try {
      await createCollection({
        contractId: form.contractId as Id<"contracts">,
        accrualId: form.accrualId
          ? (form.accrualId as Id<"accruals">)
          : undefined,
        amount,
        date,
        paidByType: form.paidByType,
        collectionType: form.collectionType,
        tenantId:
          form.paidByType === "tenant"
            ? (form.personId as Id<"tenants">)
            : undefined,
        proxyOwnerId:
          form.paidByType === "proxy"
            ? (form.personId as Id<"owners">)
            : undefined,
        collectedByProxyOwnerId: form.collectedByProxyOwnerId
          ? (form.collectedByProxyOwnerId as Id<"owners">)
          : undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success("Tahsilat işlendi ve cari hesaba kaydedildi.");
      setFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await removeCollection({ id: deleting._id });
      toast.success("Tahsilat ve cari hesap kaydı silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Tahsilatlar"
        hint="İşlenen kira tahsilatları ve cari hesap kayıtları"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Gayrimenkul, kiracı, vekil ara…"
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
        addLabel="Tahsilat Kaydı"
        onAdd={() => setFormOpen(true)}
      />

      {collections === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HandCoins />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {collections.length === 0
                ? "Henüz tahsilat kaydı yok. İlk tahsilatı işlediğinizde cari hesaba otomatik kaydedilir."
                : "Arama veya tarih aralığı filtrelerine uyan kayıt yok."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tarih</TableHead>
                  <TableHead>Gayrimenkul</TableHead>
                  <TableHead>Kiracı</TableHead>
                  <TableHead>Dönem</TableHead>
                  <TableHead>Tür</TableHead>
                  <TableHead>Ödeyen</TableHead>
                  <TableHead>Tahsil Eden</TableHead>
                  <TableHead>Not</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const contract = contractMap.get(c.contractId.toString());
                  const property = contract
                    ? propertyMap.get(contract.propertyId.toString())
                    : undefined;
                  const tenant = contract
                    ? tenantMap.get(contract.tenantId.toString())
                    : undefined;
                  const accrual = c.accrualId
                    ? accrualMap.get(c.accrualId.toString())
                    : undefined;
                  return (
                    <TableRow key={c._id} className="align-middle">
                      <TableCell className="text-sm">{formatDate(c.date)}</TableCell>
                      <TableCell className="text-sm">{property?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{tenant?.name ?? "—"}</TableCell>
                      <TableCell>
                        {accrual ? (
                          <Badge variant="outline" className="rounded-none tabular-nums text-muted-foreground">
                            {accrual.period}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {(c.collectionType ?? "rent") === "deposit" ? (
                          <Badge className="rounded-none bg-muted text-muted-foreground">
                            Depozito
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-none text-muted-foreground">
                            Kira
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.paidByType === "proxy" ? (
                          <span className="text-brand">{payerLabel(c)}</span>
                        ) : (
                          payerLabel(c)
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.collectedByProxyOwnerId ? (
                          <span className="font-medium">{collectedByLabel(c)}</span>
                        ) : (
                          <span className="text-muted-foreground">Malik</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                        {c.notes ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-emerald-700">
                        +{formatCurrency(c.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-none text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleting(c)}
                            aria-label="Tahsilatı sil"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
              {filtered.length} / {collections.length} kayıt gösteriliyor
            </span>
            <span>
              Toplam tahsilat:{" "}
              <span className="font-medium text-emerald-700">
                {formatCurrency(total)}
              </span>
            </span>
          </div>
        </div>
      )}

      <CollectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        contracts={contracts ?? []}
        propertyMap={propertyMap}
        tenantMap={tenantMap}
        owners={owners ?? []}
        accruals={accruals ?? []}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Tahsilat silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bu tahsilat ve cari hesap kaydı kalıcı olarak silinir. Bu işlem
              geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface CollectionFormState {
  contractId: string;
  accrualId: string;
  amount: string;
  date: string;
  paidByType: "tenant" | "proxy";
  collectionType: "rent" | "deposit";
  collectedByProxyOwnerId: string;
  personId: string;
  notes: string;
}

function CollectionFormDialog({
  open,
  onOpenChange,
  contracts,
  propertyMap,
  tenantMap,
  owners,
  accruals,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contracts: Contract[];
  propertyMap: Map<string, Property>;
  tenantMap: Map<string, Tenant>;
  owners: Owner[];
  accruals: Doc<"accruals">[];
  onSave: (form: CollectionFormState) => void;
}) {
  const [form, setForm] = useState<CollectionFormState>({
    contractId: "",
    accrualId: "",
    amount: "",
    date: TODAY,
    paidByType: "tenant",
    collectionType: "rent",
    collectedByProxyOwnerId: "",
    personId: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? "new" : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({
      contractId: "",
      accrualId: "",
      amount: "",
      date: TODAY,
      paidByType: "tenant",
      collectionType: "rent",
      collectedByProxyOwnerId: "",
      personId: "",
      notes: "",
    });
    setError(null);
  }

  const selectedContract = contracts.find(
    (c) => c._id.toString() === form.contractId,
  );
  const contractAccruals = useMemo(
    () =>
      accruals
        .filter((a) => a.contractId.toString() === form.contractId)
        .sort((a, b) => b.dueDate - a.dueDate),
    [accruals, form.contractId],
  );
  const proxyOwners = useMemo(
    () => owners.filter((o) => o.proxy !== null),
    [owners],
  );

  const set = <K extends keyof CollectionFormState>(
    key: K,
    value: CollectionFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (form.contractId === "" || form.date === "") {
      setError("Kontrat ve tahsilat tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      setError("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    if (
      form.paidByType === "tenant" &&
      !selectedContract
    ) {
      setError("Kontrat seçilmelidir.");
      return;
    }
    if (
      sameProxyCollectionConflict(
        form.paidByType,
        form.personId,
        form.collectedByProxyOwnerId,
      )
    ) {
      setError("Ödeyen vekil ile tahsilatı yapan aynı vekil olamaz.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Tahsilat Kaydı"
      description="Tahsilat işlendiğinde cari hesaplara otomatik kaydedilir."
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
            Tahsilatı İşle
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

        <Field label="Kontrat" required>
          <Select
            value={form.contractId}
            onValueChange={(value) => {
              const contract = contracts.find((c) => c._id.toString() === value);
              setForm((f) => ({
                ...f,
                contractId: value,
                accrualId: "",
                amount:
                  f.amount === "" && contract
                    ? String(contract.rentAmount)
                    : f.amount,
                personId: contract ? contract.tenantId.toString() : f.personId,
              }));
            }}
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
                    {property?.name ?? "—"} · {tenant?.name ?? "—"}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>

        <Row>
          <Field label="Tutar" required hint="₺">
            <Input
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="15000"
              className="rounded-none"
            />
          </Field>
          <Field label="Tahsilat Tarihi" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className="rounded-none"
            />
          </Field>
        </Row>

        <Row>
          <Field label="Tahsilat Türü" required>
            <Select
              value={form.collectionType}
              onValueChange={(value) =>
                setForm((f) => {
                  const collectionType = value as CollectionFormState["collectionType"];
                  if (collectionType === "deposit") {
                    const contract = contracts.find(
                      (c) => c._id.toString() === f.contractId,
                    );
                    return {
                      ...f,
                      collectionType,
                      accrualId: "",
                      paidByType: "tenant",
                      personId: contract ? contract.tenantId.toString() : "",
                    };
                  }
                  return { ...f, collectionType };
                })
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rent">Kira</SelectItem>
                <SelectItem value="deposit">Depozito</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Tahsilatı Yapan"
            hint={
              form.paidByType === "proxy" && form.personId
                ? "ödeyen vekil ile aynı seçilemez"
                : "vekil seçilirse cari hesabına borç işlenir"
            }
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
                  value === "office"
                    ? ""
                    : form.paidByType === "proxy" &&
                        value === form.personId
                      ? ""
                      : value,
                )
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="office">Malik</SelectItem>
                {proxyOwners.map((o) => (
                  <SelectItem
                    key={o._id}
                    value={o._id}
                    disabled={
                      form.paidByType === "proxy" &&
                      form.personId === o._id.toString()
                    }
                  >
                    {o.proxy?.name} ({o.name} adına)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Row>

        {form.collectionType === "rent" && (
          <Row>
            <Field label="Ödeyen">
              <Select
                value={form.paidByType}
                onValueChange={(value) =>
                  setForm((f) => ({
                    ...f,
                    paidByType: value as CollectionFormState["paidByType"],
                    personId:
                      value === "tenant" && f.contractId !== ""
                        ? (contracts.find((c) => c._id.toString() === f.contractId)
                            ?.tenantId.toString() ?? "")
                        : "",
                  }))
                }
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">Kiracı</SelectItem>
                  <SelectItem value="proxy">Vekil</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={form.paidByType === "proxy" ? "Vekil" : "Kiracı"} required>
              <Select
                value={form.personId}
                onValueChange={(value) =>
                  setForm((f) => ({
                    ...f,
                    personId: value,
                    // Ödeyen vekil aynı zamanda "Tahsilatı Yapan" olamaz —
                    // çelişkili kaydı önlemek için alan temizlenir.
                    collectedByProxyOwnerId:
                      f.paidByType === "proxy" &&
                      f.collectedByProxyOwnerId === value
                        ? ""
                        : f.collectedByProxyOwnerId,
                  }))
                }
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue
                    placeholder={
                      form.paidByType === "proxy"
                        ? "Vekil seçin"
                        : selectedContract
                          ? tenantMap.get(selectedContract.tenantId.toString())?.name ?? "Kiracı seçin"
                          : "Kiracı seçin"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {form.paidByType === "proxy"
                    ? proxyOwners.map((o) => (
                        <SelectItem key={o._id} value={o._id}>
                          {o.proxy?.name} ({o.name} adına)
                        </SelectItem>
                      ))
                    : selectedContract
                      ? (() => {
                          const tenant = tenantMap.get(
                            selectedContract.tenantId.toString(),
                          );
                          return tenant ? (
                            <SelectItem key={tenant._id} value={tenant._id}>
                              {tenant.name}
                            </SelectItem>
                          ) : null;
                        })()
                      : contracts.map((c) => {
                          const tenant = tenantMap.get(c.tenantId.toString());
                          return tenant ? (
                            <SelectItem key={tenant._id} value={tenant._id}>
                              {tenant.name}
                            </SelectItem>
                          ) : null;
                        })}
                </SelectContent>
              </Select>
            </Field>
          </Row>
        )}

        {form.collectionType === "rent" && (
          <Field label="Tahakkuka Bağla" hint="boş bırakılırsa en eski ödenmemiş tahakkuka otomatik bağlanır">
            <Select
              value={form.accrualId}
              onValueChange={(value) => set("accrualId", value)}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Otomatik (en eski açık tahakkuk)" />
              </SelectTrigger>
              <SelectContent>
                {contractAccruals.map((a) => (
                  <SelectItem key={a._id} value={a._id}>
                    {a.period} · {formatCurrency(a.amount)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label="Not">
          <Input
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="İsteğe bağlı açıklama"
            className="rounded-none"
          />
        </Field>
      </div>
    </DialogShell>
  );
}
