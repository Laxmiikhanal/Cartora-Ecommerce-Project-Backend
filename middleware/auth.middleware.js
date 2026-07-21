import jwt from "jsonwebtoken"
import { asyncHandler } from "./error.middleware.js"
import User from "../models/user.model.js"
import { hashUserAgent } from "../utils/jwt.utils.js"

// Protect routes - verify JWT token from HTTP-only cookie
export const protect = asyncHandler(async (req, res, next) => {
  let token

  // Get token from HTTP-only cookie
  token = req.cookies.token

  if (!token) {
    const error = new Error("Not authorized, no token")
    error.statusCode = 401
    throw error
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Reject tokens issued for a different purpose (e.g. an MFA-pending token
    // accidentally used as a session token).
    if (decoded.purpose) {
      const error = new Error("Not authorized, invalid token")
      error.statusCode = 401
      throw error
    }

    // Device binding: if this token was issued with a UA hash, the current
    // request's User-Agent must match. A mismatch means the cookie is being
    // replayed from a different browser/tool than the one that logged in.
    if (decoded.uaHash && decoded.uaHash !== hashUserAgent(req.headers["user-agent"])) {
      const error = new Error("Not authorized, session device mismatch")
      error.statusCode = 401
      throw error
    }

    // Get user from token (exclude password)
    req.user = await User.findById(decoded.id).select("-password")

    if (!req.user) {
      const error = new Error("User not found")
      error.statusCode = 401
      throw error
    }

    next()
  } catch (error) {
    error.statusCode = 401
    error.message = "Not authorized, invalid token"
    throw error
  }
})

// Admin only middleware
export const admin = asyncHandler(async (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next()
  } else {
    const error = new Error("Not authorized as admin")
    error.statusCode = 403
    throw error
  }
})

// Check if user is owner or admin
export const ownerOrAdmin = asyncHandler(async (req, res, next) => {
  if (req.user && (req.user.role === "admin" || req.user._id.toString() === req.params.id)) {
    next()
  } else {
    const error = new Error("Not authorized to access this resource")
    error.statusCode = 403
    throw error
  }
})
