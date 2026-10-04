#!/usr/bin/env node
/**
 * Seeder: data demo ringkas self-order meja BCD (EPIC-048) —
 * 4 kategori, 8 produk ber-varian/XP/station dgn foto public/products, 2 member demo.
 * Idempotent; meja tidak disentuh. Detail di bcdcoffee-self-order-demo.sql.
 *
 * Usage:
 *   npm run db:seed:bcdcoffee-self-order
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "bcdcoffee-self-order-demo.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
