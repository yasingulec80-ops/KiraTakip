import { describe, expect, it } from "bun:test";
import {
  periodKey,
  contractMonths,
  accrualPosts,
  expensePosts,
  depositAccrualDecision,
} from "../src/lib/ledger-posts";

describe("periodKey", () => {
  it("formats a timestamp to YYYY-MM", () => {
    const ts = new Date(2026, 0, 15).getTime(); // Jan 15 2026
    expect(periodKey(ts)).toBe("2026-01");
  });

  it("pads single-digit months", () => {
    const ts = new Date(2026, 11, 1).getTime(); // Dec 2026
    expect(periodKey(ts)).toBe("2026-12");
  });
});

describe("contractMonths", () => {
  it("generates correct number of months", () => {
    const start = new Date(2026, 0, 1).getTime();
    const months = contractMonths({ startDate: start, durationMonths: 3 });
    expect(months).toHaveLength(3);
  });

  it("periods are sequential YYYY-MM", () => {
    const start = new Date(2026, 0, 1).getTime();
    const months = contractMonths({ startDate: start, durationMonths: 4 });
    expect(months.map((m) => m.period)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("preserves day of month from startDate for each accrual", () => {
    // startDate = Jan 15 → i=0 produces Jan 15, i=1 produces Feb 15.
    // Both are >= startDate, so both included.
    const start = new Date(2026, 0, 15).getTime();
    const months = contractMonths({ startDate: start, durationMonths: 2 });
    expect(months).toHaveLength(2);
    expect(months[0].period).toBe("2026-01");
    expect(months[0].dueDate).toBe(new Date(2026, 0, 15).getTime());
    expect(months[1].period).toBe("2026-02");
    expect(months[1].dueDate).toBe(new Date(2026, 1, 15).getTime());
  });

  it("returns empty for 0 months", () => {
    expect(contractMonths({ startDate: Date.now(), durationMonths: 0 })).toEqual([]);
  });
});

describe("accrualPosts", () => {
  it("creates tenant debit and owner credit for rent", () => {
    const posts = accrualPosts(
      { ownerId: "owner-1", tenantId: "tenant-1" },
      { period: "2026-01", amount: 15000 },
    );
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      personType: "tenant",
      personId: "tenant-1",
      kind: "accrual",
      amount: -15000,
    });
    expect(posts[1]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "accrual",
      amount: 15000,
    });
  });

  it("creates deposit posts with distinct description", () => {
    const posts = accrualPosts(
      { ownerId: "owner-1", tenantId: "tenant-1" },
      { period: "2026-01", amount: 30000 },
      "deposit",
    );
    expect(posts[0].description).toContain("Depozito tahakkuku");
    expect(posts[1].description).toContain("Depozito tahakkuku");
  });

  it("rent posts have Kira tahakkuku description", () => {
    const posts = accrualPosts(
      { ownerId: "owner-1", tenantId: "tenant-1" },
      { period: "2026-03", amount: 10000 },
    );
    expect(posts[0].description).toBe("Kira tahakkuku — 2026-03");
  });
});

describe("expensePosts", () => {
  it("owner pays → single owner debit", () => {
    const posts = expensePosts({
      paidByType: "owner",
      payerOwnerId: "owner-1",
      amount: 5000,
      description: "Boya",
      category: "boya",
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "expense",
      amount: -5000,
    });
    expect(posts[0].description).toContain("Masraf — Boya");
  });

  it("tenant pays → single tenant credit", () => {
    const posts = expensePosts({
      paidByType: "tenant",
      payerTenantId: "tenant-1",
      amount: 3000,
      description: "Aidat",
      category: "aidat",
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      personType: "tenant",
      personId: "tenant-1",
      kind: "expense",
      amount: 3000,
    });
  });

  it("proxy pays → proxy credit + owner debit", () => {
    const posts = expensePosts({
      paidByType: "proxy",
      payerOwnerId: "owner-1",
      amount: 8000,
      description: "Tadilat",
      category: "tadilat",
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      personType: "proxy",
      personId: "owner-1",
      kind: "expense",
      amount: 8000,
    });
    expect(posts[1]).toMatchObject({
      personType: "owner",
      personId: "owner-1",
      kind: "expense",
      amount: -8000,
    });
    expect(posts[1].description).toContain("(vekil)");
  });

  it("missing payer returns empty", () => {
    const posts = expensePosts({
      paidByType: "owner",
      amount: 1000,
      description: "test",
      category: "diger",
    });
    expect(posts).toEqual([]);
  });
});

describe("depositAccrualDecision", () => {
  const start = new Date(2026, 0, 1).getTime();
  const now = new Date(2026, 0, 15).getTime();

  it("create when no existing and deposit > 0", () => {
    const d = depositAccrualDecision(50000, null, start, now);
    expect(d.action).toBe("create");
    if (d.action === "create") {
      expect(d.amount).toBe(50000);
      expect(d.period).toBe("2026-01");
    }
  });

  it("none when no existing and deposit <= 0", () => {
    expect(depositAccrualDecision(0, null, start, now).action).toBe("none");
  });

  it("delete when deposit cleared", () => {
    expect(
      depositAccrualDecision(0, { amount: 50000, dueDate: start }, start, now).action,
    ).toBe("delete");
  });

  it("update when amount changed", () => {
    const d = depositAccrualDecision(
      60000,
      { amount: 50000, dueDate: start },
      start,
      now,
    );
    expect(d.action).toBe("update");
    if (d.action === "update") {
      expect(d.amount).toBe(60000);
    }
  });

  it("none when amount unchanged", () => {
    expect(
      depositAccrualDecision(50000, { amount: 50000, dueDate: start }, start, now).action,
    ).toBe("none");
  });
});
