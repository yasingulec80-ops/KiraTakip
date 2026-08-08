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
import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailRow, DialogShell, Field, Row, RowActions } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

type Tenant = Doc<"tenants">;

interface TenantFormState {
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
  hasGuarantor: boolean;
  guarantorName: string;
  guarantorTcNo: string;
  guarantorPhone: string;
  guarantorAddress: string;
  guarantorEmail: string;
}

const emptyForm: TenantFormState = {
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
  hasGuarantor: false,
  guarantorName: "",
  guarantorTcNo: "",
  guarantorPhone: "",
  guarantorAddress: "",
  guarantorEmail: "",
};

const formFromTenant = (t: Tenant): TenantFormState => ({
  isCompany: t.isCompany === true,
  name: t.name,
  tcNo: t.tcNo ?? "",
  taxOffice: t.taxOffice ?? "",
  taxNumber: t.taxNumber ?? "",
  signatoryName: t.signatoryName ?? "",
  signatoryTcNo: t.signatoryTcNo ?? "",
  phone: t.phone,
  address: t.address,
  email: t.email,
  hasGuarantor: t.guarantor !== null,
  guarantorName: t.guarantor?.name ?? "",
  guarantorTcNo: t.guarantor?.tcNo ?? "",
  guarantorPhone: t.guarantor?.phone ?? "",
  guarantorAddress: t.guarantor?.address ?? "",
  guarantorEmail: t.guarantor?.email ?? "",
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
  "Kefil",
  "Kefil TC",
  "Kefil Telefon",
  "Kayıt Tarihi",
];

export function TenantSection() {
  const { user } = useAuth();
  const tenants = useQuery(api.tenants.list);
  const createTenant = useMutation(api.tenants.create);
  const updateTenant = useMutation(api.tenants.update);
  const removeTenant = useMutation(api.tenants.remove);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [viewing, setViewing] = useState<Tenant | null>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);

  const isAdmin = user?.role === "admin";

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (tenants ?? []).filter((t) => {
      if (fromMs !== null && t._creationTime < fromMs) return false;
      if (toMs !== null && t._creationTime > toMs) return false;
      if (q === "") return true;

      const haystack = [
        t.name,
        t.tcNo,
        t.phone,
        t.address,
        t.email,
        t.guarantor?.name,
        t.guarantor?.tcNo,
        t.guarantor?.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");
      return haystack.includes(q);
    });
  }, [tenants, search, from, to]);

  const rows = (t: Tenant): (string | null)[] => [
    t.isCompany === true ? "Şirket" : "Kişi",
    t.name,
    t.isCompany === true ? (t.taxNumber || t.tcNo) : t.tcNo,
    t.isCompany === true ? (t.taxOffice ?? "") : "",
    t.isCompany === true ? (t.signatoryName ?? "") : "",
    t.isCompany === true ? (t.signatoryTcNo ?? "") : "",
    t.phone,
    t.address,
    t.email,
    t.guarantor?.name ?? "",
    t.guarantor?.tcNo ?? "",
    t.guarantor?.phone ?? "",
    formatDate(t._creationTime),
  ];

  const exportCsv = () => {
    downloadCsv("kiracilar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Kiracılar", "Kiracı listesi", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: TenantFormState) => {
    const payload = {
      name: form.name.trim(),
      tcNo: form.isCompany ? undefined : form.tcNo.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      email: form.email.trim(),
      isCompany: form.isCompany,
      taxOffice: form.isCompany ? form.taxOffice.trim() : undefined,
      taxNumber: form.isCompany ? form.taxNumber.trim() : undefined,
      signatoryName: form.isCompany ? form.signatoryName.trim() : undefined,
      signatoryTcNo: form.isCompany ? form.signatoryTcNo.trim() : undefined,
      guarantor: form.hasGuarantor
        ? {
            name: form.guarantorName.trim(),
            tcNo: form.guarantorTcNo.trim(),
            phone: form.guarantorPhone.trim(),
            address: form.guarantorAddress.trim(),
            email: form.guarantorEmail.trim(),
          }
        : null,
    };

    try {
      if (editing) {
        await updateTenant({ id: editing._id, ...payload });
        toast.success("Kiracı güncellendi.");
      } else {
        await createTenant(payload);
        toast.success("Kiracı eklendi.");
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
      await removeTenant({ id: deleting._id });
      toast.success("Kiracı silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Kiracılar"
        hint="Kiracılar ve kefilleri"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Ad, TC, telefon, e-posta ara…"
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
        addLabel="Yeni Kiracı"
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      {tenants === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {tenants.length === 0
                ? "Henüz kiracı eklenmedi. İlk kaydı oluşturmak için “Yeni Kiracı”ya basın."
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
                  <TableHead>Kefil</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t._id} className="align-middle">
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {t.name}
                        {t.isCompany && (
                          <Badge variant="outline" className="rounded-none">
                            Şirket
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(t._creationTime)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {t.isCompany
                        ? (t.taxNumber || t.tcNo || "—")
                        : (t.tcNo || "—")}
                    </TableCell>
                    <TableCell className="text-sm">{t.phone || "—"}</TableCell>
                    <TableCell className="max-w-44 truncate text-sm text-muted-foreground">
                      {t.address || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{t.email || "—"}</TableCell>
                    <TableCell>
                      {t.guarantor ? (
                        <Badge variant="outline" className="rounded-none text-brand">
                          {t.guarantor.name}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        onView={() => setViewing(t)}
                        onEdit={() => {
                          setEditing(t);
                          setFormOpen(true);
                        }}
                        onDelete={isAdmin ? () => setDeleting(t) : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>{filtered.length} / {tenants.length} kayıt gösteriliyor</span>
            <span>Kefil atanan kiracılar rozetle işaretlidir</span>
          </div>
        </div>
      )}

      <TenantFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        onSave={handleSave}
      />

      <TenantDetailDialog tenant={viewing} onClose={() => setViewing(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Kiracı silinsin mi?
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

function TenantFormDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Tenant | null;
  onSave: (form: TenantFormState) => void;
}) {
  const [form, setForm] = useState<TenantFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? (editing ? `edit-${editing._id}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm(editing ? formFromTenant(editing) : emptyForm);
    setError(null);
  }

  const set = <K extends keyof TenantFormState>(
    key: K,
    value: TenantFormState[K],
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
      form.hasGuarantor &&
      (form.guarantorName.trim() === "" ||
        form.guarantorTcNo.trim() === "" ||
        form.guarantorPhone.trim() === "")
    ) {
      setError("Kefil için adı soyadı, TC kimlik ve telefon zorunludur.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Kiracıyı Düzenle" : "Yeni Kiracı"}
      description={
        editing
          ? `“${editing.name}” kaydının bilgilerini güncelleyin.`
          : "Kiracının kimlik ve iletişim bilgilerini girin."
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
            Kiracı bir şirket
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
                  placeholder="örn. Demir İnşaat Ltd. Şti."
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
          </div>
        ) : (
          <Row>
            <Field label="Adı Soyadı" required>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="örn. Ayşe Demir"
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

        <Field label="Adresi">
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Kiracının ikamet adresi"
            className="rounded-none"
          />
        </Field>

        {/* Kefil */}
        <div className="border border-border bg-muted/40 p-4">
          <label className="flex items-center gap-2.5">
            <Checkbox
              checked={form.hasGuarantor}
              onCheckedChange={(checked) => set("hasGuarantor", checked === true)}
            />
            <span className="text-sm font-medium">
              Bu kiracının bir kefili var
            </span>
            <span className="text-xs text-muted-foreground">
              Kefil, kiracının yükümlülüklerine kefil olur
            </span>
          </label>

          {form.hasGuarantor && (
            <div className="mt-4 space-y-4">
              <Row>
                <Field label="Kefil Adı Soyadı" required>
                  <Input
                    value={form.guarantorName}
                    onChange={(e) => set("guarantorName", e.target.value)}
                    className="rounded-none"
                  />
                </Field>
                <Field label="Kefil TC Kimlik No" required>
                  <Input
                    value={form.guarantorTcNo}
                    onChange={(e) => set("guarantorTcNo", e.target.value)}
                    className="rounded-none"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Kefil Telefon Numarası" required>
                  <Input
                    value={form.guarantorPhone}
                    onChange={(e) => set("guarantorPhone", e.target.value)}
                    className="rounded-none"
                  />
                </Field>
                <Field label="Kefil E-posta Adresi">
                  <Input
                    type="email"
                    value={form.guarantorEmail}
                    onChange={(e) => set("guarantorEmail", e.target.value)}
                    className="rounded-none"
                  />
                </Field>
              </Row>
              <Field label="Kefil Adresi">
                <Input
                  value={form.guarantorAddress}
                  onChange={(e) => set("guarantorAddress", e.target.value)}
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

function TenantDetailDialog({
  tenant,
  onClose,
}: {
  tenant: Tenant | null;
  onClose: () => void;
}) {
  return (
    <DialogShell
      open={tenant !== null}
      onOpenChange={(open) => !open && onClose()}
      title={tenant?.name ?? ""}
      description="Kiracı detayı"
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
      {tenant && (
        <dl className="divide-y divide-border">
          {tenant.isCompany && (
            <>
              <DetailRow label="Tür" value="Şirket" />
              <DetailRow label="Şirket Ünvanı" value={tenant.name} />
              <DetailRow
                label="Vergi Dairesi"
                value={tenant.taxOffice || "—"}
              />
              <DetailRow
                label="Vergi No"
                value={tenant.taxNumber || tenant.tcNo}
                mono
              />
              <DetailRow
                label="İmza Yetkilisi"
                value={
                  tenant.signatoryName || tenant.signatoryTcNo ? (
                    <div className="space-y-0.5">
                      <div>{tenant.signatoryName}</div>
                      {tenant.signatoryTcNo && (
                        <div className="font-mono text-xs text-muted-foreground">
                          TC {tenant.signatoryTcNo}
                        </div>
                      )}
                    </div>
                  ) : undefined
                }
              />
            </>
          )}
          {!tenant.isCompany && (
            <DetailRow label="TC Kimlik" value={tenant.tcNo} mono />
          )}
          <DetailRow label="Telefon" value={tenant.phone} />
          <DetailRow label="Adres" value={tenant.address} />
          <DetailRow label="E-posta" value={tenant.email} />
          <DetailRow
            label="Kefil"
            value={
              tenant.guarantor ? (
                <div className="space-y-0.5">
                  <div>{tenant.guarantor.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {tenant.guarantor.tcNo} · {tenant.guarantor.phone}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tenant.guarantor.address}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tenant.guarantor.email}
                  </div>
                </div>
              ) : undefined
            }
          />
          <DetailRow
            label="Kayıt Tarihi"
            value={formatDate(tenant._creationTime)}
          />
        </dl>
      )}
    </DialogShell>
  );
}
