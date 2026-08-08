import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ROLES, type LedgerKind, type LedgerPersonType } from "./schema";

type Ctx = QueryCtx | MutationCtx;

/** Resolve the acting user, or throw when not signed in. */
export const requireActor = async (ctx: Ctx): Promise<Doc<"users">> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("Giriş yapmalısınız.");
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Giriş yapmalısınız.");
  return user;
};

/** Resolve the acting user, or null when not signed in. */
export const getActor = async (ctx: Ctx): Promise<Doc<"users"> | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
};

/** Property ids the user may access; null means admin (all). */
export const getAuthorizedPropertyIds = async (
  ctx: Ctx,
  user: Doc<"users">,
): Promise<Set<string> | null> => {
  if (user.role === ROLES.ADMIN) return null;
  return new Set((user.authorizedPropertyIds ?? []).map((id) => id.toString()));
};

/** Throw unless the user may access the given property. */
export const requirePropertyAccess = async (
  ctx: Ctx,
  user: Doc<"users">,
  propertyId: Id<"properties">,
) => {
  if (user.role === ROLES.ADMIN) return;
  const authorized = new Set(
    (user.authorizedPropertyIds ?? []).map((id) => id.toString()),
  );
  if (!authorized.has(propertyId.toString())) {
    throw new ConvexError("Bu gayrimenkule erişim yetkiniz yok.");
  }
};

export interface LedgerPost {
  personType: LedgerPersonType;
  personId: Id<"owners"> | Id<"tenants">;
  ownerId?: Id<"owners">;
  kind: LedgerKind;
  amount: number; // pozitif = alacak, negatif = borç
  description: string;
  date: number;
  referenceId?: string;
}

/** Insert a single ledger entry for a person. */
export const postLedgerEntry = async (
  ctx: MutationCtx,
  actor: Doc<"users"> | null,
  entry: LedgerPost & {
    propertyId?: Id<"properties">;
    contractId?: Id<"contracts">;
  },
) => {
  await ctx.db.insert("ledgerEntries", {
    propertyId: entry.propertyId,
    contractId: entry.contractId,
    personType: entry.personType,
    personId: entry.personId,
    ownerId: entry.ownerId,
    kind: entry.kind,
    amount: entry.amount,
    description: entry.description,
    date: entry.date,
    referenceId: entry.referenceId,
    createdBy: actor?._id,
  });
};

/** Remove ledger entries created for a source record (by referenceId). */
export const deleteLedgerForReference = async (
  ctx: MutationCtx,
  referenceId: string,
) => {
  const entries = await ctx.db
    .query("ledgerEntries")
    .filter((q) => q.eq(q.field("referenceId"), referenceId))
    .collect();
  for (const entry of entries) {
    await ctx.db.delete(entry._id);
  }
};

/** Tenant name helper used in ledger descriptions. */
export const personLabel = (personType: LedgerPersonType): string => {
  switch (personType) {
    case "owner":
      return "Malik";
    case "tenant":
      return "Kiracı";
    case "proxy":
      return "Vekil";
  }
};
