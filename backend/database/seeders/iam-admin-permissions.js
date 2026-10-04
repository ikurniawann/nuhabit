#!/usr/bin/env node
/**
 * Seeder: Super Admin & Administrator — all menus, all actions.
 *
 * Usage:
 *   npm run db:seed:iam-admin
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "iam-admin-permissions.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
