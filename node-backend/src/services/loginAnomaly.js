const MAX_KNOWN_GEOS = 20;

// Pure decision logic for "is this login from an unfamiliar location?" —
// separated from the DB/Telegram side effects in app.js's
// flagUnfamiliarLogin so it can be tested without a real geo lookup, DB, or
// Telegram call. Compared by city/country string (not raw IP) since a home
// ISP reassigning a dynamic IP within the same city shouldn't false-alarm
// on every login. The very first login ever just establishes the baseline
// rather than flagging (nothing to compare against yet), and a null/private
// geo (internal network, or a failed lookup) is never flagged.
export function evaluateLoginGeo(knownGeos, newGeo) {
  const known = Array.isArray(knownGeos) ? knownGeos : [];

  if (!newGeo || newGeo === 'Local / Private') {
    return { isUnfamiliar: false, updatedKnownGeos: known };
  }

  const isFirstLogin = known.length === 0;
  const isKnown = known.includes(newGeo);
  const updatedKnownGeos = isKnown ? known : [newGeo, ...known].slice(0, MAX_KNOWN_GEOS);

  return { isUnfamiliar: !isKnown && !isFirstLogin, updatedKnownGeos };
}
