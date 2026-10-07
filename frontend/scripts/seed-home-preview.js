#!/usr/bin/env node

// Local preview content only. Existing stories and gallery photos are left alone.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { assertLocalTarget } = require("../../backend/database/scripts/pg-utils");

function localDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const raw = file.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
  if (!raw) throw new Error("DATABASE_URL is missing from frontend/.env.local");
  return raw.replace(/^["']|["']$/g, "");
}

async function main() {
  const url = localDatabaseUrl();
  assertLocalTarget(url, "DATABASE_URL");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query("SELECT value FROM site.content WHERE key = 'home'");
    const value = result.rows[0]?.value ?? {};
    const added = [];
    if (!Array.isArray(value.stories) || value.stories.length === 0) {
      value.stories = [{
        name: "Example member",
        role: "Sample story",
        quote: "I learned each station at my own pace, then felt ready to join my first race simulation.",
        outcome: "Illustrative progress story",
        image_url: "",
      }];
      added.push("story");
    }
    if (!Array.isArray(value.reel) || value.reel.length === 0) {
      value.reel = [
        { image_url: "/site/sample/training-session.webp", caption: "Sample photo: functional training session (AI-generated)." },
        { image_url: "/site/sample/community-after-class.webp", caption: "Sample photo: community after class (AI-generated)." },
      ];
      added.push("gallery");
    }
    if (added.length > 0) {
      await client.query(
        `INSERT INTO site.content (key, value) VALUES ('home', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(value)]
      );
    }
    console.log(added.length > 0 ? `Added local home ${added.join(" and ")} samples.` : "Home already has stories and gallery content; nothing changed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
