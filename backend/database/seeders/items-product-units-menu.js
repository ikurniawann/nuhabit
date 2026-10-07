#!/usr/bin/env node
/**
 * @deprecated Use npm run db:seed:iam-menus (Unit sudah termasuk di iam-menus.sql)
 */
const { spawnSync } = require("child_process");
const path = require("path");

console.warn("Deprecated: items-product-units-menu → db:seed:iam-menus");
const result = spawnSync("npm", ["run", "db:seed:iam-menus"], {
  stdio: "inherit",
  cwd: path.join(__dirname, "..", ".."),
});
process.exit(result.status ?? 1);
