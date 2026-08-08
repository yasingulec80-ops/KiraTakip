import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, KeyRound, Loader2, ShieldCheck, User } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/app",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const ensureInitialAdmin = useMutation(api.users.ensureInitialAdmin);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the initial admin user (Admin / 8842) on first run. Idempotent.
  useEffect(() => {
    ensureInitialAdmin().catch((err) =>
      console.warn("Admin seed skipped:", err?.message ?? err),
    );
  }, [ensureInitialAdmin]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim().length === 0 || password.length === 0) {
      setError("Kullanıcı adı ve şifre zorunludur.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signIn("password", {
        email: username.trim(),
        password,
        flow: "signIn",
      });
      // Navigation happens via the isAuthenticated effect above.
    } catch (err) {
      console.error("Sign-in error:", err);
      setError("Kullanıcı adı veya şifre hatalı.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-xl font-medium tracking-tight">
              EmlakDefteri
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:inline">
              Gayrimenkul Yönetimi
            </span>
          </Link>
          <Button asChild variant="ghost" size="sm" className="rounded-none">
            <Link to="/">Ana Sayfa</Link>
          </Button>
        </div>
      </header>

      {/* Auth content */}
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="border border-border bg-card p-8 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
            <p className="eyebrow text-brand">Kontrol ve Takip Paneli</p>
            <h1 className="mt-3 font-display text-2xl font-light tracking-tight">
              Panele Giriş
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Kullanıcı adı ve şifrenizle giriş yapın.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs font-medium">
                  Kullanıcı Adı
                </Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="örn. Admin"
                    autoComplete="username"
                    className="rounded-none pl-9"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-medium">
                  Şifre
                </Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••"
                    autoComplete="current-password"
                    className="rounded-none pl-9"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full rounded-none py-3"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Giriş yapılıyor…
                  </>
                ) : (
                  <>
                    Giriş Yap
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </div>

          <div className="mt-4 flex items-start gap-3 border border-dashed border-border bg-muted/40 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <p className="text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">İlk kurulum:</span>{" "}
              sistem, yönetici hesabını otomatik oluşturur — Kullanıcı adı{" "}
              <span className="font-medium text-foreground">Admin</span>, şifre{" "}
              <span className="font-medium text-foreground">8842</span>. Girişten
              sonra kullanıcıları ve yetkilerini yönetebilirsiniz.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
