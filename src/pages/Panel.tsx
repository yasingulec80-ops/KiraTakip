import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { KpiGrid, type KpiTile } from "@/components/panel/KpiGrid";
import { OwnerSection } from "@/components/panel/OwnerSection";
import { PropertySection } from "@/components/panel/PropertySection";
import { TenantSection } from "@/components/panel/TenantSection";
import { ContractSection } from "@/components/panel/ContractSection";
import { AccrualSection } from "@/components/panel/AccrualSection";
import { CollectionSection } from "@/components/panel/CollectionSection";
import { ExpenseSection } from "@/components/panel/ExpenseSection";
import { LedgerSection } from "@/components/panel/LedgerSection";
import { UsersSection } from "@/components/panel/UsersSection";
import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/export";
import {
  Building2,
  LogOut,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
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
  | "users";

const TABS: { id: TabId; num: number; label: string }[] = [
  { id: "properties", num: 1, label: "Gayrimenkuller" },
  { id: "owners", num: 2, label: "Malikler" },
  { id: "tenants", num: 3, label: "Kiracılar" },
  { id: "contracts", num: 4, label: "Kontratlar" },
  { id: "accruals", num: 5, label: "Tahakkuklar" },
  { id: "collections", num: 6, label: "Tahsilatlar" },
  { id: "expenses", num: 7, label: "Masraflar" },
  { id: "ledgers", num: 8, label: "Cari Hesaplar" },
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
      .filter((c) => (c.depositStatus ?? "paid") !== "returned")
      .reduce((sum, c) => sum + c.depositAmount, 0);

    const paidPerAccrual = new Map<string, number>();
    (collections ?? []).forEach((c) => {
      if (!c.accrualId) return;
      paidPerAccrual.set(
        c.accrualId.toString(),
        (paidPerAccrual.get(c.accrualId.toString()) ?? 0) + c.amount,
      );
    });
    const pendingRent = (accruals ?? []).reduce((sum, a) => {
      const paid = paidPerAccrual.get(a._id.toString()) ?? 0;
      return sum + Math.max(0, a.amount - paid);
    }, 0);
    const collectedRent = (collections ?? []).reduce(
      (sum, c) => sum + c.amount,
      0,
    );

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
        caption: "tahsil edilmeyi bekleyen",
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

  const handleTileOpen = (id: string) => {
    const tabFor: Record<string, TabId> = {
      properties: "properties",
      contracts: "contracts",
      deposits: "contracts",
      pendingRents: "accruals",
      collectedRents: "collections",
      owners: "owners",
      tenants: "tenants",
    };
    const tab = tabFor[id];
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
                  <span
                    className={cn(
                      "font-display text-xs",
                      active
                        ? "text-brand"
                        : "text-muted-foreground/60 group-hover:text-foreground/70",
                    )}
                  >
                    {String(tab.num).padStart(2, "0")}
                  </span>
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
