#!/usr/bin/env node

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const BRIDGE_VERSION = "0.0.1";
const HEARTBEAT_INTERVAL_MS = 15_000;
const CONFIG_DIR = path.join(os.homedir(), ".handoff");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

function usage() {
  console.log(`Usage:
  handoff bridge pair <code>
  handoff bridge run
  handoff bridge status

Environment:
  HANDOFF_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL must point at the Handoff Convex deployment.`);
}

function convexUrl(config = null) {
  const url = process.env.HANDOFF_CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? config?.convexUrl;
  if (!url) {
    throw new Error("Set HANDOFF_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL before running handoff.");
  }
  return url;
}

function bridgeMetadata() {
  return {
    bridgeVersion: BRIDGE_VERSION,
    platform: os.platform(),
    arch: os.arch(),
  };
}

async function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

async function writeConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

function client(config = null) {
  return new ConvexHttpClient(convexUrl(config));
}

async function pair(code) {
  if (!code) {
    throw new Error("Missing pairing code.");
  }

  const result = await client().mutation(api.devices.claimPairingCode, {
    code,
    deviceName: os.hostname() || "Mac",
    ...bridgeMetadata(),
  });

  if (!result.ok) {
    throw new Error(`Pairing failed: ${result.error}`);
  }

  await writeConfig({
    convexUrl: convexUrl(),
    deviceId: result.deviceId,
    deviceToken: result.deviceToken,
    pairedAt: Date.now(),
  });

  console.log(`Paired ${os.hostname() || "Mac"} with Handoff.`);
}

async function heartbeat() {
  const config = await readConfig();
  if (!config?.deviceToken) {
    throw new Error("No paired device token found. Run `handoff bridge pair <code>` first.");
  }

  const result = await client(config).mutation(api.devices.heartbeat, {
    deviceToken: config.deviceToken,
    ...bridgeMetadata(),
  });

  if (!result.ok) {
    throw new Error(`Heartbeat failed: ${result.error}`);
  }

  return result;
}

async function run() {
  await heartbeat();
  console.log("Handoff bridge running. Press Ctrl-C to stop.");

  const timer = setInterval(() => {
    heartbeat().catch((error) => {
      console.error(error.message);
    });
  }, HEARTBEAT_INTERVAL_MS);

  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\nHandoff bridge stopped.");
    process.exit(0);
  });
}

async function status() {
  const config = await readConfig();
  if (!config?.deviceToken) {
    console.log("Not paired.");
    return;
  }

  await heartbeat();
  console.log(`Paired device: ${config.deviceId}`);
  console.log(`Config: ${CONFIG_PATH}`);
}

async function main() {
  const [, , command, subcommand, value] = process.argv;

  if (command !== "bridge") {
    usage();
    process.exitCode = command ? 1 : 0;
    return;
  }

  if (subcommand === "pair") {
    await pair(value);
    return;
  }

  if (subcommand === "run") {
    await run();
    return;
  }

  if (subcommand === "status") {
    await status();
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
