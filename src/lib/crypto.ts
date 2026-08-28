import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Symmetric encryption for secrets we must store *reversibly* (the RCON
// password needs to be readable to open an RCON connection) rather than
// hashed. Key is derived from APP_SECRET so there's one secret to manage
// for both session cookies (iron-session) and this.

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("APP_SECRET must be set to a strong random value (see .env.example)");
  }
  return createHash("sha256").update(secret).digest(); // 32 bytes, fits AES-256
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12); // GCM standard IV size
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decrypt(stored: string): string {
  if (!stored) return "";
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
