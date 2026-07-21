import { generateSecret, generate, verify, generateURI } from "otplib"
import QRCode from "qrcode"
import crypto from "crypto"
import bcrypt from "bcryptjs"

// Keep a small clock-drift allowance (this is a library option, not a secret).
// tolerance: 1 means the code from 30s before/after "now" is also accepted, which is
// standard practice for TOTP since the user's phone clock and the server clock
// are never perfectly in sync. (otplib v13 renamed "window" -> "tolerance", and it's
// now passed per-call instead of set globally.)
const MFA_TOLERANCE = 1

const APP_NAME = "Cartora"

/**
 * Generate a brand-new base32 TOTP secret for a user enrolling in MFA.
 * This secret must be stored ENCRYPTED (see encryption.utils.js) — never in plaintext.
 */
export const generateMfaSecret = () => generateSecret()

/**
 * Build the otpauth:// URI and render it as a QR code data URL the frontend can
 * display directly in an <img src="..."> tag for the user to scan with
 * Google Authenticator / Authy / 1Password etc.
 */
export const generateMfaQrCode = async (email, secret) => {
  const otpauthUrl = generateURI({
    issuer: APP_NAME,
    label: email,
    secret,
  })
  return QRCode.toDataURL(otpauthUrl)
}

/**
 * Verify a 6-digit code the user typed against their (decrypted) secret.
 * NOTE: this is now async (v13's verify() returns a Promise) — callers must await it.
 */
export const verifyMfaToken = async (token, secret) => {
  if (!token || !secret) return false
  try {
    const result = await verify({
      token: String(token).trim(),
      secret,
      tolerance: MFA_TOLERANCE,
    })
    return result.valid
  } catch {
    return false
  }
}

/**
 * Generate a set of one-time backup/recovery codes (shown once, plaintext, to the
 * user at enrollment) and their bcrypt hashes (what actually gets stored in Mongo).
 * If a user loses their authenticator app, a backup code lets them back in.
 */
export const generateBackupCodes = async (count = 8) => {
  const plainCodes = []
  const hashedCodes = []

  for (let i = 0; i < count; i++) {
    // Format: XXXX-XXXX, easy to read/type, hard to guess (40 bits of entropy).
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase()
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`
    plainCodes.push(formatted)
    hashedCodes.push(await bcrypt.hash(formatted, 10))
  }

  return { plainCodes, hashedCodes }
}

/**
 * Check a submitted backup code against the stored hashes. Returns the index of the
 * matching hash (so the caller can remove it — each backup code is single-use) or -1.
 */
export const matchBackupCode = async (submittedCode, hashedCodes = []) => {
  for (let i = 0; i < hashedCodes.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(submittedCode.trim(), hashedCodes[i])) {
      return i
    }
  }
  return -1
}