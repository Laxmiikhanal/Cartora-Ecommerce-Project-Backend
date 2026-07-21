import nodemailer from "nodemailer"
import dotenv from "dotenv"

dotenv.config()

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

/**
 * Send OTP email.
 * In development, if email delivery fails (e.g. SMTP not configured), the code is
 * printed to the server console so registration can still be completed and tested
 * locally. In production the function returns false so the flow fails safely.
 */
export const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: `"Cartora" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Verify your email - Cartora",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Email Verification</h2>
        <p>Hello,</p>
        <p>Your verification code for Cartora is:</p>
        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 5px;">
          ${otp}
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">&copy; 2026 Cartora. All rights reserved.</p>
      </div>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    console.log("OTP email sent: %s", info.messageId)
    return true
  } catch (error) {
    console.error("Error sending OTP email:", error.message)
    if (process.env.NODE_ENV !== "production") {
      console.log("\n==================== DEV OTP (email failed) ====================")
      console.log(`   Email: ${email}`)
      console.log(`   Code:  ${otp}`)
      console.log("   Enter this code on the Register page to finish signing up.")
      console.log("================================================================\n")
      return true
    }
    return false
  }
}

/**
 * Send Reset Password email.
 * Same development fallback: if email can't be sent, the reset link is printed to the
 * server console so the password-reset flow can be tested locally.
 */
export const sendResetPasswordEmail = async (email, resetUrl) => {
  const mailOptions = {
    from: `"Cartora" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Password Reset Request - Cartora",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
        <p>Hello,</p>
        <p>You are receiving this email because you (or someone else) requested a password reset. Click the button below to reset your password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="text-align: center; word-break: break-all; color: #666; font-size: 14px;">Or copy and paste this link into your browser:<br>${resetUrl}</p>
        <p>This link will expire in 10 minutes.</p>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">&copy; 2026 Cartora. All rights reserved.</p>
      </div>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    console.log("Reset email sent: %s", info.messageId)
    return true
  } catch (error) {
    console.error("Error sending reset email:", error.message)
    if (process.env.NODE_ENV !== "production") {
      console.log("\n==================== DEV PASSWORD RESET (email failed) ====================")
      console.log(`   Email: ${email}`)
      console.log(`   Reset link: ${resetUrl}`)
      console.log("   Open this link in your browser to set a new password.")
      console.log("==========================================================================\n")
      return true
    }
    return false
  }
}

/**
 * Generate 6-digit OTP
 * @returns {string} 6-digit OTP
 */
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}
