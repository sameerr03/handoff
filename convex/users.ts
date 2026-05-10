import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

async function userFieldsFromIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email ?? "",
    name: identity.name ?? identity.email ?? "Anonymous",
  };
}

async function getUserByTokenIdentifier(ctx: QueryCtx | MutationCtx, tokenIdentifier: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

async function ensureUser(ctx: MutationCtx) {
  const fields = await userFieldsFromIdentity(ctx);
  if (!fields) return null;

  const existing = await getUserByTokenIdentifier(ctx, fields.tokenIdentifier);
  if (existing) {
    if (existing.email !== fields.email || existing.name !== fields.name) {
      await ctx.db.patch(existing._id, {
        email: fields.email,
        name: fields.name,
      });
      return await ctx.db.get(existing._id);
    }
    return existing;
  }

  const userId = await ctx.db.insert("users", fields);
  return await ctx.db.get(userId);
}

export const getOrCreateCurrentUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ensureUser(ctx);
  },
});

export const ensureViewer = mutation({
  args: {},
  handler: async (ctx) => {
    return await ensureUser(ctx);
  },
});

export const getViewer = query({
  args: {},
  handler: async (ctx) => {
    const fields = await userFieldsFromIdentity(ctx);
    if (!fields) return null;
    return await getUserByTokenIdentifier(ctx, fields.tokenIdentifier);
  },
});
