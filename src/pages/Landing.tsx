import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

const MODULES = [
  {
    num: "01",
    name: "Gayrimenkuller",
    desc: "Malik, adres, m², oda sayısı, cephe, sayaç numaraları ve demirbaş envanteri.",
  },
  {
    num: "02",
    name: "Malikler",
    desc: "İletişim, banka ve IBAN bilgileri. İsterseniz vekil tanımlayın.",
  },
  {
    num: "03",
    name: "Kiracılar",
    desc: "Kimlik ve iletişim bilgileri. İsterseniz kefil ekleyin.",
  },
  {
    num: "04",
    name: "Kontratlar",
    desc: "Malik, kiracı, süre ve depozito bilgilerinden otomatik kira kontratı; imzalı kontrat yükleme.",
  },
  {
    num: "05",
    name: "Tahakkuklar",
    desc: "Kira tahakkuklarının otomatik oluşturulması ve cari hesaplara işlenmesi.",
  },
  {
    num: "06",
    name: "Tahsilatlar",
    desc: "Tahsilat kayıtlarının işlenmesi ve cari hesaplara otomatik kaydı.",
  },
  {
    num: "07",
    name: "Masraflar",
    desc: "Aidat, yatırım, sigorta, tadilat-bakım, boya ve diğer gider kalemleri.",
  },
  {
    num: "08",
    name: "Cari Hesaplar",
    desc: "Malik, kiracı ve vekil bazında cari hesap tablosu; tahakkuk, masraf ve ödeme kayıtları.",
  },
];

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
};

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-xl font-medium tracking-tight">
              Kira Takip
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:inline">
              Gayrimenkul Yönetim Paneli
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <a
              href="#moduller"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              Modüller
            </a>
            <a
              href="#nasil-calisir"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              Nasıl Çalışır
            </a>
            <Button asChild size="sm" className="rounded-none px-4">
              <Link to="/auth">
                Panele Giriş
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-start gap-10 py-20 md:py-28 lg:flex-row lg:items-end lg:justify-between">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl"
          >
            <p className="eyebrow text-brand">Kontrol ve Takip Paneli</p>
            <h1 className="mt-5 font-display text-4xl font-light leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
              Gayrimenkulleriniz, malikleriniz ve kiracılarınız —{" "}
              <span className="italic text-muted-foreground">tek panelde.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Kira Takip, gayrimenkul portföyünüzü sade ve özenli bir panelde
              toplar. Her malik, her kiracı, her gayrimenkul bir kayıt; her
              kontrat tahakkuklarını otomatik işler; her tahsilat ve masraf
              cari hesaplara yansır.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild className="rounded-none px-6 py-3">
                <Link to="/auth">
                  Panele Giriş Yap
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-none px-6 py-3">
                <a href="#moduller">
                  Modülleri İncele
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
          </motion.div>

          {/* Editorial stats column */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.3 }}
            className="grid w-full max-w-md grid-cols-2 gap-px border border-border bg-border lg:w-80"
          >
            {[
              ["08", "modül"],
              ["03", "kişi türü"],
              ["7/24", "erişim"],
              ["01", "panel"],
            ].map(([value, label]) => (
              <div key={label} className="bg-card p-5">
                <p className="font-display text-3xl font-light">{value}</p>
                <p className="eyebrow mt-2 text-muted-foreground">{label}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Hairline framing band */}
        <div className="mb-20 grid gap-px border border-border bg-border sm:grid-cols-3">
          {[
            ["Kontrat & cari hesap", "Kontratlar tahakkukları otomatik işler; tahsilat ve masraflar cari hesaplara yansır."],
            ["Giriş güvenliği", "Her kullanıcı yalnızca yetkili olduğu gayrimenkulleri görür."],
            ["İlk yönetici", "Panel, profesyonel yönetici hesabıyla kurulur; yönetici kullanıcıları ekler."],
          ].map(([title, desc]) => (
            <div key={title} className="bg-card p-6">
              <p className="eyebrow text-brand">{title}</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section id="moduller" className="mx-auto max-w-6xl scroll-mt-24 px-6">
        <motion.div {...fadeUp}>
          <p className="eyebrow text-brand">Modüller</p>
          <h2 className="mt-4 font-display text-3xl font-light tracking-tight md:text-4xl">
            Numara sırasıyla sekiz sekme
          </h2>
          <div className="mt-3 h-px w-16 bg-foreground/70" />
        </motion.div>

        <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((module, i) => (
            <motion.div
              key={module.num}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.55, delay: (i % 4) * 0.06 }}
              className="group relative flex flex-col bg-card p-6 transition-colors duration-300 hover:bg-muted/60"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-sm text-muted-foreground">
                  {module.num}
                </span>
                <span className="text-[10px] uppercase tracking-[0.16em] text-brand/70">
                  Etkin
                </span>
              </div>
              <h3 className="mt-6 font-display text-xl font-medium tracking-tight">
                {module.name}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                {module.desc}
              </p>
              <span className="mt-6 block h-px w-full bg-border transition-colors duration-300 group-hover:bg-foreground/40" />
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="nasil-calisir" className="mx-auto max-w-6xl scroll-mt-24 px-6">
        <motion.div {...fadeUp} className="mt-28 border-t border-border pt-16">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <p className="eyebrow text-brand">Nasıl Çalışır</p>
              <h2 className="mt-4 font-display text-3xl font-light tracking-tight">
                Üç adımda panelinizi kurun
              </h2>
            </div>
            <div className="grid flex-1 gap-px border border-border bg-border sm:grid-cols-3">
              {[
                ["01", "Giriş yapın", "Yönetici hesabınızla panele girin, ilk kullanıcıları ekleyin."],
                ["02", "Kişileri ve gayrimenkulleri kaydedin", "Malikleri, vekilleri, kiracıları, kefilleri ve portföydeki gayrimenkulleri tanımlayın."],
                ["03", "Kontratı oluşturun", "Sözleşmeyi kurun; tahakkuklar otomatik işlenir, tahsilat ve masraflar cari hesaplara yansır."],
              ].map(([num, title, desc]) => (
                <div key={num} className="bg-card p-6">
                  <span className="font-display text-sm text-muted-foreground">{num}</span>
                  <h3 className="mt-5 font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-6">
        <motion.div
          {...fadeUp}
          className="mt-28 border border-border bg-card px-8 py-16 text-center md:py-20"
        >
          <p className="eyebrow text-brand">Hazır mısınız?</p>
          <h2 className="mx-auto mt-4 max-w-xl font-display text-3xl font-light tracking-tight md:text-4xl">
            Paneli açın, ilk gayrimenkulünüzü ekleyin.
          </h2>
          <Button asChild size="lg" className="mt-8 rounded-none px-8 py-3">
            <Link to="/auth">
              Panele Giriş Yap
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="mt-20 border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-medium tracking-tight">
              Kira Takip
            </span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Gayrimenkul Yönetim Paneli
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kira Takip · Sürüm 2
          </p>
        </div>
      </footer>
    </div>
  );
}
