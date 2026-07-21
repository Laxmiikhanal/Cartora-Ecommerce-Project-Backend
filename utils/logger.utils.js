import ActivityLog from "../models/activityLog.model.js"

/**
 * Record an activity log entry.
 *
 * Deliberately fire-and-forget with try/catch: logging must never break the
 * primary request flow. If Mongo is briefly unavailable, we log to console
 * and move on rather than failing the user's login/checkout/etc.
 */
export const logActivity = async ({ req, user = null, email = null, action, status = "INFO", details = {} }) => {
  try {
    await ActivityLog.create({
      user: user || null,
      email: email || null,
      action,
      status,
      ip: req?.ip || req?.headers?.["x-forwarded-for"] || "unknown",
      userAgent: req?.headers?.["user-agent"] || "unknown",
      details,
    })
  } catch (err) {
    console.error("Activity log write failed:", err.message)
  }
}

/**
 * Simple real-time monitoring: check how many LOGIN_FAILED events have been
 * recorded for this email in the last N minutes. If it crosses the threshold,
 * write a SECURITY_ALERT entry (and this is where you'd hook an email/Slack
 * alert to an admin in a fuller build).
 *
 * This runs AFTER the failed-login is logged, so it sees the current attempt.
 */
export const checkBruteForceAlert = async ({ req, email, windowMinutes = 15, threshold = 5 }) => {
  try {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000)
    const recentFailures = await ActivityLog.countDocuments({
      email,
      action: "LOGIN_FAILED",
      createdAt: { $gte: since },
    })

    if (recentFailures >= threshold) {
      await logActivity({
        req,
        email,
        action: "SECURITY_ALERT",
        status: "INFO",
        details: { reason: "Repeated failed logins", count: recentFailures, windowMinutes },
      })
      console.warn(`⚠️  SECURITY ALERT: ${recentFailures} failed logins for ${email} in ${windowMinutes}min`)
    }
  } catch (err) {
    console.error("Brute-force alert check failed:", err.message)
  }
}
