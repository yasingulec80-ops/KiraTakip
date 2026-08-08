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
import { downloadCsv, formatDate, formatNumber, printReport } from "@/lib/export";
import { useMutation, useQuery } from "convex/react";
import { Building2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailRow, DialogShell, Field, Row, RowActions } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Property = Doc<"properties">;

interface FixtureDraft {
  name: string;
  quantity: string;
}

interface PropertyFormState {
  ownerId: string;
  name: string;
  address: string;
  m2: string;
  roomCount: string;
  facade: string;
  electricityMeter: string;
  waterMeter: string;
  gasMeter: string;
  fixtures: FixtureDraft[];
  notes: string;
}

const emptyForm: PropertyFormState = {
  ownerId: "",
  name: "",
  address: "",
  m2: "",
  roomCount: "",
  facade: "",
  electricityMeter: "",
  waterMeter: "",
  gasMeter: "",
  fixtures: [],
  notes: "",
};

const formFromProperty = (p: Property): PropertyFormState => ({
  ownerId: p.ownerId?.toString() ?? "",
  name: p.name,
  address: p.address,
  m2: p.m2 !== undefined ? String(p.m2) : "",
  roomCount: p.roomCount ?? "",
  facade: p.facade ?? "",
  electricityMeter: p.electricityMeter ?? "",
  waterMeter: p.waterMeter ?? "",
  gasMeter: p.gasMeter ?? "",
  fixtures: (p.fixtures ?? []).map((f) => ({
    name: f.name,
    quantity: String(f.quantity),
  })),
  notes: p.notes ?? "",
});

const CSV_HEADERS = [
  "Gayrimenkul Adı",
  "Malik",
  "Adres",
  "M²",
  "Oda Sayısı",
  "Cephe",
  "Elektrik Sayaç No",
  "Su Sayaç No",
  "Doğalgaz Sayaç No",
  "Demirbaşlar",
  "Kayıt Tarihi",
];

export function PropertySection() {
  const { user } = useAuth();
  const properties = useQuery(api.properties.list);
  const owners = useQuery(api.owners.list);
  const createProperty = useMutation(api.properties.create);
  const updateProperty = useMutation(api.properties.update);
  const removeProperty = useMutation(api.properties.remove);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [viewing, setViewing] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState<Property | null>(null);

  const ownerMap = useMemo(() => {
    const map = new Map<string, Doc<"owners">>();
    (owners ?? []).forEach((o) => map.set(o._id.toString(), o));
    return map;
  }, [owners]);

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (properties ?? []).filter((p) => {
      if (fromMs !== null && p._creationTime < fromMs) return false;
      if (toMs !== null && p._creationTime > toMs) return false;
      if (q === "") return true;

      const owner = p.ownerId ? ownerMap.get(p.ownerId.toString()) : undefined;
      const haystack = [
        p.name,
        p.address,
        p.roomCount,
        p.facade,
        p.electricityMeter,
        p.waterMeter,
        p.gasMeter,
        owner?.name,
        owner?.tcNo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [properties, ownerMap, search, from, to]);

  const isAdmin = user?.role === "admin";

  const exportCsv = () => {
    downloadCsv(
      "gayrimenkuller",
      CSV_HEADERS,
      filtered.map((p) => {
        const owner = p.ownerId ? ownerMap.get(p.ownerId.toString()) : undefined;
        return [
          p.name,
          owner?.name ?? "—",
          p.address,
          p.m2 !== undefined ? formatNumber(p.m2) : "",
          p.roomCount ?? "",
          p.facade ?? "",
          p.electricityMeter ?? "",
          p.waterMeter ?? "",
          p.gasMeter ?? "",
          (p.fixtures ?? []).map((f) => `${f.name} (${f.quantity})`).join(", "),
          formatDate(p._creationTime),
        ];
      }),
    );
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport(
      "Gayrimenkuller",
      "Gayrimenkul listesi",
      CSV_HEADERS,
      filtered.map((p) => {
        const owner = p.ownerId ? ownerMap.get(p.ownerId.toString()) : undefined;
        return [
          p.name,
          owner?.name ?? "—",
          p.address,
          p.m2 !== undefined ? formatNumber(p.m2) : "",
          p.roomCount ?? "",
          p.facade ?? "",
          p.electricityMeter ?? "",
          p.waterMeter ?? "",
          p.gasMeter ?? "",
          (p.fixtures ?? []).map((f) => `${f.name} (${f.quantity})`).join(", "),
          formatDate(p._creationTime),
        ];
      }),
    );
    toast.success("PDF dökümü hazırlanıyor.");
  };

  // Parse a numeric input that may use a Turkish decimal comma.
  const parseNumber = (value: string): number | undefined => {
    if (value.trim() === "") return undefined;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const handleSave = async (form: PropertyFormState) => {
    const payload = {
      ownerId: form.ownerId
        ? (form.ownerId as Id<"owners">)
        : undefined,
      name: form.name.trim(),
      address: form.address.trim(),
      m2: parseNumber(form.m2),
      roomCount: form.roomCount.trim() || undefined,
      facade: form.facade.trim() || undefined,
      electricityMeter: form.electricityMeter.trim() || undefined,
      waterMeter: form.waterMeter.trim() || undefined,
      gasMeter: form.gasMeter.trim() || undefined,
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
        await updateProperty({ id: editing._id, ...payload });
        toast.success("Gayrimenkul güncellendi.");
      } else {
        await createProperty(payload);
        toast.success("Gayrimenkul eklendi.");
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız.");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await removeProperty({ id: deleting._id });
      toast.success("Gayrimenkul silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Gayrimenkuller"
        hint="Portföyünüzdeki tüm gayrimenkuller"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Ad, adres, malik, sayaç no ara…"
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
        addLabel="Yeni Gayrimenkul"
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      {properties === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {properties.length === 0
                ? "Henüz gayrimenkul eklenmedi. İlk kaydı oluşturmak için “Yeni Gayrimenkul”e basın."
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
                  <TableHead>Adres</TableHead>
                  <TableHead className="text-right">M²</TableHead>
                  <TableHead>Oda</TableHead>
                  <TableHead>Cephe</TableHead>
                  <TableHead>Sayaçlar</TableHead>
                  <TableHead>Demirbaş</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const owner = p.ownerId
                    ? ownerMap.get(p.ownerId.toString())
                    : undefined;
                  return (
                    <TableRow key={p._id} className="align-middle">
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {owner ? `Malik: ${owner.name}` : "Malik atanmadı"}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-52 truncate text-sm text-muted-foreground">
                        {p.address}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.m2 !== undefined ? `${formatNumber(p.m2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{p.roomCount ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.facade ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-[11px] leading-4 text-muted-foreground">
                          <span>E: {p.electricityMeter ?? "—"}</span>
                          <span>S: {p.waterMeter ?? "—"}</span>
                          <span>G: {p.gasMeter ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {(p.fixtures ?? []).length > 0 ? (
                          <Badge variant="secondary" className="rounded-none">
                            {(p.fixtures ?? []).length} kalem
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RowActions
                          onView={() => setViewing(p)}
                          onEdit={() => {
                            setEditing(p);
                            setFormOpen(true);
                          }}
                          onDelete={
                            isAdmin
                              ? () => setDeleting(p)
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {filtered.length} / {properties.length} kayıt gösteriliyor
            </span>
            <span>Eklenme tarihine göre sıralı</span>
          </div>
        </div>
      )}

      <PropertyFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        owners={owners ?? []}
        onSave={handleSave}
      />

      <PropertyDetailDialog
        property={viewing}
        onClose={() => setViewing(null)}
        owner={viewing?.ownerId ? ownerMap.get(viewing.ownerId.toString()) : undefined}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Gayrimenkul silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” kalıcı olarak silinecek. Bu işlem geri
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

function PropertyFormDialog({
  open,
  onOpenChange,
  editing,
  owners,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Property | null;
  owners: Doc<"owners">[];
  onSave: (form: PropertyFormState) => void;
}) {
  const [form, setForm] = useState<PropertyFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // Sync form state when the dialog opens for a new/edit record.
  const [lastKey, setLastKey] = useState<string>("");
  const key = open ? (editing ? `edit-${editing._id}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm(editing ? formFromProperty(editing) : emptyForm);
    setError(null);
  }

  const set = <K extends keyof PropertyFormState>(
    key: K,
    value: PropertyFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const setFixture = (index: number, patch: Partial<FixtureDraft>) =>
    setForm((f) => ({
      ...f,
      fixtures: f.fixtures.map((fixture, i) =>
        i === index ? { ...fixture, ...patch } : fixture,
      ),
    }));

  const submit = () => {
    if (form.name.trim() === "" || form.address.trim() === "") {
      setError("Gayrimenkul adı ve adres zorunludur.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Gayrimenkulü Düzenle" : "Yeni Gayrimenkul"}
      description={
        editing
          ? `“${editing.name}” kaydının bilgilerini güncelleyin.`
          : "Gayrimenkulün temel ve teknik bilgilerini girin."
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
            {editing ? "Kaydet" : "Ekle"}
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
          <Field label="Malik" hint="isteğe bağlı">
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
          <Field label="Gayrimenkul Adı" required>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="örn. Bağdat Cad. No:12 D:4"
              className="rounded-none"
            />
          </Field>
        </Row>

        <Field label="Adres" required>
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Mahalle, cadde, no, il/ilçe"
            className="rounded-none"
          />
        </Field>

        <Row cols={3}>
          <Field label="M²">
            <Input
              type="number"
              min={0}
              value={form.m2}
              onChange={(e) => set("m2", e.target.value)}
              placeholder="120"
              className="rounded-none"
            />
          </Field>
          <Field label="Oda Sayısı">
            <Input
              value={form.roomCount}
              onChange={(e) => set("roomCount", e.target.value)}
              placeholder="3+1"
              className="rounded-none"
            />
          </Field>
          <Field label="Cephe Bilgisi">
            <Input
              value={form.facade}
              onChange={(e) => set("facade", e.target.value)}
              placeholder="örn. Güney"
              className="rounded-none"
            />
          </Field>
        </Row>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Elektrik Sayaç / Bağlantı No">
            <Input
              value={form.electricityMeter}
              onChange={(e) => set("electricityMeter", e.target.value)}
              className="rounded-none"
            />
          </Field>
          <Field label="Su Sayaç / Bağlantı No">
            <Input
              value={form.waterMeter}
              onChange={(e) => set("waterMeter", e.target.value)}
              className="rounded-none"
            />
          </Field>
          <Field label="Doğalgaz Sayaç / Bağlantı No">
            <Input
              value={form.gasMeter}
              onChange={(e) => set("gasMeter", e.target.value)}
              className="rounded-none"
            />
          </Field>
        </div>

        {/* Demirbaşlar */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Demirbaşlar
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
              Beyaz eşya, mobilya ve diğer demirbaşları ekleyebilirsiniz.
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

        <Field label="Notlar">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            placeholder="İsteğe bağlı notlar…"
            className="w-full rounded-none border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0"
          />
        </Field>
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */

function PropertyDetailDialog({
  property,
  owner,
  onClose,
}: {
  property: Property | null;
  owner?: Doc<"owners">;
  onClose: () => void;
}) {
  return (
    <DialogShell
      open={property !== null}
      onOpenChange={(open) => !open && onClose()}
      title={property?.name ?? ""}
      description="Gayrimenkul detayı"
      wide
      footer={
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          onClick={onClose}
        >
          Kapat
        </Button>
      }
    >
      {property && (
        <dl className="divide-y divide-border">
          <DetailRow
            label="Malik"
            value={
              owner ? (
                <span>
                  {owner.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {owner.phone}
                  </span>
                </span>
              ) : (
                "Atanmadı"
              )
            }
          />
          <DetailRow label="Adres" value={property.address} />
          <DetailRow
            label="M²"
            value={
              property.m2 !== undefined
                ? `${formatNumber(property.m2)} m²`
                : undefined
            }
          />
          <DetailRow label="Oda Sayısı" value={property.roomCount} />
          <DetailRow label="Cephe Bilgisi" value={property.facade} />
          <DetailRow
            label="Elektrik"
            value={property.electricityMeter}
            mono
          />
          <DetailRow label="Su" value={property.waterMeter} mono />
          <DetailRow label="Doğalgaz" value={property.gasMeter} mono />
          <DetailRow
            label="Demirbaşlar"
            value={
              (property.fixtures ?? []).length > 0 ? (
                <ul className="space-y-1">
                  {(property.fixtures ?? []).map((f, i) => (
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
          <DetailRow label="Notlar" value={property.notes} />
          <DetailRow
            label="Kayıt Tarihi"
            value={formatDate(property._creationTime)}
          />
        </dl>
      )}
    </DialogShell>
  );
}
