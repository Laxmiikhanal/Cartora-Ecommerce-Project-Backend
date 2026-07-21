import express from "express"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect, ownerOrAdmin } from "../middleware/auth.middleware.js"
import User from "../models/user.model.js"
import { idValidator } from "../utils/validators.js"
import { validationResult } from "express-validator"

const router = express.Router()

// @route   GET /api/users/:id
// @desc    Get user by ID (owner or admin only)
// @access  Private
router.get(
  "/:id",
  protect,
  ownerOrAdmin,
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const user = await User.findById(req.params.id)

    if (!user) {
      const error = new Error("User not found")
      error.statusCode = 404
      throw error
    }

    res.status(200).json({
      success: true,
      data: user,
    })
  }),
)

export default router
