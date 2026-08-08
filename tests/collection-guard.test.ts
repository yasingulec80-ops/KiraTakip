import { describe, expect, test } from "bun:test";
import { sameProxyCollectionConflict } from "../src/lib/collection-guard";

describe("sameProxyCollectionConflict — ödeyen vekil ≠ tahsilatı yapan vekil", () => {
  test("aynı vekil hem ödeyen hem tahsilatı yapan → çakışma", () => {
    expect(sameProxyCollectionConflict("proxy", "owner-1", "owner-1")).toBe(
      true,
    );
  });

  test("farklı vekiller → çakışma yok", () => {
    expect(sameProxyCollectionConflict("proxy", "owner-1", "owner-2")).toBe(
      false,
    );
  });

  test("ödeyen kiracıysa vekil kuralı uygulanmaz", () => {
    expect(sameProxyCollectionConflict("tenant", "owner-1", "owner-1")).toBe(
      false,
    );
  });

  test("tahsilatı yapan boşsa çakışma yok", () => {
    expect(sameProxyCollectionConflict("proxy", "owner-1", "")).toBe(false);
    expect(sameProxyCollectionConflict("proxy", "owner-1", null)).toBe(false);
    expect(sameProxyCollectionConflict("proxy", "owner-1", undefined)).toBe(
      false,
    );
  });

  test("ödeyen vekil boşsa çakışma yok", () => {
    expect(sameProxyCollectionConflict("proxy", "", "owner-1")).toBe(false);
    expect(sameProxyCollectionConflict("proxy", null, "owner-1")).toBe(false);
    expect(sameProxyCollectionConflict("proxy", undefined, "owner-1")).toBe(
      false,
    );
  });

  test("ödeyen türü tanımsızsa çakışma yok", () => {
    expect(sameProxyCollectionConflict(undefined, "owner-1", "owner-1")).toBe(
      false,
    );
  });

  test("Id benzeri objeler string karşılaştırmasıyla eşitlenir", () => {
    const a = { toString: () => "owner-1" };
    const b = { toString: () => "owner-1" };
    expect(sameProxyCollectionConflict("proxy", a, b)).toBe(true);
  });
});
