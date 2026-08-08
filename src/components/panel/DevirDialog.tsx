import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateToInput, formatCurrency, parseNumber } from "@/lib/export";
import { HandCoins } from "lucide-react";
import { useState } from "react";
import { DialogShell, Field } from "./fields";

const TODAY = dateToInput(Date.now());

export interface DevirAccount {
  key: string;
  name: string;
  subtitle: string;
  ownerId: string;
}

/**
 * Vekil devri penceresi — tahsil edilen kira/depozitonun malike teslim edilmesi.
 * Kira ve depozito teslim edilebilir tutarları ayrı ayrı gösterilir ve ayrı
 * sınırlanır. Kayıt, üst bileşenin `onDevir` çağrısıyla işlenir.
 */
export function DevirDialog({
  open,
  account,
  devirableRent,
  devirableDeposit,
  onOpenChange,
  onDevir,
}: {
  open: boolean;
  account: DevirAccount | null;
  devirableRent: number;
  devirableDeposit: number;
  onOpenChange: (open: boolean) => void;
  onDevir: (
    amount: number,
    date: string,
    note: string,
    transferType: "rent" | "deposit",
  ) => void;
}) {
  const [form, setForm] = useState({
    amount: "",
    date: TODAY,
    note: "",
    transferType: "rent" as "rent" | "deposit",
  });
  const [error, setError] = useState<string | null>(null);

  const [lastKey, setLastKey] = useState("");
  const key = open && account ? account.key : "closed";
  if (key !== lastKey) {
    setLastKey(key);
    setForm({ amount: "", date: TODAY, note: "", transferType: "rent" });
    setError(null);
  }

  const devirableForType =
    form.transferType === "deposit" ? devirableDeposit : devirableRent;

  const submit = () => {
    if (!account) return;
    const amount = parseNumber(form.amount);
    if (amount === undefined || amount <= 0) {
      setError("Tutar geçerli bir değer olmalıdır.");
      return;
    }
    if (amount > devirableForType) {
      setError(
        `Teslim edilebilir ${form.transferType === "deposit" ? "depozito" : "kira"} tutarı ${formatCurrency(devirableForType)} ile sınırlıdır.`,
      );
      return;
    }
    if (form.date === "") {
      setError("Devir tarihi zorunludur.");
      return;
    }
    onDevir(amount, form.date, form.note, form.transferType);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Vekil Devri — Tahsilat Teslimi"
      description={account ? `${account.name} · ${account.subtitle}` : undefined}
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
            <HandCoins className="mr-2 h-4 w-4" />
            Devri İşle
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

        <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
          <div className="bg-card p-4">
            <p className="eyebrow text-muted-foreground">Teslim Edilebilir Kira</p>
            <p className="mt-1.5 font-display text-lg font-light tabular-nums">
              {formatCurrency(devirableRent)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              tahsil edilip devredilmemiş kira
            </p>
          </div>
          <div className="bg-card p-4">
            <p className="eyebrow text-muted-foreground">Teslim Edilebilir Depozito</p>
            <p className="mt-1.5 font-display text-lg font-light tabular-nums">
              {formatCurrency(devirableDeposit)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              tahsil edilip devredilmemiş depozito
            </p>
          </div>
        </div>

        <Field label="Devir Türü">
          <Select
            value={form.transferType}
            onValueChange={(value) =>
              setForm((f) => ({
                ...f,
                transferType: value as "rent" | "deposit",
              }))
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
          label="Tutar"
          required
          hint={`teslim edilebilir ${formatCurrency(devirableForType)}`}
        >
          <div className="flex gap-2">
            <Input
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="15000"
              className="rounded-none"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-none"
              onClick={() =>
                setForm((f) => ({ ...f, amount: String(devirableForType) }))
              }
            >
              Tümü
            </Button>
          </div>
        </Field>
        <Field label="Devir Tarihi" required>
          <Input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="rounded-none"
          />
        </Field>
        <Field label="Not" hint="isteğe bağlı">
          <Input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="örn. Ağustos tahsilatı teslim edildi"
            className="rounded-none"
          />
        </Field>
      </div>
    </DialogShell>
  );
}
