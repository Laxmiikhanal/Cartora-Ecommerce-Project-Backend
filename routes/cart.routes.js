import express from "express"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect } from "../middleware/auth.middleware.js"
import Cart from "../models/cart.model.js"
import Product from "../models/product.model.js"

const router = express.Router()

// @route   GET /api/cart
// @desc    Get user's cart
// @access  Private
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    let cart = await Cart.findOne({ user: req.user._id }).populate("items.product", "name price images stock")

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] })
    } else {
      // Check for and remove items where product no longer exists (deleted)
      const originalItemCount = cart.items.length
      cart.items = cart.items.filter((item) => item.product !== null)

      if (cart.items.length !== originalItemCount) {
        await cart.save()
      }
    }

    res.status(200).json({
      success: true,
      data: cart,
    })
  }),
)

// @route   POST /api/cart/items
// @desc    Add item to cart
// @access  Private
router.post(
  "/items",
  protect,
  asyncHandler(async (req, res) => {
    const { productId, quantity } = req.body

    if (!productId || !quantity) {
      const error = new Error("Please provide product ID and quantity")
      error.statusCode = 400
      throw error
    }

    if (quantity < 1) {
      const error = new Error("Quantity must be at least 1")
      error.statusCode = 400
      throw error
    }

    // Check if product exists and has sufficient stock
    const product = await Product.findById(productId)

    if (!product) {
      const error = new Error("Product not found")
      error.statusCode = 404
      throw error
    }

    if (!product.isActive) {
      const error = new Error("Product is not available")
      error.statusCode = 400
      throw error
    }

    if (product.stock < quantity) {
      const error = new Error(`Only ${product.stock} items available in stock`)
      error.statusCode = 400
      throw error
    }

    // Get or create cart
    let cart = await Cart.findOne({ user: req.user._id })

    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] })
    }

    // Check if product already in cart
    const existingItemIndex = cart.items.findIndex((item) => item.product.toString() === productId)

    if (existingItemIndex > -1) {
      // Update quantity
      const newQuantity = cart.items[existingItemIndex].quantity + quantity

      if (product.stock < newQuantity) {
        const error = new Error(`Only ${product.stock} items available in stock`)
        error.statusCode = 400
        throw error
      }

      cart.items[existingItemIndex].quantity = newQuantity
    } else {
      // Add new item
      cart.items.push({
        product: productId,
        quantity,
        price: product.price,
      })
    }

    await cart.save()
    await cart.populate("items.product", "name price images stock")

    res.status(200).json({
      success: true,
      data: cart,
      message: "Item added to cart",
    })
  }),
)

// @route   PUT /api/cart/items/:productId
// @desc    Update cart item quantity
// @access  Private
router.put(
  "/items/:productId",
  protect,
  asyncHandler(async (req, res) => {
    const { quantity } = req.body

    if (!quantity || quantity < 1) {
      const error = new Error("Quantity must be at least 1")
      error.statusCode = 400
      throw error
    }

    const cart = await Cart.findOne({ user: req.user._id })

    if (!cart) {
      const error = new Error("Cart not found")
      error.statusCode = 404
      throw error
    }

    const itemIndex = cart.items.findIndex((item) => item.product.toString() === req.params.productId)

    if (itemIndex === -1) {
      const error = new Error("Item not found in cart")
      error.statusCode = 404
      throw error
    }

    // Check stock availability
    const product = await Product.findById(req.params.productId)
    if (product.stock < quantity) {
      const error = new Error(`Only ${product.stock} items available in stock`)
      error.statusCode = 400
      throw error
    }

    cart.items[itemIndex].quantity = quantity
    cart.items[itemIndex].price = product.price

    await cart.save()
    await cart.populate("items.product", "name price images stock")

    res.status(200).json({
      success: true,
      data: cart,
      message: "Cart updated",
    })
  }),
)

// @route   DELETE /api/cart/items/:productId
// @desc    Remove item from cart
// @access  Private
router.delete(
  "/items/:productId",
  protect,
  asyncHandler(async (req, res) => {
    const cart = await Cart.findOne({ user: req.user._id })

    if (!cart) {
      const error = new Error("Cart not found")
      error.statusCode = 404
      throw error
    }

    cart.items = cart.items.filter((item) => item.product.toString() !== req.params.productId)

    await cart.save()
    await cart.populate("items.product", "name price images stock")

    res.status(200).json({
      success: true,
      data: cart,
      message: "Item removed from cart",
    })
  }),
)

// @route   DELETE /api/cart
// @desc    Clear cart
// @access  Private
router.delete(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const cart = await Cart.findOne({ user: req.user._id })

    if (cart) {
      cart.items = []
      await cart.save()
    }

    res.status(200).json({
      success: true,
      message: "Cart cleared",
    })
  }),
)

export default router
