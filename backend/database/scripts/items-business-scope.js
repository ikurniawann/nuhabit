const HOLDING_CODE = process.env.SEED_HOLDING_CODE || "PROLOGE";
const COMPANY_CODE = process.env.SEED_COMPANY_CODE || "SULU";
const BRANCH_CODE = process.env.SEED_BRANCH_CODE || "SULU-DAGO";
const BRANCH_NAME = process.env.SEED_BRANCH_NAME || "Dago";

async function resolveSeedBusinessScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id,
            c.id AS company_id,
            b.id AS branch_id,
            h.name AS holding_name,
            c.name AS company_name,
            b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c
       ON c.holding_id = h.id AND c.code = $2
     JOIN configuration.branches b
       ON b.company_id = c.id AND b.code = $3
     WHERE h.code = $1
       AND c.is_active = true
       AND b.is_active = true
     LIMIT 1`,
    [HOLDING_CODE, COMPANY_CODE, BRANCH_CODE]
  );

  if (rows[0]) return rows[0];

  // Default kode di atas berasal dari tenant lama (Sulu). Pada deploy yang hanya
  // berisi SATU bisnis aktif, memaksa pengguna menebak kode lewat env hanya jadi
  // penghalang — jadi dipakai otomatis. Bila ada lebih dari satu, tetap gagal
  // supaya tidak pernah salah menulis ke tenant yang keliru.
  const { rows: only } = await client.query(
    `SELECT h.id AS holding_id,
            c.id AS company_id,
            b.id AS branch_id,
            h.name AS holding_name,
            c.name AS company_name,
            b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c ON c.holding_id = h.id
     JOIN configuration.branches b ON b.company_id = c.id
     WHERE c.is_active = true AND b.is_active = true
     LIMIT 2`
  );

  if (only.length === 1) {
    console.log(
      `[seed-scope] Kode default (${HOLDING_CODE}/${COMPANY_CODE}/${BRANCH_CODE}) tidak ada. ` +
        `Memakai satu-satunya bisnis aktif: ${only[0].company_name} — ${only[0].branch_name}.`
    );
    return only[0];
  }

  throw new Error(
    `Seed scope tidak ditemukan (${HOLDING_CODE} / ${COMPANY_CODE} / ${BRANCH_CODE}).` +
      (only.length > 1
        ? " Ada lebih dari satu bisnis aktif — tentukan lewat SEED_HOLDING_CODE / SEED_COMPANY_CODE / SEED_BRANCH_CODE."
        : " Jalankan seeder business hierarchy dulu.")
  );
}

module.exports = {
  HOLDING_CODE,
  COMPANY_CODE,
  BRANCH_CODE,
  BRANCH_NAME,
  resolveSeedBusinessScope,
};
