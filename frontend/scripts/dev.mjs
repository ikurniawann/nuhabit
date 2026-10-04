#!/usr/bin/env node
/**
 * Dev entry: if DATABASE_URL uses port 15432, start cloudflared TCP tunnel
 * alongside Next + NFC bridge (same lifecycle as `pnpm dev` / Ctrl+C).
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_TUNNEL_PORT = 15432;
const DEFAULT_CF_HOSTNAME = "pg.within.ventures";
const DEFAULT_CF_URL = `localhost:${DEV_TUNNEL_PORT}`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(filePath, target) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    target[key] = value;
  }
}

function loadEnv() {
  const env = { ...process.env };
  // Next order: .env then .env.local (local overrides)
  loadEnvFile(path.join(root, ".env"), env);
  loadEnvFile(path.join(root, ".env.local"), env);
  return env;
}

function getDatabasePort(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const normalized = databaseUrl
      .replace(/^postgresql:/i, "http:")
      .replace(/^postgres:/i, "http:");
    const u = new URL(normalized);
    if (u.port) return Number(u.port);
    return 5432;
  } catch {
    return null;
  }
}

function hasCloudflared() {
  const result = spawnSync("cloudflared", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function isPortListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function runConcurrently(args, env) {
  const concurrentlyBin = path.join(root, "node_modules", ".bin", "concurrently");
  const child = spawn(concurrentlyBin, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

async function main() {
  const env = loadEnv();
  const databaseUrl = env.DATABASE_URL || "";
  const port = getDatabasePort(databaseUrl);
  const needTunnel = port === DEV_TUNNEL_PORT;

  if (needTunnel) {
    console.log(`DB target: dev tunnel (${DEV_TUNNEL_PORT})`);

    if (!hasCloudflared()) {
      console.error(
        "ERROR: cloudflared tidak ditemukan di PATH. Install cloudflared lalu login Cloudflare Access."
      );
      process.exit(1);
    }

    if (await isPortListening(DEV_TUNNEL_PORT)) {
      console.error(
        `ERROR: Port ${DEV_TUNNEL_PORT} sudah dipakai. Kill proses cloudflared/orphan yang menahan port itu, lalu jalankan ulang \`pnpm dev\`.`
      );
      process.exit(1);
    }

    const hostname = env.CLOUDFLARED_TCP_HOSTNAME || DEFAULT_CF_HOSTNAME;
    const url = env.CLOUDFLARED_TCP_URL || DEFAULT_CF_URL;
    const cfCmd = `cloudflared access tcp --hostname ${hostname} --url ${url}`;

    runConcurrently(
      [
        "-n",
        "next,nfc,cf",
        "-c",
        "cyan,magenta,yellow",
        "npm run dev:next",
        "npm run pos:nfc-bridge",
        cfCmd,
      ],
      env
    );
    return;
  }

  console.log(`DB target: local (${port ?? "unknown"})`);
  runConcurrently(
    [
      "-n",
      "next,nfc",
      "-c",
      "cyan,magenta",
      "npm run dev:next",
      "npm run pos:nfc-bridge",
    ],
    env
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
