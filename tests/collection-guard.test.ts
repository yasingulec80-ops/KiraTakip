import { describe, expect, test } from "bun:test";
import { sameProxyCollectionConflict } from "../src/lib/collection-guard";

describe("sameProxyCollectionConflict", () => {
  test("ödeyen vekil ile tahsil eden aynıysa çelişki", () => {
    expect(sameProxyCollectionConflict("proxy", "owner-1", "owner-1")).toBe(true);
  });

  test("farklı vekillerse çelişki yok", () => {
    expect(sameProxyCollectionConflict("proxy", "owner-1", "owner-2")).toBe(false);
  });

  test("kiracı ödüyorsa kural uygulanmaz", () => {
    expect(sameProxyCollectionConflict("tenant", "owner-1", "owner-1")).toBe(false);
  });

  test("kimlik eksikse kural uygulanmaz", () => {
    expect(sameProxyCollectionConflict("proxy", "", "owner-1")).toBe(false);
    expect(sameProxyCollectionConflict("proxy", "owner-1", null)).toBe(false);
    expect(sameProxyCollectionConflict(null, "owner-1", "owner-1")).toBe(false);
  });
});
