#!/usr/bin/env node
/**
 * Seeder: POS tables — 10 tables per floor (Lantai 5 & 6).
 *
 * Usage:
 *   npm run db:seed:pos-tables
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "pos-tables.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
