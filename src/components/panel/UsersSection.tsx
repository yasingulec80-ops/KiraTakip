import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { KeyRound, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DialogShell, Field, Row, RowActions } from "./fields";
import { SectionToolbar } from "./SectionToolbar";

interface UserSummary {
  _id: string;
  _creationTime: number;
  name: string;
  username: string;
  role: string;
  isActive: boolean;
  authorizedPropertyIds: string[];
  isAdmin: boolean;
}

interface UserFormState {
  username: string;
  password: string;
  name: string;
  role: string;
  authorizedPropertyIds: string[];
  isActive: boolean;
}

const emptyForm: UserFormState = {
  username: "",
  password: "",
  name: "",
  role: "manager",
  authorizedPropertyIds: [],
  isActive: true,
};

const CSV_HEADERS = [
  "Kullanıcı Adı",
  "Ad Soyad",
  "Rol",
  "Yetkili Gayrimenkul",
  "Durum",
  "Kayıt Tarihi",
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Yönetici",
  manager: "Profesyonel Yönetici",
};

export function UsersSection() {
  const { user: me } = useAuth();
  const users = useQuery(api.users.listUsers);
  const properties = useQuery(api.properties.list);
  const createUser = useMutation(api.users.createUser);
  const updateUser = useMutation(api.users.updateUser);
  const deleteUser = useMutation(api.users.deleteUser);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState<UserSummary | null>(null);

  const filtered = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const q = search.trim().toLocaleLowerCase("tr");

    return (users ?? []).filter((u) => {
      if (fromMs !== null && u._creationTime < fromMs) return false;
      if (toMs !== null && u._creationTime > toMs) return false;
      if (q === "") return true;
      return `${u.username} ${u.name} ${ROLE_LABELS[u.role] ?? ""}`
        .toLocaleLowerCase("tr")
        .includes(q);
    });
  }, [users, search, from, to]);

  const rows = (u: UserSummary): (string | number)[] => [
    u.username,
    u.name,
    ROLE_LABELS[u.role] ?? u.role,
    u.isAdmin ? "Tümü" : u.authorizedPropertyIds.length,
    u.isActive ? "Aktif" : "Pasif",
    formatDate(u._creationTime),
  ];

  const exportCsv = () => {
    downloadCsv("kullanicilar", CSV_HEADERS, filtered.map(rows));
    toast.success("Excel dökümü indirildi.");
  };

  const exportPdf = () => {
    printReport("Kullanıcılar", "Sistem kullanıcıları", CSV_HEADERS, filtered.map(rows));
    toast.success("PDF dökümü hazırlanıyor.");
  };

  const handleSave = async (form: UserFormState) => {
    try {
      if (editing) {
        await updateUser({
          userId: editing._id as any,
          name: form.name.trim() || undefined,
          role: form.role as "admin" | "manager",
          authorizedPropertyIds:
            form.role === "admin" ? undefined : (form.authorizedPropertyIds as any[]),
          isActive: form.isActive,
          password: form.password.trim() || undefined,
        });
        toast.success("Kullanıcı güncellendi.");
      } else {
        await createUser({
          username: form.username.trim(),
          password: form.password,
          name: form.name.trim(),
          role: form.role as "admin" | "manager",
          authorizedPropertyIds: form.authorizedPropertyIds as any[],
          isActive: form.isActive,
        });
        toast.success("Kullanıcı oluşturuldu.");
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
      await deleteUser({ userId: deleting._id as any });
      toast.success("Kullanıcı silindi.");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silme başarısız.");
    }
  };

  return (
    <section className="space-y-6">
      <SectionToolbar
        title="Kullanıcılar"
        hint="Sistem kullanıcıları ve gayrimenkul yetkileri"
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Kullanıcı adı veya ad ara…"
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
        addLabel="Yeni Kullanıcı"
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      {users === undefined ? (
        <div className="flex items-center justify-center border border-border bg-card py-24 text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound />
            </EmptyMedia>
            <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
            <EmptyDescription>
              {users.length === 0
                ? "Henüz kullanıcı oluşturulmadı. İlk kullanıcıyı eklemek için “Yeni Kullanıcı”ya basın."
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
                  <TableHead className="min-w-40">Kullanıcı Adı</TableHead>
                  <TableHead>Ad Soyad</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Yetki</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">Eylemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const isSeededAdmin = u.username === "Admin";
                  const isSelf = me?._id === u._id;
                  return (
                    <TableRow key={u._id} className="align-middle">
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          {u.username}
                          {u.isAdmin && (
                            <ShieldCheck className="h-3.5 w-3.5 text-brand" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(u._creationTime)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{u.name || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {ROLE_LABELS[u.role] ?? u.role}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.isAdmin
                          ? "Tüm gayrimenkuller"
                          : `${u.authorizedPropertyIds.length} gayrimenkul`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={u.isActive ? "default" : "outline"}
                          className="rounded-none"
                        >
                          {u.isActive ? "Aktif" : "Pasif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RowActions
                          onView={() => {
                            setEditing(u);
                            setFormOpen(true);
                          }}
                          onEdit={() => {
                            setEditing(u);
                            setFormOpen(true);
                          }}
                          onDelete={
                            isSeededAdmin || isSelf
                              ? undefined
                              : () => setDeleting(u)
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
            <span>{filtered.length} / {users.length} kayıt gösteriliyor</span>
            <span>Kullanıcılar yalnızca yetkili oldukları gayrimenkulleri görür</span>
          </div>
        </div>
      )}

      <UserFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        properties={properties ?? []}
        onSave={handleSave}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-none border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              Kullanıcı silinsin mi?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.username}” adlı kullanıcı kalıcı olarak silinecek ve
              panele giriş yapamayacak. Bu işlem geri alınamaz.
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

function UserFormDialog({
  open,
  onOpenChange,
  editing,
  properties,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: UserSummary | null;
  properties: Doc<"properties">[];
  onSave: (form: UserFormState) => void;
}) {
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open ? (editing ? `edit-${editing._id}` : "new") : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm(
      editing
        ? {
            username: editing.username,
            password: "",
            name: editing.name,
            role: editing.role,
            authorizedPropertyIds: editing.authorizedPropertyIds,
            isActive: editing.isActive,
          }
        : emptyForm,
    );
    setError(null);
  }

  const set = <K extends keyof UserFormState>(
    key: K,
    value: UserFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const toggleProperty = (id: string) =>
    setForm((f) => ({
      ...f,
      authorizedPropertyIds: f.authorizedPropertyIds.includes(id)
        ? f.authorizedPropertyIds.filter((pid) => pid !== id)
        : [...f.authorizedPropertyIds, id],
    }));

  const isSeededAdmin = editing?.username === "Admin";

  const submit = () => {
    if (form.username.trim() === "") {
      setError("Kullanıcı adı zorunludur.");
      return;
    }
    if (!editing && form.password.trim() === "") {
      setError("Yeni kullanıcı için şifre zorunludur.");
      return;
    }
    if (form.name.trim() === "") {
      setError("Ad soyad zorunludur.");
      return;
    }
    onSave(form);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Kullanıcıyı Düzenle" : "Yeni Kullanıcı"}
      description={
        editing
          ? `“${editing.username}” kullanıcısının bilgilerini güncelleyin.`
          : "Kullanıcı adı ve şifre tanımlayın, gayrimenkul yetkilerini belirleyin."
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
            {editing ? "Kaydet" : "Oluştur"}
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
          <Field label="Kullanıcı Adı" required hint={editing ? "değiştirilemez" : undefined}>
            <Input
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              disabled={editing !== null}
              placeholder="örn. ayse.yonet"
              autoComplete="off"
              className="rounded-none"
            />
          </Field>
          <Field
            label="Şifre"
            required={!editing}
            hint={editing ? "boş bırakılırsa değişmez" : undefined}
          >
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
              placeholder={editing ? "••••••••" : "Şifre belirleyin"}
              className="rounded-none"
            />
          </Field>
        </Row>

        <Row>
          <Field label="Ad Soyad" required>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="örn. Ayşe Yönet"
              className="rounded-none"
            />
          </Field>
          <Field label="Rol">
            <Select
              value={form.role}
              onValueChange={(value) => set("role", value)}
              disabled={isSeededAdmin}
            >
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Rol seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Yönetici</SelectItem>
                <SelectItem value="manager">
                  Profesyonel Yönetici
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Row>

        {/* Property authorization */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Yetkili Gayrimenkuller
            </span>
            {form.role === "manager" && properties.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-none text-xs"
                onClick={() =>
                  set(
                    "authorizedPropertyIds",
                    form.authorizedPropertyIds.length === properties.length
                      ? []
                      : properties.map((p) => p._id.toString()),
                  )
                }
              >
                {form.authorizedPropertyIds.length === properties.length
                  ? "Temizle"
                  : "Tümünü Seç"}
              </Button>
            )}
          </div>

          {form.role === "admin" ? (
            <p className="border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Yönetici rolü tüm gayrimenkullere erişir, yetki listesi gerekmez.
            </p>
          ) : properties.length === 0 ? (
            <p className="border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Henüz gayrimenkul kaydı yok. Gayrimenkul ekledikten sonra yetki
              verebilirsiniz.
            </p>
          ) : (
            <div className="grid max-h-48 gap-1 overflow-y-auto border border-border p-2">
              {properties.map((p) => {
                const id = p._id.toString();
                const checked = form.authorizedPropertyIds.includes(id);
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleProperty(id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.address}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium">Hesap durumu</p>
            <p className="text-xs text-muted-foreground">
              Pasif hesaplar panele giriş yapamaz.
            </p>
          </div>
          <Switch
            checked={form.isActive}
            onCheckedChange={(checked) => set("isActive", checked)}
            disabled={isSeededAdmin}
          />
        </div>
      </div>
    </DialogShell>
  );
}
