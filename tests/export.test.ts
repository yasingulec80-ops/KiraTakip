import { describe, expect, test } from "bun:test";
import {
  dateToInput,
  formatCurrency,
  formatDate,
  formatNumber,
  parseDateInput,
  parseNumber,
} from "../src/lib/export";

describe("parseNumber — Türkçe sayı girişi", () => {
  test("binlik ayracı nokta, ondalık virgül", () => {
    expect(parseNumber("1.500,50")).toBe(1500.5);
    expect(parseNumber("15.000")).toBe(15000);
  });

  test("düz tamsayı", () => {
    expect(parseNumber("15000")).toBe(15000);
    expect(parseNumber("0")).toBe(0);
  });

  test("boş / geçersiz giriş undefined döner", () => {
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("   ")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
  });
});

describe("formatNumber / formatCurrency — tr-TR", () => {
  test("binlik ayraçları", () => {
    expect(formatNumber(1500.5)).toBe("1.500,5");
    expect(formatNumber(15000)).toBe("15.000");
  });

  test("para biçimi — binlik ayraçlar ve ₺ simgesi", () => {
    // Simge yerleşimi ICU sürümüne göre değişebilir; biçim ve tutar doğrulanır.
    expect(formatCurrency(1500)).toContain("1.500,00");
    expect(formatCurrency(1500)).toContain("₺");
    expect(formatCurrency(0)).toContain("0,00");
  });
});

describe("tarih yardımcıları", () => {
  test("dateToInput yyyy-MM-dd üretir", () => {
    expect(dateToInput(new Date(2026, 7, 8).getTime())).toBe("2026-08-08");
    expect(dateToInput(new Date(2026, 0, 1).getTime())).toBe("2026-01-01");
  });

  test("parseDateInput / dateToInput gidiş-dönüş", () => {
    const ts = parseDateInput("2026-08-08");
    expect(ts).toBeDefined();
    expect(dateToInput(ts!)).toBe("2026-08-08");
  });

  test("formatDate tr-TR kısa ay (gün her zaman 2 haneli)", () => {
    expect(formatDate(new Date(2026, 7, 8).getTime())).toBe("08 Ağu 2026");
  });
});
