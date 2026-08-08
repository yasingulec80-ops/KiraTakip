import { describe, expect, test } from "bun:test";
import { computeVat } from "../src/lib/vat";

describe("computeVat — KDV hesapları", () => {
  test("KDV hariç: KDV tutarı kira üzerinden eklenir", () => {
    const v = computeVat(18500, 20, "haric");
    expect(v.vatAmount).toBe(3700);
    expect(v.vatInclusiveRent).toBe(22200);
  });

  test("KDV dahil: KDV tutarı fiyatın içinden çıkarılır", () => {
    const v = computeVat(18500, 20, "dahil");
    // 18500 − 18500 / 1.20 = 18500 − 15416.67 = 3083.33
    expect(v.vatAmount).toBeCloseTo(3083.33, 2);
    expect(v.vatInclusiveRent).toBe(18500);
  });

  test("KDV dahil çıkarımı doğrudur: hariç fiyat + KDV = dahil fiyat", () => {
    const net = 18500;
    const v = computeVat(net, 20, "dahil");
    const netPrice = net - v.vatAmount;
    // netPrice + netPrice × %20 = dahil fiyat
    expect(netPrice * 1.2).toBeCloseTo(net, 2);
  });

  test("sıfır oran KDV üretmez", () => {
    const v = computeVat(15000, 0, "haric");
    expect(v.vatAmount).toBe(0);
    expect(v.vatInclusiveRent).toBe(15000);
  });

  test("farklı oranlar (ör. %10, %18)", () => {
    expect(computeVat(10000, 10, "haric").vatAmount).toBe(1000);
    expect(computeVat(10000, 18, "haric").vatAmount).toBe(1800);
  });

  test("yuvarlama kararlılığı — dahil modda 1.000.000 ₺", () => {
    const v = computeVat(1_000_000, 20, "dahil");
    expect(v.vatAmount).toBeCloseTo(166_666.67, 2);
    expect(v.vatInclusiveRent).toBe(1_000_000);
  });
});
