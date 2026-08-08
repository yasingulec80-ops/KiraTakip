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
import { useMutation, useQuery } from "convex/react";
import { ReceiptText, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field, Row } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Expense = Doc<"expenses">;
type Property = Doc<"properties">;
type Contract = Doc<"contracts">;
type Owner = Doc<"owners">;
type Tenant = Doc<"tenants">;

const EXPENSE_CATEGORIES: { id: Expense["category"]; label: string }[] = [
  { id: "aidat", label: "Aidat" },
  { id: "yatirim", label: "Yatırım" },
  { id: "sigorta", label: "Sigorta" },
  { id: "tadilat", label: "Tadilat-Bakım/Onarım" },
  { id: "boya", label: "Boya" },
  { id: "diger", label: "Diğer" },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.id, c.label]),
);

const TODAY = dateToInput(Date.now());

const CSV_HEADERS = [
  "Tarih",
  "Gayrimenkul",
  "Kalem",
  "Ödeyen",
  "Açıklama",
  "Tutar",
];

export function ExpenseSection() {
  const { user } = useAuth();
  const expenses = useQuery(api.expenses.list);
  const properties = useQuery(api.properties.list);
  const contracts = useQuery(api.contracts.list);
  const owners = useQuery(api.owners.list);
  const tenants = useQuery(api.tenants.list);
  const createExpense = useMutation(api.expenses.create);
  const removeExpense = useMutation(api.expenses.remove);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);

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

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (expenses ?? []).filter((e) => {
      if (fromMs !== null && e.date < fromMs) return false;
      if (toMs !== null && e.date > toMs) return false;
      if (q === "") return true;

      const property = propertyMap.get(e.propertyId.toString());
      const payer = payerLabel(e, ownerMap, tenantMap);
      const haystack = [
        property?.name,
        CATEGORY_LABEL[e.category],
        payer,
        e.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [expenses, propertyMap, ownerMap, tenantMap, search, from, to]);

  const isAdmin = user?.role === "admin";

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((e) => {
      totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    });
    return totals;
  }, [filtered]);

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + e.amount, 0),
    [filtered],
  );

  const rows = (e: Expense): (string | number | null)[] => {
    const property = propertyMap.get(e.propertyId.toString());
    return [
      formatDate(e.date),
      property?.name ?? "—",
      CATEGORY_LABEL[e.category],
      payerLabel(e, ownerMap, tenantMap),
      e.description,
      e.amount,
    ];
  };

  const exportCsv = () => {
    downloadCsv("masraflar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Masraflar", "Gayrimenkul gider dökümü", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: ExpenseFormState) => {
    const date = parseDateInput(form.date);
    if (!form.propertyId || !date) {
      toast.error("Gayrimenkul ve masraf tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      toast.error("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    if (form.description.trim() === "") {
      toast.error("Açıklama zorunludur.");
      return;
    }
    try {
      await createExpense({
        propertyId: form.propertyId as Id<"properties">,
        contractId: form.contractId
          ? (form.contractId as Id<"contracts">)
          : undefined,
        category: form.category,
        amount,
        date,
        paidByType: form.paidByType ?? undefined,
        payerOwnerId:
          form.paidByType === "owner" || form.paidByType === "proxy"
            ? (form.personId as Id<"owners">)
            : undefined,
        payerTenantId:
          form.paidByType === "tenant"
            ? (form.personId as Id<"tenants">)
            : undefined,
        description: form.description.trim(),
      });
      toast.success("Masraf kaydedildi ve cari hesaba işlendi.");
      setFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await removeExpense({ id: deleting._id });
      toast.success("Masraf ve cari hesap kaydı silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Masraflar"
        hint="Aidat, yatırım, sigorta, tadilat, boya ve diğer giderler"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Gayrimenkul, kalem, ödeyen ara…"
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
        addLabel="Masraf Kaydı"
        onAdd={() => setFormOpen(true)}
      />

      {expenses === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptText />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {expenses.length === 0
                ? "Henüz masraf kaydı yok. İlk masrafı kaydettiğinizde ödeyenin cari hesabına işlenir."
                : "Arama veya tarih aralığı filtrelerine uyan kayıt yok."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-4">
          {/* Kalem bazlı toplamlar */}
          <div className="grid gap-px border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
            {EXPENSE_CATEGORIES.map((category) => (
              <div key={category.id} className="bg-card p-4">
                <p className="eyebrow text-muted-foreground">{category.label}</p>
                <p className="mt-2 font-display text-lg font-light tabular-nums">
                  {formatCurrency(categoryTotals.get(category.id) ?? 0)}
                </p>
              </div>
            ))}
          </div>

          <div className="border border-border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tarih</TableHead>
                    <TableHead>Gayrimenkul</TableHead>
                    <TableHead>Kalem</TableHead>
                    <TableHead>Ödeyen</TableHead>
                    <TableHead>Açıklama</TableHead>
                    <TableHead className="text-right">Tutar</TableHead>
                    <TableHead className="text-right">Eylemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => {
                    const property = propertyMap.get(e.propertyId.toString());
                    return (
                      <TableRow key={e._id} className="align-middle">
                        <TableCell className="text-sm">{formatDate(e.date)}</TableCell>
                        <TableCell className="text-sm">{property?.name ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="rounded-none">
                            {CATEGORY_LABEL[e.category]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {e.paidByType ? payerLabel(e, ownerMap, tenantMap) : "—"}
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                          {e.description}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="text-amber-700">
                            −{formatCurrency(e.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdmin && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-none text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleting(e)}
                              aria-label="Masrafı sil"
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
                {filtered.length} / {expenses.length} kayıt gösteriliyor
              </span>
              <span>
                Toplam masraf:{" "}
                <span className="font-medium text-amber-700">
                  {formatCurrency(total)}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        properties={properties ?? []}
        contracts={contracts ?? []}
        owners={owners ?? []}
        tenants={tenants ?? []}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Masraf silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bu masraf ve cari hesap kaydı kalıcı olarak silinir. Bu işlem geri
              alınamaz.
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

const payerLabel = (
  e: Expense,
  ownerMap: Map<string, Owner>,
  tenantMap: Map<string, Tenant>,
): string => {
  if (e.paidByType === "owner" && e.payerOwnerId) {
    return ownerMap.get(e.payerOwnerId.toString())?.name ?? "Malik";
  }
  if (e.paidByType === "proxy" && e.payerOwnerId) {
    const owner = ownerMap.get(e.payerOwnerId.toString());
    return `Vekil · ${owner?.proxy?.name ?? owner?.name ?? "—"}`;
  }
  if (e.paidByType === "tenant" && e.payerTenantId) {
    return tenantMap.get(e.payerTenantId.toString())?.name ?? "Kiracı";
  }
  return "—";
};

interface ExpenseFormState {
  propertyId: string;
  contractId: string;
  category: Expense["category"];
  amount: string;
  date: string;
  paidByType: "owner" | "tenant" | "proxy" | null;
  personId: string;
  description: string;
}

function ExpenseFormDialog({
  open,
  onOpenChange,
  properties,
  contracts,
  owners,
  tenants,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: Property[];
  contracts: Contract[];
  owners: Owner[];
  tenants: Tenant[];
  onSave: (form: ExpenseFormState) => void;
}) {
  const [form, setForm] = useState<ExpenseFormState>({
    propertyId: "",
    contractId: "",
    category: "aidat",
    amount: "",
    date: TODAY,
    paidByType: null,
    personId: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? "new" : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({
      propertyId: "",
      contractId: "",
      category: "aidat",
      amount: "",
      date: TODAY,
      paidByType: null,
      personId: "",
      description: "",
    });
    setError(null);
  }

  const propertyContracts = useMemo(
    () =>
      contracts.filter((c) => c.propertyId.toString() === form.propertyId),
    [contracts, form.propertyId],
  );
  const proxyOwners = useMemo(
    () => owners.filter((o) => o.proxy !== null),
    [owners],
  );

  const set = <K extends keyof ExpenseFormState>(
    key: K,
    value: ExpenseFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (form.propertyId === "" || form.date === "") {
      setError("Gayrimenkul ve masraf tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      setError("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    if (form.description.trim() === "") {
      setError("Açıklama zorunludur.");
      return;
    }
    if (form.paidByType && form.personId === "") {
      setError("Masrafı yapan kişi seçilmelidir.");
      return;
    }
    onSave(form);
  };

  const payerOptions =
    form.paidByType === "owner"
      ? owners
      : form.paidByType === "proxy"
        ? proxyOwners
        : form.paidByType === "tenant"
          ? tenants
          : [];

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Masraf Kaydı"
      description="Masrafı yapan seçilir; kayıt seçilen kişinin cari hesabına işlenir."
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
            Kaydet
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

        <Row>
          <Field label="Gayrimenkul" required>
            <Select
              value={form.propertyId}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, propertyId: value, contractId: "" }))
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Gayrimenkul seçin" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kalem" required>
            <Select
              value={form.category}
              onValueChange={(value) =>
                set("category", value as ExpenseFormState["category"])
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Row>

        <Row>
          <Field label="Kontrat" hint="isteğe bağlı">
            <Select
              value={form.contractId}
              onValueChange={(value) => set("contractId", value)}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Kontrat bağlamayın" />
              </SelectTrigger>
              <SelectContent>
                {propertyContracts.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" })
                      .format(new Date(c.startDate))}{" "}
                    başlangıçlı kontrat
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tutar" required hint="₺">
            <Input
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="2000"
              className="rounded-none"
            />
          </Field>
        </Row>

        <Row>
          <Field label="Masraf Tarihi" required>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className="rounded-none"
            />
          </Field>
          <Field label="Masrafı Yapan" hint="Malik · Kiracı · Vekil">
            <Select
              value={form.paidByType ?? ""}
              onValueChange={(value) =>
                setForm((f) => ({
                  ...f,
                  paidByType: (value || null) as ExpenseFormState["paidByType"],
                  personId: "",
                }))
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Ödeyeni seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Malik</SelectItem>
                <SelectItem value="tenant">Kiracı</SelectItem>
                <SelectItem value="proxy">Vekil</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Row>

        {form.paidByType && (
          <Field
            label={
              form.paidByType === "owner"
                ? "Malik"
                : form.paidByType === "tenant"
                  ? "Kiracı"
                  : "Vekil"
            }
            required
          >
            <Select
              value={form.personId}
              onValueChange={(value) => set("personId", value)}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue
                  placeholder={
                    form.paidByType === "proxy" ? "Vekil seçin" : "Kişi seçin"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {payerOptions.map((person) => {
                  const name =
                    "proxy" in person && person.proxy
                      ? `${person.proxy.name} (${person.name} adına)`
                      : person.name;
                  return (
                    <SelectItem
                      key={person._id}
                      value={person._id}
                    >
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label="Açıklama" required>
          <Input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="örn. Kombi bakımı"
            className="rounded-none"
          />
        </Field>
      </div>
    </DialogShell>
  );
}
