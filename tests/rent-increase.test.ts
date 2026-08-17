import { describe, expect, test } from "bun:test";
import {
  INCREASE_LOOKAHEAD_DAYS,
  contractEndMs,
  effectiveNextIncreaseDate,
  firstIncreaseDateOf,
  increasedRent,
  isIncreaseDue,
  nextIncreaseDateOf,
  rentAccrualsToUpdate,
} from "../src/lib/rent-increase";

const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day).getTime();

const DAY_MS = 86_400_000;

describe("firstIncreaseDateOf — ilk yıllık artış tarihi", () => {
  test("başlangıçtan 12 ay sonra", () => {
    const start = at(2026, 7, 1);
    expect(firstIncreaseDateOf(start, 24)).toBe(at(2027, 7, 1));
  });

  test("12 aylık kontrat: yıldönümü bitişin ötesinde kalır → kontrat içinde artış yok", () => {
    // 12 aylık kontrat 2027-06-30 biter; artış yıldönümü 2027-07-01 sınır dışıdır.
    const start = at(2026, 7, 1);
    expect(firstIncreaseDateOf(start, 12)).toBeNull();
  });

  test("13 aylık kontrat: yıldönümü bitişin içinde kalır → takip edilir", () => {
    expect(firstIncreaseDateOf(at(2026, 7, 1), 13)).toBe(at(2027, 7, 1));
  });

  test("12 aydan kısa kontratta artış dönemi yok", () => {
    expect(firstIncreaseDateOf(at(2026, 7, 1), 6)).toBeNull();
  });

  test("ay sonu gün taşması korunur (31 Temmuz + 12 ay → 31 Temmuz)", () => {
    expect(firstIncreaseDateOf(at(2026, 7, 31), 24)).toBe(at(2027, 7, 31));
  });
});

describe("nextIncreaseDateOf — ilerletme", () => {
  const start = at(2026, 7, 1);

  test("kayıtlı tarih varsa 12 ay ileri alınır", () => {
    expect(nextIncreaseDateOf(start, 36, at(2027, 7, 1))).toBe(at(2028, 7, 1));
  });

  test("ilerletme kontrat bitişini aşarsa null (kontrat içinde artık artış yok)", () => {
    // 24 aylık kontrat (2028-06-30 biter): 2027-07 artışından sonra 2028-07 sınır dışı.
    expect(nextIncreaseDateOf(start, 24, at(2027, 7, 1))).toBeNull();
  });

  test("kayıtlı tarih yoksa ilk yıldönümü hesaplanır", () => {
    expect(nextIncreaseDateOf(start, 24, null)).toBe(at(2027, 7, 1));
    expect(nextIncreaseDateOf(start, 24, undefined)).toBe(at(2027, 7, 1));
  });

  test("12 aylık kontratta kayıtlı tarih yoksa null", () => {
    expect(nextIncreaseDateOf(start, 12, null)).toBeNull();
  });
});

describe("isIncreaseDue — artış dönemi gelen", () => {
  const now = at(2026, 8, 1);

  test("tarih geçmişse true (gecikti)", () => {
    expect(isIncreaseDue(at(2026, 7, 1), now)).toBe(true);
  });

  test("90 gün içindeki tarih true (yaklaşıyor)", () => {
    expect(isIncreaseDue(at(2026, 10, 20), now)).toBe(true);
    // Pencere sınırı: tam 90 gün sonrası dahil.
    expect(isIncreaseDue(now + 90 * DAY_MS, now)).toBe(true);
  });

  test("pencerenin dışındaki tarih false", () => {
    expect(isIncreaseDue(now + 91 * DAY_MS, now)).toBe(false);
    expect(isIncreaseDue(at(2027, 1, 1), now)).toBe(false);
  });

  test("tarih yoksa false", () => {
    expect(isIncreaseDue(null, now)).toBe(false);
    expect(isIncreaseDue(undefined, now)).toBe(false);
  });

  test("pencere parametresiyle değiştirilebilir", () => {
    expect(isIncreaseDue(now + 60 * DAY_MS, now, 30)).toBe(false);
    expect(isIncreaseDue(now + 60 * DAY_MS, now, 90)).toBe(true);
    expect(INCREASE_LOOKAHEAD_DAYS).toBe(90);
  });
});

describe("increasedRent — yeni kira hesaplama", () => {
  test("%25 artış", () => {
    expect(increasedRent(12000, 25)).toBe(15000);
  });

  test("%0 artış tutarı değiştirmez", () => {
    expect(increasedRent(12000, 0)).toBe(12000);
  });

  test("yuvarlama en yakın tam sayıya", () => {
    expect(increasedRent(100, 33)).toBe(133); // 133.0
    expect(increasedRent(18500, 22.6)).toBe(22681); // 22681.0
    expect(increasedRent(12345, 10.5)).toBe(13641); // 13641.225 → 13641
  });
});

describe("effectiveNextIncreaseDate — karo için etkin tarih", () => {
  const start = at(2026, 7, 1);

  test("kayıtlı tarih önceliklidir", () => {
    expect(
      effectiveNextIncreaseDate({
        startDate: start,
        durationMonths: 24,
        nextIncreaseDate: at(2027, 7, 1),
      }),
    ).toBe(at(2027, 7, 1));
  });

  test("artış hiç uygulanmamış eski kontratta ilk yıldönümü kullanılır (karo görünür)", () => {
    expect(
      effectiveNextIncreaseDate({ startDate: start, durationMonths: 24 }),
    ).toBe(at(2027, 7, 1));
  });

  test("artış uygulanmış ama tarih kayıtlı değilse null (görünmez)", () => {
    expect(
      effectiveNextIncreaseDate({
        startDate: start,
        durationMonths: 24,
        lastIncreaseDate: at(2027, 7, 1),
      }),
    ).toBeNull();
  });

  test("süre 12 aydan kısaysa null", () => {
    expect(
      effectiveNextIncreaseDate({ startDate: start, durationMonths: 6 }),
    ).toBeNull();
  });
});

describe("contractEndMs — kontrat bitişi", () => {
  test("12 aylık kontrat bir sonraki yılın haziran sonu biter", () => {
    expect(contractEndMs(at(2026, 7, 1), 12)).toBe(at(2027, 6, 30));
  });
});

describe("rentAccrualsToUpdate — artışın etkilediği tahakkuklar", () => {
  const rent = (period: string, amount: number, dueDate: number, type?: string) => ({
    _id: `a-${period}`,
    type,
    period,
    amount,
    dueDate,
  });
  const start = at(2026, 7, 1);

  test("etkili tarihin döneminden (dahil) itibaren farklı tutarlı kiralar seçilir", () => {
    const accruals = [
      rent("2026-05", 10000, start),
      rent("2026-06", 10000, start),
      rent("2026-07", 10000, start),
      rent("2026-08", 10000, start),
    ];
    const updated = rentAccrualsToUpdate(accruals, at(2026, 7, 15), 12000);
    expect(updated.map((a) => a.period)).toEqual(["2026-07", "2026-08"]);
  });

  test("depozito tahakkukları asla seçilmez (type = deposit)", () => {
    const accruals = [
      rent("2026-07", 30000, start, "deposit"),
      rent("2026-07", 10000, start),
    ];
    const updated = rentAccrualsToUpdate(accruals, at(2026, 7, 1), 12000);
    expect(updated.map((a) => a.period)).toEqual(["2026-07"]);
    expect(updated[0]?.amount).toBe(10000);
  });

  test("tutar zaten yeni kira ile aynıysa dokunulmaz", () => {
    const accruals = [rent("2026-07", 12000, start), rent("2026-08", 12000, start)];
    expect(
      rentAccrualsToUpdate(accruals, at(2026, 7, 1), 12000),
    ).toEqual([]);
  });

  test("type alanı olmayan eski kayıtlar kira sayılır (depozito değil)", () => {
    const accruals = [
      { _id: "legacy", period: "2026-07", amount: 10000, dueDate: start },
    ];
    expect(
      rentAccrualsToUpdate(accruals, at(2026, 7, 1), 12000).map((a) => a._id),
    ).toEqual(["legacy"]);
  });

  test("karışık senaryo: geçmiş + depozito + aynı tutar dışlanır, gerisi güncellenir", () => {
    const accruals = [
      rent("2026-05", 10000, start), // geçmiş dönem → dışarı
      rent("2026-06", 10000, start), // geçmiş dönem → dışarı
      rent("2026-06", 30000, start, "deposit"), // depozito → dışarı
      rent("2026-07", 10000, start), // güncelle
      rent("2026-08", 10000, start), // güncelle
      rent("2026-09", 12000, start), // aynı tutar → dışarı
    ];
    const updated = rentAccrualsToUpdate(accruals, at(2026, 7, 1), 12000);
    expect(updated.map((a) => a.period)).toEqual(["2026-07", "2026-08"]);
  });

  test("dönem karşılaştırması YYYY-MM sıralıdır; aynı ay dahil edilir", () => {
    const accruals = [rent("2026-12", 10000, start), rent("2027-01", 10000, start)];
    expect(
      rentAccrualsToUpdate(accruals, at(2026, 12, 10), 12000).map((a) => a.period),
    ).toEqual(["2026-12", "2027-01"]);
  });
});
