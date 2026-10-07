/**
 * Shared PostgreSQL connection helpers for database scripts.
 */

function parseHost(url) {
  try {
    const normalized = url.replace(/^postgresql:/i, "http:");
    return new URL(normalized).hostname;
  } catch {
    return "";
  }
}

function isLocalDatabaseUrl(url) {
  const host = parseHost(url);
  return host === "localhost" || host === "127.0.0.1";
}

/** SSL for remote/managed Postgres; local installs usually skip SSL. */
function sslForUrl(url) {
  if (/sslmode=require/i.test(url)) return { rejectUnauthorized: false };
  if (!isLocalDatabaseUrl(url)) return { rejectUnauthorized: false };
  return false;
}

/** Guard: migration apply / seeders must target local Postgres only. */
function assertLocalTarget(url, envName = "MIGRATE_DATABASE_URL") {
  if (!isLocalDatabaseUrl(url)) {
    throw new Error(
      `REFUSED: ${envName} harus mengarah ke Postgres lokal (localhost/127.0.0.1), bukan database remote/production.`
    );
  }
}

/** Introspection / one-time data copy source. */
function sourceDatabaseUrl() {
  return process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL || "";
}

module.exports = {
  parseHost,
  isLocalDatabaseUrl,
  sslForUrl,
  assertLocalTarget,
  sourceDatabaseUrl,
};
