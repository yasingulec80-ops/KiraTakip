import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActor } from "./ledger_helpers";
import { ROLES } from "./schema";

const REMINDER_SETTINGS_KEY = "reminders";

export const DEFAULT_REMINDER_SETTINGS = {
  daysBefore: 3,
  notifyTenant: true,
  notifyOwner: false,
};

/** Read the rent reminder preferences (window + recipients). */
export const getReminderSettings = query({
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", REMINDER_SETTINGS_KEY))
      .first();
    if (!doc) return DEFAULT_REMINDER_SETTINGS;
    return {
      daysBefore: doc.daysBefore ?? DEFAULT_REMINDER_SETTINGS.daysBefore,
      notifyTenant:
        doc.notifyTenant ?? DEFAULT_REMINDER_SETTINGS.notifyTenant,
      notifyOwner: doc.notifyOwner ?? DEFAULT_REMINDER_SETTINGS.notifyOwner,
    };
  },
});

/** Update the rent reminder preferences (admin only). */
export const updateReminderSettings = mutation({
  args: {
    daysBefore: v.number(),
    notifyTenant: v.boolean(),
    notifyOwner: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici hatırlatma ayarlarını değiştirebilir.");
    }

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", REMINDER_SETTINGS_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("settings", {
        key: REMINDER_SETTINGS_KEY,
        ...args,
      });
    }
    return true;
  },
});

const GENERAL_CONDITIONS_KEY = "generalConditions";
const SPECIAL_CONDITIONS_KEY = "specialConditions";

/** Varsayılan hususi şartlar — kullanıcının tanımladığı 17 madde. */
const DEFAULT_SPECIAL_CONDITIONS: string[] = [
  "Kiracı, kat mülkiyeti kanun ve kurallarına uymayı aynen kabul ve taahhüt eder.",
  "Kiracı kiraladığı mecuru yalnız konut olarak kullanacaktır.",
  "Kiracı mecurun elektrik, doğalgaz ve su aboneliğini kendi üstüne alacaktır. İşbu kira kontratının başlangıç tarihinden itibaren ve teslimine kadar su, elektrik, doğalgaz, aidat, temizlik, vb kiracı tarafından ödenecektir. Kira kontratının sonunda Kiracı bütün borçları kapatarak, ödeme makbuzlarının birer kopyasını Mülk Sahibine verecektir.",
  "Kiracı, kiraladığı mecuru mal sahibinin yazılı izni olmadan kısmen veya tamamen devir edemez, kontrat kendi üzerinde kalmak kaydı ile dahi başkasının istifadesine terk edemez. Kiracı, kiraya verenin yazılı rızası olmadıkça, kiralananı başkasına kiralayamayacağı gibi, kullanım hakkını da devredemez. Yazılı izin olsun veya olmasın devir halinde kiracı, devralanla birlikte müteselsil borçlu olur ve kira borcu ile birlikte gayrimenkule verilecek her türlü zarar ve ziyandan, demirbaşlardan, yan giderlerden vd. borç ve zarardan, tahliye için yapılacak masraf ve vekâlet ücretinden de sorumlu olur. Yazılı izin olmadan yapılan devirde, depozito geri ödenmez.",
  "Kiracı mecuru tahliye edeceğini, kira süresi bitiminde en az 1 ay önce kiraya verene bildirmek zorundadır. Aksi halde kontrat (mal sahibinin tahliye talebi yoksa) 1 yıl daha uzamış sayılır.",
  "Tarafların tebligat adresleri kira sözleşmesinin ön yüzündeki adreslerdir. Adres değişikliği karşı tarafa otuz (30) gün önceden yazılı olarak bildirilmedikçe bu adreslere yöneltilmiş tebligatlar geçerli bir tebligatın tüm sonuçlarını doğurur.",
  "Kiracı sözleşme imzaladığı gün daire için toplam depozito olarak bir aylık kira bedeli verilmiştir. Daire tesliminde hiçbir borç bırakılmadığı ve daireye her hangi bir zarar verilmediği takdirde bu depozito kiracıya faizsiz olarak iade edilecektir. Mecur üzerinde borç veya demirbaşa verilmiş olan zarar depozitten mahsup edilecektir, yetmez ise, eksik kalan kısım ayrıca talep edilecektir. Depozito hiçbir zaman kiracı tarafından kiraya veya yapacağı tamirata mahsup edilemez.",
  "Kiracı mecuru temiz ve boya yapılmış vaziyette teslim almıştır. Mecurun tesliminde aynı şekilde iade etmeyi peşinen kabul etmiştir. Mecurun içinde ilave tadilat ve tamirat işlerini Kiracı yalnız mal sahibinin yazılı muvafakatı üzerine masrafı kendisine ait olmak üzere yapabilir. Tahliye sırasında yapılan tadilat hiçbir ücret istenmeksizin mecurda bırakılacak veya mal sahibinin yazılı talebi üzerine mecur eski hale getirilecektir.",
  "Yıllık kira artışı oranı iki tarafın onayı ve rızasıyla yıllık TÜFE 12 aylık ortalama değişim oranı baz alınarak artış olacaktır. İki taraf tarafından kabul edilmiştir. Kiraya verenin önceden ihtarname çekmesine gerek yoktur.",
  "Kiracı, iş bu kontratın her hangi bir maddesini ihlal ettiği takdirde kontratın kendiliğinden fesh edildiğini ve derhal tahliyeyi kabul ettiğini taahhüt eder.",
  "Kiracı ve birlikte ikamet eden aile üyeleri veya çalışanlar, apartman kurallarına uymak ve çevre sakinlerini, komşuları rahatsız edici ve çevreye zarar verici eylemlerde bulunmamak, komşulara gerekli saygının gösterilmesi için azami özeni göstermekle yükümlüdür. Çevre sakinlerinin resmi şikâyetleri veya apartman yönetiminin şikayeti derhal tahliye sebebidir. Bu durumda kiracı yazılı ihtar üzerine 1 ay içinde kiralananı tahliye etmeyi, tahliye etmediği takdirde her gün için cezai şart ödemeyi kabul ve taahhüt eder.",
  "Kiracı, bakım, satış ya da sonraki kiralama için zorunlu olduğu ölçüde, kiraya verenin ve onun belirlediği üçüncü kişinin kiralananı gezip görmesine izin vermekle yükümlüdür.",
  "Aylık kira bedeli contract.rentAmount olarak belirlenmiştir.",
  "Kira, her ayın 1 ile 5'i arası aşağıdaki belirtilmiş olan banka hesabına kesintisiz havale edilecektir. banka bilgileri otomatik olarak doldurulacaktır.",
  "Kefillerin kefaleti müteselsil ve müşterek borçlu sıfatıyla olup, kontratın devamı ve yenilenmesi süresince akdin karşılıklı feshine kadar geçerlidir. Bu süreçte kefil azlini isteyemez.  Kefil, kira bedeli, bina genel gideri ve her türlü yan gider, elektrik, su, doğalgaz vb kullanım bedelleri gibi kiracının ödemek zorunda bulunduğu her türlü bedelden ve borçtan kiracılık süresince müteselsil borçlu sıfatıyla sorumlu olduğu gibi kiracının binaya ve çevreye verdiği her türlü zarardan da yine müteselsil borçlu sıfatıyla her türlü masraf ve vekâlet ücretleri de dâhil olmak üzere sorumludur.",
  "İş bu kontrattan doğabilecek ihtilaflar halinde İstanbul Anadolu Adliyesi Mahkemeleri ve İcra Daireleri yetkilidir.",
  "Bu sözleşmede yazılı bulunmayan hükümlere ihtiyaç duyulduğunda 6570 sayılı Kira Kanunu, Medeni Kanunu, Borçlar Kanunu, 634 sayılı Kat Mülkiyeti Kanununun ve Diğer yürürlükteki alakalı kanun ve Yargıtay kararları uygulanır.",
];

/** Kayıtlı kontrat genel koşulları (madde listesi). Henüz kaydedilmemişse null döner. */
export const getGeneralConditions = query({
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", GENERAL_CONDITIONS_KEY))
      .first();
    return doc?.generalConditions ?? null;
  },
});

/** Kayıtlı kontrat hususi şartları (madde listesi). Varsayılan 17 madde ile başlar. */
export const getSpecialConditions = query({
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SPECIAL_CONDITIONS_KEY))
      .first();
    return doc?.specialConditions ?? DEFAULT_SPECIAL_CONDITIONS;
  },
});

/** Kontrat genel koşullarını günceller (yalnızca yönetici). */
export const updateGeneralConditions = mutation({
  args: {
    conditions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici genel koşulları değiştirebilir.");
    }

    const clean = args.conditions
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", GENERAL_CONDITIONS_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { generalConditions: clean });
    } else {
      await ctx.db.insert("settings", {
        key: GENERAL_CONDITIONS_KEY,
        generalConditions: clean,
      });
    }
    return true;
  },
});

/** Kontrat hususi şartlarını günceller (yalnızca yönetici). */
export const updateSpecialConditions = mutation({
  args: {
    conditions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici hususi şartları değiştirebilir.");
    }

    const clean = args.conditions
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SPECIAL_CONDITIONS_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { specialConditions: clean });
    } else {
      await ctx.db.insert("settings", {
        key: SPECIAL_CONDITIONS_KEY,
        specialConditions: clean,
      });
    }
    return true;
  },
});

const TUIK_SETTINGS_KEY = "tuik";

export const DEFAULT_TUIK_INFLATION = {
  cpi12MonthAvg: 0,
};

/** TÜFE 12 aylık ortalama oranı (%) — kira artışlarında kullanılır. */
export const getTuikInflation = query({
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", TUIK_SETTINGS_KEY))
      .first();
    if (!doc) return DEFAULT_TUIK_INFLATION;
    return {
      cpi12MonthAvg: doc.cpi12MonthAvg ?? 0,
    };
  },
});

/** TÜFE 12 aylık ortalama oranını günceller (yalnızca yönetici). */
export const updateTuikInflation = mutation({
  args: { cpi12MonthAvg: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (actor.role !== ROLES.ADMIN) {
      throw new ConvexError("Yalnızca yönetici TÜFE oranını güncelleyebilir.");
    }
    if (args.cpi12MonthAvg < 0) {
      throw new ConvexError("TÜFE oranı negatif olamaz.");
    }
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", TUIK_SETTINGS_KEY))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { cpi12MonthAvg: args.cpi12MonthAvg });
    } else {
      await ctx.db.insert("settings", {
        key: TUIK_SETTINGS_KEY,
        cpi12MonthAvg: args.cpi12MonthAvg,
      });
    }
    return true;
  },
});
