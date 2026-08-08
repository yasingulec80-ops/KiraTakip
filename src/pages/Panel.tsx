import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { DialogShell } from "@/components/panel/fields";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { KpiGrid, type KpiTile } from "@/components/panel/KpiGrid";
import { OwnerSection } from "@/components/panel/OwnerSection";
import { PropertySection } from "@/components/panel/PropertySection";
import { TenantSection } from "@/components/panel/TenantSection";
import { ContractSection } from "@/components/panel/ContractSection";
import { DepositSection } from "@/components/panel/DepositSection";
import { AccrualSection } from "@/components/panel/AccrualSection";
import { CollectionSection } from "@/components/panel/CollectionSection";
import { ExpenseSection } from "@/components/panel/ExpenseSection";
import { LedgerSection } from "@/components/panel/LedgerSection";
import { UsersSection } from "@/components/panel/UsersSection";
import { VekilDevirReport } from "@/components/panel/VekilDevirReport";
import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatNumber } from "@/lib/export";
import {
  ArrowUpRight,
  Building2,
  LogOut,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

type TabId =
  | "properties"
  | "owners"
  | "tenants"
  | "contracts"
  | "accruals"
  | "collections"
  | "expenses"
  | "ledgers"
  | "deposits"
  | "report"
  | "users";

const TABS: { id: TabId; label: string }[] = [
  { id: "properties", label: "Gayrimenkuller" },
  { id: "owners", label: "Malikler" },
  { id: "tenants", label: "Kiracılar" },
  { id: "contracts", label: "Kontratlar" },
  { id: "accruals", label: "Tahakkuklar" },
  { id: "collections", label: "Tahsilatlar" },
  { id: "expenses", label: "Masraflar" },
  { id: "ledgers", label: "Cari Hesaplar" },
  { id: "deposits", label: "Depozitolar" },
  { id: "report", label: "Vekil Devir Raporu" },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.id).concat("users"));

export default function Panel() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const properties = useQuery(api.properties.list);
  const owners = useQuery(api.owners.list);
  const tenants = useQuery(api.tenants.list);
  const contracts = useQuery(api.contracts.list);
  const accruals = useQuery(api.accruals.list);
  const collections = useQuery(api.collections.list);

  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState<TabId>(
    initialTab && VALID_TABS.has(initialTab)
      ? (initialTab as TabId)
      : "properties",
  );

  const setActiveTab = (tab: TabId) => {
    setActiveTabState(tab);
    setSearchParams(tab === "properties" ? {} : { tab }, { replace: true });
  };

  const isAdmin = user?.role === "admin";
  const isInactive = user?.isActive === false;

  const tiles: KpiTile[] = useMemo(() => {
    const count = (n: number | undefined) => n ?? 0;

    const activeContracts = (contracts ?? []).filter(
      (c) => c.status !== "ended",
    );
    const totalDeposits = (contracts ?? [])
      .filter((c) => !c.depositReturnedAt)
      .reduce((sum, c) => sum + c.depositAmount, 0);

    const paidPerAccrual = new Map<string, number>();
    (collections ?? []).forEach((c) => {
      if (!c.accrualId) return;
      paidPerAccrual.set(
        c.accrualId.toString(),
        (paidPerAccrual.get(c.accrualId.toString()) ?? 0) + c.amount,
      );
    });
    // Bekleyen kiralar: yalnızca vadesi geçmiş ve bu ay içinde vadesi gelen
    // tahakkuklar sayılır; vadesi ileriki aylara ait olanlar dahil edilmez.
    const now = new Date();
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).getTime();
    const pendingRent = (accruals ?? [])
      .filter((a) => (a.type ?? "rent") !== "deposit") // depozito tahakkuku kira alacağı değildir
      .reduce((sum, a) => {
        if (a.dueDate > monthEnd) return sum;
        const paid = paidPerAccrual.get(a._id.toString()) ?? 0;
        return sum + Math.max(0, a.amount - paid);
      }, 0);
    const collectedRent = (collections ?? [])
      .filter((c) => (c.collectionType ?? "rent") === "rent")
      .reduce((sum, c) => sum + c.amount, 0);

    const money = (value: number) =>
      value === 0 ? "0 ₺" : formatCurrency(value);

    return [
      {
        id: "properties",
        label: "Gayrimenkuller",
        value: count(properties?.length),
        caption: "portföy kaydı",
      },
      {
        id: "contracts",
        label: "Aktif Sözleşmeler",
        value: count(activeContracts.length),
        caption: "yürürlükteki sözleşme",
      },
      {
        id: "deposits",
        label: "Depozitolar",
        value: money(totalDeposits),
        caption: "elde tutulan depozito",
      },
      {
        id: "pendingRents",
        label: "Bekleyen Kiralar",
        value: money(pendingRent),
        caption: "gecikmiş + bu ay vadesi gelen",
      },
      {
        id: "collectedRents",
        label: "Tahsil Edilen Kiralar",
        value: money(collectedRent),
        caption: "toplam tahsilat",
      },
      {
        id: "owners",
        label: "Malikler",
        value: count(owners?.length),
        caption: "mal sahibi",
      },
      {
        id: "tenants",
        label: "Kiracılar",
        value: count(tenants?.length),
        caption: "kiracı kaydı",
      },
    ];
  }, [properties, owners, tenants, contracts, accruals, collections]);

  const [detailTile, setDetailTile] = useState<string | null>(null);

  const handleTileOpen = (id: string) => {
    setDetailTile(id);
  };

  const handleGoToTabFromDetail = (id: string) => {
    const tabFor: Record<string, TabId> = {
      properties: "properties",
      contracts: "contracts",
      deposits: "deposits",
      pendingRents: "accruals",
      collectedRents: "collections",
      owners: "owners",
      tenants: "tenants",
    };
    const tab = tabFor[id];
    setDetailTile(null);
    if (tab) setActiveTab(tab);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const today = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <Link to="/" className="font-display text-xl font-medium tracking-tight">
              Kira Takip
            </Link>
            <span className="hidden text-[10px] uppercase tracking-[0.22em] text-muted-foreground md:inline">
              Gayrimenkul Yönetim Paneli
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "rounded-none",
                  activeTab === "users" && "border-foreground bg-foreground text-background",
                )}
                onClick={() => setActiveTab("users")}
              >
                <Users className="mr-2 h-4 w-4" />
                Kullanıcılar
              </Button>
            )}
            <div className="hidden items-center gap-2 border-l border-border pl-3 sm:flex">
              <div className="text-right">
                <p className="text-sm font-medium leading-4">
                  {user?.name || user?.email || "Kullanıcı"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {isAdmin ? "Yönetici" : "Profesyonel Yönetici"}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
              aria-label="Çıkış yap"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Control panel */}
        <section className="space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-brand">Kontrol ve Takip Paneli</p>
              <h1 className="mt-3 font-display text-3xl font-light tracking-tight md:text-4xl">
                Genel Bakış
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {today} · Hoş geldiniz
                {user?.name ? `, ${user.name}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              <span>
                Yetkili olduğunuz gayrimenkuller:{" "}
                <span className="font-medium text-foreground">
                  {isAdmin ? "tümü" : `${(properties ?? []).length}`}
                </span>
              </span>
            </div>
          </div>

          {isInactive && (
            <div className="flex items-center gap-3 border border-dashed border-destructive/50 bg-destructive/5 px-4 py-3">
              <ShieldCheck className="h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">
                Hesabınız pasif durumda. Yöneticinizle iletişime geçin.
              </p>
            </div>
          )}

          <KpiGrid tiles={tiles} onOpen={handleTileOpen} />

          <OverviewDetailDialog
            open={detailTile !== null}
            onOpenChange={(open) => !open && setDetailTile(null)}
            tileId={detailTile}
            onGoToTab={handleGoToTabFromDetail}
            properties={properties ?? []}
            owners={owners ?? []}
            tenants={tenants ?? []}
            contracts={contracts ?? []}
            accruals={accruals ?? []}
            collections={collections ?? []}
          />

          {/* Section header rule */}
          <div className="flex items-center gap-4 pt-2">
            <span className="eyebrow text-muted-foreground">
              Modül Seçimi
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </section>

        {/* Tab bar */}
        <div className="mt-4">
          <nav
            className="-mx-1 flex gap-1 overflow-x-auto pb-1"
            aria-label="Modüller"
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "group flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-8 border-t border-border pt-8">
            {activeTab === "properties" && <PropertySection />}
            {activeTab === "owners" && <OwnerSection />}
            {activeTab === "tenants" && <TenantSection />}
            {activeTab === "contracts" && <ContractSection />}
            {activeTab === "accruals" && <AccrualSection />}
            {activeTab === "collections" && <CollectionSection />}
            {activeTab === "expenses" && <ExpenseSection />}
            {activeTab === "ledgers" && <LedgerSection />}
            {activeTab === "deposits" && <DepositSection />}
            {activeTab === "report" && <VekilDevirReport />}
            {activeTab === "users" && isAdmin && <UsersSection />}
            {activeTab === "users" && !isAdmin && <PropertySection />}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-border py-6 text-xs text-muted-foreground">
          <span>Kira Takip · Sürüm 2 — Tüm modüller etkin</span>
          <span className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Gayrimenkul Yönetim Paneli
          </span>
        </footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const DETAIL_TITLES: Record<string, { title: string; hint: string }> = {
  properties: {
    title: "Gayrimenkuller",
    hint: "Portföydeki tüm gayrimenkuller",
  },
  contracts: {
    title: "Aktif Sözleşmeler",
    hint: "Yürürlükteki kira sözleşmeleri",
  },
  deposits: {
    title: "Depozitolar",
    hint: "Sözleşme bazında tutulan depozitolar",
  },
  pendingRents: {
    title: "Bekleyen Kiralar",
    hint: "Ödenmemiş tahakkuklar",
  },
  collectedRents: {
    title: "Tahsil Edilen Kiralar",
    hint: "Kaydedilen tüm tahsilatlar",
  },
  owners: {
    title: "Malikler",
    hint: "Kayıtlı mal sahipleri",
  },
  tenants: {
    title: "Kiracılar",
    hint: "Kayıtlı kiracılar",
  },
};

function OverviewDetailDialog({
  open,
  onOpenChange,
  tileId,
  onGoToTab,
  properties,
  owners,
  tenants,
  contracts,
  accruals,
  collections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tileId: string | null;
  onGoToTab: (id: string) => void;
  properties: Doc<"properties">[];
  owners: Doc<"owners">[];
  tenants: Doc<"tenants">[];
  contracts: Doc<"contracts">[];
  accruals: Doc<"accruals">[];
  collections: Doc<"collections">[];
}) {
  const ownerMap = useMemo(() => {
    const map = new Map<string, Doc<"owners">>();
    owners.forEach((o) => map.set(o._id.toString(), o));
    return map;
  }, [owners]);
  const tenantMap = useMemo(() => {
    const map = new Map<string, Doc<"tenants">>();
    tenants.forEach((t) => map.set(t._id.toString(), t));
    return map;
  }, [tenants]);
  const propertyMap = useMemo(() => {
    const map = new Map<string, Doc<"properties">>();
    properties.forEach((p) => map.set(p._id.toString(), p));
    return map;
  }, [properties]);

  const meta = tileId ? DETAIL_TITLES[tileId] : undefined;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={meta?.title ?? "Detay"}
      description={meta?.hint}
      xwide
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            onClick={() => onOpenChange(false)}
          >
            Kapat
          </Button>
          {tileId && (
            <Button
              type="button"
              className="rounded-none"
              onClick={() => onGoToTab(tileId)}
            >
              Modüle Git
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </>
      }
    >
      <div className="max-h-[60vh] overflow-auto">
        {tileId === "properties" && (
          <PropertyDetailList
            properties={properties}
            ownerMap={ownerMap}
          />
        )}
        {tileId === "contracts" && (
          <ContractDetailList
            contracts={contracts.filter((c) => c.status !== "ended")}
            propertyMap={propertyMap}
            tenantMap={tenantMap}
            ownerMap={ownerMap}
          />
        )}
        {tileId === "deposits" && (
          <DepositDetailList
            contracts={contracts}
            collections={collections}
            propertyMap={propertyMap}
          />
        )}
        {tileId === "pendingRents" && (
          <PendingRentDetailList
            accruals={accruals}
            collections={collections}
            contracts={contracts}
            propertyMap={propertyMap}
            tenantMap={tenantMap}
          />
        )}
        {tileId === "collectedRents" && (
          <CollectionDetailList
            collections={collections}
            accruals={accruals}
            contracts={contracts}
            propertyMap={propertyMap}
            tenantMap={tenantMap}
            ownerMap={ownerMap}
          />
        )}
        {tileId === "owners" && <OwnerDetailList owners={owners} />}
        {tileId === "tenants" && <TenantDetailList tenants={tenants} />}
      </div>
    </DialogShell>
  );
}

/* ------------------------------ alt listeler ----------------------------- */

function DetailTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {headers.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function PropertyDetailList({
  properties,
  ownerMap,
}: {
  properties: Doc<"properties">[];
  ownerMap: Map<string, Doc<"owners">>;
}) {
  return (
    <DetailTable headers={["Gayrimenkul", "Adres", "M²", "Oda", "Cephe", "Malik"]}>
      {properties.map((p) => (
        <TableRow key={p._id}>
          <TableCell className="font-medium">{p.name}</TableCell>
          <TableCell className="text-sm text-muted-foreground">{p.address}</TableCell>
          <TableCell className="text-sm tabular-nums">
            {p.m2 !== undefined ? formatNumber(p.m2) : "—"}
          </TableCell>
          <TableCell className="text-sm">{p.roomCount ?? "—"}</TableCell>
          <TableCell className="text-sm">{p.facade ?? "—"}</TableCell>
          <TableCell className="text-sm">
            {p.ownerId ? ownerMap.get(p.ownerId.toString())?.name ?? "—" : "—"}
          </TableCell>
        </TableRow>
      ))}
    </DetailTable>
  );
}

function ContractDetailList({
  contracts,
  propertyMap,
  tenantMap,
  ownerMap,
}: {
  contracts: Doc<"contracts">[];
  propertyMap: Map<string, Doc<"properties">>;
  tenantMap: Map<string, Doc<"tenants">>;
  ownerMap: Map<string, Doc<"owners">>;
}) {
  return (
    <DetailTable
      headers={["Gayrimenkul", "Malik", "Kiracı", "Kira", "Depozito", "Bitiş"]}
    >
      {contracts.map((c) => (
        <TableRow key={c._id}>
          <TableCell className="font-medium">
            {propertyMap.get(c.propertyId.toString())?.name ?? "—"}
          </TableCell>
          <TableCell className="text-sm">
            {ownerMap.get(c.ownerId.toString())?.name ?? "—"}
          </TableCell>
          <TableCell className="text-sm">
            {tenantMap.get(c.tenantId.toString())?.name ?? "—"}
          </TableCell>
          <TableCell className="text-sm tabular-nums">
            {formatCurrency(c.rentAmount)}/ay
          </TableCell>
          <TableCell className="text-sm tabular-nums">
            {formatCurrency(c.depositAmount)}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {formatDate(
              new Date(
                new Date(c.startDate).getFullYear(),
                new Date(c.startDate).getMonth() + c.durationMonths,
                1,
              ).getTime(),
            )}
          </TableCell>
        </TableRow>
      ))}
    </DetailTable>
  );
}

const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  pending: "Ödeme Bekliyor",
  paid: "Tahsil Edildi",
  held: "Elde Tutuluyor",
  returned: "İade Edildi",
};

/**
 * Depozito durumu kontrat üzerinden seçilmez; tahakkuk ve tahsilatlardan
 * türetilir: iade edildi → tahsil edildi (depozito tahsilatı tutarı
 * karşılıyor) → ödeme bekliyor.
 */
const depositStatusOf = (
  contract: Doc<"contracts">,
  collectedByContract: Map<string, number>,
): string => {
  if (contract.depositReturnedAt || contract.depositStatus === "returned") {
    return "returned";
  }
  const collected = collectedByContract.get(contract._id.toString()) ?? 0;
  if (collected >= (contract.depositAmount ?? 0)) return "paid";
  return "pending";
};

function DepositDetailList({
  contracts,
  collections,
  propertyMap,
}: {
  contracts: Doc<"contracts">[];
  collections: Doc<"collections">[];
  propertyMap: Map<string, Doc<"properties">>;
}) {
  const collectedByContract = useMemo(() => {
    const map = new Map<string, number>();
    collections.forEach((c) => {
      if ((c.collectionType ?? "rent") !== "deposit") return;
      const key = c.contractId.toString();
      map.set(key, (map.get(key) ?? 0) + c.amount);
    });
    return map;
  }, [collections]);
  const total = contracts.reduce((s, c) => s + c.depositAmount, 0);
  return (
    <div>
      <DetailTable headers={["Gayrimenkul", "Depozito", "Durum"]}>
        {contracts.map((c) => {
          const status = depositStatusOf(c, collectedByContract);
          return (
            <TableRow key={c._id}>
              <TableCell className="font-medium">
                {propertyMap.get(c.propertyId.toString())?.name ?? "—"}
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {formatCurrency(c.depositAmount)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    status === "returned"
                      ? "outline"
                      : status === "held"
                        ? "secondary"
                        : "default"
                  }
                  className="rounded-none"
                >
                  {DEPOSIT_STATUS_LABEL[status]}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </DetailTable>
      <p className="mt-3 text-sm text-muted-foreground">
        Toplam depozito:{" "}
        <span className="font-medium text-foreground">
          {formatCurrency(total)}
        </span>
      </p>
    </div>
  );
}

function PendingRentDetailList({
  accruals,
  collections,
  contracts,
  propertyMap,
  tenantMap,
}: {
  accruals: Doc<"accruals">[];
  collections: Doc<"collections">[];
  contracts: Doc<"contracts">[];
  propertyMap: Map<string, Doc<"properties">>;
  tenantMap: Map<string, Doc<"tenants">>;
}) {
  const contractMap = useMemo(() => {
    const map = new Map<string, Doc<"contracts">>();
    contracts.forEach((c) => map.set(c._id.toString(), c));
    return map;
  }, [contracts]);
  const paidByAccrual = useMemo(() => {
    const map = new Map<string, number>();
    collections.forEach((c) => {
      if (!c.accrualId) return;
      map.set(
        c.accrualId.toString(),
        (map.get(c.accrualId.toString()) ?? 0) + c.amount,
      );
    });
    return map;
  }, [collections]);

  // Vadesi geçmiş ve bu ay içinde vadesi gelen tahakkuklar gösterilir;
  // vadesi ileriki aylara ait olanlar bu görünüme dahil edilmez.
  const { overdue, dueThisMonth, totalRemaining, overdueTotal, monthTotal } =
    useMemo(() => {
      const nowMs = new Date().getTime();
      const monthEnd = new Date(
        new Date(nowMs).getFullYear(),
        new Date(nowMs).getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      ).getTime();
      const allRows = accruals
        .filter((a) => (a.type ?? "rent") !== "deposit") // depozito tahakkuku bu görünümde yer almaz
        .map((a) => {
          const paid = paidByAccrual.get(a._id.toString()) ?? 0;
          return {
            accrual: a,
            remaining: Math.max(0, a.amount - paid),
          };
        })
        .filter((r) => r.remaining > 0 && r.accrual.dueDate <= monthEnd)
        .sort((x, y) => x.accrual.dueDate - y.accrual.dueDate);
      const overdue = allRows.filter((r) => r.accrual.dueDate < nowMs);
      const dueThisMonth = allRows.filter((r) => r.accrual.dueDate >= nowMs);
      return {
        overdue,
        dueThisMonth,
        totalRemaining: allRows.reduce((s, r) => s + r.remaining, 0),
        overdueTotal: overdue.reduce((s, r) => s + r.remaining, 0),
        monthTotal: dueThisMonth.reduce((s, r) => s + r.remaining, 0),
      };
    }, [accruals, paidByAccrual]);

  const renderGroup = (
    rows: { accrual: Doc<"accruals">; remaining: number }[],
  ) =>
    rows.length === 0 ? (
      <p className="border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
        Bu grupta kira yok.
      </p>
    ) : (
      <div className="border border-border bg-card">
        <div className="overflow-x-auto">
          <DetailTable headers={["Dönem", "Gayrimenkul", "Kiracı", "Vade", "Kalan"]}>
            {rows.map(({ accrual: a, remaining }) => {
              const contract = contractMap.get(a.contractId.toString());
              return (
                <TableRow key={a._id}>
                  <TableCell className="font-medium tabular-nums">
                    {a.period}
                  </TableCell>
                  <TableCell className="text-sm">
                    {contract
                      ? propertyMap.get(contract.propertyId.toString())?.name ?? "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {contract
                      ? tenantMap.get(contract.tenantId.toString())?.name ?? "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(a.dueDate)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-amber-700">
                    {formatCurrency(remaining)}
                  </TableCell>
                </TableRow>
              );
            })}
          </DetailTable>
        </div>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="eyebrow text-amber-700">
            Vadesi Geçen · {overdue.length} kira
          </span>
          <span className="font-display text-lg font-light tabular-nums text-amber-700">
            {formatCurrency(overdueTotal)}
          </span>
        </div>
        {renderGroup(overdue)}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="eyebrow text-muted-foreground">
            Bu Ay İçinde Vadesi Gelen · {dueThisMonth.length} kira
          </span>
          <span className="font-display text-lg font-light tabular-nums">
            {formatCurrency(monthTotal)}
          </span>
        </div>
        {renderGroup(dueThisMonth)}
      </div>

      <p className="text-sm text-muted-foreground">
        Toplam bekleyen kira (gecikmiş + bu ay):{" "}
        <span className="font-medium text-amber-700">
          {formatCurrency(totalRemaining)}
        </span>
      </p>
    </div>
  );
}

function CollectionDetailList({
  collections,
  accruals,
  contracts,
  propertyMap,
  tenantMap,
  ownerMap,
}: {
  collections: Doc<"collections">[];
  accruals: Doc<"accruals">[];
  contracts: Doc<"contracts">[];
  propertyMap: Map<string, Doc<"properties">>;
  tenantMap: Map<string, Doc<"tenants">>;
  ownerMap: Map<string, Doc<"owners">>;
}) {
  const contractMap = useMemo(() => {
    const map = new Map<string, Doc<"contracts">>();
    contracts.forEach((c) => map.set(c._id.toString(), c));
    return map;
  }, [contracts]);
  const accrualMap = useMemo(() => {
    const map = new Map<string, Doc<"accruals">>();
    accruals.forEach((a) => map.set(a._id.toString(), a));
    return map;
  }, [accruals]);
  const sorted = [...collections]
    .filter((c) => (c.collectionType ?? "rent") === "rent")
    .sort((a, b) => b.date - a.date);
  const total = sorted.reduce((s, c) => s + c.amount, 0);

  const collectedByLabel = (c: Doc<"collections">): string => {
    if (c.collectedByProxyOwnerId) {
      const owner = ownerMap.get(c.collectedByProxyOwnerId.toString());
      return owner?.proxy?.name ?? owner?.name ?? "Vekil";
    }
    return "Ofis";
  };

  return (
    <div>
      <DetailTable
        headers={["Tarih", "Gayrimenkul", "Kiracı", "Dönem", "Ödeyen", "Tahsil Eden", "Tutar"]}
      >
        {sorted.map((c) => {
          const contract = contractMap.get(c.contractId.toString());
          const accrual = c.accrualId
            ? accrualMap.get(c.accrualId.toString())
            : undefined;
          return (
            <TableRow key={c._id}>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(c.date)}
              </TableCell>
              <TableCell className="text-sm">
                {contract
                  ? propertyMap.get(contract.propertyId.toString())?.name ?? "—"
                  : "—"}
              </TableCell>
              <TableCell className="text-sm">
                {contract
                  ? tenantMap.get(contract.tenantId.toString())?.name ?? "—"
                  : "—"}
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {accrual?.period ?? "—"}
              </TableCell>
              <TableCell className="text-sm">
                {c.paidByType === "proxy"
                  ? c.proxyOwnerId
                    ? `Vekil · ${
                        ownerMap.get(c.proxyOwnerId.toString())?.proxy?.name ?? "—"
                      }`
                    : "Vekil"
                  : c.tenantId
                    ? tenantMap.get(c.tenantId.toString())?.name ?? "Kiracı"
                    : "Kiracı"}
              </TableCell>
              <TableCell className="text-sm">
                {c.collectedByProxyOwnerId ? (
                  <span className="font-medium">{collectedByLabel(c)}</span>
                ) : (
                  <span className="text-muted-foreground">Ofis</span>
                )}
              </TableCell>
              <TableCell className="text-sm tabular-nums text-emerald-700">
                {formatCurrency(c.amount)}
              </TableCell>
            </TableRow>
          );
        })}
      </DetailTable>
      <p className="mt-3 text-sm text-muted-foreground">
        Toplam tahsilat:{" "}
        <span className="font-medium text-emerald-700">
          {formatCurrency(total)}
        </span>
      </p>
    </div>
  );
}

function OwnerDetailList({ owners }: { owners: Doc<"owners">[] }) {
  return (
    <DetailTable headers={["Adı Soyadı", "TC Kimlik", "Telefon", "Vekil"]}>
      {owners.map((o) => (
        <TableRow key={o._id}>
          <TableCell className="font-medium">{o.name}</TableCell>
          <TableCell className="text-sm tabular-nums">{o.tcNo}</TableCell>
          <TableCell className="text-sm">{o.phone}</TableCell>
          <TableCell className="text-sm">
            {o.proxy ? `${o.proxy.name} (${o.proxy.phone})` : "—"}
          </TableCell>
        </TableRow>
      ))}
    </DetailTable>
  );
}

function TenantDetailList({ tenants }: { tenants: Doc<"tenants">[] }) {
  return (
    <DetailTable headers={["Adı Soyadı", "TC Kimlik", "Telefon", "Kefil"]}>
      {tenants.map((t) => (
        <TableRow key={t._id}>
          <TableCell className="font-medium">{t.name}</TableCell>
          <TableCell className="text-sm tabular-nums">{t.tcNo}</TableCell>
          <TableCell className="text-sm">{t.phone}</TableCell>
          <TableCell className="text-sm">
            {t.guarantor ? `${t.guarantor.name} (${t.guarantor.phone})` : "—"}
          </TableCell>
        </TableRow>
      ))}
    </DetailTable>
  );
}
