import express from "express"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect } from "../middleware/auth.middleware.js"
import Order from "../models/order.model.js"
import Cart from "../models/cart.model.js"
import Product from "../models/product.model.js"

const router = express.Router()

// @route   POST /api/orders
// @desc    Create a new order
// @access  Private
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { shippingAddress, paymentMethod } = req.body

    if (
      !shippingAddress ||
      !shippingAddress.street ||
      !shippingAddress.city ||
      !shippingAddress.zipCode ||
      !shippingAddress.country
    ) {
      const error = new Error("Please provide complete shipping address")
      error.statusCode = 400
      throw error
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user._id }).populate("items.product")

    if (!cart || cart.items.length === 0) {
      const error = new Error("Cart is empty")
      error.statusCode = 400
      throw error
    }

    // Verify stock availability and prepare order items
    const orderItems = []

    for (const item of cart.items) {
      try {
        
        // Skip null items or items without a product reference
        if (!item || !item.product) {
          continue
        }

        // Handle both populated and unpopulated product references
        const productId = (item.product && item.product._id) ? item.product._id : item.product
        
        if (!productId) {
          continue
        }

        const product = await Product.findById(productId)

        if (!product) {
          continue
        }

      if (!product.isActive) {
        const error = new Error(`Product ${product.name} is no longer available`)
        error.statusCode = 400
        throw error
      }

      if (product.stock < item.quantity) {
        const error = new Error(`Insufficient stock for ${product.name}. Only ${product.stock} available`)
        error.statusCode = 400
        throw error
      }

        orderItems.push({
          product: product._id,
          name: product.name,
          quantity: item.quantity,
          price: product.price,
          image: product.images?.[0]?.url || "",
        })
      } catch (err) {
        console.error("Error processing cart item:", err.message)
        continue
      }
    }

    if (orderItems.length === 0) {
      const error = new Error("No valid products in your order. They might have been deleted.")
      error.statusCode = 400
      throw error
    }

    // Calculate prices
    const itemsPrice = orderItems.reduce((acc, item) => acc + item.price * item.quantity, 0)
    const shippingPrice = itemsPrice > 100 ? 0 : 10 // Free shipping over $100
    const taxPrice = Number((0.1 * itemsPrice).toFixed(2)) // 10% tax
    const totalPrice = Number((itemsPrice + shippingPrice + taxPrice).toFixed(2))

    // Create order
    const order = await Order.create({
      user: req.user._id,
      orderItems,
      shippingAddress,
      paymentMethod: paymentMethod || "Stripe",
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
    })

    // Clear cart after order creation
    cart.items = []
    await cart.save()

    res.status(201).json({
      success: true,
      data: order,
      message: "Order created successfully",
    })
  }),
)

// @route   GET /api/orders
// @desc    Get user's orders
// @access  Private
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page) || 1
    const limit = Number.parseInt(req.query.limit) || 10
    const skip = (page - 1) * limit

    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)

    const total = await Order.countDocuments({ user: req.user._id })

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

// @route   GET /api/orders/:id
// @desc    Get order by ID
// @access  Private
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id).populate("user", "name email")

    if (!order) {
      const error = new Error("Order not found")
      error.statusCode = 404
      throw error
    }

    // Make sure user is order owner or admin
    if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      const error = new Error("Not authorized to access this order")
      error.statusCode = 403
      throw error
    }

    res.status(200).json({
      success: true,
      data: order,
    })
  }),
)

// @route   PUT /api/orders/:id/pay
// @desc    Update order to paid
// @access  Private
router.put(
  "/:id/pay",
  protect,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)

    if (!order) {
      const error = new Error("Order not found")
      error.statusCode = 404
      throw error
    }

    // Verify user is order owner
    if (order.user.toString() !== req.user._id.toString()) {
      const error = new Error("Not authorized to update this order")
      error.statusCode = 403
      throw error
    }

    // Update product stock
    for (const item of order.orderItems) {
      const product = await Product.findById(item.product)
      if (product) {
        product.stock -= item.quantity
        await product.save()
      }
    }

    order.isPaid = true
    order.paidAt = Date.now()
    order.status = "processing"
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.email_address,
    }

    const updatedOrder = await order.save()

    res.status(200).json({
      success: true,
      data: updatedOrder,
      message: "Order payment recorded",
    })
  }),
)

// @route   PUT /api/orders/:id/cancel
// @desc    Cancel order
// @access  Private
router.put(
  "/:id/cancel",
  protect,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id)

    if (!order) {
      const error = new Error("Order not found")
      error.statusCode = 404
      throw error
    }

    if (order.user.toString() !== req.user._id.toString()) {
      const error = new Error("Not authorized to cancel this order")
      error.statusCode = 403
      throw error
    }

    if (order.isDelivered) {
      const error = new Error("Cannot cancel delivered order")
      error.statusCode = 400
      throw error
    }

    // Restore stock if paid
    if (order.isPaid) {
      for (const item of order.orderItems) {
        const product = await Product.findById(item.product)
        if (product) {
          product.stock += item.quantity
          await product.save()
        }
      }
    }

    order.status = "cancelled"
    await order.save()

    res.status(200).json({
      success: true,
      data: order,
      message: "Order cancelled successfully",
    })
  }),
)

export default router