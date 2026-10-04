#!/usr/bin/env node
/**
 * Seeder: canonical IAM menu tree.
 *
 * Usage:
 *   npm run db:seed:iam-menus
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "iam-menus.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
