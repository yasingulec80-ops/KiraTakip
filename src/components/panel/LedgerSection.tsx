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
import { BookOpenText, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field, Row } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type LedgerEntry = Doc<"ledgerEntries">;
type Owner = Doc<"owners">;
type Tenant = Doc<"tenants">;
type Property = Doc<"properties">;
type Contract = Doc<"contracts">;

type PersonType = "owner" | "tenant" | "proxy";

interface PersonAccount {
  key: string;
  personType: PersonType;
  personId: string;
  name: string;
  subtitle: string;
  balance: number;
}

const PERSON_TYPE_LABEL: Record<PersonType, string> = {
  owner: "Malik",
  tenant: "Kiracı",
  proxy: "Vekil",
};

const KIND_LABEL: Record<string, string> = {
  accrual: "Tahakkuk",
  collection: "Tahsilat",
  expense: "Masraf",
  adjustment: "Düzeltme",
};

const TODAY = dateToInput(Date.now());

const SUMMARY_HEADERS = ["Tür", "Kişi", "Borç", "Alacak", "Bakiye"];
const ENTRY_HEADERS = ["Tarih", "Tür", "Açıklama", "Tutar"];

export function LedgerSection() {
  const { user } = useAuth();
  const entries = useQuery(api.ledgers.list);
  const owners = useQuery(api.owners.list);
  const tenants = useQuery(api.tenants.list);
  const properties = useQuery(api.properties.list);
  const contracts = useQuery(api.contracts.list);
  const removeEntry = useMutation(api.ledgers.removeEntry);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [entryPerson, setEntryPerson] = useState<PersonAccount | null>(null);
  const [viewing, setViewing] = useState<PersonAccount | null>(null);
  const [deleting, setDeleting] = useState<LedgerEntry | null>(null);

  const isAdmin = user?.role === "admin";

  const rangeFilteredEntries = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return (entries ?? []).filter((e) => {
      if (fromMs !== null && e.date < fromMs) return false;
      if (toMs !== null && e.date > toMs) return false;
      return true;
    });
  }, [entries, from, to]);

  const accounts = useMemo(() => {
    const accounts: PersonAccount[] = [];
    const balanceOf = (personType: PersonType, personId: string) =>
      rangeFilteredEntries
        .filter(
          (e) =>
            e.personType === personType && e.personId.toString() === personId,
        )
        .reduce((sum, e) => sum + e.amount, 0);

    (owners ?? []).forEach((o) => {
      accounts.push({
        key: `owner:${o._id}`,
        personType: "owner",
        personId: o._id.toString(),
        name: o.name,
        subtitle: o.phone || "—",
        balance: balanceOf("owner", o._id.toString()),
      });
      if (o.proxy) {
        accounts.push({
          key: `proxy:${o._id}`,
          personType: "proxy",
          personId: o._id.toString(),
          name: o.proxy.name,
          subtitle: `Vekil · ${o.name}`,
          balance: balanceOf("proxy", o._id.toString()),
        });
      }
    });
    (tenants ?? []).forEach((t) => {
      accounts.push({
        key: `tenant:${t._id}`,
        personType: "tenant",
        personId: t._id.toString(),
        name: t.name,
        subtitle: t.phone || "—",
        balance: balanceOf("tenant", t._id.toString()),
      });
    });

    const q = search.trim().toLocaleLowerCase("tr");
    return accounts
      .filter(
        (a) =>
          q === "" ||
          a.name.toLocaleLowerCase("tr").includes(q) ||
          a.subtitle.toLocaleLowerCase("tr").includes(q) ||
          PERSON_TYPE_LABEL[a.personType].toLocaleLowerCase("tr").includes(q),
      )
      .sort((a, b) => {
        if (a.personType !== b.personType) {
          const order = { owner: 0, tenant: 1, proxy: 2 } as const;
          return order[a.personType] - order[b.personType];
        }
        return a.name.localeCompare(b.name, "tr");
      });
  }, [owners, tenants, rangeFilteredEntries, search]);

  const entriesOf = (account: PersonAccount): LedgerEntry[] =>
    rangeFilteredEntries
      .filter(
        (e) =>
          e.personType === account.personType &&
          e.personId.toString() === account.personId,
      )
      .sort((a, b) => b.date - a.date);

  const entryRows = (account: PersonAccount): (string | number | null)[][] =>
    entriesOf(account).map((e) => [
      formatDate(e.date),
      KIND_LABEL[e.kind],
      e.description,
      e.amount,
    ]);

  const exportSummaryCsv = () => {
    downloadCsv(
      "cari-hesap-ozeti",
      SUMMARY_HEADERS,
      accounts.map((a) => [
        PERSON_TYPE_LABEL[a.personType],
        a.name,
        a.balance < 0 ? -a.balance : 0,
        a.balance > 0 ? a.balance : 0,
        a.balance,
      ]),
    );
    toast.success("Excel dökümü indirildi.");
  };

  const exportSummaryPdf = () => {
    printReport(
      "Cari Hesap Özeti",
      "Malik, kiracı ve vekil bakiyeleri",
      SUMMARY_HEADERS,
      accounts.map((a) => [
        PERSON_TYPE_LABEL[a.personType],
        a.name,
        a.balance < 0 ? -a.balance : 0,
        a.balance > 0 ? a.balance : 0,
        a.balance,
      ]),
    );
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const exportPersonCsv = (account: PersonAccount) => {
    downloadCsv(
      `cari-hesap-${account.personType}-${account.personId}`,
      ENTRY_HEADERS,
      entryRows(account),
    );
    toast.success("Excel dökümü indirildi.");
  };

  const exportPersonPdf = (account: PersonAccount) => {
    printReport(
      `${account.name} — Cari Hesap`,
      `${PERSON_TYPE_LABEL[account.personType]} hesap dökümü`,
      ENTRY_HEADERS,
      entryRows(account),
    );
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await removeEntry({ id: deleting._id });
      toast.success("Cari hesap kaydı silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        num="08"
        title="Cari Hesaplar"
        hint="Malik, kiracı ve vekil bazında cari hesap tablosu"
        count={accounts.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Kişi, telefon, tür ara…"
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onClearRange={() => {
          setFrom("");
          setTo("");
        }}
        onExportCsv={exportSummaryCsv}
        onExportPdf={exportSummaryPdf}
        addLabel="Yeni Kayıt"
        onAdd={() => {
          setEntryPerson(null);
          setFormOpen(true);
        }}
      />

      {entries === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : accounts.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenText />
            </EmptyMedia>
            <EmptyTitle>Hesap bulunamadı</EmptyTitle>
            <EmptyDescription>
              {owners?.length === 0 && tenants?.length === 0
                ? "Önce malik ve kiracı kaydı oluşturun; ardından buradan her kişinin cari hesabını takip edin."
                : "Arama veya tarih aralığı filtrelerine uyan hesap yok."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tür</TableHead>
                  <TableHead className="min-w-44">Kişi</TableHead>
                  <TableHead className="text-right">Borç</TableHead>
                  <TableHead className="text-right">Alacak</TableHead>
                  <TableHead className="text-right">Bakiye</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow
                    key={a.key}
                    className="cursor-pointer align-middle hover:bg-muted/40"
                    onClick={() => setViewing(a)}
                  >
                    <TableCell>
                      <Badge
                        variant={
                          a.personType === "proxy" ? "outline" : "secondary"
                        }
                        className={
                          a.personType === "proxy"
                            ? "rounded-none text-brand"
                            : "rounded-none"
                        }
                      >
                        {PERSON_TYPE_LABEL[a.personType]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.subtitle}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.balance < 0 ? (
                        <span className="text-amber-700">
                          {formatCurrency(-a.balance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.balance > 0 ? (
                        <span className="text-emerald-700">
                          {formatCurrency(a.balance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {a.balance === 0 ? (
                        <span className="text-muted-foreground">0,00 ₺</span>
                      ) : a.balance > 0 ? (
                        <span className="text-emerald-700">
                          {formatCurrency(a.balance)} alacak
                        </span>
                      ) : (
                        <span className="text-amber-700">
                          {formatCurrency(-a.balance)} borç
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEntryPerson(a);
                          setFormOpen(true);
                        }}
                        aria-label="Hesaba kayıt ekle"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {accounts.length} hesap gösteriliyor · satıra tıklayınca kayıt
              dökümü açılır
            </span>
            <span>Pozitif bakiye alacak, negatif bakiye borç anlamına gelir</span>
          </div>
        </div>
      )}

      <PersonDetailDialog
        account={viewing}
        entries={viewing ? entriesOf(viewing) : []}
        onClose={() => setViewing(null)}
        onAddEntry={(account) => {
          setViewing(null);
          setEntryPerson(account);
          setFormOpen(true);
        }}
        onExportCsv={viewing ? () => exportPersonCsv(viewing) : undefined}
        onExportPdf={viewing ? () => exportPersonPdf(viewing) : undefined}
        onDelete={isAdmin ? setDeleting : undefined}
      />

      <ManualEntryDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={entryPerson}
        owners={owners ?? []}
        tenants={tenants ?? []}
        properties={properties ?? []}
        contracts={contracts ?? []}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Cari hesap kaydı silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bu kayıt kalıcı olarak silinir. Otomatik oluşturulan kayıtları
              ilgili modülden silmeniz önerilir. Bu işlem geri alınamaz.
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

function PersonDetailDialog({
  account,
  entries,
  onClose,
  onAddEntry,
  onExportCsv,
  onExportPdf,
  onDelete,
}: {
  account: PersonAccount | null;
  entries: LedgerEntry[];
  onClose: () => void;
  onAddEntry: (account: PersonAccount) => void;
  onExportCsv?: () => void;
  onExportPdf?: () => void;
  onDelete?: (entry: LedgerEntry) => void;
}) {
  const balance = entries.reduce((sum, e) => sum + e.amount, 0);

  return (
    <DialogShell
      open={account !== null}
      onOpenChange={(open) => !open && onClose()}
      title={account?.name ?? ""}
      description={
        account
          ? `${PERSON_TYPE_LABEL[account.personType]} cari hesabı · ${account.subtitle}`
          : ""
      }
      wide
      footer={
        <>
          {onExportCsv && (
            <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={onExportCsv}>
              Excel
            </Button>
          )}
          {onExportPdf && (
            <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={onExportPdf}>
              PDF
            </Button>
          )}
          <div className="flex-1" />
          {account && (
            <Button type="button" variant="outline" className="rounded-none" onClick={() => onAddEntry(account)}>
              Yeni Kayıt
            </Button>
          )}
          <Button type="button" variant="ghost" className="rounded-none" onClick={onClose}>
            Kapat
          </Button>
        </>
      }
    >
      {account && (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-border pb-3">
            <p className="eyebrow text-muted-foreground">Bakiye</p>
            <p
              className={
                balance === 0
                  ? "font-display text-xl font-light tabular-nums"
                  : balance > 0
                    ? "font-display text-xl font-light tabular-nums text-emerald-700"
                    : "font-display text-xl font-light tabular-nums text-amber-700"
              }
            >
              {balance === 0
                ? formatCurrency(0)
                : balance > 0
                  ? `${formatCurrency(balance)} alacak`
                  : `${formatCurrency(-balance)} borç`}
            </p>
          </div>

          {entries.length === 0 ? (
            <p className="border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
              Bu hesapta henüz kayıt yok.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tarih</TableHead>
                    <TableHead>Tür</TableHead>
                    <TableHead>Açıklama</TableHead>
                    <TableHead className="text-right">Tutar</TableHead>
                    <TableHead className="text-right">Eylemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e._id} className="align-middle">
                      <TableCell className="text-sm">{formatDate(e.date)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-none text-muted-foreground">
                          {KIND_LABEL[e.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-52 truncate text-sm">
                        {e.description}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          e.amount > 0 ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        {e.amount > 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(e.amount))}
                      </TableCell>
                      <TableCell className="text-right">
                        {onDelete && e.kind === "adjustment" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-none text-muted-foreground hover:text-destructive"
                            onClick={() => onDelete(e)}
                            aria-label="Kaydı sil"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */

interface ManualEntryState {
  kind: "accrual" | "collection" | "expense" | "adjustment";
  personType: PersonType;
  personId: string;
  amount: string;
  direction: "borc" | "alacak";
  date: string;
  propertyId: string;
  contractId: string;
  category: string;
  description: string;
}

const KIND_OPTIONS: { id: ManualEntryState["kind"]; label: string; desc: string }[] = [
  { id: "accrual", label: "Tahakkuk", desc: "Kira tahakkuku işler (kontrat gerekir)." },
  { id: "collection", label: "Tahsilat / Ödeme", desc: "Ödeme alındığında kaydedilir (kontrat gerekir)." },
  { id: "expense", label: "Masraf", desc: "Gayrimenkul masrafı işlenir." },
  { id: "adjustment", label: "Düzeltme", desc: "Manuel alacak veya borç kaydı." },
];

const allowedPersonTypes = (kind: ManualEntryState["kind"]): PersonType[] => {
  if (kind === "accrual") return ["owner", "tenant"];
  if (kind === "collection") return ["tenant", "proxy"];
  return ["owner", "tenant", "proxy"];
};

function ManualEntryDialog({
  open,
  onOpenChange,
  initial,
  owners,
  tenants,
  properties,
  contracts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PersonAccount | null;
  owners: Owner[];
  tenants: Tenant[];
  properties: Property[];
  contracts: Contract[];
}) {
  const createManual = useMutation(api.ledgers.createManual);

  const [form, setForm] = useState<ManualEntryState>({
    kind: "accrual",
    personType: "tenant",
    personId: "",
    amount: "",
    direction: "borc",
    date: TODAY,
    propertyId: "",
    contractId: "",
    category: "diger",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [lastKey, setLastKey] = useState("");
  const key = open ? (initial ? `edit-${initial.key}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    const personType = initial?.personType ?? "tenant";
    setForm({
      kind:
        personType === "owner"
          ? "accrual"
          : personType === "proxy"
            ? "collection"
            : "accrual",
      personType,
      personId: initial?.personId ?? "",
      amount: "",
      direction: personType === "tenant" ? "borc" : "alacak",
      date: TODAY,
      propertyId: "",
      contractId: "",
      category: "diger",
      description: "",
    });
    setError(null);
  }

  const set = <K extends keyof ManualEntryState>(
    key: K,
    value: ManualEntryState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const proxyOwners = owners.filter((o) => o.proxy !== null);

  const personOptions = (personType: PersonType): (Owner | Tenant)[] => {
    if (personType === "owner") return owners;
    if (personType === "tenant") return tenants;
    return proxyOwners;
  };

  const propertyContracts = contracts.filter(
    (c) => c.propertyId.toString() === form.propertyId,
  );

  const submit = async () => {
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      setError("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    if (!form.personId || form.description.trim() === "") {
      setError("Kişi ve açıklama zorunludur.");
      return;
    }
    if (form.kind === "accrual" && !form.contractId) {
      setError("Tahakkuk için kontrat seçilmelidir.");
      return;
    }
    if (form.kind === "collection" && !form.contractId) {
      setError("Tahsilat için kontrat seçilmelidir.");
      return;
    }
    if (form.kind === "expense" && !form.propertyId) {
      setError("Masraf için gayrimenkul seçilmelidir.");
      return;
    }

    const signedAmount =
      form.kind === "adjustment"
        ? form.direction === "borc"
          ? -amount
          : amount
        : amount;

    setSaving(true);
    try {
      await createManual({
        personType: form.personType,
        personId: form.personId as Id<"owners"> | Id<"tenants">,
        kind: form.kind,
        amount: signedAmount,
        description: form.description.trim(),
        date: parseDateInput(form.date) ?? Date.now(),
        propertyId: form.propertyId
          ? (form.propertyId as Id<"properties">)
          : undefined,
        contractId: form.contractId
          ? (form.contractId as Id<"contracts">)
          : undefined,
        category:
          form.kind === "expense"
            ? (form.category as
                | "aidat"
                | "yatirim"
                | "sigorta"
                | "tadilat"
                | "boya"
                | "diger")
            : undefined,
      });
      toast.success("Kayıt işlendi ve cari hesaba yansıdı.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    } finally {
      setSaving(false);
    }
  };

  const allowed = allowedPersonTypes(form.kind);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Cari Hesaba Kayıt"
      description="Tahakkuk, tahsilat, masraf veya düzeltme kaydı atılır; ilgili modüle de işlenir."
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
          <Button type="button" className="rounded-none" onClick={submit} disabled={saving}>
            {saving ? "İşleniyor…" : "Kaydı İşle"}
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

        <Field label="Kayıt Türü" required>
          <Select
            value={form.kind}
            onValueChange={(value) =>
              setForm((f) => {
                const kind = value as ManualEntryState["kind"];
                const nextAllowed = allowedPersonTypes(kind);
                const personType = nextAllowed.includes(f.personType)
                  ? f.personType
                  : nextAllowed[0];
                return {
                  ...f,
                  kind,
                  personType,
                  personId:
                    personType === f.personType ? f.personId : "",
                };
              })
            }
          >
            <SelectTrigger className="rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <p className="-mt-2 text-xs leading-5 text-muted-foreground">
          {KIND_OPTIONS.find((k) => k.id === form.kind)?.desc}
        </p>

        <Row>
          <Field label="Hesap Türü" required>
            <Select
              value={form.personType}
              onValueChange={(value) =>
                setForm((f) => ({
                  ...f,
                  personType: value as PersonType,
                  personId: "",
                }))
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowed.map((type) => (
                  <SelectItem key={type} value={type}>
                    {PERSON_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kişi" required>
            <Select
              value={form.personId}
              onValueChange={(value) => set("personId", value)}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Kişi seçin" />
              </SelectTrigger>
              <SelectContent>
                {personOptions(form.personType).map((person) => (
                  <SelectItem key={person._id} value={person._id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Row>

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

        {form.kind === "adjustment" && (
          <Field label="Yön">
            <Select
              value={form.direction}
              onValueChange={(value) =>
                set("direction", value as ManualEntryState["direction"])
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="borc">Borç (kişi borçlanır)</SelectItem>
                <SelectItem value="alacak">Alacak (kişi alacaklanır)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {form.kind === "expense" && (
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
        )}

        {(form.kind === "accrual" || form.kind === "collection") && (
          <Field label="Kontrat" required>
            <Select
              value={form.contractId}
              onValueChange={(value) => set("contractId", value)}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Kontrat seçin" />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c._id.toString().slice(0, 8)}… · {formatDate(c.startDate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {form.kind === "expense" && form.propertyId !== "" && (
          <Row>
            <Field label="Kalem">
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
            <Field label="Kontrat" hint="isteğe bağlı">
              <Select
                value={form.contractId}
                onValueChange={(value) => set("contractId", value)}
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue placeholder="Bağlamayın" />
                </SelectTrigger>
                <SelectContent>
                  {propertyContracts.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {formatDate(c.startDate)} başlangıçlı
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Row>
        )}

        <Field label="Açıklama" required>
          <Input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="örn. Mart kirası, kombi bakımı…"
            className="rounded-none"
          />
        </Field>
      </div>
    </DialogShell>
  );
}
