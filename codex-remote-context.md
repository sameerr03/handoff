# Codex Remote Control Context

## Goal

Build a way to view and control Codex sessions from a phone, including:

- viewing Codex threads/chat history
- continuing work started on the Mac
- starting new worktree-based Codex sessions remotely
- running selected terminal commands on the Mac from the phone

The Mac remains the execution environment. The phone is only a control surface.

## Proposed Architecture

Use a hosted mobile web app plus a local Mac bridge:

```text
Phone browser
  -> Next.js app on Vercel
  -> Convex sync/control plane
  -> Mac bridge process
  -> Codex app-server / wt / local shell
```

Convex should be the sync and control plane, not the execution plane. The Mac bridge is the only component that runs local commands or talks to Codex locally.

## Codex App-Server

Codex CLI `0.130.0` is installed and exposes:

- `codex remote-control`
- `codex app-server`
- `codex app-server generate-ts`
- `codex app-server generate-json-schema`

`codex remote-control` starts a headless, remotely controllable app-server. The generated TypeScript protocol confirms first-class APIs for:

- listing threads
- starting threads
- resuming threads
- listing turns/items
- starting turns
- command execution and approval events

The app should use Codex app-server for chat/session control instead of scraping local session files or wrapping the CLI in a PTY as the primary path.

## Mac Bridge

The "Mac daemon" means a small background process running on the laptop. It could start as a manually run process:

```sh
pnpm remote-agent
```

Later it can become a launchd service that starts on login.

Responsibilities:

- stay connected to Convex
- heartbeat device status
- start or connect to `codex remote-control`
- translate Convex requests into Codex app-server calls
- sync Codex threads, turns, messages, and approvals back to Convex
- call `wt` to create/list worktrees
- run approved shell commands locally
- enforce command/workspace policy

The Mac should not expose a public inbound port. It should make outbound connections to Convex.

## `wt` Integration

The existing `wt` utility is a zsh worktree manager. Current `wt new` is interactive:

- project selection through detection or `fzf`
- prompt entry through `gum`
- branch-name generation
- worktree provisioning
- dependency install
- foreground agent launch

For phone control, add non-interactive machine-readable commands rather than automating the TUI.

Suggested additions:

```sh
wt remote-new \
  --project finbelief \
  --base main \
  --agent codex \
  --prompt "Fix the loading skeleton issue" \
  --json
```

Expected JSON shape:

```json
{
  "project": "finbelief",
  "feature": "fix-loading-skeleton",
  "branch": "fix-loading-skeleton",
  "worktreePath": "/Users/sameer/Code/worktrees/finbelief/fix-loading-skeleton",
  "repoPath": "/Users/sameer/Code/finbelief",
  "installStatus": "ok"
}
```

Other useful commands:

```sh
wt remote-issue --project finbelief --issue 123 --base main --agent codex --json
wt remote-list --json
wt remote-resolve --project finbelief --feature fix-loading-skeleton --json
```

The remote-control app should probably live in a new repo. This `wt` repo should only gain the local CLI primitives needed by the bridge.

## Starting A New Session From Phone

Flow:

1. Phone submits a new-session request with project, base branch, prompt, and optional feature name.
2. Convex stores the request.
3. Mac bridge receives it.
4. Bridge runs `wt remote-new --json`.
5. `wt` creates the worktree and returns `worktreePath`.
6. Bridge starts a Codex app-server thread with `cwd = worktreePath`.
7. Bridge starts the first turn with the user prompt.
8. Phone streams the conversation through Convex.

No Terminal.app window is required. Codex runs headlessly through app-server.

## Continuing From Mac To Phone

Two cases:

### Session Started Through Remote App

This is the easiest case. The bridge already knows:

- worktree path
- Codex thread id
- status
- recent events/messages

The phone lists the active session and can continue it directly.

### Session Started Manually On Mac

The bridge should periodically ask Codex app-server for local thread lists and sync recent threads to Convex.

Phone flow:

1. Open app.
2. See recent local sessions.
3. Tap a session.
4. Bridge calls app-server `thread/resume`.
5. Phone reads turns/items and sends the next turn.

If the original foreground CLI process is still open, exact live-process control may be tricky. The practical flow is "resume latest thread in this cwd" from the app-server-backed remote UI.

## Auth

Use two identity layers:

```text
Phone/web user -> Clerk
Mac bridge     -> separate device credential
```

Clerk is a good fit for human auth. Use it for the Vercel/Next app and Convex user identity.

For the Mac bridge, do not store a normal browser session or broad Clerk user token on disk. Treat the bridge as a registered device.

Suggested pairing flow:

1. User signs into web app with Clerk.
2. User clicks "Pair new Mac."
3. Convex creates a short-lived pairing code.
4. On the Mac:

   ```sh
   codex-remote bridge pair ABCD-1234
   ```

5. Bridge exchanges the code for a device token.
6. Bridge stores the token locally.
7. Convex stores only a token hash.

Device token storage:

- preferred: macOS Keychain
- MVP acceptable: `~/.config/codex-remote/device.json` with `0600` permissions

Convex device model:

```text
devices
  ownerUserId
  name
  tokenHash
  createdAt
  lastSeenAt
  revokedAt
  capabilities
```

Every action must check owner and device scope:

```text
request.ownerUserId == authenticatedUser.id
request.deviceId belongs to ownerUserId
bridge only executes request.deviceId == thisDeviceId
```

## Security Requirements

This is effectively remote command execution on the Mac, so security needs to be designed in from the start.

Required safeguards:

- never expose Codex app-server directly to the internet
- no public inbound server on the Mac
- use outbound-only bridge connection to Convex
- restrict web access to the owner account
- use separate revocable device credentials
- operate only inside configured repo/worktree roots
- log every request and result
- add a local and web kill switch
- block obvious secret paths and secret-reading commands
- mirror Codex approval requests to the phone before approving actions

Avoid an MVP that is just a raw shell text box. Prefer structured actions first:

- create worktree
- start/resume Codex session
- approve/deny Codex actions
- run allowlisted commands

Command policy should distinguish:

- safe: `git status`, `git diff`, tests
- approval-required: installs, pushes, migrations
- blocked by default: destructive filesystem operations, keychain/secret access, broad home-directory commands

## Recommended Repo Split

Keep `wt` focused and create a new repo for the remote-control app.

This repo:

- add `wt remote-new --json`
- add `wt remote-issue --json`
- add `wt remote-list --json`

New repo:

- Next.js mobile app
- Convex backend
- Clerk auth
- Mac bridge process
- generated Codex app-server bindings
- command/session/device policy

## Suggested First Milestone

1. Add `wt remote-new --json`.
2. Create new Next/Convex app.
3. Add Clerk login with owner allowlist.
4. Build Mac bridge heartbeat to Convex.
5. Add manual device token pairing.
6. Phone creates a session request.
7. Bridge runs `wt remote-new`.
8. Bridge starts a Codex app-server thread in the new worktree.
9. Phone streams the Codex conversation.

