import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col bg-background text-foreground"
    >
      {/* Top bar */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-xl font-medium tracking-tight">
              Kira Takip
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:inline">
              Gayrimenkul Yönetim Paneli
            </span>
          </Link>
          <Button asChild variant="ghost" size="sm" className="rounded-none">
            <Link to="/">Ana Sayfa</Link>
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
        <div className="max-w-5xl mx-auto relative px-4">
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-center">
              <p className="eyebrow text-brand">Hata 404</p>
              <h1 className="mt-5 font-display text-5xl font-light tracking-tight md:text-6xl">
                Sayfa Bulunamadı
              </h1>
              <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
                Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir. Ana
                sayfaya dönerek panele erişmeyi deneyin.
              </p>
              <div className="mt-9 flex justify-center">
                <Button asChild className="rounded-none px-6 py-3">
                  <Link to="/">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Ana Sayfaya Dön
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
