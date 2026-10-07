#!/usr/bin/env node
/**
 * Seeder: payment gateways (Xendit + Midtrans placeholders)
 *
 * Usage:
 *   npm run db:seed:payment-gateways
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "payment-gateways.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
