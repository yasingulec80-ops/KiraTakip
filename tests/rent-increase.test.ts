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

const ms = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12).getTime();

// addMonthsStrict gün ortasını korumaz — sonuçlar gece yarısına göre karşılaştırılır.
const msMidnight = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day).getTime();

describe("firstIncreaseDateOf", () => {
  test("12 aydan kısa kontratta artış yoktur", () => {
    expect(firstIncreaseDateOf(ms(2026, 7, 1), 11)).toBeNull();
  });

  test("ilk artış başlangıçtan 12 ay sonradır; bitişi geçmiyorsa", () => {
    expect(firstIncreaseDateOf(ms(2026, 7, 1), 24)).toBe(msMidnight(2027, 7, 1));
  });

  test("12 aylık kontratta ilk artış bitişten sonraya denk gelir → null", () => {
    // Bitiş 2027-06-30; ilk yıldönümü 2027-07-01 → kontrat içinde artış yok.
    expect(firstIncreaseDateOf(ms(2026, 7, 1), 12)).toBeNull();
  });
});

describe("nextIncreaseDateOf", () => {
  test("stored tarih varsa 12 ay ileri alınır", () => {
    expect(nextIncreaseDateOf(ms(2026, 7, 1), 36, ms(2027, 7, 1))).toBe(msMidnight(2028, 7, 1));
  });

  test("ileri alınan tarih bitişi aşarsa null", () => {
    expect(nextIncreaseDateOf(ms(2026, 7, 1), 13, ms(2027, 7, 1))).toBeNull();
  });
});

describe("isIncreaseDue", () => {
  const now = ms(2026, 8, 17);

  test("tarih geçmişse true", () => {
    expect(isIncreaseDue(ms(2026, 8, 1), now)).toBe(true);
  });

  test("pencere içindeyse true", () => {
    const inside = now + INCREASE_LOOKAHEAD_DAYS * 86_400_000;
    expect(isIncreaseDue(inside, now)).toBe(true);
  });

  test("pencerenin dışındaysa false", () => {
    expect(isIncreaseDue(ms(2027, 6, 1), now)).toBe(false);
  });

  test("tarih yoksa false", () => {
    expect(isIncreaseDue(null, now)).toBe(false);
    expect(isIncreaseDue(undefined, now)).toBe(false);
  });
});

describe("increasedRent", () => {
  test("oran → yeni kira, en yakın tam sayı", () => {
    expect(increasedRent(18_500, 25)).toBe(23_125);
    expect(increasedRent(10_000, 0)).toBe(10_000);
    expect(increasedRent(10_000, 33.33)).toBe(13_333);
  });
});

describe("rentAccrualsToUpdate", () => {
  const accruals = [
    { type: "rent", period: "2026-07", amount: 18_500, dueDate: ms(2026, 7, 1) },
    { type: "rent", period: "2026-08", amount: 18_500, dueDate: ms(2026, 8, 1) },
    { type: "deposit", period: "2026-07", amount: 55_500, dueDate: ms(2026, 7, 1) },
    { type: "rent", period: "2026-09", amount: 18_500, dueDate: ms(2026, 9, 1) },
    { type: "rent", period: "2026-10", amount: 23_125, dueDate: ms(2026, 10, 1) }, // zaten yeni tutar
  ];

  test("depozito hariç, etkili dönemden itibaren ve tutarı farklı olanlar", () => {
    const toUpdate = rentAccrualsToUpdate(accruals, ms(2026, 8, 1), 23_125);
    const periods = toUpdate.map((a) => a.period);
    expect(periods).toEqual(["2026-08", "2026-09"]);
  });
});

describe("effectiveNextIncreaseDate", () => {
  test("kayıtlı tarih önceliklidir", () => {
    const c = {
      startDate: ms(2026, 7, 1),
      durationMonths: 24,
      nextIncreaseDate: ms(2027, 9, 1),
      lastIncreaseDate: ms(2027, 7, 1),
    };
    expect(effectiveNextIncreaseDate(c)).toBe(ms(2027, 9, 1));
  });

  test("artış hiç kullanılmamışsa ilk yıldönümü gösterilir", () => {
    expect(
      effectiveNextIncreaseDate({
        startDate: ms(2026, 7, 1),
        durationMonths: 24,
      }),
    ).toBe(msMidnight(2027, 7, 1));
  });

  test("artış uygulanmış ama sonraki tarih yoksa null", () => {
    expect(
      effectiveNextIncreaseDate({
        startDate: ms(2026, 7, 1),
        durationMonths: 24,
        lastIncreaseDate: ms(2027, 7, 1),
      }),
    ).toBeNull();
  });
});
