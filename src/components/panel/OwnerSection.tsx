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
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { downloadCsv, formatDate, printReport } from "@/lib/export";
import { useMutation, useQuery } from "convex/react";
import { UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailRow, DialogShell, Field, Row, RowActions } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Owner = Doc<"owners">;

interface OwnerFormState {
  isCompany: boolean;
  name: string;
  tcNo: string;
  taxOffice: string;
  taxNumber: string;
  signatoryName: string;
  signatoryTcNo: string;
  phone: string;
  address: string;
  email: string;
  bankName: string;
  iban: string;
  hasProxy: boolean;
  proxyName: string;
  proxyTcNo: string;
  proxyPhone: string;
}

const emptyForm: OwnerFormState = {
  isCompany: false,
  name: "",
  tcNo: "",
  taxOffice: "",
  taxNumber: "",
  signatoryName: "",
  signatoryTcNo: "",
  phone: "",
  address: "",
  email: "",
  bankName: "",
  iban: "",
  hasProxy: false,
  proxyName: "",
  proxyTcNo: "",
  proxyPhone: "",
};

const formFromOwner = (o: Owner): OwnerFormState => ({
  isCompany: o.isCompany === true,
  name: o.name,
  tcNo: o.tcNo ?? "",
  taxOffice: o.taxOffice ?? "",
  taxNumber: o.taxNumber ?? "",
  signatoryName: o.signatoryName ?? "",
  signatoryTcNo: o.signatoryTcNo ?? "",
  phone: o.phone,
  address: o.address,
  email: o.email,
  bankName: o.bankName,
  iban: o.iban,
  hasProxy: o.proxy !== null,
  proxyName: o.proxy?.name ?? "",
  proxyTcNo: o.proxy?.tcNo ?? "",
  proxyPhone: o.proxy?.phone ?? "",
});

const CSV_HEADERS = [
  "Tür",
  "Adı Soyadı / Ünvan",
  "TC / Vergi No",
  "Vergi Dairesi",
  "İmza Yetkilisi",
  "İmza Yetkilisi TC",
  "Telefon",
  "Adres",
  "E-posta",
  "Banka",
  "IBAN",
  "Vekil",
  "Vekil TC",
  "Vekil Telefon",
  "Kayıt Tarihi",
];

export function OwnerSection() {
  const { user } = useAuth();
  const owners = useQuery(api.owners.list);
  const createOwner = useMutation(api.owners.create);
  const updateOwner = useMutation(api.owners.update);
  const removeOwner = useMutation(api.owners.remove);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Owner | null>(null);
  const [viewing, setViewing] = useState<Owner | null>(null);
  const [deleting, setDeleting] = useState<Owner | null>(null);

  const isAdmin = user?.role === "admin";

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (owners ?? []).filter((o) => {
      if (fromMs !== null && o._creationTime < fromMs) return false;
      if (toMs !== null && o._creationTime > toMs) return false;
      if (q === "") return true;

      const haystack = [
        o.name,
        o.tcNo,
        o.phone,
        o.address,
        o.email,
        o.bankName,
        o.iban,
        o.proxy?.name,
        o.proxy?.tcNo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [owners, search, from, to]);

  const rows = (o: Owner): (string | null)[] => [
    o.isCompany === true ? "Şirket" : "Kişi",
    o.name,
    o.isCompany === true ? (o.taxNumber || o.tcNo) : o.tcNo,
    o.isCompany === true ? (o.taxOffice ?? "") : "",
    o.isCompany === true ? (o.signatoryName ?? "") : "",
    o.isCompany === true ? (o.signatoryTcNo ?? "") : "",
    o.phone,
    o.address,
    o.email,
    o.bankName,
    o.iban,
    o.proxy?.name ?? "",
    o.proxy?.tcNo ?? "",
    o.proxy?.phone ?? "",
    formatDate(o._creationTime),
  ];

  const exportCsv = () => {
    downloadCsv("malikler", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Malikler", "Mal sahipleri listesi", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: OwnerFormState) => {
    const payload = {
      name: form.name.trim(),
      tcNo: form.isCompany ? undefined : form.tcNo.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      email: form.email.trim(),
      bankName: form.bankName.trim(),
      iban: form.iban.trim(),
      isCompany: form.isCompany,
      taxOffice: form.isCompany ? form.taxOffice.trim() : undefined,
      taxNumber: form.isCompany ? form.taxNumber.trim() : undefined,
      signatoryName: form.isCompany ? form.signatoryName.trim() : undefined,
      signatoryTcNo: form.isCompany ? form.signatoryTcNo.trim() : undefined,
      proxy: form.hasProxy
        ? {
            name: form.proxyName.trim(),
            tcNo: form.proxyTcNo.trim(),
            phone: form.proxyPhone.trim(),
          }
        : null,
    };

    try {
      if (editing) {
        await updateOwner({ id: editing._id, ...payload });
        toast.success("Malik güncellendi.");
      } else {
        await createOwner(payload);
        toast.success("Malik eklendi.");
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
      await removeOwner({ id: deleting._id });
      toast.success("Malik silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Malikler"
        hint="Mal sahipleri ve vekilleri"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Ad, TC, telefon, IBAN ara…"
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
        addLabel="Yeni Malik"
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      {owners === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRound />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {owners.length === 0
                ? "Henüz malik eklenmedi. İlk kaydı oluşturmak için “Yeni Malik”e basın."
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
                  <TableHead className="min-w-44">Adı Soyadı / Ünvan</TableHead>
                  <TableHead>TC / Vergi No</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Adres</TableHead>
                  <TableHead>E-posta</TableHead>
                  <TableHead>Banka / IBAN</TableHead>
                  <TableHead>Vekil</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o._id} className="align-middle">
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {o.name}
                        {o.isCompany && (
                          <Badge variant="outline" className="rounded-none">
                            Şirket
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(o._creationTime)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {o.isCompany
                        ? (o.taxNumber || o.tcNo || "—")
                        : (o.tcNo || "—")}
                    </TableCell>
                    <TableCell className="text-sm">{o.phone || "—"}</TableCell>
                    <TableCell className="max-w-44 truncate text-sm text-muted-foreground">
                      {o.address || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{o.email || "—"}</TableCell>
                    <TableCell className="max-w-44 truncate text-sm text-muted-foreground">
                      {o.iban
                        ? `${o.bankName ? `${o.bankName} · ` : ""}${o.iban}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {o.proxy ? (
                        <Badge variant="outline" className="rounded-none text-brand">
                          {o.proxy.name}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        onView={() => setViewing(o)}
                        onEdit={() => {
                          setEditing(o);
                          setFormOpen(true);
                        }}
                        onDelete={isAdmin ? () => setDeleting(o) : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>{filtered.length} / {owners.length} kayıt gösteriliyor</span>
            <span>Vekil atanan malikler rozetle işaretlidir</span>
          </div>
        </div>
      )}

      <OwnerFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        onSave={handleSave}
      />

      <OwnerDetailDialog owner={viewing} onClose={() => setViewing(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Malik silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” kalıcı olarak silinecek. Bu malike bağlı
              gayrimenkuller maliksiz kalır. Bu işlem geri alınamaz.
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

function OwnerFormDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Owner | null;
  onSave: (form: OwnerFormState) => void;
}) {
  const [form, setForm] = useState<OwnerFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? (editing ? `edit-${editing._id}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm(editing ? formFromOwner(editing) : emptyForm);
    setError(null);
  }

  const set = <K extends keyof OwnerFormState>(
    key: K,
    value: OwnerFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (form.name.trim() === "" || form.phone.trim() === "") {
      setError(
        form.isCompany
          ? "Şirket ünvanı ve telefon zorunludur."
          : "Adı soyadı ve telefon zorunludur.",
      );
      return;
    }
    if (form.isCompany) {
      if (form.taxNumber.trim() === "") {
        setError("Vergi numarası zorunludur.");
        return;
      }
    } else if (form.tcNo.trim() === "") {
      setError("TC kimlik numarası zorunludur.");
      return;
    }
    if (
      form.hasProxy &&
      (form.proxyName.trim() === "" ||
        form.proxyTcNo.trim() === "" ||
        form.proxyPhone.trim() === "")
    ) {
      setError("Vekil için adı soyadı, TC kimlik ve telefon zorunludur.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Maliki Düzenle" : "Yeni Malik"}
      description={
        editing
          ? `“${editing.name}” kaydının bilgilerini güncelleyin.`
          : "Mal sahibinin kimlik, iletişim ve ödeme bilgilerini girin."
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

        {/* Şirket tiki — seçilirse şirket bilgileri açılır */}
        <div className="flex items-center gap-2.5">
          <Checkbox
            checked={form.isCompany}
            onCheckedChange={(checked) => set("isCompany", checked === true)}
          />
          <span className="text-sm font-medium">
            Malik bir şirket
          </span>
          <span className="text-xs text-muted-foreground">
            Şirket ünvanı ve vergi bilgileriyle kaydedilir
          </span>
        </div>

        {form.isCompany ? (
          <div className="space-y-4 border border-border bg-muted/40 p-4">
            <Row>
              <Field label="Şirket Ünvanı" required>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="örn. Yılmaz Gayrimenkul A.Ş."
                  className="rounded-none"
                />
              </Field>
              <Field label="Vergi Numarası" required>
                <Input
                  value={form.taxNumber}
                  onChange={(e) => set("taxNumber", e.target.value)}
                  placeholder="10 haneli vergi no"
                  className="rounded-none"
                />
              </Field>
            </Row>
            <Row>
              <Field label="Vergi Dairesi">
                <Input
                  value={form.taxOffice}
                  onChange={(e) => set("taxOffice", e.target.value)}
                  placeholder="örn. Kadıköy VD"
                  className="rounded-none"
                />
              </Field>
              <Field label="İmza Yetkilisi Adı Soyadı">
                <Input
                  value={form.signatoryName}
                  onChange={(e) => set("signatoryName", e.target.value)}
                  placeholder="Şirketi imzalayacak kişi"
                  className="rounded-none"
                />
              </Field>
            </Row>
            <Field label="İmza Yetkilisi TC Kimlik Numarası">
              <Input
                value={form.signatoryTcNo}
                onChange={(e) => set("signatoryTcNo", e.target.value)}
                placeholder="11 haneli TC no"
                className="rounded-none"
              />
            </Field>
            <Field label="Şirket Adresi">
              <Input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Şirketin merkez adresi"
                className="rounded-none"
              />
            </Field>
          </div>
        ) : (
          <Row>
            <Field label="Adı Soyadı" required>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="örn. Ahmet Yılmaz"
                className="rounded-none"
              />
            </Field>
            <Field label="TC Kimlik Numarası" required>
              <Input
                value={form.tcNo}
                onChange={(e) => set("tcNo", e.target.value)}
                placeholder="11 haneli TC no"
                className="rounded-none"
              />
            </Field>
          </Row>
        )}

        <Row>
          <Field label="Telefon Numarası" required>
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="05xx xxx xx xx"
              className="rounded-none"
            />
          </Field>
          <Field label="E-posta Adresi">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="ornek@mail.com"
              className="rounded-none"
            />
          </Field>
        </Row>

        {!form.isCompany && (
          <Field label="Adresi">
            <Input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Malikin ikamet adresi"
              className="rounded-none"
            />
          </Field>
        )}

        <Row>
          <Field label="Banka Adı">
            <Input
              value={form.bankName}
              onChange={(e) => set("bankName", e.target.value)}
              placeholder="örn. Ziraat Bankası"
              className="rounded-none"
            />
          </Field>
          <Field label="IBAN Numarası" hint="TR…">
            <Input
              value={form.iban}
              onChange={(e) => set("iban", e.target.value)}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
              className="rounded-none"
            />
          </Field>
        </Row>

        {/* Vekil */}
        <div className="border border-border bg-muted/40 p-4">
          <label className="flex items-center gap-2.5">
            <Checkbox
              checked={form.hasProxy}
              onCheckedChange={(checked) => set("hasProxy", checked === true)}
            />
            <span className="text-sm font-medium">
              Bu malikin bir vekili var
            </span>
            <span className="text-xs text-muted-foreground">
              Vekil, malik adına işlem yapabilir
            </span>
          </label>

          {form.hasProxy && (
            <div className="mt-4 space-y-4">
              <Row>
                <Field label="Vekil Adı Soyadı" required>
                  <Input
                    value={form.proxyName}
                    onChange={(e) => set("proxyName", e.target.value)}
                    className="rounded-none"
                  />
                </Field>
                <Field label="Vekil TC Kimlik No" required>
                  <Input
                    value={form.proxyTcNo}
                    onChange={(e) => set("proxyTcNo", e.target.value)}
                    className="rounded-none"
                  />
                </Field>
              </Row>
              <Field label="Vekil Telefon Numarası" required>
                <Input
                  value={form.proxyPhone}
                  onChange={(e) => set("proxyPhone", e.target.value)}
                  className="rounded-none"
                />
              </Field>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */

function OwnerDetailDialog({
  owner,
  onClose,
}: {
  owner: Owner | null;
  onClose: () => void;
}) {
  return (
    <DialogShell
      open={owner !== null}
      onOpenChange={(open) => !open && onClose()}
      title={owner?.name ?? ""}
      description="Malik detayı"
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
      {owner && (
        <dl className="divide-y divide-border">
          {owner.isCompany && (
            <>
              <DetailRow label="Tür" value="Şirket" />
              <DetailRow label="Şirket Ünvanı" value={owner.name} />
              <DetailRow
                label="Vergi Dairesi"
                value={owner.taxOffice || "—"}
              />
              <DetailRow label="Vergi No" value={owner.taxNumber || owner.tcNo} mono />
              <DetailRow
                label="İmza Yetkilisi"
                value={
                  owner.signatoryName || owner.signatoryTcNo ? (
                    <div className="space-y-0.5">
                      <div>{owner.signatoryName}</div>
                      {owner.signatoryTcNo && (
                        <div className="font-mono text-xs text-muted-foreground">
                          TC {owner.signatoryTcNo}
                        </div>
                      )}
                    </div>
                  ) : undefined
                }
              />
            </>
          )}
          {!owner.isCompany && (
            <DetailRow label="TC Kimlik" value={owner.tcNo} mono />
          )}
          <DetailRow label="Telefon" value={owner.phone} />
          <DetailRow label="Adres" value={owner.address} />
          <DetailRow label="E-posta" value={owner.email} />
          <DetailRow label="Banka" value={owner.bankName} />
          <DetailRow label="IBAN" value={owner.iban} mono />
          <DetailRow
            label="Vekil"
            value={
              owner.proxy ? (
                <div className="space-y-0.5">
                  <div>{owner.proxy.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {owner.proxy.tcNo}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {owner.proxy.phone}
                  </div>
                </div>
              ) : undefined
            }
          />
          <DetailRow
            label="Kayıt Tarihi"
            value={formatDate(owner._creationTime)}
          />
        </dl>
      )}
    </DialogShell>
  );
}
