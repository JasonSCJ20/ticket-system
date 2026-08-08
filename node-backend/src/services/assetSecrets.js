import crypto from 'crypto';
import { CONFIG } from '../config.js';

// Client-granted edge credentials (e.g. a Cloudflare API token) are a third
// party's infrastructure secret, not CommandCentre's own — a meaningfully
// higher bar than the JWT SECRET_KEY, so this gets its own dedicated key and
// reversible AES-256-GCM encryption (unlike agent keys, which are only ever
// hashed since we never need the plaintext back after issuing them).
const ALGORITHM = 'aes-256-gcm';
// Node defaults to a 16-byte (128-bit) GCM auth tag when this is omitted —
// already the maximum/most secure length — but making it explicit rather
// than implicit is what real static analysis (Semgrep's gcm-no-tag-length
// rule) actually checks for, since an implicit default can't be verified
// without knowing the runtime's exact behavior.
const GCM_OPTIONS = { authTagLength: 16 };

function getEncryptionKey() {
  const raw = CONFIG.ASSET_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error('ASSET_CREDENTIAL_ENCRYPTION_KEY must be set to a 32+ byte value to store client credentials.');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptAssetCredential(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, GCM_OPTIONS);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptAssetCredential(blob) {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, ciphertextB64] = String(blob).split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error('Malformed credential blob.');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'), GCM_OPTIONS);
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

// Agent keys: one-way, like a password. Generate a random key at issuance
// time (shown once to the operator), store only its hash, and compare hashes
// on every request the agent makes.
export function generateAgentKey() {
  return `cca_${crypto.randomBytes(24).toString('base64url')}`;
}

export function hashAgentKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

export function verifyAgentKey(presentedKey, storedHash) {
  if (!presentedKey || !storedHash) return false;
  const presentedHash = hashAgentKey(presentedKey);
  const a = Buffer.from(presentedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
