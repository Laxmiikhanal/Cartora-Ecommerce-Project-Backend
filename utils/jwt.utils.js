import jwt from "jsonwebtoken"
import crypto from "crypto"

// A lightweight device-binding signal: we hash the User-Agent string (never store it
// raw) and embed the hash as a JWT claim. On every subsequent request the `protect`
// middleware recomputes the hash from the incoming request and compares. This doesn't
// stop an attacker who clones the UA header too, but it does stop the common case of a
// stolen cookie being replayed from a different browser/tool with a different UA
// (e.g. curl, Postman, a different machine's browser) without extra work on our part.
export const hashUserAgent = (userAgent) =>
  crypto.createHash("sha256").update(userAgent || "unknown").digest("hex")

/**
 * MFA "pending" token: issued after password is verified but BEFORE the second
 * factor is checked. It is short-lived (5 min), carries a distinct `purpose` claim
 * so it can never be mistaken for (or replayed as) a real session token, and is
 * returned in the JSON body — NOT set as a cookie — since the user isn't logged in yet.
 */
export const generateMfaPendingToken = (userId) =>
  jwt.sign({ id: userId, purpose: "mfa_pending" }, process.env.JWT_SECRET, { expiresIn: "5m" })

export const verifyMfaPendingToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET)
  if (decoded.purpose !== "mfa_pending") {
    throw new Error("Invalid token purpose")
  }
  return decoded
}

// Generate JWT token and set HTTP-only cookie.
// `req` is optional so existing call sites keep working, but pass it wherever
// possible so the session gets device-bound (see hashUserAgent above).
export const generateTokenAndSetCookie = (res, userId, req = null) => {
  const uaHash = req ? hashUserAgent(req.headers["user-agent"]) : undefined

  const token = jwt.sign({ id: userId, ...(uaHash && { uaHash }) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  })

  const options = {
    expires: new Date(Date.now() + (process.env.COOKIE_EXPIRE || 7) * 24 * 60 * 60 * 1000),
    httpOnly: true, // Prevents XSS attacks
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // None for cross-site in production
    path: "/",
  }

  res.cookie("token", token, options)

  return token
}

// Clear cookie
export const clearCookie = (res) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  })
}
