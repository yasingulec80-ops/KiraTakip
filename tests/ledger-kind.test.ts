import { describe, expect, test } from "bun:test";
import { entryBase, transferCategory, transferIsDeposit } from "../src/lib/ledger-kind";

describe("transferIsDeposit / transferCategory", () => {
  test("depozito tahsilatı ve devri depozito sayılır", () => {
    expect(transferIsDeposit("Vekil tahsilatı — depozito")).toBe(true);
    expect(transferIsDeposit("Vekil devri — depozito teslimi")).toBe(true);
    expect(transferIsDeposit("Vekil devri — depozito iadesi")).toBe(true);
  });

  test("kira kayıtları kira sayılır", () => {
    expect(transferIsDeposit("Vekil tahsilatı — kira")).toBe(false);
    expect(transferIsDeposit("Vekil devri — tahsilat teslimi")).toBe(false);
  });

  test("not alanındaki 'depozito' sözcüğü sınıflandırmayı bozamaz", () => {
    // Ayrım yalnızca ilk \" · \" ayracından önceki gövdeye bakar.
    expect(transferIsDeposit("Vekil devri — tahsilat teslimi · depozito notta geçer")).toBe(false);
    expect(transferIsDeposit("Vekil devri — depozito teslimi · kira notta geçer")).toBe(true);
  });

  test("entryBase not bölümünü ayırır; transferCategory eşleşir", () => {
    expect(entryBase("Vekil tahsilatı — kira · ay 3")).toBe("Vekil tahsilatı — kira");
    expect(transferCategory("Vekil devri — depozito teslimi")).toBe("deposit");
    expect(transferCategory("Vekil devri — tahsilat teslimi")).toBe("rent");
  });
});
