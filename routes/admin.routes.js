import express from "express"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect, admin } from "../middleware/auth.middleware.js"
import User from "../models/user.model.js"
import Product from "../models/product.model.js"
import Order from "../models/order.model.js"
import { idValidator } from "../utils/validators.js"
import { validationResult } from "express-validator"

const router = express.Router()

// All routes are protected and admin-only
router.use(protect, admin)

// ========== ANALYTICS ==========

// @route   GET /api/admin/analytics/dashboard
// @desc    Get dashboard analytics
// @access  Private/Admin
router.get(
  "/analytics/dashboard",
  asyncHandler(async (req, res) => {
    // Get total counts
    const totalUsers = await User.countDocuments()
    const totalProducts = await Product.countDocuments()
    const totalOrders = await Order.countDocuments()

    // Get revenue stats
    const paidOrders = await Order.find({ isPaid: true })
    const totalRevenue = paidOrders.reduce((sum, order) => sum + order.totalPrice, 0)

    // Get recent orders
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(10).populate("user", "name email")

    // Get pending orders
    const pendingOrders = await Order.countDocuments({ status: "pending" })

    // Get low stock products
    const lowStockProducts = await Product.find({ stock: { $lt: 10 }, isActive: true })
      .select("name stock")
      .limit(10)

    // Calculate monthly revenue (last 6 months)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          isPaid: true,
          paidAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$paidAt" },
            month: { $month: "$paidAt" },
          },
          revenue: { $sum: "$totalPrice" },
          orders: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ])

    // Get top selling products
    const topProducts = await Order.aggregate([
      { $match: { isPaid: true } },
      { $unwind: "$orderItems" },
      {
        $group: {
          _id: "$orderItems.product",
          totalSold: { $sum: "$orderItems.quantity" },
          revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          name: "$product.name",
          totalSold: 1,
          revenue: 1,
        },
      },
    ])

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalProducts,
          totalOrders,
          totalRevenue: totalRevenue.toFixed(2),
          pendingOrders,
        },
        recentOrders,
        lowStockProducts,
        monthlyRevenue,
        topProducts,
      },
    })
  }),
)

// @route   GET /api/admin/analytics/sales
// @desc    Get sales analytics
// @access  Private/Admin
router.get(
  "/analytics/sales",
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query

    const filter = { isPaid: true }

    if (startDate || endDate) {
      filter.paidAt = {}
      if (startDate) filter.paidAt.$gte = new Date(startDate)
      if (endDate) filter.paidAt.$lte = new Date(endDate)
    }

    const salesData = await Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalPrice" },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: "$totalPrice" },
        },
      },
    ])

    // Sales by category
    const categoryStats = await Order.aggregate([
      { $match: filter },
      { $unwind: "$orderItems" },
      {
        $lookup: {
          from: "products",
          localField: "orderItems.product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$product.category",
          revenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } },
          quantity: { $sum: "$orderItems.quantity" },
        },
      },
      { $sort: { revenue: -1 } },
    ])

    res.status(200).json({
      success: true,
      data: {
        sales: salesData[0] || { totalRevenue: 0, totalOrders: 0, averageOrderValue: 0 },
        categoryStats,
      },
    })
  }),
)

// ========== USER MANAGEMENT ==========

// @route   GET /api/admin/users
// @desc    Get all users with pagination
// @access  Private/Admin
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page) || 1
    const limit = Number.parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit

    const filter = {}
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { email: { $regex: req.query.search, $options: "i" } },
      ]
    }

    if (req.query.role) {
      filter.role = req.query.role
    }

    const users = await User.find(filter).select("-password").sort({ createdAt: -1 }).limit(limit).skip(skip)

    const total = await User.countDocuments(filter)

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  }),
)

// @route   GET /api/admin/users/:id
// @desc    Get user by ID
// @access  Private/Admin
router.get(
  "/users/:id",
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const user = await User.findById(req.params.id).select("-password")

    if (!user) {
      const error = new Error("User not found")
      error.statusCode = 404
      throw error
    }

    // Get user's order history
    const orders = await Order.find({ user: req.params.id }).sort({ createdAt: -1 }).limit(10)

    res.status(200).json({
      success: true,
      data: {
        user,
        orders,
      },
    })
  }),
)

// @route   PUT /api/admin/users/:id
// @desc    Update user
// @access  Private/Admin
router.put(
  "/users/:id",
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

    // Update allowed fields
    if (req.body.name) user.name = req.body.name
    if (req.body.email) user.email = req.body.email
    if (req.body.role) user.role = req.body.role
    if (typeof req.body.isActive !== "undefined") user.isActive = req.body.isActive

    const updatedUser = await user.save()

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: "User updated successfully",
    })
  }),
)

// @route   DELETE /api/admin/users/:id
// @desc    Delete user
// @access  Private/Admin
router.delete(
  "/users/:id",
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

    // Prevent deleting self
    if (user._id.toString() === req.user._id.toString()) {
      const error = new Error("Cannot delete your own account")
      error.statusCode = 400
      throw error
    }

    await user.deleteOne()

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    })
  }),
)

// ========== ORDER MANAGEMENT ==========

// @route   GET /api/admin/orders
// @desc    Get all orders with pagination
// @access  Private/Admin
router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page) || 1
    const limit = Number.parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit

    const filter = {}

    console.log("RAW QUERY:", req.query)

    if (req.query.status) {
      filter.status = req.query.status
    }

    if (req.query.search) {
      const rawSearch = String(req.query.search)
      const searchTerm = rawSearch.trim().replace(/^#/, "")

      if (searchTerm) {
        if (searchTerm.match(/^[0-9a-fA-F]{24}$/)) {
          // Exact match
          filter._id = searchTerm
        } else {
          // Partial match via In-Memory ID filtering (Fallback for strict compatibility)
          // 1. Fetch all IDs (lightweight)
          const allOrders = await Order.find({}, "_id")
          
          // 2. Filter in JS (Guaranteed string matching)
          const matchingIds = allOrders
            .filter(order => order._id.toString().toLowerCase().includes(searchTerm.toLowerCase()))
            .map(order => order._id)

          // 3. Apply to filter
          filter._id = { $in: matchingIds }
        }
      }
    }

    if (req.query.isPaid) {
      filter.isPaid = req.query.isPaid === "true"
    }

    const orders = await Order.find(filter)
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)

    const total = await Order.countDocuments(filter)

    res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  }),
)

// @route   PUT /api/admin/orders/:id/status
// @desc    Update order status
// @access  Private/Admin
router.put(
  "/orders/:id/status",
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { status } = req.body

    const validStatuses = ["pending", "processing", "shipped", "delivered", "cancelled"]
    if (!validStatuses.includes(status)) {
      const error = new Error("Invalid status")
      error.statusCode = 400
      throw error
    }

    const order = await Order.findById(req.params.id)

    if (!order) {
      const error = new Error("Order not found")
      error.statusCode = 404
      throw error
    }

    order.status = status

    if (status === "delivered") {
      order.isDelivered = true
      order.deliveredAt = Date.now()
    }

    await order.save()

    res.status(200).json({
      success: true,
      data: order,
      message: "Order status updated successfully",
    })
  }),
)

// ========== PRODUCT MANAGEMENT ==========

// @route   GET /api/admin/products
// @desc    Get all products (including inactive)
// @access  Private/Admin
router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page) || 1
    const limit = Number.parseInt(req.query.limit) || 40
    const skip = (page - 1) * limit

    const filter = {}

    if (req.query.category) {
      filter.category = req.query.category
    }

    if (typeof req.query.isActive !== "undefined") {
      filter.isActive = req.query.isActive === "true"
    }

    if (req.query.search) {
      filter.$text = { $search: req.query.search }
    }

    const products = await Product.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip)

    const total = await Product.countDocuments(filter)

    res.status(200).json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  }),
)

export default router
