<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Project Rules

- Do not add `createdAt` fields to Convex tables unless there is a specific product reason. Convex automatically provides `_creationTime` on every document.
- Never start local dev servers. The user will always run dev servers themselves.
