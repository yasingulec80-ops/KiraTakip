import { describe, expect, test } from "bun:test";
import {
  accrualPosts,
  contractMonths,
  depositAccrualDecision,
  expensePosts,
  periodKey,
} from "../src/lib/ledger-posts";

const contract = { ownerId: "owner-1", tenantId: "tenant-1", startDate: 0, durationMonths: 3 };

describe("periodKey / contractMonths", () => {
  test("periodKey ay anahtarını üretir", () => {
    expect(periodKey(new Date(2026, 7, 15).getTime())).toBe("2026-08");
    expect(periodKey(new Date(2026, 0, 1).getTime())).toBe("2026-01");
  });

  test("contractMonths süre boyunca aylık satır üretir", () => {
    const start = new Date(2026, 6, 1).getTime(); // 2026-07-01
    const months = contractMonths({ startDate: start, durationMonths: 3 });
    expect(months).toEqual([
      { period: "2026-07", dueDate: start },
      { period: "2026-08", dueDate: new Date(2026, 7, 1).getTime() },
      { period: "2026-09", dueDate: new Date(2026, 8, 1).getTime() },
    ]);
  });
});

describe("accrualPosts — tahakkuk kayıtları", () => {
  test("kira tahakkuku: kiracı borçlanır (−), malik alacaklanır (+)", () => {
    const posts = accrualPosts(contract, { period: "2026-08", amount: 18_500 });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      personType: "tenant",
      personId: "tenant-1",
      kind: "accrual",
      amount: -18_500,
      description: "Kira tahakkuku — 2026-08",
    });
    expect(posts[1]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "accrual",
      amount: 18_500,
      description: "Kira tahakkuku — 2026-08",
    });
  });

  test("depozito tahakkuku ayrı açıklama yazar", () => {
    const posts = accrualPosts(contract, { period: "2026-07", amount: 55_500 }, "deposit");
    expect(posts[0].description).toBe("Depozito tahakkuku — 2026-07");
    expect(posts[0].amount).toBe(-55_500);
    expect(posts[1].amount).toBe(55_500);
  });
});

describe("expensePosts — masraf ödeyen sınıflandırması", () => {
  const base = {
    amount: 2_500,
    description: "Ağustos site aidatı",
    category: "aidat",
  };

  test("malik öder → malik borçlanır (−)", () => {
    const posts = expensePosts({ ...base, paidByType: "owner", payerOwnerId: "owner-1" });
    expect(posts).toEqual([
      {
        personType: "owner",
        personId: "owner-1",
        kind: "expense",
        amount: -2_500,
        description: "Masraf — Ağustos site aidatı",
      },
    ]);
  });

  test("kiracı öder → kiracı alacaklanır (+) (kira hesabına mahsup)", () => {
    const posts = expensePosts({ ...base, paidByType: "tenant", payerTenantId: "tenant-1" });
    expect(posts).toEqual([
      {
        personType: "tenant",
        personId: "tenant-1",
        kind: "expense",
        amount: 2_500,
        description: "Masraf — Ağustos site aidatı",
      },
    ]);
  });

  test("vekil öder → vekil alacaklanır (+), malik borçlanır (−, (vekil) eki)", () => {
    const posts = expensePosts({ ...base, paidByType: "proxy", payerOwnerId: "owner-1" });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      personType: "proxy",
      personId: "owner-1",
      ownerId: "owner-1",
      kind: "expense",
      amount: 2_500,
    });
    expect(posts[1]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "expense",
      amount: -2_500,
      description: "Masraf — Ağustos site aidatı (vekil)",
    });
  });

  test("ödeyen kimliği eksikse kayıt üretilmez", () => {
    expect(expensePosts({ ...base, paidByType: "owner" })).toEqual([]);
    expect(expensePosts({ ...base, paidByType: "tenant" })).toEqual([]);
  });
});

describe("depositAccrualDecision — depozito tahakkuk senkronizasyonu", () => {
  const startDate = new Date(2026, 6, 1).getTime();
  const now = new Date(2026, 7, 15).getTime();

  test("tahakkuk yok + depozito > 0 → oluştur", () => {
    const d = depositAccrualDecision(55_500, null, startDate, now);
    expect(d.action).toBe("create");
    if (d.action === "create") {
      expect(d.amount).toBe(55_500);
      expect(d.period).toBe("2026-07");
      expect(d.dueDate).toBe(startDate);
    }
  });

  test("tahakkuk yok + depozito yok → dokunma", () => {
    expect(depositAccrualDecision(0, null, startDate, now).action).toBe("none");
  });

  test("depozito kaldırıldı → sil", () => {
    expect(
      depositAccrualDecision(0, { amount: 55_500, dueDate: startDate }, startDate, now).action,
    ).toBe("delete");
  });

  test("tutar değişti ve vade gelmiş → güncelle + cari kayıtları yeniden işle", () => {
    const d = depositAccrualDecision(60_000, { amount: 55_500, dueDate: startDate }, startDate, now);
    expect(d.action).toBe("update");
    if (d.action === "update") {
      expect(d.amount).toBe(60_000);
      expect(d.shouldPost).toBe(true);
    }
  });

  test("tutar değişti ama vade ileride → güncelle, cari kayıt işleme", () => {
    const futureStart = new Date(2027, 0, 1).getTime();
    const d = depositAccrualDecision(
      60_000,
      { amount: 55_500, dueDate: futureStart },
      futureStart,
      now,
    );
    expect(d.action).toBe("update");
    if (d.action === "update") {
      expect(d.shouldPost).toBe(false);
    }
  });

  test("tutar aynı → dokunma", () => {
    expect(
      depositAccrualDecision(55_500, { amount: 55_500, dueDate: startDate }, startDate, now).action,
    ).toBe("none");
  });
});
