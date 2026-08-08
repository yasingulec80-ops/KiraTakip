import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { ComingSoonDialog } from "@/components/panel/ComingSoonDialog";
import { KpiGrid, type KpiTile } from "@/components/panel/KpiGrid";
import { OwnerSection } from "@/components/panel/OwnerSection";
import { PropertySection } from "@/components/panel/PropertySection";
import { TenantSection } from "@/components/panel/TenantSection";
import { UsersSection } from "@/components/panel/UsersSection";
import { useQuery } from "convex/react";
import { cn } from "@/lib/utils";
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

const TABS: { id: TabId; num: number; label: string; v2?: boolean }[] = [
  { id: "properties", num: 1, label: "Gayrimenkuller" },
  { id: "owners", num: 2, label: "Malikler" },
  { id: "tenants", num: 3, label: "Kiracılar" },
  { id: "contracts", num: 4, label: "Kontratlar", v2: true },
  { id: "accruals", num: 5, label: "Tahakkuklar", v2: true },
  { id: "collections", num: 6, label: "Tahsilatlar", v2: true },
  { id: "expenses", num: 7, label: "Masraflar", v2: true },
  { id: "ledgers", num: 8, label: "Cari Hesaplar", v2: true },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.id).concat("users"));

const V2_TILE_IDS = ["contracts", "deposits", "pendingRents", "collectedRents"];

export default function Panel() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const properties = useQuery(api.properties.list);
  const owners = useQuery(api.owners.list);
  const tenants = useQuery(api.tenants.list);

  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState<TabId>(
    initialTab && VALID_TABS.has(initialTab)
      ? (initialTab as TabId)
      : "properties",
  );
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  const setActiveTab = (tab: TabId) => {
    setActiveTabState(tab);
    setSearchParams(tab === "properties" ? {} : { tab }, { replace: true });
  };

  const isAdmin = user?.role === "admin";
  const isInactive = user?.isActive === false;

  const tiles: KpiTile[] = useMemo(() => {
    const count = (n: number | undefined) => n ?? 0;
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
        value: "0",
        caption: "Sürüm 2",
        muted: true,
      },
      {
        id: "deposits",
        label: "Depozitolar",
        value: "—",
        caption: "Sürüm 2",
        muted: true,
      },
      {
        id: "pendingRents",
        label: "Bekleyen Kiralar",
        value: "—",
        caption: "Sürüm 2",
        muted: true,
      },
      {
        id: "collectedRents",
        label: "Tahsil edilen Kiralar",
        value: "—",
        caption: "Sürüm 2",
        muted: true,
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
  }, [properties, owners, tenants]);

  const handleTileOpen = (id: string) => {
    if (V2_TILE_IDS.includes(id)) {
      setComingSoon(id);
      return;
    }
    if (id === "owners" || id === "tenants" || id === "properties") {
      setActiveTab(id as TabId);
    }
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
              EmlakDefteri
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
                  onClick={() =>
                    tab.v2 ? setComingSoon(tab.id) : setActiveTab(tab.id)
                  }
                  className={cn(
                    "group flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                    tab.v2
                      ? "cursor-pointer border-transparent text-muted-foreground/70 hover:text-muted-foreground"
                      : active
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "font-display text-xs",
                      tab.v2
                        ? "text-muted-foreground/50"
                        : active
                          ? "text-brand"
                          : "text-muted-foreground/60 group-hover:text-foreground/70",
                    )}
                  >
                    {String(tab.num).padStart(2, "0")}
                  </span>
                  {tab.label}
                  {tab.v2 && (
                    <Badge
                      variant="outline"
                      className="ml-0.5 rounded-full px-1.5 py-0 text-[9px] font-medium tracking-wide text-muted-foreground/60"
                    >
                      V2
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-8 border-t border-border pt-8">
            {activeTab === "properties" && <PropertySection />}
            {activeTab === "owners" && <OwnerSection />}
            {activeTab === "tenants" && <TenantSection />}
            {activeTab === "users" && isAdmin && <UsersSection />}
            {activeTab === "users" && !isAdmin && <PropertySection />}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-border py-6 text-xs text-muted-foreground">
          <span>EmlakDefteri · Sürüm 1 — Gayrimenkul ve kişiler</span>
          <span className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Gayrimenkul Yönetim Paneli
          </span>
        </footer>
      </main>

      <ComingSoonDialog
        moduleId={comingSoon ?? ""}
        open={comingSoon !== null}
        onOpenChange={(open) => !open && setComingSoon(null)}
      />
    </div>
  );
}
