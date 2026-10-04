#!/usr/bin/env node
/**
 * Seeder: POS loyalty settings (ARK + XP)
 *
 * Usage:
 *   npm run db:seed:pos-loyalty-settings
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "pos-loyalty-settings.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
