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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { computeVat } from "@/lib/vat";
import {
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import {
  Eye,
  FileSignature,
  FileText,
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
  rentVat: "dahil" | "haric";
  vatRate: string;
  rentIncreaseRate: string;
  useTuikInflation: boolean;
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
  rentRecipient: "owner" | "proxy";
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
  rentVat: "dahil",
  vatRate: "20",
  rentIncreaseRate: "",
  useTuikInflation: false,
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
  rentRecipient: "owner",
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
  rentVat: c.rentVat ?? "dahil",
  vatRate: c.vatRate !== undefined ? String(c.vatRate) : "20",
  rentIncreaseRate:
    c.rentIncreaseRate !== undefined ? String(c.rentIncreaseRate) : "",
  useTuikInflation: c.useTuikInflation === true,
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
  rentRecipient: c.rentRecipient ?? "owner",
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
  const generalConditions = useQuery(api.settings.getGeneralConditions);
  const updateGeneralConditions = useMutation(api.settings.updateGeneralConditions);
  const specialConditions = useQuery(api.settings.getSpecialConditions);
  const updateSpecialConditions = useMutation(api.settings.updateSpecialConditions);
  const effectiveConditions = generalConditions ?? GENERAL_CONDITIONS;
  const effectiveSpecialConditions = specialConditions ?? [];

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
      rentVat: form.rentVat,
      vatRate: parseNumber(form.vatRate),
      rentIncreaseRate: parseNumber(form.rentIncreaseRate),
      useTuikInflation: form.useTuikInflation,
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
      rentRecipient: form.rentRecipient !== "owner" ? form.rentRecipient : undefined,
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
        rentRecipient: payload.rentRecipient,
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
    printHtmlDocument(buildContractHtml(c, owner, tenant, property, effectiveConditions, effectiveSpecialConditions));
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
        conditions={effectiveConditions}
        specialConditions={effectiveSpecialConditions}
        isAdmin={isAdmin}
        onUpdateConditions={(list) => updateGeneralConditions({ conditions: list })}
        onUpdateSpecialConditions={(list) => updateSpecialConditions({ conditions: list })}
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
        conditions={effectiveConditions}
        specialConditions={effectiveSpecialConditions}
        onPrint={
          preview
            ? () =>
                printHtmlDocument(
                  buildContractHtml(
                    preview,
                    ownerMap.get(preview.ownerId.toString()),
                    tenantMap.get(preview.tenantId.toString()),
                    propertyMap.get(preview.propertyId.toString()),
                    effectiveConditions,
                    effectiveSpecialConditions,
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
  conditions,
  specialConditions,
  isAdmin,
  onUpdateConditions,
  onUpdateSpecialConditions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Contract | null;
  properties: Property[];
  owners: Owner[];
  tenants: Tenant[];
  onSave: (form: ContractFormState) => void;
  conditions: string[];
  specialConditions: string[];
  isAdmin: boolean;
  onUpdateConditions: (conditions: string[]) => Promise<unknown>;
  onUpdateSpecialConditions: (conditions: string[]) => Promise<unknown>;
}) {
  const [form, setForm] = useState<ContractFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [ozelHukumlerOpen, setOzelHukumlerOpen] = useState(false);
  const [genelKosullarOpen, setGenelKosullarOpen] = useState(false);
  const [hususiSartlarOpen, setHususiSartlarOpen] = useState(false);
  const tuik = useQuery(api.settings.getTuikInflation);
  const updateTuik = useMutation(api.settings.updateTuikInflation);
  const [tuikEdit, setTuikEdit] = useState("");
  const [tuikEdited, setTuikEdited] = useState(false);

  const [lastKey, setLastKey] = useState("");
  const key = open ? (editing ? `edit-${editing._id}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm(editing ? formFromContract(editing) : emptyForm);
    setError(null);
    setTuikEdit("");
    setTuikEdited(false);
  }

  // TÜFE alanı: kullanıcı düzenlemediyse kayıtlı değer canlı gösterilir.
  const tuikInputValue = tuikEdited
    ? tuikEdit
    : String(tuik?.cpi12MonthAvg ?? 0);

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
      // Demirbaşlar gayrimenkul kaydından otomatik doldur (yalnızca ilk seçimde)
      fixtures:
        f.fixtures.length === 0 && property?.fixtures
          ? property.fixtures.map((fx) => ({ name: fx.name, quantity: String(fx.quantity) }))
          : f.fixtures,
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
  const annualRent = rentNum > 0 ? rentNum * 12 : null;
  const selectedOwner = owners.find((o) => o._id.toString() === form.ownerId);
  const ownerIsCompany = selectedOwner?.isCompany === true;
  const vatRateNum = parseNumber(form.vatRate) ?? 0;
  // KDV tutarı — kira bedeli KDV hariçse KDV ayrıca eklenir; dahilse içinden çıkarılır.
  const vatBreakdown =
    ownerIsCompany && vatRateNum > 0 && rentNum > 0
      ? computeVat(rentNum, vatRateNum, form.rentVat)
      : null;
  const vatAmount = vatBreakdown?.vatAmount ?? null;
  const vatInclusiveRent = vatBreakdown?.vatInclusiveRent ?? null;

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

      if (form.evictionCommitmentDate === form.startDate) {
        setError("Taahhüt tarihi, kontrat (başlangıç) tarihi ile aynı olamaz.");
        return;
      }
    }
    onSave(form);
  };

  return (
    <>
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
              onValueChange={(value) => {
                set("ownerId", value);
                // Malik değiştiyse ve yeni malikin vekili yoksa kira alıcısını sıfırla
                const newOwner = owners.find((o) => o._id.toString() === value);
                if (!newOwner?.proxy) set("rentRecipient", "owner");
              }}
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

        {selectedOwner?.proxy && (
          <Field label="Kira Ödemesi">
            <RadioGroup
              className="flex gap-6"
              value={form.rentRecipient}
              onValueChange={(value) => set("rentRecipient", value as "owner" | "proxy")}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <RadioGroupItem value="owner" />
                Malik ({selectedOwner.name})
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <RadioGroupItem value="proxy" />
                Vekil ({selectedOwner.proxy.name})
              </label>
            </RadioGroup>
          </Field>
        )}

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
          <Field
            label="Aylık Kira"
            required
            hint={
              annualRent !== null
                ? `yıllık ≈ ${formatNumber(annualRent)} ₺`
                : "₺"
            }
          >
            <Input
              value={form.rentAmount}
              onChange={(e) => set("rentAmount", e.target.value)}
              placeholder="15000"
              className="rounded-none"
            />
          </Field>
        </Row>

        {/* Malik şirketse KDV tercihi — kira bedeli KDV dahil / hariç */}
        {ownerIsCompany && (
          <div className="space-y-3 border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium">
              Kira Bedeli KDV Durumu
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              Malik şirket olduğu için kira bedelinin KDV dahil mi hariç mi
              olduğu ve KDV oranı kontrat üzerinde belirtilir.
            </p>
            <RadioGroup
              value={form.rentVat}
              onValueChange={(value) =>
                set("rentVat", value as "dahil" | "haric")
              }
              className="flex flex-wrap gap-4"
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="dahil" />
                KDV Dahil
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="haric" />
                KDV Hariç
              </label>
            </RadioGroup>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="KDV Oranı" hint="%">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.vatRate}
                  onChange={(e) => set("vatRate", e.target.value)}
                  placeholder="20"
                  className="rounded-none"
                />
              </Field>
              <div className="rounded-none border border-border bg-card px-3 py-2">
                <p className="eyebrow text-muted-foreground">
                  Aylık KDV Tutarı
                </p>
                <p className="mt-1 font-display text-lg font-light tabular-nums">
                  {vatAmount !== null
                    ? formatCurrency(vatAmount)
                    : "—"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {form.rentVat === "dahil"
                    ? "KDV dahil fiyatın içinden hesaplanır"
                    : "Kira bedeline ayrıca eklenir"}
                  {vatInclusiveRent !== null && form.rentVat === "haric"
                    ? ` · KDV dahil toplam ${formatCurrency(vatInclusiveRent)}`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Kira artışı — yıllık artış oranı + TÜFE 12 aylık ortalama tiki */}
        <div className="space-y-3 border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-64 flex-1">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  checked={form.useTuikInflation}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true;
                    setForm((f) => ({
                      ...f,
                      useTuikInflation: enabled,
                      // TÜFE açılınca artış oranı otomatik doldurulur.
                      rentIncreaseRate:
                        enabled && f.rentIncreaseRate.trim() === ""
                          ? String(tuik?.cpi12MonthAvg ?? 0)
                          : f.rentIncreaseRate,
                    }));
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">
                    TÜFE 12 Aylık Ortalama
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    İşaretlendiğinde kira artış oranı TÜFE 12 aylık ortalamasıyla
                    otomatik doldurulur; yine de değiştirebilirsiniz.
                  </span>
                </span>
              </label>
            </div>
            <div className="w-36">
              <Field
                label="Kira Artış Oranı"
                hint="% · yıllık"
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.rentIncreaseRate}
                  onChange={(e) => set("rentIncreaseRate", e.target.value)}
                  placeholder="0"
                  className="rounded-none"
                />
              </Field>
            </div>
          </div>
          {form.useTuikInflation && (
            <div className="flex flex-wrap items-end gap-3 bg-muted/30 p-4">
              <div className="w-44">
                <Field
                  label="TÜFE 12 Aylık Ortalama"
                  hint="% · kayıtlı değer"
                >
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    value={tuikInputValue}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      setTuikEdited(true);
                      setTuikEdit(e.target.value);
                    }}
                    className="rounded-none"
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                disabled={!isAdmin}
                onClick={async () => {
                  const value = parseNumber(tuikInputValue);
                  if (value === undefined || value < 0) {
                    setError("TÜFE oranı geçerli bir yüzde olmalıdır.");
                    return;
                  }
                  try {
                    await updateTuik({ cpi12MonthAvg: value });
                    setTuikEdited(false);
                    setForm((f) => ({
                      ...f,
                      rentIncreaseRate: f.useTuikInflation
                        ? String(value)
                        : f.rentIncreaseRate,
                    }));
                    toast.success(
                      "TÜFE oranı kaydedildi; artış oranı güncellendi.",
                    );
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Kayıt başarısız.",
                    );
                  }
                }}
              >
                {isAdmin
                  ? "TÜFE'yi Kaydet"
                  : "TÜFE yalnızca yönetici tarafından güncellenir"}
              </Button>
            </div>
          )}
        </div>

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
                hint="taahhüt edilen boşaltma tarihi (opsiyonel)"
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

        {/* Kontrat metinleri — genel koşullar (kayıtlı metin) + özel hükümler (kullanıcı) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start rounded-none p-4 text-left"
            onClick={() => setOzelHukumlerOpen(true)}
          >
            <FileText className="mr-3 h-5 w-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">Özel Hükümler</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {form.notes.trim() === ""
                  ? "Kontrata ekleyeceğiniz özel hükümleri buradan yazın."
                  : `${form.notes.trim().split(/\s*\n+\s*/).filter(Boolean).length} satır özel hüküm eklendi.`}
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start rounded-none p-4 text-left"
            onClick={() => setGenelKosullarOpen(true)}
          >
            <ScrollText className="mr-3 h-5 w-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">Genel Koşullar</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Kayıtlı {conditions.length} madde kontrata otomatik eklenir.
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex w-full items-start rounded-none p-4 text-left"
            onClick={() => setHususiSartlarOpen(true)}
          >
            <ScrollText className="mr-3 h-5 w-5 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">Hususi Şartlar</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Kayıtlı {specialConditions.length} madde kontrata otomatik eklenir.
              </span>
            </span>
          </Button>
        </div>
      </div>
      </DialogShell>

      <SpecialProvisionsDialog
        open={ozelHukumlerOpen}
        onOpenChange={setOzelHukumlerOpen}
        value={form.notes}
        onSave={(value) => set("notes", value)}
      />

      <GeneralConditionsDialog
        open={genelKosullarOpen}
        onOpenChange={setGenelKosullarOpen}
        conditions={conditions}
        isAdmin={isAdmin}
        onSave={onUpdateConditions}
      />

      <SpecialConditionsDialog
        open={hususiSartlarOpen}
        onOpenChange={setHususiSartlarOpen}
        conditions={specialConditions}
        isAdmin={isAdmin}
        onSave={onUpdateSpecialConditions}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function SpecialConditionsDialog({

  open,

  onOpenChange,

  conditions,

  isAdmin,

  onSave,

}: {

  open: boolean;

  onOpenChange: (open: boolean) => void;

  conditions: string[];

  isAdmin: boolean;

  onSave: (conditions: string[]) => Promise<unknown>;

}) {

  const [text, setText] = useState("");

  const [saving, setSaving] = useState(false);

  const [lastKey, setLastKey] = useState("");

  const key = open ? "open" : "closed";

  if (key !== lastKey) {

    setLastKey(key);

    setText(conditions.join("\n"));

  }

  const submit = async () => {

    setSaving(true);

    try {

      const list = text

        .split(/\r?\n/)

        .map((s) => s.trim())

        .filter((s) => s !== "");

      await onSave(list);

      toast.success("Hususi şartlar kaydedildi.");

      onOpenChange(false);

    } catch (err) {

      toast.error(err instanceof Error ? err.message : "Kayıt başarısız.");

    } finally {

      setSaving(false);

    }

  };



  return (

    <DialogShell

      open={open}

      onOpenChange={onOpenChange}

      title="Hususi Şartlar"

      description={

        isAdmin

          ? "Her satır bir madde olarak kontrata eklenir; kayıtlı metni düzenleyebilirsiniz."

          : "Kontrat belgesine otomatik eklenen hususi şartlar. Yalnızca yönetici düzenleyebilir."

      }

      footer={

        <>

          <Button

            type="button"

            variant="outline"

            className="rounded-none"

            onClick={() => onOpenChange(false)}

          >

            {isAdmin ? "Vazgeç" : "Kapat"}

          </Button>

          {isAdmin && (

            <Button

              type="button"

              className="rounded-none"

              onClick={submit}

              disabled={saving}

            >

              {saving ? "Kaydediliyor…" : "Kaydet"}

            </Button>

          )}

        </>

      }

    >

      <ol className="mb-4 max-h-44 space-y-1 overflow-y-auto border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">

        {conditions.map((c, i) => (

          <li key={i}>

            <strong className="text-foreground">Madde {i + 1}.</strong> {c}

          </li>

        ))}

      </ol>

      {isAdmin && (

        <textarea

          value={text}

          onChange={(e) => setText(e.target.value)}

          rows={10}

          placeholder="Her satıra bir hususi şart maddesi yazın…"

          className="w-full rounded-none border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"

        />

      )}

    </DialogShell>

  );

}

/* ------------------------------------------------------------------ */

function SpecialProvisionsDialog({

  open,

  onOpenChange,

  value,

  onSave,

}: {

  open: boolean;

  onOpenChange: (open: boolean) => void;

  value: string;

  onSave: (value: string) => void;

}) {

  const [text, setText] = useState(value);

  const [lastKey, setLastKey] = useState("");

  const key = open ? "open" : "closed";

  if (key !== lastKey) {

    setLastKey(key);

    setText(value);

  }



  return (

    <DialogShell

      open={open}

      onOpenChange={onOpenChange}

      title="Özel Hükümler"

      description="Kontratın Özel Hükümler bölümüne eklenecek metni yazın."

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

          <Button

            type="button"

            className="rounded-none"

            onClick={() => {

              onSave(text.trim());

              onOpenChange(false);

            }}

          >

            Uygula

          </Button>

        </>

      }

    >

      <textarea

        value={text}

        onChange={(e) => setText(e.target.value)}

        rows={9}

        placeholder="Kontrata eklemek istediğiniz özel hükümleri yazın…"

        className="w-full rounded-none border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"

      />

    </DialogShell>

  );

}

/* ------------------------------------------------------------------ */

function GeneralConditionsDialog({

  open,

  onOpenChange,

  conditions,

  isAdmin,

  onSave,

}: {

  open: boolean;

  onOpenChange: (open: boolean) => void;

  conditions: string[];

  isAdmin: boolean;

  onSave: (conditions: string[]) => Promise<unknown>;

}) {

  const [text, setText] = useState("");

  const [saving, setSaving] = useState(false);

  const [lastKey, setLastKey] = useState("");

  const key = open ? "open" : "closed";

  if (key !== lastKey) {

    setLastKey(key);

    setText(conditions.join("\n"));

  }





/* ------------------------------------------------------------------ */





  const submit = async () => {

    setSaving(true);

    try {

      const list = text

        .split(/\r?\n/)

        .map((s) => s.trim())

        .filter((s) => s !== "");

      await onSave(list);

      toast.success("Genel koşullar kaydedildi.");

      onOpenChange(false);

    } catch (err) {

      toast.error(err instanceof Error ? err.message : "Kayıt başarısız.");

    } finally {

      setSaving(false);

    }

  };



  return (

    <DialogShell

      open={open}

      onOpenChange={onOpenChange}

      title="Genel Koşullar"

      description={

        isAdmin

          ? "Her satır bir madde olarak kontrata eklenir; kayıtlı metni düzenleyebilirsiniz."

          : "Kontrat belgesine otomatik eklenen genel koşullar. Yalnızca yönetici düzenleyebilir."

      }

      footer={

        <>

          <Button

            type="button"

            variant="outline"

            className="rounded-none"

            onClick={() => onOpenChange(false)}

          >

            {isAdmin ? "Vazgeç" : "Kapat"}

          </Button>

          {isAdmin && (

            <Button

              type="button"

              className="rounded-none"

              onClick={submit}

              disabled={saving}

            >

              {saving ? "Kaydediliyor…" : "Kaydet"}

            </Button>

          )}

        </>

      }

    >

      <ol className="mb-4 max-h-44 space-y-1 overflow-y-auto border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">

        {conditions.map((c, i) => (

          <li key={i}>

            <strong className="text-foreground">Madde {i + 1}.</strong> {c}

          </li>

        ))}

      </ol>

      {isAdmin && (

        <textarea

          value={text}

          onChange={(e) => setText(e.target.value)}

          rows={10}

          placeholder="Her satıra bir genel koşul maddesi yazın…"

          className="w-full rounded-none border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"

        />

      )}

    </DialogShell>

  );

}

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
          {(contract.rentIncreaseRate !== undefined ||
            contract.nextIncreaseDate ||
            contract.lastIncreaseDate) && (
            <DetailRow
              label="Kira Artışı"
              value={
                <span>
                  {contract.rentIncreaseRate !== undefined && (
                    <span>
                      Oran: %{contract.rentIncreaseRate}
                      {contract.useTuikInflation && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          · TÜFE 12 ay ort.
                        </span>
                      )}
                    </span>
                  )}
                  {contract.lastIncreaseDate && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Son artış: {formatDate(contract.lastIncreaseDate)}
                    </span>
                  )}
                  {contract.nextIncreaseDate && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Sonraki: {formatDate(contract.nextIncreaseDate)}
                    </span>
                  )}
                </span>
              }
            />
          )}
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
  | "rentVat"
  | "vatRate"
  | "depositAmount"
  | "depositMonths"
  | "guarantor"
  | "evictionCommitment"
  | "evictionCommitmentDate"
  | "evictionDate"
  | "rentRecipient"
  | "fixtures"
  | "notes"
>;

/** Resmi kontrat formatı stil tanımları (önizleme + yazdırma ortak). */
const CONTRACT_STYLES = `
  @page { size: A4 portrait; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", "Georgia", serif;
    color: #2b2722;
    font-size: 12pt;
    font-style: normal;
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

/** Sayıyı Türkçe yazıya çevirir (basit, yalnızca pozitif tam sayılar için). */
function toWordsTR(n: number): string {
  if (n === 0) return "Sıfır";
  const ones = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
  const tens = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Altmış", "Yetmiş", "Seksen", "Doksan"];
  const groups = ["", "Bin", "Milyon", "Milyar"];
  if (n < 0) return "Eksi " + toWordsTR(-n);
  if (n < 10) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  if (n < 1000) return ones[Math.floor(n / 100)] + " Yüz" + (n % 100 ? " " + toWordsTR(n % 100) : "");
  let result = "";
  let groupIdx = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const chunkStr = toWordsTR(chunk);
      const prefix = groupIdx === 1 && chunk === 1 ? "" : chunkStr + " ";
      result = prefix + groups[groupIdx] + (result ? " " + result : "");
    }
    n = Math.floor(n / 1000);
    groupIdx++;
  }
  return result.trim();
}

function buildContractHtml(
  contract: ContractDocData,
  owner?: Owner,
  tenant?: Tenant,
  property?: Property,
  conditions: string[] = GENERAL_CONDITIONS,
  specialConditions: string[] = [],
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

  /** Hususi şartlar — DB'den gelen maddeler, dinamik olarak işlenir */
  // kira kime yatacak: rentRecipient = "proxy" ise vekil, değilse malik
  const rentRecipientIsProxy = contract.rentRecipient === "proxy" && !!owner?.proxy;
  const paymentPerson = rentRecipientIsProxy ? owner!.proxy!.name : owner?.name;
  /** kira bedeli ve banka bilgisi maddeleri otomatik doldurulur */
  const processedSpecial = specialConditions.map((c) => {
    if (c.includes("contract.rentAmount")) {
      c = c.replace("contract.rentAmount", tl(contract.rentAmount));
    }
    if (c.includes("contract.depositAmount")) {
      const depositText = contract.depositMonths && contract.depositMonths > 0
        ? `${contract.depositMonths} aylık kira bedeli karşılığı`
        : toWordsTR(Math.round(contract.depositAmount)) + " Türk Lirası";
      c = c.replace("contract.depositAmount", tl(contract.depositAmount) + " (" + depositText + ")");
    }
    // depositMonths artık depositAmount içinde yer aldığı için ayrıca değiştirme
    // (çift "aylık kira bedeli karşılığı" çıkmasını önlemek için)
    if (c.includes("banka bilgileri otomatik olarak doldurulacaktır.")) {
      const _iban = rentRecipientIsProxy ? (owner!.proxy!.iban ?? owner?.iban ?? "—") : (owner?.iban ?? "—");
      const _bankName = rentRecipientIsProxy ? (owner!.proxy!.bankName ?? owner?.bankName ?? "—") : (owner?.bankName ?? "—");
      c = c.replace("banka bilgileri otomatik olarak doldurulacaktır.",
        (paymentPerson ?? owner?.name ?? "—") + " adına " + _iban + " IBAN nolu " + _bankName + " hesabını kullanacaktır.");
    }
    return c;
  }).filter(Boolean);

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
    '<div class="doc-head running"><span class="meta">Kira Kontratı</span></div>';

  const page1 = `
    <div class="page">
      <div class="content">
        <div class="doc-head">
          <h1>KİRA KONTRATI</h1>
          </div>
        <p class="clause">İşbu kira kontratı, aşağıda kimlik bilgileri yer alan taraflar arasında, aşağıda yazılı koşullarla düzenlenmiştir.</p>

        <h2>MADDE 1 — TARAFLAR</h2>
        <div>
          ${fieldRow("Kiracı", tenant?.name ?? "—")}
          ${
            tenant?.isCompany
              ? `${fieldRow("Vergi No", tenant?.taxNumber || tenant?.tcNo || "—")}${tenant?.taxOffice ? fieldRow("Vergi Dairesi", tenant.taxOffice) : ""}${tenant?.signatoryName ? fieldRow("İmza Yetkilisi", tenant.signatoryName) : ""}`
              : fieldRow("TC Kimlik No", tenant?.tcNo ?? "—")
          }
          ${fieldRow("Telefon", tenant?.phone ?? "—")}
          ${fieldRow("Adres", tenant?.address ?? "—")}
          ${fieldRow("E-posta", tenant?.email ?? "—")}
          ${fieldRow("Kiraya Veren", owner?.name ?? "—")}
          ${
            owner?.isCompany
              ? `${fieldRow("Vergi No", owner?.taxNumber || owner?.tcNo || "—")}${owner?.taxOffice ? fieldRow("Vergi Dairesi", owner.taxOffice) : ""}${owner?.signatoryName ? fieldRow("İmza Yetkilisi", owner.signatoryName) : ""}`
              : fieldRow("TC Kimlik No", owner?.tcNo ?? "—")
          }
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
        <p class="clause">Kiracı, kira bedelini her ayın başında ödemekle yükümlüdür. Aylık kira bedeli ${esc(
          tl(contract.rentAmount),
        )}${esc(
          contract.rentVat === "haric"
            ? " (KDV hariç)"
            : contract.rentVat === "dahil"
              ? " (KDV dahil)"
              : "",
        )} olarak belirlenmiştir. Yıllık kira bedeli ${esc(
          tl(contract.rentAmount * 12),
        )}${esc(
          contract.rentVat === "haric"
            ? " (KDV hariç)"
            : contract.rentVat === "dahil"
              ? " (KDV dahil)"
              : "",
        )} olarak hesaplanmıştır.</p>

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
          ${conditions.map(
            (c, i) => `<p><strong>Madde ${i + 1}.</strong> ${esc(c)}</p>`,
          ).join("\n          ")}
        </div>

        <h2>HUSUSİ ŞARTLAR</h2>
        <div class="conditions">
          ${processedSpecial.map(
            (c, i) => `<p><strong>${esc(String(i + 1))}.</strong> ${c}</p>`,
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

        <p class="clause closing">${esc(String(conditions.length))} ( ${esc(toWordsTR(conditions.length)).toLocaleLowerCase("tr")} ) genel, ${esc(String(processedSpecial.length))} ( ${esc(toWordsTR(processedSpecial.length)).toLocaleLowerCase("tr")} ) özel hükümden oluşan iş bu sözleşme Kiracı, Kiraya veren ve ${kefil ? "Kefiller" : ""} arasında karşılıklı mutabakata varılarak iki (2) suret olarak düzenlenmiş ve imzaları ile tasdik edilerek yürürlüğe girmiştir.</p>
        <p class="clause closing">İşbu kira kontratı, taraflarca okunarak anlaşılmış ve aşağıda imza altına alınmıştır. Taraflardan her biri, sözleşme metninin birer örneğini teslim almıştır.</p>
        <div class="sig-date">Tarih: ${esc(formatDate(Date.now()))}</div>
      </div>
      ${signatures(3)}
    </div>`;

  // Tahliye taahhütnamesi — ayrı sayfa (yalnızca evictionCommitment seçiliyse).
  const evictionSigner = owner?.proxy ? owner.proxy.name : (owner?.name ?? "—");
  const commitDate = contract.evictionCommitmentDate
    ? formatDate(contract.evictionCommitmentDate)
    : "—";
  const evictDate = contract.evictionDate
    ? formatDate(contract.evictionDate)
    : "";

  const page4 = hasEviction
    ? `
    <div class="page">
      <div class="content">
        <div class="doc-head">
          <h1>TAHLİYE TAAHHÜTNAMESİ</h1>
        </div>

        <p class="clause">Ben ${esc(tenant?.name ?? "—")}, Kiraya Veren ${esc(evictionSigner)} arasında imzalanan Kira Sözleşmesi uyarınca Mecur’da kiracı sıfatı ile bulunmaktayız.</p>

        <p class="clause">Halen Kiracı olarak kullanmakta olduğumuz yukarıda açık adresi yazılı Mecur’u, ${esc(evictDate) ? `${esc(evictDate)} tarihinde, ` : ''}hiçbir ihtar ve ihbara veya başkaca herhangi bir hukuki işleme gerek kalmaksızın kayıtsız ve şartsız olarak, 6098 sayılı Türk Borçlar Kanunu (\"TBK\")’nın 352/1 maddesi gereğince, tarafımıza teslim edilen Mecur’da bulunan dekorasyon ve demirbaşlar konutta bulunan tüm eşyalar kullanılabilir ve çalışır vaziyette tam ve sağlam olarak tahliye tarihimizde teslim ederek Kiraya Veren ${esc(evictionSigner)}’ya teslim edeceğimizi gayrikabili rücu kabul beyan ve taahhüt ederiz.</p>

        <p class="clause">Kiracı, işbu tahliye taahhüdü ile, Kira Sözleşmesi uyarınca kiralamış olduğumuz Mecur’u, hiçbir ihtar, ihbar, bildirim, mahkeme kararı vs. başkaca herhangi bir hukuki işleme gerek kalmaksızın, ${esc(evictDate) ? `${esc(evictDate)} tarihinde ` : ''}teslim aldığı şekli ile tahliye ve teslim edeceğini, kendi serbest iradesi ile gayrikabili rücu beyan, kabul ve taahhüt eder.</p>

        <p class="clause">Kiracı, yukarıda belirtilen şart ve kapsamlardaki tahliye yükümlüğü gereği gibi yerine getirmediği takdirde;</p>

        <p class="clause">&bull; Mecur’un Kiraya Veren tarafından cebri icra yoluyla cebren tahliye ettirileceğini ve bu halde bu hususla ilgili olarak sarf edilecek tüm masrafların ve bilcümle ferilerinin kiracı tarafından tazmin edileceğini,</p>
        <p class="clause">&bull; TBK’nın kira akdi ile ilgili hükümlerini kabul ettiğimizi ve tahliyeyi geciktirmemiz halinde gecikmeden dolayı Kiraya Veren’in bu nedenle uğ-rayacağı zarar ve ziyanları herhangi bir ihtar, ihbar ve hukuki merasime gerek kalmadan derhal, nakden ve peşinen ödeyeceğimizi,</p>
        <p class="clause">&bull; Yukarıda ifade edilenlerle sınırlı olmaksızın Kiraya Veren’in bu nedenle uğradığı tüm maddi, manevi, doğrudan, dolaylı, menfi, müsbet her türlü zarar ve ziyanını tazmin etmeyi, bu kapsamda her türlü yargılama gideri, avukatlık ücretini de ödemekle yükümlü olduğumuzu;</p>

        <p class="clause">gayrikabili rücu kabul, beyan ve taahhüt ederiz.</p>

        <p class="clause">İşbu Tahliye Taahhüdü, Kiracı ile Kiraya Veren arasındaki temel ilişkinin herhangi bir hususunun geçerliliğine veya icra edilebilirliğine ilişkin herhangi bir değişiklikten veya ilgili belgelerde yapılan tadillerden veya geçerlilikten etkilenmeyeceğini, gayrikabili rücu, kabul, beyan ve taahhüt ederiz.</p>

        <p class="clause">İşbu Tahliye Taahhüdü, kanunlar iştilafı hükümlerine bakılmaksızın Türkiye Cumhuriyeti kanunlarına tabidir ve Türkiye Cumhuriyeti kanunlarına uygun olarak yorumlanacaktır. İşbu Tahliye Taahhüdü’nden kaynaklanan uyuşmazlıkların çözümünde İstanbul (Anadolu) mahkemeleri ve icra daireleri yetkilidir.</p>

        <p class="clause">İşbu Tahliye Taahhüdü, Kira Sözleşmesi uyarınca tesis edilen kira ilişkisine istinaden düzenlenmiş olup, sonuçları bilinerek herhangi bir baskı altında kalmadan ve müzayaka halinde olmadan, serbest irademizle ${esc(commitDate)} tarihinde imzalanmıştır.</p>

        <p class="clause">İşbu Tahliye Taahhüdü tek asıl nüsha ve (İki) sayfa halinde düzenlenerek Kiraya Veren’e teslim edilmiştir.</p>

        <div class="taahhut-box">
          <div class="field-row"><span class="field-label">Taahhüt Tarihi</span><span>${esc(commitDate)}</span></div>
          ${evictDate ? `<div class="field-row"><span class="field-label">Tahliye Tarihi</span><span>${esc(evictDate)}</span></div>` : ""}
          <div class="field-row"><span class="field-label">Kiracı</span><span>${esc(tenant?.name ?? "—")}</span></div>
          <div class="field-row"><span class="field-label">Kiraya Veren</span><span>${esc(evictionSigner)}</span></div>
        </div>
      </div>
      <div class="signatures">
        <div class="signature"><div class="line"></div><div class="name">Kiracı<span>${esc(tenant?.name ?? "—")}</span></div></div>
        <div class="signature"><div class="line"></div><div class="name">Kiraya Veren<span>${esc(evictionSigner)}</span></div></div>
      </div>
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
  conditions,
  specialConditions,
  onClose,
  onPrint,
}: {
  contract: ContractDocData | null;
  property?: Property;
  owner?: Owner;
  tenant?: Tenant;
  conditions?: string[];
  specialConditions?: string[];
  onClose: () => void;
  onPrint?: () => void;
}) {
  const html = useMemo(
    () =>
      contract
        ? buildContractHtml(contract, owner, tenant, property, conditions, specialConditions)
        : "",
    [contract, property, owner, tenant, conditions, specialConditions],
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
