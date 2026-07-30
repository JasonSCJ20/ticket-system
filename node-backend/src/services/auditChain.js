import crypto from 'crypto';

// Canonical payload a hash is computed over — every field that actually
// identifies "what happened", plus the previous row's own hash. Deliberately
// excluded: `id` (DB-assigned, irrelevant to content integrity), the hash
// column itself (can't include itself), and `createdAt` — Sequelize's own
// timestamp management can re-round-trip that value with slightly different
// precision between insert time and a later re-fetch, which would produce
// false-positive tamper detection on an untouched row. Row ORDER is already
// guaranteed by `id` + the prevHash chain itself, so the exact creation
// instant isn't needed for integrity, only for display.
// `?? null` on every optional field matters: at hash-computation time
// (beforeCreate, before the row is ever persisted) an unset optional field
// is `undefined`, which JSON.stringify simply omits from the output — but
// once the row round-trips through the database and comes back via a later
// findAll(), Sequelize reflects the real column value, `null`. Without this
// normalization, `{}` (undefined omitted) and `{"details":null}` hash
// differently for what is otherwise the exact same, untouched row.
function canonicalPayload(row, prevHash) {
  return JSON.stringify({
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    actor: row.actor ?? null,
    actorRole: row.actorRole ?? null,
    action: row.action ?? null,
    ipAddress: row.ipAddress ?? null,
    details: row.details ?? null,
    prevHash,
  });
}

export function computeAuditHash(row, prevHash) {
  return crypto.createHash('sha256').update(canonicalPayload(row, prevHash)).digest('hex');
}

// Walks the entire audit log in insertion order and confirms every row's
// stored hash still matches what its content + the previous row's hash
// would produce today. A single UPDATE anywhere in the table — or a DELETE
// of anything other than the very last row — breaks the chain from that
// point forward and is reported as the first row where it broke.
//
// Known limitation, same as any hash chain (including a blockchain):
// deleting the CURRENT LAST row leaves nothing after it to contradict, so
// that specific case isn't detectable by this function alone. Closing that
// gap needs an independent record of the expected latest hash/count kept
// somewhere the same actor can't also alter (e.g. periodically exporting
// the latest hash off-box) — not built yet, tracked as a follow-up.
export async function verifyAuditChain(AuditLog) {
  const rows = await AuditLog.findAll({ order: [['id', 'ASC']] });
  let prevHash = null;
  for (const row of rows) {
    const expected = computeAuditHash(row, prevHash);
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return { valid: false, brokenAtId: row.id, totalChecked: rows.length };
    }
    prevHash = row.hash;
  }
  return { valid: true, brokenAtId: null, totalChecked: rows.length };
}
