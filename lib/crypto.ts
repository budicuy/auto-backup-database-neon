import * as crypto from "node:crypto";

const ALGORITHM = "aes-256-cbc";

/**
 * Derives a 32-byte key from the environment variable (ENCRYPTION_KEY or BACKUP_SECRET).
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.BACKUP_SECRET;
  if (!secret) {
    throw new Error(
      "Encryption key configuration error: Please set ENCRYPTION_KEY or BACKUP_SECRET env variable",
    );
  }
  // Generate 32-byte hash to act as the AES key
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a string (e.g. database connection URL) using AES-256-CBC.
 * Returns a colon-separated string: "iv:cipherText"
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a colon-separated "iv:cipherText" string.
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted format: Expected "iv:ciphertext"');
  }

  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
