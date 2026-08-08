import { describe, expect, test } from "bun:test";
import {
  accrualPosts,
  contractMonths,
  depositAccrualDecision,
  expensePosts,
  periodKey,
} from "../src/lib/ledger-posts";

const CONTRACT = {
  ownerId: "owner-1",
  tenantId: "tenant-1",
  startDate: new Date(2026, 6, 1).getTime(), // 2026-07-01
  durationMonths: 12,
};

describe("accrualPosts — tahakkuk kayıtları (kiracı borçlanır, malik alacaklanır)", () => {
  test("kira tahakkuku: kiracı −, malik +, aynı açıklama", () => {
    const posts = accrualPosts(CONTRACT, {
      period: "2026-07",
      amount: 15000,
    }, "rent");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      personType: "tenant",
      personId: "tenant-1",
      kind: "accrual",
      amount: -15000,
      description: "Kira tahakkuku — 2026-07",
    });
    expect(posts[1]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "accrual",
      amount: 15000,
      description: "Kira tahakkuku — 2026-07",
    });
  });

  test("depozito tahakkuku ayrı açıklama kullanır", () => {
    const posts = accrualPosts(CONTRACT, {
      period: "2026-07",
      amount: 30000,
    }, "deposit");
    expect(posts[0].description).toBe("Depozito tahakkuku — 2026-07");
    expect(posts[1].description).toBe("Depozito tahakkuku — 2026-07");
    expect(posts[0].amount).toBe(-30000);
    expect(posts[1].amount).toBe(30000);
  });

  test("varsayılan tür kiradır", () => {
    const posts = accrualPosts(CONTRACT, {
      period: "2026-07",
      amount: 1000,
    });
    expect(posts[0].description).toBe("Kira tahakkuku — 2026-07");
  });
});

describe("expensePosts — masraf ödeyen sınıflandırması", () => {
  const base = {
    amount: 5000,
    description: "tadilat",
    category: "tadilat",
  };

  test("malik öder → malik borçlanır (−)", () => {
    const posts = expensePosts({ ...base, paidByType: "owner", payerOwnerId: "owner-1" });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "expense",
      amount: -5000,
      description: "Masraf — tadilat",
    });
  });

  test("kiracı öder → kiracı alacaklanır (+) (kira hesabına mahsup)", () => {
    const posts = expensePosts({ ...base, paidByType: "tenant", payerTenantId: "tenant-1" });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      personType: "tenant",
      personId: "tenant-1",
      amount: 5000,
    });
  });

  test("vekil öder → vekil alacaklanır (+), malik borçlanır (−, '(vekil)' eki)", () => {
    const posts = expensePosts({ ...base, paidByType: "proxy", payerOwnerId: "owner-1" });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      personType: "proxy",
      personId: "owner-1",
      ownerId: "owner-1",
      amount: 5000,
      description: "Masraf — tadilat",
    });
    expect(posts[1]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      amount: -5000,
      description: "Masraf — tadilat (vekil)",
    });
  });

  test("açıklama boşsa kategoriye düşer", () => {
    const posts = expensePosts({
      ...base,
      description: "",
      paidByType: "owner",
      payerOwnerId: "owner-1",
    });
    expect(posts[0].description).toBe("Masraf — tadilat");
  });

  test("ödeyen kimliği eksikse kayıt üretilmez", () => {
    expect(expensePosts({ ...base, paidByType: "owner" })).toEqual([]);
    expect(expensePosts({ ...base, paidByType: "proxy" })).toEqual([]);
    expect(expensePosts({ ...base, paidByType: "tenant" })).toEqual([]);
  });
});

describe("depositAccrualDecision — depozito tahakkuk senkronizasyonu", () => {
  const startDate = new Date(2026, 6, 1).getTime();
  const now = new Date(2026, 7, 1).getTime(); // 2026-08-01

  test("tahakkuk yok + depozito > 0 → oluştur (start tarihiyle)", () => {
    const d = depositAccrualDecision(30000, null, startDate, now);
    expect(d.action).toBe("create");
    if (d.action === "create") {
      expect(d.amount).toBe(30000);
      expect(d.period).toBe("2026-07");
      expect(d.dueDate).toBe(startDate);
    }
  });

  test("tahakkuk yok + depozito 0 → dokunma", () => {
    expect(depositAccrualDecision(0, null, startDate, now).action).toBe(
      "none",
    );
  });

  test("depozito ≤ 0 → sil", () => {
    const existing = { amount: 30000, dueDate: startDate };
    expect(depositAccrualDecision(0, existing, startDate, now).action).toBe(
      "delete",
    );
    expect(depositAccrualDecision(-1000, existing, startDate, now).action).toBe(
      "delete",
    );
  });

  test("tutar değişti + vade gelmiş → güncelle ve cari kayıtları yeniden işle", () => {
    const existing = { amount: 30000, dueDate: startDate }; // vadesi geçmiş
    const d = depositAccrualDecision(35000, existing, startDate, now);
    expect(d.action).toBe("update");
    if (d.action === "update") {
      expect(d.amount).toBe(35000);
      expect(d.period).toBe("2026-07");
      expect(d.shouldPost).toBe(true);
    }
  });

  test("tutar değişti + vade gelmemiş → güncelle ama cari kayıt işleme", () => {
    const future = new Date(2027, 0, 1).getTime(); // 2027-01-01 (now'dan sonra)
    const existing = { amount: 30000, dueDate: future };
    const d = depositAccrualDecision(35000, existing, future, now);
    expect(d.action).toBe("update");
    if (d.action === "update") {
      expect(d.shouldPost).toBe(false);
    }
  });

  test("tutar aynıysa → dokunma", () => {
    const existing = { amount: 30000, dueDate: startDate };
    expect(depositAccrualDecision(30000, existing, startDate, now).action).toBe(
      "none",
    );
  });
});

describe("periodKey / contractMonths — taşınmış yardımcılar hâlâ çalışıyor", () => {
  test("periodKey ay anahtarı üretir", () => {
    expect(periodKey(new Date(2026, 7, 1).getTime())).toBe("2026-08");
  });

  test("contractMonths süre kadar ay üretir", () => {
    const months = contractMonths({
      startDate: CONTRACT.startDate,
      durationMonths: 2,
    });
    expect(months.map((m) => m.period)).toEqual(["2026-07", "2026-08"]);
  });
});
