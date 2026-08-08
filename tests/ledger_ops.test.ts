import { describe, expect, test } from "bun:test";
import { contractMonths, periodKey } from "../src/convex/ledger_ops";

describe("periodKey", () => {
  test("ay anahtarı üretir", () => {
    expect(periodKey(new Date(2026, 7, 1).getTime())).toBe("2026-08");
    expect(periodKey(new Date(2026, 0, 31).getTime())).toBe("2026-01");
    expect(periodKey(new Date(2027, 0, 1).getTime())).toBe("2027-01");
  });
});

describe("contractMonths", () => {
  const start = new Date(2026, 6, 1).getTime(); // 2026-07-01

  test("süre kadar ay üretir", () => {
    const months = contractMonths({ startDate: start, durationMonths: 3 });
    expect(months).toHaveLength(3);
    expect(months.map((m) => m.period)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  test("vade tarihleri her ayın ilk günüdür", () => {
    const months = contractMonths({ startDate: start, durationMonths: 2 });
    expect(months[0].dueDate).toBe(new Date(2026, 6, 1).getTime());
    expect(months[1].dueDate).toBe(new Date(2026, 7, 1).getTime());
  });

  test("yıl sonuna taşan sürelerde ay anahtarı doğru döner", () => {
    const novStart = new Date(2026, 10, 1).getTime();
    const months = contractMonths({ startDate: novStart, durationMonths: 3 });
    expect(months.map((m) => m.period)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  test("boş süre boş dizi döndürür", () => {
    expect(contractMonths({ startDate: start, durationMonths: 0 })).toEqual([]);
  });
});
