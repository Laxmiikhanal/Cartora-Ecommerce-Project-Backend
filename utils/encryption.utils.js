import crypto from "crypto"

/**
 * Field-level encryption for sensitive PII (e.g. phone numbers) using AES-256-CBC.
 *
 * The key MUST be 32 bytes (256 bits) and MUST come from the environment in
 * production. The development fallback below exists only so the app can boot
 * locally without configuration; it is intentionally rejected in production.
 */
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev_only_insecure_32byte_key_0001" // 32 chars
const IV_LENGTH = 16

// Fail fast in production rather than encrypting real data with a weak/missing key.
if (process.env.NODE_ENV === "production") {
  if (!process.env.ENCRYPTION_KEY || Buffer.byteLength(process.env.ENCRYPTION_KEY, "utf8") !== 32) {
    throw new Error("ENCRYPTION_KEY must be set to a 32-byte value in production")
  }
}

export const encrypt = (text) => {
  if (!text) return text

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return iv.toString("hex") + ":" + encrypted.toString("hex")
}

export const decrypt = (text) => {
  if (!text) return text

  const textParts = text.split(":")
  if (textParts.length !== 2) return text // Not in encrypted format

  try {
    const iv = Buffer.from(textParts[0], "hex")
    const encryptedText = Buffer.from(textParts[1], "hex")
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString()
  } catch (error) {
    console.error("Decryption failed:", error.message)
    return text
  }
}
