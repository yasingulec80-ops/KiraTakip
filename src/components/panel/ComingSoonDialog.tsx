import { DialogShell } from "./fields";

export const V2_MODULES: Record<
  string,
  { num: number; title: string; desc: string }
> = {
  contracts: {
    num: 4,
    title: "Kontratlar",
    desc: "Malik ve kiracı bilgilerinden otomatik kira kontratı oluşturulması, depozito kaydı ve imzalı kontrat yükleme.",
  },
  accruals: {
    num: 5,
    title: "Tahakkuklar",
    desc: "Kira tahakkuklarının otomatik oluşturulması ve cari hesaplara işlenmesi.",
  },
  collections: {
    num: 6,
    title: "Tahsilatlar",
    desc: "Tahsilat kayıtlarının işlenmesi ve otomatik cari hesap güncellemesi.",
  },
  expenses: {
    num: 7,
    title: "Masraflar",
    desc: "Aidat, yatırım, sigorta, tadilat-bakım, boya ve diğer masraf kalemleri; ödeyenin (kiracı/malik/vekil) seçimi.",
  },
  ledgers: {
    num: 8,
    title: "Cari Hesaplar",
    desc: "Malik, kiracı ve vekil bazında cari hesap tablosu; tahakkuk, masraf ve ödeme kayıtları ve listeler.",
  },
  deposits: {
    num: -1,
    title: "Depozitolar",
    desc: "Toplam depozito takibi ve sözleşme bazlı depozito detayları.",
  },
  pendingRents: {
    num: -1,
    title: "Bekleyen Kiralar",
    desc: "Vadesi gelen ve bekleyen kira alacaklarının listesi.",
  },
  collectedRents: {
    num: -1,
    title: "Tahsil edilen Kiralar",
    desc: "Tahsil edilmiş kiraların dönemsel dökümü.",
  },
};

export function ComingSoonDialog({
  moduleId,
  open,
  onOpenChange,
}: {
  moduleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const module = V2_MODULES[moduleId];
  if (!module) return null;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={module.title}
      description="Bu modül Sürüm 2 kapsamındadır."
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">{module.desc}</p>
        <div className="border border-dashed border-border bg-muted/40 p-4">
          <p className="eyebrow text-brand">Sürüm 1 kapsamı</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sürüm 1'de gayrimenkul ve kişi kayıtları (Gayrimenkuller, Malikler,
            Kiracılar) işlevseldir. Bu modül bir sonraki sürümde panele
            eklenecektir.
          </p>
        </div>
      </div>
    </DialogShell>
  );
}
