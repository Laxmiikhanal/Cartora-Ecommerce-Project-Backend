import mongoose from "mongoose"

/**
 * Activity / audit log.
 *
 * Design notes (for the report):
 * - We log the ACTION and CONTEXT (who/when/where/outcome), never sensitive
 *   payloads (no passwords, tokens, OTPs, card numbers). This satisfies the
 *   "meaningful actions without exposing sensitive data" requirement.
 * - `user` is nullable because some events happen before we know who the
 *   user is (e.g. a failed login with a bad email, a registration attempt).
 * - TTL index auto-expires logs after 180 days so the collection doesn't
 *   grow unbounded — a reasonable retention policy to state in the report.
 */
const activityLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  email: {
    // Kept separately from `user` so failed-login attempts against a
    // non-existent or not-yet-linked account are still traceable.
    type: String,
    default: null,
  },
  action: {
    type: String,
    required: true,
    enum: [
      "LOGIN_SUCCESS",
      "LOGIN_FAILED",
      "LOGOUT",
      "REGISTER",
      "PASSWORD_CHANGE",
      "PASSWORD_RESET_REQUEST",
      "PASSWORD_RESET_COMPLETE",
      "MFA_ENABLED",
      "MFA_DISABLED",
      "MFA_CHALLENGE_SUCCESS",
      "MFA_CHALLENGE_FAILED",
      "PROFILE_UPDATE",
      "ACCOUNT_LOCKED",
      "ORDER_PLACED",
      "ADMIN_ACTION",
      "SECURITY_ALERT",
    ],
  },
  status: {
    type: String,
    enum: ["SUCCESS", "FAILURE", "INFO"],
    default: "INFO",
  },
  ip: String,
  userAgent: String,
  details: {
    // Free-form but deliberately small — e.g. { orderId }, { targetUserId },
    // never credentials or full request bodies.
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 180, // 180-day retention (TTL index)
  },
})

activityLogSchema.index({ email: 1, action: 1, createdAt: -1 })
activityLogSchema.index({ user: 1, createdAt: -1 })

export default mongoose.model("ActivityLog", activityLogSchema)
