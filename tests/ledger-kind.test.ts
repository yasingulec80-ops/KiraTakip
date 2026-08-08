import { describe, expect, test } from "bun:test";
import {
  entryBase,
  transferCategory,
  transferIsDeposit,
} from "../src/lib/ledger-kind";

describe("transferIsDeposit — kira/depozito sınıflandırması", () => {
  test("kira tahsilatı kira olarak sınıflandırılır", () => {
    expect(transferIsDeposit("Vekil tahsilatı — kira")).toBe(false);
  });

  test("depozito tahsilatı depozito olarak sınıflandırılır", () => {
    expect(transferIsDeposit("Vekil tahsilatı — depozito")).toBe(true);
  });

  test("kira devri kira olarak sınıflandırılır", () => {
    expect(transferIsDeposit("Vekil devri — tahsilat teslimi")).toBe(false);
  });

  test("depozito devri depozito olarak sınıflandırılır", () => {
    expect(transferIsDeposit("Vekil devri — depozito teslimi")).toBe(true);
  });

  test("depozito iadesi devri depozito olarak sınıflandırılır", () => {
    expect(transferIsDeposit("Vekil devri — depozito iadesi")).toBe(true);
  });

  test("not alanındaki 'depozito' kira devrini yanlış sınıflandırmaz (regresyon)", () => {
    // devir kayıtlarında kullanıcı notu " · " ayracından sonra açıklamaya eklenir.
    expect(
      transferIsDeposit("Vekil devri — tahsilat teslimi · depozito ödendi"),
    ).toBe(false);
    expect(
      transferIsDeposit("Vekil devri — tahsilat teslimi · Depozito teslim edildi"),
    ).toBe(false);
    expect(
      transferIsDeposit(
        "Vekil devri — tahsilat teslimi · bu not depozitoyla ilgili değil",
      ),
    ).toBe(false);
  });

  test("not alanı depozito devrini kira olarak sınıflandırmaz", () => {
    expect(
      transferIsDeposit("Vekil devri — depozito teslimi · kira temsilcisi"),
    ).toBe(true);
  });

  test("içerik dışı açıklamalar kira varsayılır", () => {
    expect(transferIsDeposit("Kira tahakkuku — 2026-08")).toBe(false);
    expect(transferIsDeposit("Depozito iadesi")).toBe(true);
  });
});

describe("transferCategory", () => {
  test("türü döndürür", () => {
    expect(transferCategory("Vekil tahsilatı — kira")).toBe("rent");
    expect(transferCategory("Vekil devri — depozito iadesi · not")).toBe("deposit");
  });
});

describe("entryBase", () => {
  test("not ayracından önceki gövdeyi döndürür", () => {
    expect(entryBase("Vekil devri — tahsilat teslimi · not kısmı")).toBe(
      "Vekil devri — tahsilat teslimi",
    );
    expect(entryBase("Vekil devri — depozito teslimi")).toBe(
      "Vekil devri — depozito teslimi",
    );
  });
});
