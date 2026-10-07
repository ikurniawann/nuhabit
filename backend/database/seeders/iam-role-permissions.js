#!/usr/bin/env node
/**
 * Seeder: operational IAM role menu permissions.
 *
 * Usage:
 *   npm run db:seed:iam-roles
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "iam-role-permissions.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
