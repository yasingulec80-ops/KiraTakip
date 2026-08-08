import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  formatNumber,
  parseDateInput,
  parseNumber,
  printHtmlDocument,
  printReport,
} from "@/lib/export";
import {
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import {
  Eye,
  FileSignature,
  Plus,
  Printer,
  RefreshCw,
  ScrollText,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DetailRow, DialogShell, Field, Row, RowActions } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Contract = Doc<"contracts">;
type Property = Doc<"properties">;
type Owner = Doc<"owners">;
type Tenant = Doc<"tenants">;

interface FixtureDraft {
  name: string;
  quantity: string;
}

interface ContractFormState {
  propertyId: string;
  ownerId: string;
  tenantId: string;
  startDate: string;
  durationMonths: string;
  rentAmount: string;
  depositAmount: string;
  depositMonths: string;
  status: "active" | "ended";
  guarantorEnabled: boolean;
  guarantorName: string;
  guarantorTc: string;
  guarantorPhone: string;
  guarantorAddress: string;
  guarantorEmail: string;
  evictionCommitment: boolean;
  evictionCommitmentDate: string;
  evictionDate: string;
  fixtures: FixtureDraft[];
  notes: string;
}

const emptyForm: ContractFormState = {
  propertyId: "",
  ownerId: "",
  tenantId: "",
  startDate: "",
  durationMonths: "12",
  rentAmount: "",
  depositAmount: "",
  depositMonths: "0",
  status: "active",
  guarantorEnabled: false,
  guarantorName: "",
  guarantorTc: "",
  guarantorPhone: "",
  guarantorAddress: "",
  guarantorEmail: "",
  evictionCommitment: false,
  evictionCommitmentDate: "",
  evictionDate: "",
  fixtures: [],
  notes: "",
};

const formFromContract = (c: Contract): ContractFormState => ({
  propertyId: c.propertyId.toString(),
  ownerId: c.ownerId.toString(),
  tenantId: c.tenantId.toString(),
  startDate: dateToInput(c.startDate),
  durationMonths: String(c.durationMonths),
  rentAmount: String(c.rentAmount),
  depositAmount: String(c.depositAmount),
  depositMonths: c.depositMonths ? String(c.depositMonths) : "0",
  status: c.status ?? "active",
  guarantorEnabled: c.guarantor != null,
  guarantorName: c.guarantor?.name ?? "",
  guarantorTc: c.guarantor?.tcNo ?? "",
  guarantorPhone: c.guarantor?.phone ?? "",
  guarantorAddress: c.guarantor?.address ?? "",
  guarantorEmail: c.guarantor?.email ?? "",
  evictionCommitment: c.evictionCommitment === true,
  evictionCommitmentDate: c.evictionCommitmentDate
    ? dateToInput(c.evictionCommitmentDate)
    : "",
  evictionDate: c.evictionDate ? dateToInput(c.evictionDate) : "",
  fixtures: (c.fixtures ?? []).map((f) => ({
    name: f.name,
    quantity: String(f.quantity),
  })),
  notes: c.notes ?? "",
});

const CSV_HEADERS = [
  "Gayrimenkul",
  "Malik",
  "Kiracı",
  "Başlangıç",
  "Bitiş",
  "Süre (ay)",
  "Aylık Kira",
  "Depozito",
  "Durum",
];

const contractEnd = (start: number, months: number): number => {
  const d = new Date(start);
  return new Date(d.getFullYear(), d.getMonth() + months, 0).getTime();
};

/** Kira kontratına otomatik eklenen genel koşullar (madde metinleri). */
const GENERAL_CONDITIONS: string[] = [
  "Kiracı, kiralananı özenle kullanmak zorundadır.",
  "Kiracı, kiralananda ve çevrede oturanlara iyi niyet kuralları içinde davranmaya zorunludur.",
  "Kiracı, kiralananı kısmen veya tamamen üçüncü kişilere kiralayamaz, alt kiraya veremez; devir ve temlik edemez.",
  "Kiracı, kiralayanın yazılı izni olmadıkça, kiralananda değişiklik yapamaz; aksi halde, doğacak zararı karşılamak zorundadır.",
  "Üçüncü kişilerin kiralanan üzerinde hak iddia etmeleri halinde, kiracı, durumu derhal kiralayana haber vermek zorundadır.",
  "Kiracı, kiralananda yapılması gereken onarımları, derhal kiralayana bildirmek zorundadır; aksi halde doğacak zarardan sorumludur.",
  "Kiracı, kat malikleri kurulunca kendisine tebliğ edilen hususları, kiralayana haber vermek zorundadır.",
  "Kiracı, kat malikleri kurulu kararı uyarınca, yapılması gereken işlere izin vermek zorundadır.",
  "Kiracı, kiralanandaki onarımlara katlanmak ve kiralanandaki olağan kullanımdan dolayı yapılması gereken onarımları yapmak/yaptırmak ve giderlerini karşılamak zorundadır.",
  "Kiralananın mülkiyet hakkından doğan vergileri kiralayana, kullanımdan doğan vergi, resim ve harçları kiracıya aittir. Uyuşmazlık halinde, yerel örf ve âdetler uygulanır.",
  "Kiracı, kira sözleşmesinin sonunda, kiralananı aldığı şekilde, kiralayana teslim etmek zorundadır: Keza kiralananla birlikte teslim edilen demirbaşlar da alındığı şekilde, kiralanana teslim edilmediği takdirde, oluşan hasarların bedelinin kiralayana ödenmesi veya eski hale getirilmesi zorunludur.",
  "Kiralananın iyi ve kullanılmaya elverişli halde teslim edildiği asıldır. Aksi durum kiracı tarafından ispatlanmak zorundadır. Kiralananın normal kullanımından dolayı ortaya çıkacak yıpranma ve eksikliklerden dolayı kiracı sorumlu değildir.",
  "Kiracı, kira sözleşmesinin sona ermesi veya satılığa çıkartılması halinde, kiralananın gezilmesine ve incelenmesine izin vermek zorundadır.",
  "Kiralananın boşaltılması/tahliyesi gerektiği hallerde, kiralananın boşaltılmaması durumunda ortaya çıkacak zararlardan dolayı kiracı sorumlu olacaktır.",
  "Kiracı, kendisi veya birlikte oturanların sağlığı için ciddi tehlike oluşturmayan kusurlardan dolayı, kiralayanı teslim almaktan kaçınamaz, sözleşmeyi bozamaz ve kiradan indirim talebinde bulunamaz.",
  "Kiracı, kiralana yaptığı faydalı ve lüks şeylerin bedelini kiralayandan isteyemez ve sözleşme bitiminde bunları kiralayana teslim etmek zorundadır.",
  "Kiracı, kiralayanın yazılı olurunu almak ve giderleri kendisine ait olmak üzere, genel anten, uydu anteni, kablo televizyon gibi donanımları yaptırabilir.",
  "İş bu kira sözleşmesinde yer almayan hususlar hakkında 6098 sayılı borçlar kanunu hükümleri geçerlidir.",
];

export function ContractSection() {
  const { user } = useAuth();
  const contracts = useQuery(api.contracts.list);
  const properties = useQuery(api.properties.list);
  const owners = useQuery(api.owners.list);
  const tenants = useQuery(api.tenants.list);
  const accruals = useQuery(api.accruals.list);
  const createContract = useMutation(api.contracts.create);
  const updateContract = useMutation(api.contracts.update);
  const removeContract = useMutation(api.contracts.remove);
  const generateAccruals = useMutation(api.contracts.generateAccruals);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [viewing, setViewing] = useState<Contract | null>(null);
  const [deleting, setDeleting] = useState<Contract | null>(null);
  const [preview, setPreview] = useState<ContractDocData | null>(null);

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

  const accrualCountByContract = useMemo(() => {
    const map = new Map<string, { total: number; paid: number }>();
    (accruals ?? []).forEach((a) => {
      const entry = map.get(a.contractId.toString()) ?? { total: 0, paid: 0 };
      entry.total += 1;
      if (a.status === "paid") entry.paid += 1;
      map.set(a.contractId.toString(), entry);
    });
    return map;
  }, [accruals]);

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (contracts ?? []).filter((c) => {
      if (fromMs !== null && c.startDate < fromMs) return false;
      if (toMs !== null && c.startDate > toMs) return false;
      if (q === "") return true;

      const property = propertyMap.get(c.propertyId.toString());
      const owner = ownerMap.get(c.ownerId.toString());
      const tenant = tenantMap.get(c.tenantId.toString());
      const haystack = [
        property?.name,
        property?.address,
        owner?.name,
        tenant?.name,
        tenant?.phone,
        formatNumber(c.rentAmount),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [contracts, propertyMap, ownerMap, tenantMap, search, from, to]);

  const isAdmin = user?.role === "admin";

  const rows = (c: Contract): (string | number | null)[] => {
    const property = propertyMap.get(c.propertyId.toString());
    const owner = ownerMap.get(c.ownerId.toString());
    const tenant = tenantMap.get(c.tenantId.toString());
    return [
      property?.name ?? "—",
      owner?.name ?? "—",
      tenant?.name ?? "—",
      formatDate(c.startDate),
      formatDate(contractEnd(c.startDate, c.durationMonths)),
      c.durationMonths,
      formatNumber(c.rentAmount),
      formatNumber(c.depositAmount),
      c.status === "active" ? "Aktif" : "Sona erdi",
    ];
  };

  const exportCsv = () => {
    downloadCsv("kontratlar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Kontratlar", "Kira sözleşmeleri listesi", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: ContractFormState) => {
    const hasGuarantor = [
      form.guarantorName,
      form.guarantorTc,
      form.guarantorPhone,
      form.guarantorAddress,
      form.guarantorEmail,
    ].some((v) => v.trim() !== "");
    const payload = {
      propertyId: form.propertyId as Id<"properties">,
      ownerId: form.ownerId as Id<"owners">,
      tenantId: form.tenantId as Id<"tenants">,
      startDate: parseDateInput(form.startDate)!,
      durationMonths: parseNumber(form.durationMonths) ?? 12,
      rentAmount: parseNumber(form.rentAmount) ?? 0,
      depositAmount: parseNumber(form.depositAmount) ?? 0,
      depositMonths:
        (parseNumber(form.depositMonths) ?? 0) > 0
          ? parseNumber(form.depositMonths)
          : undefined,
      status: form.status,
      guarantor:
        form.guarantorEnabled && hasGuarantor
          ? {
              name: form.guarantorName.trim(),
              tcNo: form.guarantorTc.trim(),
              phone: form.guarantorPhone.trim(),
              address: form.guarantorAddress.trim(),
              email: form.guarantorEmail.trim(),
            }
          : undefined,
      evictionCommitment: form.evictionCommitment,
      evictionCommitmentDate:
        form.evictionCommitment && form.evictionCommitmentDate !== ""
          ? parseDateInput(form.evictionCommitmentDate)
          : undefined,
      evictionDate:
        form.evictionCommitment && form.evictionDate !== ""
          ? parseDateInput(form.evictionDate)
          : undefined,
      fixtures: form.fixtures
        .filter((f) => f.name.trim() !== "")
        .map((f) => ({
          name: f.name.trim(),
          quantity: parseNumber(f.quantity) ?? 1,
        })),
      notes: form.notes.trim() || undefined,
    };

    try {
      if (editing) {
        await updateContract({ id: editing._id, ...payload });
        toast.success("Kontrat güncellendi.");
      } else {
        await createContract(payload);
        toast.success("Kontrat oluşturuldu; aylık tahakkuklar işlendi.");
      }
      setFormOpen(false);
      setEditing(null);
      // Kaydedilen kontrat resmi formatta önizleme olarak açılır.
      setPreview({
        propertyId: payload.propertyId,
        ownerId: payload.ownerId,
        tenantId: payload.tenantId,
        startDate: payload.startDate,
        durationMonths: payload.durationMonths,
        rentAmount: payload.rentAmount,
        depositAmount: payload.depositAmount,
        depositMonths: payload.depositMonths,
        guarantor: payload.guarantor,
        evictionCommitment: payload.evictionCommitment,
        evictionCommitmentDate: payload.evictionCommitmentDate,
        evictionDate: payload.evictionDate,
        fixtures: payload.fixtures,
        notes: payload.notes,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await removeContract({ id: deleting._id });
      toast.success("Kontrat ve bağlı kayıtlar silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  const handlePrint = (c: Contract) => {
    const property = propertyMap.get(c.propertyId.toString());
    const owner = ownerMap.get(c.ownerId.toString());
    const tenant = tenantMap.get(c.tenantId.toString());
    printHtmlDocument(buildContractHtml(c, owner, tenant, property));
    toast.success("Kontrat belgesi yazdırma için hazırlanıyor.");
  };

  const handleGenerate = async (c: Contract) => {
    try {
      await generateAccruals({ id: c._id });
      toast.success("Eksik tahakkuklar oluşturuldu.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Kontratlar"
        hint="Malik, kiracı ve gayrimenkul arasındaki sözleşmeler"
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
        addLabel="Yeni Kontrat"
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      {contracts === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {contracts.length === 0
                ? "Henüz kontrat eklenmedi. Bir kontrat oluşturduğunuzda aylık kira tahakkukları otomatik işlenir."
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
                  <TableHead className="min-w-44">Gayrimenkul</TableHead>
                  <TableHead>Malik</TableHead>
                  <TableHead>Kiracı</TableHead>
                  <TableHead>Dönem</TableHead>
                  <TableHead className="text-right">Kira</TableHead>
                  <TableHead className="text-right">Depozito</TableHead>
                  <TableHead>Tahakkuk</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const property = propertyMap.get(c.propertyId.toString());
                  const owner = ownerMap.get(c.ownerId.toString());
                  const tenant = tenantMap.get(c.tenantId.toString());
                  const progress = accrualCountByContract.get(c._id.toString());
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
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(c.startDate)}
                        <span className="mx-1">→</span>
                        {formatDate(contractEnd(c.startDate, c.durationMonths))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(c.rentAmount)}
                        <span className="ml-1 text-xs text-muted-foreground">₺/ay</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(c.depositAmount)} ₺
                      </TableCell>
                      <TableCell>
                        {progress ? (
                          <Badge
                            variant="outline"
                            className="rounded-none text-muted-foreground"
                          >
                            {progress.paid}/{progress.total} ödendi
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={c.status === "active" ? "default" : "secondary"}
                          className="rounded-none"
                        >
                          {c.status === "active" ? "Aktif" : "Sona erdi"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-none"
                            onClick={() => handlePrint(c)}
                            aria-label="Kontrat belgesini yazdır"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          <RowActions
                            onView={() => setViewing(c)}
                            onEdit={() => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                            onDelete={isAdmin ? () => setDeleting(c) : undefined}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {filtered.length} / {contracts.length} kayıt gösteriliyor
            </span>
            <span>Kontrat oluşturulduğunda tahakkuklar otomatik işlenir</span>
          </div>
        </div>
      )}

      <ContractFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        properties={properties ?? []}
        owners={owners ?? []}
        tenants={tenants ?? []}
        onSave={handleSave}
      />

      <ContractDetailDialog
        contract={viewing}
        onClose={() => setViewing(null)}
        property={viewing ? propertyMap.get(viewing.propertyId.toString()) : undefined}
        owner={viewing ? ownerMap.get(viewing.ownerId.toString()) : undefined}
        tenant={viewing ? tenantMap.get(viewing.tenantId.toString()) : undefined}
        onPreview={viewing ? () => setPreview(viewing) : undefined}
        onPrint={viewing ? () => handlePrint(viewing) : undefined}
        onGenerate={viewing ? () => handleGenerate(viewing) : undefined}
        progress={
          viewing ? accrualCountByContract.get(viewing._id.toString()) : undefined
        }
      />

      <ContractPreviewDialog
        contract={preview}
        onClose={() => setPreview(null)}
        property={preview ? propertyMap.get(preview.propertyId.toString()) : undefined}
        owner={preview ? ownerMap.get(preview.ownerId.toString()) : undefined}
        tenant={preview ? tenantMap.get(preview.tenantId.toString()) : undefined}
        onPrint={
          preview
            ? () =>
                printHtmlDocument(
                  buildContractHtml(
                    preview,
                    ownerMap.get(preview.ownerId.toString()),
                    tenantMap.get(preview.tenantId.toString()),
                    propertyMap.get(preview.propertyId.toString()),
                  ),
                )
            : undefined
        }
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Kontrat silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bu kontrata bağlı tahakkuklar, tahsilatlar ve cari hesap kayıtları
              da silinir. Bu işlem geri alınamaz.
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

function ContractFormDialog({
  open,
  onOpenChange,
  editing,
  properties,
  owners,
  tenants,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Contract | null;
  properties: Property[];
  owners: Owner[];
  tenants: Tenant[];
  onSave: (form: ContractFormState) => void;
}) {
  const [form, setForm] = useState<ContractFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? (editing ? `edit-${editing._id}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm(editing ? formFromContract(editing) : emptyForm);
    setError(null);
  }

  const set = <K extends keyof ContractFormState>(
    key: K,
    value: ContractFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const pickProperty = (value: string) => {
    const property = properties.find((p) => p._id.toString() === value);
    setForm((f) => ({
      ...f,
      propertyId: value,
      // Malik boşsa gayrimenkulün malikiyle otomatik doldur.
      ownerId: f.ownerId === "" && property?.ownerId ? property.ownerId.toString() : f.ownerId,
    }));
  };

  // Depozito karşılığı seçilince tutar alanı boşsa aylık kira × ay otomatik doldurulur.
  const pickDepositMonths = (value: string) => {
    setForm((f) => {
      const months = parseNumber(value) ?? 0;
      const rent = parseNumber(f.rentAmount) ?? 0;
      const autoFill = months > 0 && rent > 0 && f.depositAmount.trim() === "";
      return {
        ...f,
        depositMonths: value,
        depositAmount: autoFill ? String(rent * months) : f.depositAmount,
      };
    });
  };

  const depositMonthsNum = parseNumber(form.depositMonths) ?? 0;
  const rentNum = parseNumber(form.rentAmount) ?? 0;
  const impliedDeposit =
    depositMonthsNum > 0 && rentNum > 0 ? rentNum * depositMonthsNum : null;

  const setFixture = (index: number, patch: Partial<FixtureDraft>) =>
    setForm((f) => ({
      ...f,
      fixtures: f.fixtures.map((fixture, i) =>
        i === index ? { ...fixture, ...patch } : fixture,
      ),
    }));

  const submit = () => {
    if (
      form.propertyId === "" ||
      form.ownerId === "" ||
      form.tenantId === "" ||
      form.startDate === "" ||
      form.rentAmount.trim() === ""
    ) {
      setError("Gayrimenkul, malik, kiracı, başlangıç tarihi ve kira zorunludur.");
      return;
    }
    const rent = parseNumber(form.rentAmount);
    if (rent === undefined || rent <= 0) {
      setError("Aylık kira geçerli bir tutar olmalıdır.");
      return;
    }
    if (form.evictionCommitment) {
      if (form.evictionCommitmentDate === "") {
        setError("Tahliye taahhütnamesi için taahhüt tarihi zorunludur.");
        return;
      }
      if (form.evictionDate === "") {
        setError("Tahliye taahhütnamesi için tahliye tarihi zorunludur.");
        return;
      }
      if (form.evictionCommitmentDate === form.startDate) {
        setError("Taahhüt tarihi, kontrat (başlangıç) tarihi ile aynı olamaz.");
        return;
      }
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Kontratı Düzenle" : "Yeni Kontrat"}
      description={
        editing
          ? "Sözleşme bilgilerini güncelleyin; eksik tahakkuklar otomatik tamamlanır."
          : "Malik, kiracı ve gayrimenkul bilgilerinden otomatik kira kontratı oluşturulur."
      }
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
            {editing ? "Kaydet" : "Kontrat Oluştur"}
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
            <Select value={form.propertyId} onValueChange={pickProperty}>
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
          <Field label="Malik" required hint="otomatik doldurabilir">
            <Select
              value={form.ownerId}
              onValueChange={(value) => set("ownerId", value)}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Malik seçin" />
              </SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o._id} value={o._id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Row>

        <Field label="Kiracı" required>
          <Select
            value={form.tenantId}
            onValueChange={(value) => {
              const tenant = tenants.find((t) => t._id.toString() === value);
              setForm((f) => {
                // Kefil açıksa, seçilen kiracının kayıtlı kefil bilgileri
                // otomatik doldurulur (kiracı değişince alanlar yenilenir).
                const g = tenant?.guarantor;
                const fill = f.guarantorEnabled && value !== f.tenantId;
                return {
                  ...f,
                  tenantId: value,
                  guarantorName: fill ? (g?.name ?? "") : f.guarantorName,
                  guarantorTc: fill ? (g?.tcNo ?? "") : f.guarantorTc,
                  guarantorPhone: fill ? (g?.phone ?? "") : f.guarantorPhone,
                  guarantorAddress: fill ? (g?.address ?? "") : f.guarantorAddress,
                  guarantorEmail: fill ? (g?.email ?? "") : f.guarantorEmail,
                };
              });
            }}
          >
            <SelectTrigger className="rounded-none">
              <SelectValue placeholder="Kiracı seçin" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t._id} value={t._id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Kefil — onay kutusuyla açılır */}
        <div className="space-y-3 border border-border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={form.guarantorEnabled}
              onCheckedChange={(checked) =>
                setForm((f) => {
                  const enabled = checked === true;
                  const g = enabled
                    ? tenants.find((t) => t._id.toString() === f.tenantId)
                        ?.guarantor
                    : null;
                  return {
                    ...f,
                    guarantorEnabled: enabled,
                    // Açılırken kiracının kayıtlı kefili varsa otomatik doldur.
                    guarantorName: enabled && g ? g.name : f.guarantorName,
                    guarantorTc: enabled && g ? g.tcNo : f.guarantorTc,
                    guarantorPhone: enabled && g ? g.phone : f.guarantorPhone,
                    guarantorAddress: enabled && g ? g.address : f.guarantorAddress,
                    guarantorEmail: enabled && g ? g.email : f.guarantorEmail,
                  };
                })
              }
            />
            <span>
              <span className="block text-sm font-medium">Kefil</span>
              <span className="block text-xs leading-5 text-muted-foreground">
                İşaretlendiğinde kiracının kayıtlı kefil bilgileri otomatik
                doldurulur; gerekiyorsa değiştirebilirsiniz.
              </span>
            </span>
          </label>
          {form.guarantorEnabled && (
            <div className="space-y-3 bg-muted/30 p-4">
              <Row>
                <Field label="Adı Soyadı">
                  <Input
                    value={form.guarantorName}
                    onChange={(e) => set("guarantorName", e.target.value)}
                    placeholder="Kefilin adı soyadı"
                    className="rounded-none"
                  />
                </Field>
                <Field label="TC Kimlik Numarası">
                  <Input
                    value={form.guarantorTc}
                    onChange={(e) => set("guarantorTc", e.target.value)}
                    placeholder="11122233344"
                    className="rounded-none"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Telefon Numarası">
                  <Input
                    value={form.guarantorPhone}
                    onChange={(e) => set("guarantorPhone", e.target.value)}
                    placeholder="05xx xxx xx xx"
                    className="rounded-none"
                  />
                </Field>
                <Field label="Mail Adresi">
                  <Input
                    type="email"
                    value={form.guarantorEmail}
                    onChange={(e) => set("guarantorEmail", e.target.value)}
                    placeholder="kefil@eposta.com"
                    className="rounded-none"
                  />
                </Field>
              </Row>
              <Field label="Adresi">
                <Input
                  value={form.guarantorAddress}
                  onChange={(e) => set("guarantorAddress", e.target.value)}
                  placeholder="Kefilin adresi"
                  className="rounded-none"
                />
              </Field>
            </div>
          )}
        </div>

        <Row cols={3}>
          <Field label="Başlangıç Tarihi" required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              className="rounded-none"
            />
          </Field>
          <Field label="Kira Süresi" required hint="ay">
            <Input
              type="number"
              min={1}
              value={form.durationMonths}
              onChange={(e) => set("durationMonths", e.target.value)}
              placeholder="12"
              className="rounded-none"
            />
          </Field>
          <Field label="Aylık Kira" required hint="₺">
            <Input
              value={form.rentAmount}
              onChange={(e) => set("rentAmount", e.target.value)}
              placeholder="15000"
              className="rounded-none"
            />
          </Field>
        </Row>

        <Row cols={2}>
          <Field label="Depozito Tutarı" hint="₺ · kaydedilince otomatik tahakkuk edilir">
            <Input
              value={form.depositAmount}
              onChange={(e) => set("depositAmount", e.target.value)}
              placeholder="30000"
              className="rounded-none"
            />
          </Field>
          <Field
            label="Depozito Karşılığı"
            hint={
              impliedDeposit !== null
                ? `≈ ${formatNumber(impliedDeposit)} ₺`
                : undefined
            }
          >
            <Select value={form.depositMonths} onValueChange={pickDepositMonths}>
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Belirtilmedi</SelectItem>
                <SelectItem value="1">1 aylık kira</SelectItem>
                <SelectItem value="2">2 aylık kira</SelectItem>
                <SelectItem value="3">3 aylık kira</SelectItem>
                <SelectItem value="4">4 aylık kira</SelectItem>
                <SelectItem value="6">6 aylık kira</SelectItem>
                <SelectItem value="12">12 aylık kira</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Row>

        {/* Tahliye taahhütnamesi — isteğe bağlı */}
        <div className="space-y-3 border border-border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={form.evictionCommitment}
              onCheckedChange={(checked) =>
                setForm((f) => ({
                  ...f,
                  evictionCommitment: checked === true,
                }))
              }
            />
            <span>
              <span className="block text-sm font-medium">
                Tahliye Taahhütnamesi
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                İşaretlenirse kontrat belgesine otomatik tahliye taahhütnamesi
                eklenir; taahhüt ve tahliye tarihleri belirtilir.
              </span>
            </span>
          </label>
          {form.evictionCommitment && (
            <Row>
              <Field label="Taahhüt Tarihi" required>
                <Input
                  type="date"
                  value={form.evictionCommitmentDate}
                  onChange={(e) => set("evictionCommitmentDate", e.target.value)}
                  className="rounded-none"
                />
              </Field>
              <Field
                label="Tahliye Tarihi"
                required
                hint="taahhüt edilen boşaltma tarihi"
              >
                <Input
                  type="date"
                  value={form.evictionDate}
                  onChange={(e) => set("evictionDate", e.target.value)}
                  className="rounded-none"
                />
              </Field>
            </Row>
          )}
        </div>

        {editing && (
          <Field label="Kontrat Durumu">
            <Select
              value={form.status}
              onValueChange={(value) =>
                set("status", value as ContractFormState["status"])
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="ended">Sona erdi</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {/* Demirbaşlar */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Kontrat Demirbaşları
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none"
              onClick={() =>
                set("fixtures", [...form.fixtures, { name: "", quantity: "1" }])
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Kalem Ekle
            </Button>
          </div>
          {form.fixtures.length === 0 ? (
            <p className="border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Sözleşmeye özel demirbaşları ekleyebilirsiniz.
            </p>
          ) : (
            <div className="space-y-2">
              {form.fixtures.map((fixture, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={fixture.name}
                    onChange={(e) => setFixture(i, { name: e.target.value })}
                    placeholder="örn. Buzdolabı"
                    className="rounded-none"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={fixture.quantity}
                    onChange={(e) =>
                      setFixture(i, { quantity: e.target.value })
                    }
                    className="w-20 rounded-none"
                    aria-label="Adet"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-none text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      set(
                        "fixtures",
                        form.fixtures.filter((_, idx) => idx !== i),
                      )
                    }
                    aria-label="Kalemi kaldır"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Sözleşme Notları">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            placeholder="İsteğe bağlı özel hükümler…"
            className="w-full rounded-none border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"
          />
        </Field>
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */

function ContractDetailDialog({
  contract,
  property,
  owner,
  tenant,
  progress,
  onClose,
  onPreview,
  onPrint,
  onGenerate,
}: {
  contract: Contract | null;
  property?: Property;
  owner?: Owner;
  tenant?: Tenant;
  progress?: { total: number; paid: number };
  onClose: () => void;
  onPreview?: () => void;
  onPrint?: () => void;
  onGenerate?: () => void;
}) {
  return (
    <DialogShell
      open={contract !== null}
      onOpenChange={(open) => !open && onClose()}
      title={contract ? `${property?.name ?? "Kontrat"} · ${tenant?.name ?? ""}` : ""}
      description="Kontrat detayı"
      wide
      footer={
        <>
          {contract && <SignedContractControl contract={contract} />}
          <div className="flex-1" />
          {onGenerate && (
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={onGenerate}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Eksik Tahakkukları Oluştur
            </Button>
          )}
          {onPreview && (
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={onPreview}
            >
              <Eye className="mr-2 h-4 w-4" />
              Önizle
            </Button>
          )}
          {onPrint && (
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={onPrint}
            >
              <Printer className="mr-2 h-4 w-4" />
              Kontrat Belgesi
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="rounded-none"
            onClick={onClose}
          >
            Kapat
          </Button>
        </>
      }
    >
      {contract && (
        <dl className="divide-y divide-border">
          <DetailRow
            label="Gayrimenkul"
            value={
              property ? (
                <span>
                  {property.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {property.address}
                  </span>
                </span>
              ) : (
                undefined
              )
            }
          />
          <DetailRow
            label="Malik"
            value={
              owner ? (
                <span>
                  {owner.name}
                  {owner.proxy && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Vekil: {owner.proxy.name}
                    </span>
                  )}
                </span>
              ) : (
                undefined
              )
            }
          />
          <DetailRow
            label="Kiracı"
            value={
              tenant ? (
                <span>
                  {tenant.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {tenant.phone}
                  </span>
                </span>
              ) : (
                undefined
              )
            }
          />
          <DetailRow
            label="Kefil"
            value={
              contract.guarantor ? (
                <span>
                  {contract.guarantor.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {contract.guarantor.phone}
                  </span>
                </span>
              ) : (
                undefined
              )
            }
          />
          <DetailRow
            label="Dönem"
            value={`${formatDate(contract.startDate)} → ${formatDate(
              contractEnd(contract.startDate, contract.durationMonths),
            )} (${contract.durationMonths} ay)`}
          />
          <DetailRow
            label="Aylık Kira"
            value={`${formatCurrency(contract.rentAmount)}`}
          />
          <DetailRow
            label="Depozito"
            value={
              <span>
                {formatCurrency(contract.depositAmount)}
                {contract.depositMonths ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {contract.depositMonths} aylık kira karşılığı · tahakkuk edildi
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-muted-foreground">
                    tahakkuk edildi
                  </span>
                )}
              </span>
            }
          />
          {contract.depositReturnedAt && (
            <DetailRow
              label="Depozito İadesi"
              value={
                <span>
                  {formatDate(contract.depositReturnedAt)}
                  {contract.depositNote && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {contract.depositNote}
                    </span>
                  )}
                </span>
              }
            />
          )}
          {contract.evictionCommitment && (
            <DetailRow
              label="Tahliye Taahhüdü"
              value={
                <span>
                  Taahhüt:{" "}
                  {contract.evictionCommitmentDate
                    ? formatDate(contract.evictionCommitmentDate)
                    : "—"}{" "}
                  · Tahliye:{" "}
                  {contract.evictionDate
                    ? formatDate(contract.evictionDate)
                    : "—"}
                </span>
              }
            />
          )}
          <DetailRow
            label="Tahakkuklar"
            value={
              progress ? (
                <span>
                  {progress.paid} / {progress.total} ödendi
                </span>
              ) : undefined
            }
          />
          <DetailRow
            label="Demirbaşlar"
            value={
              (contract.fixtures ?? []).length > 0 ? (
                <ul className="space-y-1">
                  {(contract.fixtures ?? []).map((f, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-4">
                      <span>{f.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatNumber(f.quantity)} adet
                      </span>
                    </li>
                  ))}
                </ul>
              ) : undefined
            }
          />
          <DetailRow label="Notlar" value={contract.notes} />
          <DetailRow
            label="Kayıt Tarihi"
            value={formatDate(contract._creationTime)}
          />
        </dl>
      )}
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */

/** Upload / download control for the signed contract file. */
function SignedContractControl({ contract }: { contract: Contract }) {
  const generateUploadUrl = useAction(api.contracts.generateUploadUrl);
  const attachSignedContract = useMutation(api.contracts.attachSignedContract);
  const detachSignedContract = useMutation(api.contracts.detachSignedContract);
  const fileUrl = useQuery(api.contracts.getSignedContractUrl, {
    storageId: contract.signedContractStorageId,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok) throw new Error("Yükleme başarısız oldu.");
      const { storageId } = (await result.json()) as { storageId: string };
      await attachSignedContract({
        contractId: contract._id,
        storageId: storageId as Id<"_storage">,
      });
      toast.success("İmzalı kontrat yüklendi.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Yükleme başarısız.");
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = async () => {
    try {
      await detachSignedContract({ contractId: contract._id });
      toast.success("İmzalı kontrat kaldırıldı.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="rounded-none"
        onClick={() => inputRef.current?.click()}
      >
        <FileSignature className="mr-2 h-4 w-4" />
        {contract.signedContractStorageId ? "Yeni Dosya Yükle" : "İmzalı Kontrat Yükle"}
      </Button>
      {contract.signedContractStorageId && fileUrl && (
        <Button
          type="button"
          variant="ghost"
          className="rounded-none"
          asChild
        >
          <a href={fileUrl} target="_blank" rel="noreferrer">
            Görüntüle
          </a>
        </Button>
      )}
      {contract.signedContractStorageId && (
        <Button
          type="button"
          variant="ghost"
          className="rounded-none text-muted-foreground hover:text-destructive"
          onClick={handleRemove}
        >
          Kaldır
        </Button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

/** Kontrat önizleme / yazdırma belgesi için gereken alanlar. */
type ContractDocData = Pick<
  Contract,
  | "propertyId"
  | "ownerId"
  | "tenantId"
  | "startDate"
  | "durationMonths"
  | "rentAmount"
  | "depositAmount"
  | "depositMonths"
  | "guarantor"
  | "evictionCommitment"
  | "evictionCommitmentDate"
  | "evictionDate"
  | "fixtures"
  | "notes"
>;

/** Resmi kontrat formatı stil tanımları (önizleme + yazdırma ortak). */
const CONTRACT_STYLES = `
  @page { size: A4 portrait; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Georgia", "Times New Roman", serif;
    color: #2b2722;
    font-size: 12.5px;
    line-height: 1.75;
    background: #ece8df;
  }
  @media print { body { background: #fff; } }
  .page {
    display: flex;
    flex-direction: column;
    min-height: 265mm;
    width: 210mm;
    margin: 0 auto;
    padding: 14mm 12mm;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  @media print {
    .page {
      width: auto;
      margin: 0;
      padding: 0;
      box-shadow: none;
    }
  }
  .content { flex: 1 1 auto; }
  .doc-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 24px;
    border-bottom: 1.5px solid #2b2722;
    padding-bottom: 10px; margin-bottom: 20px;
  }
  .doc-head.running { border-bottom-color: #d8d1c4; margin-bottom: 16px; }
  h1 { font-size: 19px; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
  .meta {
    font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
    color: #6b6358; text-align: right;
  }
  h2 { font-size: 12px; font-weight: 600; margin: 20px 0 8px; letter-spacing: 0.05em; }
  .cont { font-weight: 400; text-transform: none; letter-spacing: 0; color: #6b6358; font-size: 11px; }
  .clause { margin: 0 0 8px; text-align: justify; }
  .closing { margin-top: 22px; }
  .conditions { font-size: 11.8px; }
  .conditions p { margin: 0 0 5px; text-align: justify; }
  .signature .name .sub {
    display: block; margin-top: 2px; font-size: 10px; font-weight: 400;
    letter-spacing: 0.02em; text-transform: none; color: #6b6358;
  }
  .taahhut-box {
    border: 1px solid #d8d1c4;
    padding: 14px 16px;
    margin-top: 18px;
  }
  .taahhut-box .field-row:last-child { border-bottom: none; }
  .field-row {
    display: flex; justify-content: space-between; gap: 24px;
    border-bottom: 1px solid #e3ddd2; padding: 5px 0;
  }
  .field-label { color: #6b6358; font-size: 10.5px; letter-spacing: 0.05em; }
  .field-row > span:last-child { text-align: right; }
  .sig-date { margin-top: 20px; font-size: 12px; }
  .signatures {
    display: flex; justify-content: space-between; gap: 36px;
    margin-top: 30px;
  }
  .signature { flex: 1; }
  .signature .line { border-bottom: 1px solid #2b2722; height: 42px; }
  .signature .name {
    margin-top: 8px; font-size: 10px; letter-spacing: 0.08em;
    text-transform: uppercase; color: #6b6358;
  }
  .signature .name span {
    display: block; margin-top: 2px; font-size: 12px; font-weight: 600;
    letter-spacing: 0; text-transform: none; color: #2b2722;
  }
  .page-foot {
    margin-top: 14px; padding-top: 8px; border-top: 1px solid #e3ddd2;
    font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase;
    color: #6b6358; text-align: center;
  }
`;

/**
 * Build the full official-format rental contract as a standalone HTML document.
 * The document is split into A4 pages; every page ends with signature areas
 * (Kiracı / Malik / Vekil) whose names are filled in automatically.
 */
function buildContractHtml(
  contract: ContractDocData,
  owner?: Owner,
  tenant?: Tenant,
  property?: Property,
): string {
  const esc = (value: string | number | null | undefined) =>
    String(value ?? "—")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const tl = (value: number) => `${formatNumber(value)} ₺`;

  const start = formatDate(contract.startDate);
  const end = formatDate(contractEnd(contract.startDate, contract.durationMonths));
  const fixtureList = (contract.fixtures ?? []).length
    ? (contract.fixtures ?? [])
        .map((f) => esc(f.name) + ` (${formatNumber(f.quantity)} adet)`)
        .join("; ")
    : "—";

  const fieldRow = (label: string, value: string) =>
    `<div class="field-row"><span class="field-label">${esc(label)}</span><span>${esc(value)}</span></div>`;

  const kefil = contract.guarantor ?? tenant?.guarantor ?? null;
  const hasEviction = contract.evictionCommitment === true;
  const TOTAL_PAGES = hasEviction ? 4 : 3;

  /** Her sayfanın altına imza alanları — isimler otomatik doldurulur. */
  const signatures = (page: number) => {
    const sig = (role: string, name?: string, sub?: string) =>
      `<div class="signature"><div class="line"></div><div class="name">${esc(role)}<span>${esc(name ?? "—")}</span>${
        sub ? `<span class="sub">${esc(sub)}</span>` : ""
      }</div></div>`;
    return `<div class="signatures">
      ${sig("Kiracı", tenant?.name)}
      ${kefil ? sig("Kefil", kefil.name) : ""}
      ${
        owner?.proxy
          ? sig(`Kiraya Veren ${owner.name} Adına Vekaleten`, owner.proxy.name)
          : sig("Kiraya Veren", owner?.name)
      }
    </div>
    <div class="page-foot">Sayfa ${page} / ${TOTAL_PAGES}</div>`;
  };

  const runningHead =
    '<div class="doc-head running"><span class="meta">Kira Kontratı</span><span class="meta">Kira Takip · Gayrimenkul Yönetim Paneli</span></div>';

  const page1 = `
    <div class="page">
      <div class="content">
        <div class="doc-head">
          <h1>KİRA KONTRATI</h1>
          <div class="meta">Kira Takip · Gayrimenkul Yönetim Paneli</div>
        </div>
        <p class="clause">İşbu kira kontratı, aşağıda kimlik bilgileri yer alan taraflar arasında, aşağıda yazılı koşullarla düzenlenmiştir.</p>

        <h2>MADDE 1 — TARAFLAR</h2>
        <div>
          ${fieldRow("Kiracı", tenant?.name ?? "—")}
          ${fieldRow("TC Kimlik No", tenant?.tcNo ?? "—")}
          ${fieldRow("Telefon", tenant?.phone ?? "—")}
          ${fieldRow("Adres", tenant?.address ?? "—")}
          ${fieldRow("E-posta", tenant?.email ?? "—")}
          ${fieldRow("Kiraya Veren", owner?.name ?? "—")}
          ${fieldRow("TC Kimlik No", owner?.tcNo ?? "—")}
          ${fieldRow("Telefon", owner?.phone ?? "—")}
          ${
            owner?.proxy
              ? fieldRow(`Vekil — Kiraya Veren ${owner.name} Adına Vekaleten`, `${owner.proxy.name} (${owner.proxy.tcNo} · ${owner.proxy.phone})`)
              : ""
          }
          ${
            kefil
              ? `
          ${fieldRow("Kefil", kefil.name)}
          ${fieldRow("TC Kimlik No", kefil.tcNo ?? "—")}
          ${fieldRow("Telefon", kefil.phone ?? "—")}
          ${fieldRow("Adres", kefil.address ?? "—")}
          ${fieldRow("E-posta", kefil.email ?? "—")}`
              : ""
          }
        </div>

        <h2>MADDE 2 — KONU</h2>
        <div>
          ${fieldRow("Gayrimenkul", property?.name ?? "—")}
          ${fieldRow("Adres", property?.address ?? "—")}
          ${property?.m2 !== undefined ? fieldRow("Brüt Alan", `${formatNumber(property.m2)} m²`) : ""}
          ${property?.roomCount ? fieldRow("Oda Sayısı", property.roomCount) : ""}
        </div>

        <h2>MADDE 3 — SÜRE</h2>
        <div>
          ${fieldRow("Başlangıç Tarihi", start)}
          ${fieldRow("Kira Süresi", `${contract.durationMonths} ay`)}
          ${fieldRow("Bitiş Tarihi", end)}
        </div>

        <h2>MADDE 4 — KİRA BEDELİ</h2>
        <p class="clause">Kiracı, kira bedelini her ayın başında ödemekle yükümlüdür. Aylık kira bedeli ${esc(tl(contract.rentAmount))} olarak belirlenmiştir.</p>

        <h2>MADDE 5 — DEPOZİTO</h2>
        <p class="clause">Depozito tutarı ${esc(tl(contract.depositAmount))} olarak belirlenmiştir. ${
          contract.depositMonths
            ? `Depozito, ${esc(String(contract.depositMonths))} aylık kira bedeli karşılığıdır (aylık kira ${esc(tl(contract.rentAmount))} × ${esc(String(contract.depositMonths))} ay = ${esc(tl(contract.rentAmount * contract.depositMonths))}). `
            : ""
        }Depozito, kontrat sona erdiğinde ve gayrimenkulün boşaltılmış olduğu tespit edildiğinde iade edilir.</p>
      </div>
      ${signatures(1)}
    </div>`;

  const page2 = `
    <div class="page">
      <div class="content">
        ${runningHead}

        <h2>MADDE 6 — DEMİRBAŞLAR</h2>
        <p class="clause">${esc(fixtureList)}</p>

        <h2>GENEL KOŞULLAR</h2>
        <div class="conditions">
          ${GENERAL_CONDITIONS.map(
            (c, i) => `<p><strong>Madde ${i + 1}.</strong> ${esc(c)}</p>`,
          ).join("\n          ")}
        </div>
      </div>
      ${signatures(2)}
    </div>`;

  const page3 = `
    <div class="page">
      <div class="content">
        ${runningHead}

        ${
          contract.notes
            ? `<h2>ÖZEL HÜKÜMLER</h2><p class="clause">${esc(contract.notes)}</p>`
            : ""
        }

        <p class="clause closing">İşbu kira kontratı, taraflarca okunarak anlaşılmış ve aşağıda imza altına alınmıştır. Taraflardan her biri, sözleşme metninin birer örneğini teslim almıştır.</p>
        <div class="sig-date">Tarih: ${esc(formatDate(Date.now()))}</div>
      </div>
      ${signatures(3)}
    </div>`;

  // Tahliye taahhütnamesi — ayrı sayfa (yalnızca evictionCommitment seçiliyse).
  const page4 = hasEviction
    ? `
    <div class="page">
      <div class="content">
        <div class="doc-head">
          <h1>TAHLİYE TAAHHÜTNAMESİ</h1>
          <div class="meta">Kira Takip · Gayrimenkul Yönetim Paneli</div>
        </div>
        <p class="clause">Ben, aşağıda kimlik bilgileri yazılı kiracı ${esc(tenant?.name ?? "—")}${
          tenant?.tcNo ? ` (TC Kimlik No: ${esc(tenant.tcNo)})` : ""
        }; ${esc(property?.name ?? "—")} adresindeki taşınmazı, ${esc(
          contract.evictionDate ? formatDate(contract.evictionDate) : "—",
        )} tarihinde, herhangi bir ihtara gerek kalmaksızın, aynen ve tahliye edilmiş olarak boşaltmayı ve kiraya verene teslim etmeyi kabul ve taahhüt ederim.</p>
        <p class="clause">İşbu tahliye taahhütnamesi, 6098 sayılı Türk Borçlar Kanunu'nun 352. maddesi uyarınca düzenlenmiş olup imza tarihinden itibaren geçerlidir. Taahhüt edilen tarihte tahliye gerçekleşmediği takdirde kiraya verenin yasal hakları saklıdır.</p>

        <div class="taahhut-box">
          <div class="field-row"><span class="field-label">Taahhüt Tarihi</span><span>${esc(
            contract.evictionCommitmentDate
              ? formatDate(contract.evictionCommitmentDate)
              : "—",
          )}</span></div>
          <div class="field-row"><span class="field-label">Tahliye Tarihi</span><span>${esc(
            contract.evictionDate ? formatDate(contract.evictionDate) : "—",
          )}</span></div>
          <div class="field-row"><span class="field-label">Kiracı</span><span>${esc(tenant?.name ?? "—")}</span></div>
          <div class="field-row"><span class="field-label">Kiralanan</span><span>${esc(property?.name ?? "—")}</span></div>
        </div>
      </div>
      <div class="signatures">
        <div class="signature"><div class="line"></div><div class="name">Kiracı<span>${esc(tenant?.name ?? "—")}</span></div></div>
      </div>
      <div class="page-foot">Sayfa ${TOTAL_PAGES} / ${TOTAL_PAGES}</div>
    </div>`
    : "";

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Kira Kontratı</title>
<style>${CONTRACT_STYLES}</style>
</head>
<body>
${page1}
${page2}
${page3}
${page4}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */

/** Resmi format önizleme penceresi (her sayfada imza alanları). */
function ContractPreviewDialog({
  contract,
  property,
  owner,
  tenant,
  onClose,
  onPrint,
}: {
  contract: ContractDocData | null;
  property?: Property;
  owner?: Owner;
  tenant?: Tenant;
  onClose: () => void;
  onPrint?: () => void;
}) {
  const html = useMemo(
    () => (contract ? buildContractHtml(contract, owner, tenant, property) : ""),
    [contract, property, owner, tenant],
  );

  return (
    <DialogShell
      open={contract !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Kontrat Önizleme"
      description="Resmi kontrat formatı — her sayfada imza alanları, isimler otomatik doldurulur"
      xwide
      footer={
        <>
          {onPrint && (
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={onPrint}
            >
              <Printer className="mr-2 h-4 w-4" />
              Yazdır / PDF İndir
            </Button>
          )}
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            className="rounded-none"
            onClick={onClose}
          >
            Kapat
          </Button>
        </>
      }
    >
      {html ? (
        <iframe
          title="Kontrat önizleme"
          srcDoc={html}
          className="block w-full border border-border bg-[#ece8df]"
          style={{ height: "72vh" }}
        />
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Yükleniyor…
        </p>
      )}
    </DialogShell>
  );
}
