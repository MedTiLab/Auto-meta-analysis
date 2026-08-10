import crypto from 'crypto';

const CIPHER_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

function getSecretMaterial() {
  return process.env.MEDHELP_SECRET_KEY
    || process.env.MEDAUTODATA_SECRET_KEY
    || process.env.JWT_SECRET
    || 'medautodata-local-dev-secret-change-in-production';
}

function getCipherKey() {
  return crypto.createHash('sha256').update(String(getSecretMaterial())).digest();
}

export function encryptSecret(value) {
  const plaintext = String(value || '');
  if (!plaintext) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getCipherKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload) {
  const text = String(payload || '');
  if (!text) return null;

  const [version, ivText, tagText, ciphertextText] = text.split(':');
  if (version !== CIPHER_VERSION || !ivText || !tagText || !ciphertextText) {
    return null;
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getCipherKey(),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function getSecretLast4(value) {
  const text = String(value || '').trim();
  return text ? text.slice(-4) : null;
}
