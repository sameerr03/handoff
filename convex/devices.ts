import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_BYTES = 6;
const DEVICE_TOKEN_BYTES = 32;

async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createTokenValue() {
  const bytes = new Uint8Array(DEVICE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createPairingCodeValue() {
  const bytes = new Uint8Array(PAIRING_CODE_BYTES);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}

function normalizePairingCode(code: string) {
  return code.trim().toUpperCase();
}

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

async function revokeActiveDevicesForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number
) {
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(20);

  for (const device of devices) {
    if (!device.revokedAt) {
      await ctx.db.patch(device._id, { revokedAt: now });
    }
  }
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

async function deletePairingCodesForUser(ctx: MutationCtx, userId: Id<"users">) {
  const codes = await ctx.db
    .query("pairingCodes")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(50);

  for (const code of codes) {
    await ctx.db.delete(code._id);
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

export const claimPairingCode = mutation({
  args: {
    code: v.string(),
    deviceName: v.string(),
    bridgeVersion: v.optional(v.string()),
    platform: v.optional(v.string()),
    arch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const codeHash = await hashValue(normalizePairingCode(args.code));
    const pairingCode = await ctx.db
      .query("pairingCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .unique();

    if (!pairingCode || pairingCode.expiresAt <= now) {
      if (pairingCode) {
        await ctx.db.delete(pairingCode._id);
      }
      return { ok: false, error: "invalid_or_expired_code" };
    }

    const deviceToken = createTokenValue();
    const tokenHash = await hashValue(deviceToken);
    const deviceName = args.deviceName.trim() || "Mac";

    await revokeActiveDevicesForUser(ctx, pairingCode.userId, now);
    const deviceId = await ctx.db.insert("devices", {
      userId: pairingCode.userId,
      name: deviceName,
      tokenHash,
      lastSeenAt: now,
      ...(args.bridgeVersion ? { bridgeVersion: args.bridgeVersion } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.arch ? { arch: args.arch } : {}),
    });
    await deletePairingCodesForUser(ctx, pairingCode.userId);

    return { ok: true, deviceId, deviceToken };
  },
});

export const heartbeat = mutation({
  args: {
    deviceToken: v.string(),
    bridgeVersion: v.optional(v.string()),
    platform: v.optional(v.string()),
    arch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tokenHash = await hashValue(args.deviceToken);
    const device = await ctx.db
      .query("devices")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!device || device.revokedAt) {
      return { ok: false, error: "device_not_authorized" };
    }

    await ctx.db.patch(device._id, {
      lastSeenAt: Date.now(),
      ...(args.bridgeVersion ? { bridgeVersion: args.bridgeVersion } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.arch ? { arch: args.arch } : {}),
    });

    return { ok: true, deviceId: device._id };
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
