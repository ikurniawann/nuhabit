/**
 * Password akun hasil seeder. Repo tidak menyimpan password default: bila env
 * belum diset, seeder membuat password acak lalu mencetaknya SEKALI ke stdout.
 * Simpan saat itu juga; menjalankan seeder lagi tanpa env akan mengganti
 * password akun tersebut dengan nilai acak baru.
 */
const crypto = require("crypto");
const { isLocalDatabaseUrl } = require("../../scripts/pg-utils");

function seedPassword(envName) {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const generated = crypto.randomBytes(12).toString("base64url");
  console.log(`${envName} belum diset. Password acak (hanya dicetak sekali): ${generated}`);
  return generated;
}

/** Keterangan asal password untuk ringkasan akhir, tanpa mencetak ulang nilainya. */
function passwordSource(envName) {
  return process.env[envName] ? `dari ${envName}` : "acak, lihat di atas";
}

/**
 * Tolak database remote kecuali operator menyatakannya lewat --allow-remote
 * atau ALLOW_REMOTE_DB=1 (pola yang sama dengan seeder reset-*).
 */
function assertLocalOrAllowed(url) {
  const allowRemote = process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_DB === "1";
  if (isLocalDatabaseUrl(url) || allowRemote) return;
  throw new Error(
    "REFUSED: target database bukan localhost/127.0.0.1. Tambahkan --allow-remote atau ALLOW_REMOTE_DB=1 bila memang disengaja."
  );
}

module.exports = { seedPassword, passwordSource, assertLocalOrAllowed };
