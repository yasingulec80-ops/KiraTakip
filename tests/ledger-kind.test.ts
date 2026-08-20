import { describe, expect, it } from "bun:test";
import {
  entryBase,
  transferIsDeposit,
  transferCategory,
} from "../src/lib/ledger-kind";

describe("entryBase", () => {
  it("returns full string when no note separator", () => {
    expect(entryBase("Vekil tahsilatı — kira")).toBe("Vekil tahsilatı — kira");
  });

  it("strips note after · separator", () => {
    expect(entryBase("Vekil devri — tahsilat teslimi · notum")).toBe(
      "Vekil devri — tahsilat teslimi",
    );
  });

  it("trims whitespace", () => {
    expect(entryBase("  Kira devri  · extra ")).toBe("Kira devri");
  });
});

describe("transferIsDeposit", () => {
  it("detects deposit collection", () => {
    expect(transferIsDeposit("Vekil tahsilatı — depozito")).toBe(true);
  });

  it("detects rent collection", () => {
    expect(transferIsDeposit("Vekil tahsilatı — kira")).toBe(false);
  });

  it("detects deposit transfer", () => {
    expect(transferIsDeposit("Vekil devri — depozito teslimi")).toBe(true);
  });

  it("detects rent transfer", () => {
    expect(transferIsDeposit("Vekil devri — tahsilat teslimi")).toBe(false);
  });

  it("ignores note content for classification", () => {
    expect(transferIsDeposit("Vekil devri — tahsilat teslimi · depozito iade")).toBe(false);
  });

  it("case-insensitive", () => {
    expect(transferIsDeposit("Vekil Tahsilatı — Depozito")).toBe(true);
  });

  it("deposit return transfer", () => {
    expect(transferIsDeposit("Vekil devri — depozito iadesi")).toBe(true);
  });
});

describe("transferCategory", () => {
  it("returns deposit for deposit descriptions", () => {
    expect(transferCategory("Vekil tahsilatı — depozito")).toBe("deposit");
  });

  it("returns rent for rent descriptions", () => {
    expect(transferCategory("Vekil tahsilatı — kira")).toBe("rent");
  });
});
