import express from "express"
import { validationResult } from "express-validator"
import rateLimit from "express-rate-limit"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect } from "../middleware/auth.middleware.js"
import { registerValidator, loginValidator, emailValidator, validatePasswordStrength } from "../utils/validators.js"
import User from "../models/user.model.js"
import OTP from "../models/otp.model.js"
import { generateTokenAndSetCookie, clearCookie, generateMfaPendingToken, verifyMfaPendingToken } from "../utils/jwt.utils.js"
import { sendOTPEmail, generateOTP, sendResetPasswordEmail } from "../utils/otp.utils.js"
import crypto from "crypto"
import { encrypt, decrypt } from "../utils/encryption.utils.js"
import { verifyRecaptcha } from "../utils/recaptcha.utils.js"
import {
  generateMfaSecret,
  generateMfaQrCode,
  verifyMfaToken,
  generateBackupCodes,
  matchBackupCode,
} from "../utils/mfa.utils.js"
import { logActivity, checkBruteForceAlert } from "../utils/logger.utils.js"

const router = express.Router()

// Strict limiter for sensitive auth endpoints (login, OTP, password reset).
// This is much tighter than the global /api limiter and is the first line of
// defence against credential stuffing and brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again in 15 minutes." },
})

// @route   POST /api/auth/send-otp
// @desc    Send OTP for registration
// @access  Public
router.post(
  "/send-otp",
  authLimiter,
  emailValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { email } = req.body

    // Check if user already exists
    const userExists = await User.findOne({ email })
    if (userExists) {
      const error = new Error("User already exists with this email")
      error.statusCode = 400
      throw error
    }

    // Generate OTP
    const otpCode = generateOTP()

    // Save OTP to database
    await OTP.findOneAndUpdate({ email }, { otp: otpCode }, { upsert: true, new: true })

    // Send OTP via email
    const emailSent = await sendOTPEmail(email, otpCode)

    if (!emailSent) {
      const error = new Error("Failed to send OTP email")
      error.statusCode = 500
      throw error
    }

    res.status(200).json({
      success: true,
      message: "OTP sent successfully to your email",
    })
  }),
)

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post(
  "/register",
  registerValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { name, email, password, otp } = req.body

    if (!otp) {
      const error = new Error("Please provide OTP")
      error.statusCode = 400
      throw error
    }

    // Verify OTP
    const otpRecord = await OTP.findOne({ email, otp })
    if (!otpRecord) {
      const error = new Error("Invalid or expired OTP")
      error.statusCode = 400
      throw error
    }

    // Check if user already exists (double check)
    const userExists = await User.findOne({ email })
    if (userExists) {
      const error = new Error("User already exists with this email")
      error.statusCode = 400
      throw error
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
    })

    // Delete OTP record after successful registration
    await OTP.deleteOne({ email })

    if (user) {
      // Generate token and set HTTP-only cookie
      generateTokenAndSetCookie(res, user._id, req)

      await logActivity({ req, user: user._id, email: user.email, action: "REGISTER", status: "SUCCESS" })

      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        message: "User registered successfully",
      })
    } else {
      const error = new Error("Invalid user data")
      error.statusCode = 400
      throw error
    }
  }),
)

// @route   POST /api/auth/login
// @desc    Login user & get token in HTTP-only cookie
// @access  Public
router.post(
  "/login",
  authLimiter,
  loginValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { email, password, recaptchaToken } = req.body

    // Bot protection. reCAPTCHA is enforced in production, and in ANY environment where a
    // secret key is configured (so the real flow can be tested locally by setting the keys).
    // In development with no key configured it is skipped, so the app runs locally without
    // external services. Production therefore always fails closed.
    const recaptchaRequired = process.env.NODE_ENV === "production" || Boolean(process.env.RECAPTCHA_SECRET_KEY)

    if (recaptchaRequired) {
      if (!recaptchaToken) {
        const error = new Error("Please complete the CAPTCHA")
        error.statusCode = 400
        throw error
      }

      const isHuman = await verifyRecaptcha(recaptchaToken)
      if (!isHuman) {
        const error = new Error("CAPTCHA verification failed. Please try again.")
        error.statusCode = 400
        throw error
      }
    }

    // Check for user with password field
    const user = await User.findOne({ email }).select("+password +passwordHistory")

    if (!user) {
      await logActivity({ req, email, action: "LOGIN_FAILED", status: "FAILURE", details: { reason: "no such user" } })
      await checkBruteForceAlert({ req, email })
      const error = new Error("Invalid credentials")
      error.statusCode = 401
      throw error
    }

    // Check account lockout
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 60000)
      await logActivity({ req, user: user._id, email, action: "LOGIN_FAILED", status: "FAILURE", details: { reason: "account locked" } })
      const error = new Error(`Account locked. Please try again in ${remainingTime} minutes.`)
      error.statusCode = 423
      throw error
    }

    // Check if user is active
    if (!user.isActive) {
      const error = new Error("Account is deactivated. Please contact support")
      error.statusCode = 403
      throw error
    }

    // Check password
    const isPasswordMatch = await user.matchPassword(password)

    if (!isPasswordMatch) {
      // Increment failed attempts
      user.failedLoginAttempts += 1

      // Lock the account for 15 minutes after 5 consecutive failures,
      // then reset the counter so the user gets a fresh set of attempts after the lock expires.
      let justLocked = false
      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = Date.now() + 15 * 60 * 1000
        user.failedLoginAttempts = 0
        justLocked = true
      }

      await user.save({ validateBeforeSave: false })

      await logActivity({ req, user: user._id, email, action: "LOGIN_FAILED", status: "FAILURE", details: { reason: "bad password" } })
      if (justLocked) {
        await logActivity({ req, user: user._id, email, action: "ACCOUNT_LOCKED", status: "INFO" })
      }
      await checkBruteForceAlert({ req, email })

      const error = new Error("Invalid credentials")
      error.statusCode = 401
      throw error
    }

    // Reset failed attempts on success
    user.failedLoginAttempts = 0
    user.lockUntil = undefined
    await user.save({ validateBeforeSave: false })

    // Check password expiry (90 days) — enforced, not just advisory. An expired
    // password blocks session issuance until the user goes through forgot-password.
    const ninetyDays = 90 * 24 * 60 * 60 * 1000
    const isPasswordExpired = user.passwordChangedAt && Date.now() - user.passwordChangedAt > ninetyDays
    if (isPasswordExpired) {
      await logActivity({ req, user: user._id, email, action: "LOGIN_BLOCKED_PASSWORD_EXPIRED", status: "FAILURE" })
      const error = new Error("Your password has expired. Please reset it to continue.")
      error.statusCode = 403
      error.code = "PASSWORD_EXPIRED"
      throw error
    }

    // --- MFA branch ---
    // Password is correct, but if this account has TOTP enabled we do NOT issue a
    // session yet. Instead we hand back a short-lived pending token; the frontend
    // must call /api/auth/mfa/login-verify with a 6-digit code (or backup code)
    // before a real session cookie is ever set.
    if (user.mfaEnabled) {
      await logActivity({ req, user: user._id, email, action: "LOGIN_PASSWORD_OK_MFA_PENDING", status: "INFO" })
      const mfaPendingToken = generateMfaPendingToken(user._id)
      return res.status(200).json({
        success: true,
        mfaRequired: true,
        mfaPendingToken,
        message: "Password verified. Enter your authenticator code to finish signing in.",
      })
    }

    await logActivity({ req, user: user._id, email, action: "LOGIN_SUCCESS", status: "SUCCESS" })

    // Generate token and set HTTP-only cookie, bound to this request's device (UA hash)
    generateTokenAndSetCookie(res, user._id, req)

    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      message: "Login successful",
    })
  }),
)

// @route   POST /api/auth/mfa/login-verify
// @desc    Complete login by verifying a TOTP or backup code against the pending token
//          issued by /login when mfaRequired was returned.
// @access  Public (requires a valid short-lived mfaPendingToken)
router.post(
  "/mfa/login-verify",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { mfaPendingToken, code } = req.body

    if (!mfaPendingToken || !code) {
      const error = new Error("Missing MFA token or code")
      error.statusCode = 400
      throw error
    }

    let decoded
    try {
      decoded = verifyMfaPendingToken(mfaPendingToken)
    } catch {
      const error = new Error("MFA session expired. Please log in again.")
      error.statusCode = 401
      throw error
    }

    const user = await User.findById(decoded.id).select("+mfaSecret +mfaBackupCodes")
    if (!user || !user.mfaEnabled) {
      const error = new Error("MFA not enabled for this account")
      error.statusCode = 400
      throw error
    }

    const decryptedSecret = decrypt(user.mfaSecret)
    let ok = await verifyMfaToken(code, decryptedSecret)
    let usedBackupCode = false

    // Fall back to a backup/recovery code if the TOTP code didn't match.
    if (!ok) {
      const idx = await matchBackupCode(code, user.mfaBackupCodes)
      if (idx !== -1) {
        ok = true
        usedBackupCode = true
        // Backup codes are single-use — remove the one that was just spent.
        user.mfaBackupCodes.splice(idx, 1)
        await user.save({ validateBeforeSave: false })
      }
    }

    if (!ok) {
      await logActivity({ req, user: user._id, email: user.email, action: "MFA_LOGIN_FAILED", status: "FAILURE" })
      const error = new Error("Invalid authentication code")
      error.statusCode = 401
      throw error
    }

    await logActivity({
      req,
      user: user._id,
      email: user.email,
      action: "LOGIN_SUCCESS",
      status: "SUCCESS",
      details: { via: usedBackupCode ? "mfa_backup_code" : "mfa_totp" },
    })

    generateTokenAndSetCookie(res, user._id, req)

    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      message: "Login successful",
    })
  }),
)

// @route   POST /api/auth/mfa/setup
// @desc    Begin MFA enrollment: generate a secret + QR code for the logged-in user.
//          Does NOT enable MFA yet — that happens in /mfa/enable once the user proves
//          they can generate a valid code, so we never lock someone out with a secret
//          they never actually scanned correctly.
// @access  Private
router.post(
  "/mfa/setup",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (user.mfaEnabled) {
      const error = new Error("MFA is already enabled on this account")
      error.statusCode = 400
      throw error
    }

    const secret = generateMfaSecret()
    const qrCodeDataUrl = await generateMfaQrCode(user.email, secret)

    // Store encrypted, but NOT marked enabled — /mfa/enable flips that flag.
    user.mfaSecret = encrypt(secret)
    await user.save({ validateBeforeSave: false })

    res.status(200).json({
      success: true,
      data: { qrCode: qrCodeDataUrl, manualEntryKey: secret },
      message: "Scan the QR code with your authenticator app, then confirm with a code via /mfa/enable.",
    })
  }),
)

// @route   POST /api/auth/mfa/enable
// @desc    Confirm MFA enrollment with a valid TOTP code; generates one-time backup codes.
// @access  Private
router.post(
  "/mfa/enable",
  protect,
  asyncHandler(async (req, res) => {
    const { code } = req.body
    const user = await User.findById(req.user._id).select("+mfaSecret")

    if (!user.mfaSecret) {
      const error = new Error("Call /mfa/setup first")
      error.statusCode = 400
      throw error
    }

    const decryptedSecret = decrypt(user.mfaSecret)
    if (!(await verifyMfaToken(code, decryptedSecret))) {
      const error = new Error("Invalid code. Please try again.")
      error.statusCode = 401
      throw error
    }

    const { plainCodes, hashedCodes } = await generateBackupCodes()
    user.mfaEnabled = true
    user.mfaBackupCodes = hashedCodes
    await user.save({ validateBeforeSave: false })

    await logActivity({ req, user: user._id, email: user.email, action: "MFA_ENABLED", status: "SUCCESS" })

    res.status(200).json({
      success: true,
      data: { backupCodes: plainCodes }, // shown ONCE — frontend must tell the user to save these now
      message: "MFA enabled. Save your backup codes somewhere safe — they won't be shown again.",
    })
  }),
)

// @route   POST /api/auth/mfa/disable
// @desc    Disable MFA — requires the current password as confirmation so a hijacked
//          but-not-yet-fully-authenticated session can't turn off the second factor.
// @access  Private
router.post(
  "/mfa/disable",
  protect,
  asyncHandler(async (req, res) => {
    const { password } = req.body
    const user = await User.findById(req.user._id).select("+password")

    const isMatch = await user.matchPassword(password)
    if (!isMatch) {
      const error = new Error("Incorrect password")
      error.statusCode = 401
      throw error
    }

    user.mfaEnabled = false
    user.mfaSecret = undefined
    user.mfaBackupCodes = []
    await user.save({ validateBeforeSave: false })

    await logActivity({ req, user: user._id, email: user.email, action: "MFA_DISABLED", status: "INFO" })

    res.status(200).json({ success: true, message: "MFA disabled" })
  }),
)

// @route   POST /api/auth/logout
// @desc    Logout user & clear cookie
// @access  Private
router.post(
  "/logout",
  protect,
  asyncHandler(async (req, res) => {
    clearCookie(res)

    await logActivity({ req, user: req.user._id, email: req.user.email, action: "LOGOUT", status: "SUCCESS" })

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    })
  }),
)

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    // Decrypt phone if exists
    if (user.phone) {
      user.phone = decrypt(user.phone)
    }

    res.status(200).json({
      success: true,
      data: user,
    })
  }),
)

// @route   PUT /api/auth/update-profile
// @desc    Update user profile
// @access  Private
router.put(
  "/update-profile",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
      user.name = req.body.name || user.name
      user.email = req.body.email || user.email
      user.phone = req.body.phone || user.phone

      if (req.body.address) {
        user.address = {
          ...user.address,
          ...req.body.address,
        }
      }

      const updatedUser = await user.save()

      res.status(200).json({
        success: true,
        data: {
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          phone: updatedUser.phone,
          address: updatedUser.address,
        },
        message: "Profile updated successfully",
      })
    } else {
      const error = new Error("User not found")
      error.statusCode = 404
      throw error
    }
  }),
)

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put(
  "/change-password",
  protect,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      const error = new Error("Please provide current and new password")
      error.statusCode = 400
      throw error
    }

    const strength = validatePasswordStrength(newPassword)
    if (!strength.valid) {
      const error = new Error(strength.message)
      error.statusCode = 400
      throw error
    }

    const user = await User.findById(req.user._id).select("+password +passwordHistory")

    // Check current password
    const isMatch = await user.matchPassword(currentPassword)
    if (!isMatch) {
      const error = new Error("Current password is incorrect")
      error.statusCode = 401
      throw error
    }

    // Update password
    user.password = newPassword
    await user.save()

    await logActivity({ req, user: user._id, email: user.email, action: "PASSWORD_CHANGE", status: "SUCCESS" })

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    })
  }),
)

// @route   POST /api/auth/register-admin
// @desc    Register a new admin (requires ADMIN_SECRET_KEY)
// @access  Public with secret key
router.post(
  "/register-admin",
  registerValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { name, email, password, adminSecretKey } = req.body

    // Verify admin secret key
    if (!adminSecretKey || adminSecretKey !== process.env.ADMIN_SECRET_KEY) {
      const error = new Error("Invalid admin secret key")
      error.statusCode = 403
      throw error
    }

    // Check if user already exists
    const userExists = await User.findOne({ email })
    if (userExists) {
      const error = new Error("User already exists with this email")
      error.statusCode = 400
      throw error
    }

    // Create admin user
    const user = await User.create({
      name,
      email,
      password,
      role: "admin",
    })

    if (user) {
      // Generate token and set HTTP-only cookie
      generateTokenAndSetCookie(res, user._id, req)

      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        message: "Admin registered successfully",
      })
    } else {
      const error = new Error("Invalid user data")
      error.statusCode = 400
      throw error
    }
  }),
)

// @route   POST /api/auth/forgot-password
// @desc    Forgot Password
// @access  Public
router.post(
  "/forgot-password",
  authLimiter,
  emailValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { email } = req.body

    const user = await User.findOne({ email })

    if (!user) {
      const error = new Error("User not found with that email")
      error.statusCode = 404
      throw error
    }

    // Get reset token
    const resetToken = user.getResetPasswordToken()

    await user.save({ validateBeforeSave: false })

    // Create reset url
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password/${resetToken}`

    try {
      await sendResetPasswordEmail(user.email, resetUrl)

      await logActivity({ req, user: user._id, email: user.email, action: "PASSWORD_RESET_REQUEST", status: "SUCCESS" })

      res.status(200).json({
        success: true,
        message: "Email sent",
      })
    } catch (err) {
      console.log(err)
      user.resetPasswordToken = undefined
      user.resetPasswordExpire = undefined

      await user.save({ validateBeforeSave: false })

      const error = new Error("Email could not be sent")
      error.statusCode = 500
      throw error
    }
  }),
)

// @route   PUT /api/auth/reset-password/:resetToken
// @desc    Reset Password
// @access  Public
router.put(
  "/reset-password/:resetToken",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body

    const strength = validatePasswordStrength(password)
    if (!strength.valid) {
      const error = new Error(strength.message)
      error.statusCode = 400
      throw error
    }

    // Get hashed token
    const resetPasswordToken = crypto.createHash("sha256").update(req.params.resetToken).digest("hex")

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    }).select("+passwordHistory")

    if (!user) {
      const error = new Error("Invalid token")
      error.statusCode = 400
      throw error
    }

    // Set new password
    user.password = password
    user.resetPasswordToken = undefined
    user.resetPasswordExpire = undefined

    await user.save()

    await logActivity({ req, user: user._id, email: user.email, action: "PASSWORD_RESET_COMPLETE", status: "SUCCESS" })

    res.status(200).json({
      success: true,
      message: "Password updated success",
    })
  }),
)

export default router