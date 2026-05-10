import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.string(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  pairingCodes: defineTable({
    userId: v.id("users"),
    codeHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_userId", ["userId"]),

  devices: defineTable({
    userId: v.id("users"),
    name: v.string(),
    tokenHash: v.string(),
    bridgeVersion: v.optional(v.string()),
    platform: v.optional(v.string()),
    arch: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_tokenHash", ["tokenHash"]),
});
