import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createPairingCodeValue() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

async function deleteExpiredPairingCodesForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number
) {
  const codes = await ctx.db
    .query("pairingCodes")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(20);

  for (const code of codes) {
    if (code.expiresAt <= now) {
      await ctx.db.delete(code._id);
    }
  }
}

export const createPairingCode = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;

    const now = Date.now();
    await deleteExpiredPairingCodesForUser(ctx, user._id, now);

    const code = createPairingCodeValue();
    const codeHash = await hashValue(code);
    const expiresAt = now + PAIRING_CODE_TTL_MS;

    await ctx.db.insert("pairingCodes", {
      userId: user._id,
      codeHash,
      expiresAt,
    });

    return { code, expiresAt };
  },
});

export const listMyDevices = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("devices")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
  },
});

export const revokeDevice = mutation({
  args: {
    deviceId: v.id("devices"),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return false;

    const device = await ctx.db.get(args.deviceId);
    if (!device || device.userId !== user._id) return false;
    if (device.revokedAt) return true;

    await ctx.db.patch(args.deviceId, { revokedAt: Date.now() });
    return true;
  },
});
