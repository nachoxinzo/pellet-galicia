import crypto from "crypto";

const PREFIX = "v1:";

function getMasterKey(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "DATA_ENCRYPTION_KEY no está configurada o no tiene 64 caracteres hex (32 bytes)."
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Cifra un texto sensible en servidor con AES-256-GCM (IV aleatorio de 12 bytes).
 * Si el texto está vacío, retorna "".
 */
export function encryptField(plaintext?: string | null): string {
  if (!plaintext) return "";
  const clean = String(plaintext);
  if (clean.length === 0) return "";

  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(clean, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Descifra un valor generado por encryptField.
 */
export function decryptField(encoded?: string | null): string {
  if (!encoded) return "";
  if (!encoded.startsWith(PREFIX)) {
    return "";
  }

  const parts = encoded.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return "";

  try {
    const [ivB64, tagB64, dataB64] = parts;
    const key = getMasterKey();
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("Error descifrando campo AES-256-GCM:", err);
    return "[Dato cifrado ilegible]";
  }
}

/**
 * Genera un HMAC-SHA256 determinista sobre los dígitos normalizados del teléfono
 * para deduplicación segura sin almacenar el teléfono en texto claro.
 */
export function hashPhoneForLookup(phone?: string | null): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 6) return "";

  const master = getMasterKey();
  const subKey = crypto
    .createHash("sha256")
    .update("satruta-phone-lookup:")
    .update(master)
    .digest();

  return crypto.createHmac("sha256", subKey).update(digits).digest("hex");
}
