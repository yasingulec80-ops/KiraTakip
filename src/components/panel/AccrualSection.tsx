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
import { CalendarClock, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field, Row } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Accrual = Doc<"accruals">;
type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Tenant = Doc<"tenants">;

const ACCRUAL_STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  partial: "Kısmen ödendi",
  paid: "Ödendi",
};

const TODAY = dateToInput(Date.now());

const CSV_HEADERS = [
  "Dönem",
  "Vade Tarihi",
  "Gayrimenkul",
  "Kiracı",
  "Tahakkuk",
  "Ödenen",
  "Kalan",
  "Durum",
];

export function AccrualSection() {
  const { user } = useAuth();
  const accruals = useQuery(api.accruals.list);
  const collections = useQuery(api.collections.list);
  const contracts = useQuery(api.contracts.list);
  const properties = useQuery(api.properties.list);
  const tenants = useQuery(api.tenants.list);
  const createAccrual = useMutation(api.accruals.create);
  const removeAccrual = useMutation(api.accruals.remove);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Accrual | null>(null);

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

  const paidByAccrual = useMemo(() => {
    const map = new Map<string, number>();
    (collections ?? []).forEach((c) => {
      if (!c.accrualId) return;
      map.set(
        c.accrualId.toString(),
        (map.get(c.accrualId.toString()) ?? 0) + c.amount,
      );
    });
    return map;
  }, [collections]);

  const enriched = useMemo(
    () =>
      (accruals ?? []).map((a) => ({
        ...a,
        paid: paidByAccrual.get(a._id.toString()) ?? 0,
        remaining: Math.max(0, a.amount - (paidByAccrual.get(a._id.toString()) ?? 0)),
      })),
    [accruals, paidByAccrual],
  );

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return enriched.filter((a) => {
      if (fromMs !== null && a.dueDate < fromMs) return false;
      if (toMs !== null && a.dueDate > toMs) return false;
      if (q === "") return true;

      const contract = contractMap.get(a.contractId.toString());
      const property = contract
        ? propertyMap.get(contract.propertyId.toString())
        : undefined;
      const tenant = contract
        ? tenantMap.get(contract.tenantId.toString())
        : undefined;
      const haystack = [
        a.period,
        property?.name,
        tenant?.name,
        ACCRUAL_STATUS_LABEL[a.status ?? "pending"],
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [enriched, contractMap, propertyMap, tenantMap, search, from, to]);

  const isAdmin = user?.role === "admin";

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, a) => ({
          amount: acc.amount + a.amount,
          paid: acc.paid + a.paid,
          remaining: acc.remaining + a.remaining,
        }),
        { amount: 0, paid: 0, remaining: 0 },
      ),
    [filtered],
  );

  const rows = (a: (typeof enriched)[number]): (string | number | null)[] => {
    const contract = contractMap.get(a.contractId.toString());
    const property = contract
      ? propertyMap.get(contract.propertyId.toString())
      : undefined;
    const tenant = contract
      ? tenantMap.get(contract.tenantId.toString())
      : undefined;
    return [
      a.period,
      formatDate(a.dueDate),
      property?.name ?? "—",
      tenant?.name ?? "—",
      a.amount,
      a.paid,
      a.remaining,
      ACCRUAL_STATUS_LABEL[a.status ?? "pending"],
    ];
  };

  const exportCsv = () => {
    downloadCsv("tahakkuklar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Tahakkuklar", "Kira tahakkuk dökümü", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: AccrualFormState) => {
    const dueDate = parseDateInput(form.dueDate);
    if (!form.contractId || !dueDate) {
      toast.error("Kontrat ve vade tarihi zorunludur.");
      return;
    }
    try {
      await createAccrual({
        contractId: form.contractId as Id<"contracts">,
        amount: parseNumber(form.amount) ?? 0,
        dueDate,
      });
      toast.success("Tahakkuk oluşturuldu ve cari hesaba işlendi.");
      setFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await removeAccrual({ id: deleting._id });
      toast.success("Tahakkuk ve cari hesap kaydı silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        num="05"
        title="Tahakkuklar"
        hint="Otomatik oluşturulan aylık kira tahakkukları"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Dönem, gayrimenkul, kiracı ara…"
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
        addLabel="Tahakkuk Oluştur"
        onAdd={() => setFormOpen(true)}
      />

      {accruals === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {accruals.length === 0
                ? "Henüz tahakkuk yok. Kontrat oluşturduğunuzda aylık tahakkuklar otomatik işlenir; isterseniz elle de oluşturabilirsiniz."
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
                  <TableHead>Dönem</TableHead>
                  <TableHead>Gayrimenkul</TableHead>
                  <TableHead>Kiracı</TableHead>
                  <TableHead className="text-right">Tahakkuk</TableHead>
                  <TableHead className="text-right">Ödenen</TableHead>
                  <TableHead className="text-right">Kalan</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => {
                  const contract = contractMap.get(a.contractId.toString());
                  const property = contract
                    ? propertyMap.get(contract.propertyId.toString())
                    : undefined;
                  const tenant = contract
                    ? tenantMap.get(contract.tenantId.toString())
                    : undefined;
                  const status = a.status ?? "pending";
                  return (
                    <TableRow key={a._id} className="align-middle">
                      <TableCell>
                        <div className="font-medium tabular-nums">{a.period}</div>
                        <div className="text-xs text-muted-foreground">
                          Vade: {formatDate(a.dueDate)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{property?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{tenant?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(a.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {a.paid > 0 ? formatCurrency(a.paid) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.remaining > 0 ? (
                          <span className="text-amber-700">
                            {formatCurrency(a.remaining)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            status === "paid"
                              ? "default"
                              : status === "partial"
                                ? "secondary"
                                : "outline"
                          }
                          className={[
                            "rounded-none",
                            status === "partial" && "text-amber-700",
                            status === "pending" && "text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {ACCRUAL_STATUS_LABEL[status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-none text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleting(a)}
                            aria-label="Tahakkuku sil"
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
              {filtered.length} / {accruals.length} kayıt gösteriliyor
            </span>
            <div className="flex items-center gap-5">
              <span>
                Toplam: <span className="font-medium text-foreground">{formatCurrency(totals.amount)}</span>
              </span>
              <span>
                Ödenen: <span className="font-medium text-emerald-700">{formatCurrency(totals.paid)}</span>
              </span>
              <span>
                Kalan: <span className="font-medium text-amber-700">{formatCurrency(totals.remaining)}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <AccrualFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        contracts={contracts ?? []}
        propertyMap={propertyMap}
        tenantMap={tenantMap}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Tahakkuk silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.period} dönemi tahakkuku ve cari hesap kaydı silinir.` : ""}{" "}
              Bu işlem geri alınamaz.
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

interface AccrualFormState {
  contractId: string;
  amount: string;
  dueDate: string;
}

function AccrualFormDialog({
  open,
  onOpenChange,
  contracts,
  propertyMap,
  tenantMap,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contracts: Contract[];
  propertyMap: Map<string, Property>;
  tenantMap: Map<string, Tenant>;
  onSave: (form: AccrualFormState) => void;
}) {
  const [form, setForm] = useState<AccrualFormState>({
    contractId: "",
    amount: "",
    dueDate: TODAY,
  });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? "new" : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({
      contractId: "",
      amount: "",
      dueDate: TODAY,
    });
    setError(null);
  }

  const selectedContract = contracts.find(
    (c) => c._id.toString() === form.contractId,
  );

  const submit = () => {
    if (form.contractId === "" || form.dueDate === "") {
      setError("Kontrat ve vade tarihi zorunludur.");
      return;
    }
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      setError("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Tahakkuk Oluştur"
      description="Seçilen kontrat için elle tahakkuk oluşturulur ve cari hesaplara işlenir."
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
            Oluştur
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
                amount:
                  f.amount === "" && contract
                    ? String(contract.rentAmount)
                    : f.amount,
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
          <Field label="Tutar" hint="₺">
            <Input
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder={selectedContract ? String(selectedContract.rentAmount) : "15000"}
              className="rounded-none"
            />
          </Field>
          <Field label="Vade Tarihi" required>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              className="rounded-none"
            />
          </Field>
        </Row>
      </div>
    </DialogShell>
  );
}
