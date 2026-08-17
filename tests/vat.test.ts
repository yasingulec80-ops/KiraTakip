import { describe, expect, test } from "bun:test";
import { computeVat } from "../src/lib/vat";

describe("computeVat", () => {
  test("KDV hariç: KDV ayrıca eklenir", () => {
    const b = computeVat(10_000, 20, "haric");
    expect(b.vatAmount).toBe(2_000);
    expect(b.vatInclusiveRent).toBe(12_000);
  });

  test("KDV dahil: KDV fiyatın içinden çıkarılır", () => {
    const b = computeVat(12_000, 20, "dahil");
    expect(b.vatInclusiveRent).toBe(12_000);
    // 12.000 − 12.000/1,2 = 2.000
    expect(b.vatAmount).toBeCloseTo(2_000, 6);
  });

  test("sıfır oran KDV üretmez", () => {
    expect(computeVat(10_000, 0, "haric").vatAmount).toBe(0);
    expect(computeVat(10_000, 0, "dahil").vatAmount).toBe(0);
  });
});
