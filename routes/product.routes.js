import express from "express"
import { validationResult } from "express-validator"
import upload from "../middleware/upload.middleware.js"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect, admin } from "../middleware/auth.middleware.js"
import Product from "../models/product.model.js"
import { productValidator, idValidator } from "../utils/validators.js"

const router = express.Router()

// @route   GET /api/products
// @desc    Get all products with filtering, sorting, and pagination
// @access  Public
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page) || 1
    const limit = Number.parseInt(req.query.limit) || 12
    const skip = (page - 1) * limit

    // Build filter object
    const filter = { isActive: true }

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category
    }

    // Price range filter
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {}
      if (req.query.minPrice) filter.price.$gte = Number.parseFloat(req.query.minPrice)
      if (req.query.maxPrice) filter.price.$lte = Number.parseFloat(req.query.maxPrice)
    }

    // Search by text
    if (req.query.search) {
      filter.$text = { $search: req.query.search }
    }

    // Featured products
    if (req.query.featured === "true") {
      filter.featured = true
    }

    // Build sort object
    let sort = {}
    if (req.query.sort) {
      switch (req.query.sort) {
        case "price-asc":
          sort = { price: 1 }
          break
        case "price-desc":
          sort = { price: -1 }
          break
        case "rating":
          sort = { rating: -1 }
          break
        case "newest":
          sort = { createdAt: -1 }
          break
        default:
          sort = { createdAt: -1 }
      }
    } else {
      sort = { createdAt: -1 }
    }

    const products = await Product.find(filter).sort(sort).limit(limit).skip(skip)

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

// @route   GET /api/products/:id
// @desc    Get single product by ID
// @access  Public
router.get(
  "/:id",
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const product = await Product.findById(req.params.id).populate("reviews.user", "name")

    if (!product) {
      const error = new Error("Product not found")
      error.statusCode = 404
      throw error
    }

    res.status(200).json({
      success: true,
      data: product,
    })
  }),
)

// @route   POST /api/products
// @desc    Create a new product (Admin only)
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  upload.array("images", 5), // Allow up to 5 image uploads - must run BEFORE validator so req.body is populated
  productValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    let images = [];

    if (req.files && req.files.length > 0) {
      // Uploaded files take priority
      images = req.files.map((file) => ({
        url: `/uploads/${file.filename}`,
        alt: req.body.name || "Product image",
      }));
    } else {
      // Fallback: accept URL strings like before
      const rawImages = req.body.images;

      if (typeof rawImages === "string") {
        images = rawImages
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((url) => ({ url, alt: req.body.name || "Product image" }));
      } else if (Array.isArray(rawImages)) {
        images = rawImages.map((img) => {
          if (typeof img === "string") {
            return { url: img.trim(), alt: req.body.name || "Product image" };
          }
          return img;
        });
      }
    }

    req.body.images = images;

    const product = await Product.create(req.body);

    res.status(201).json({
      success: true,
      data: product,
      message: "Product created successfully",
    })
  }),
)

// @route   PUT /api/products/:id
// @desc    Update a product (Admin only)
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  upload.array("images", 5), // Allow up to 5 image uploads - must run BEFORE validator so req.body is populated
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    let product = await Product.findById(req.params.id)

    if (!product) {
      const error = new Error("Product not found")
      error.statusCode = 404
      throw error
    }

    // Only touch images if the admin actually uploaded new files.
    // Otherwise keep the product's existing images untouched.
    if (req.files && req.files.length > 0) {
      req.body.images = req.files.map((file) => ({
        url: `/uploads/${file.filename}`,
        alt: req.body.name || product.name || "Product image",
      }))
    } else {
      delete req.body.images
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })

    res.status(200).json({
      success: true,
      data: product,
      message: "Product updated successfully",
    })
  }),
)

// @route   DELETE /api/products/:id
// @desc    Delete a product (Admin only)
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const product = await Product.findById(req.params.id)

    if (!product) {
      const error = new Error("Product not found")
      error.statusCode = 404
      throw error
    }

    await product.deleteOne()

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    })
  }),
)

// @route   POST /api/products/:id/reviews
// @desc    Create a product review
// @access  Private
router.post(
  "/:id/reviews",
  protect,
  admin,
  idValidator,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const error = new Error(errors.array()[0].msg)
      error.statusCode = 400
      throw error
    }

    const { rating, comment } = req.body

    if (!rating || !comment) {
      const error = new Error("Please provide rating and comment")
      error.statusCode = 400
      throw error
    }

    const product = await Product.findById(req.params.id)

    if (!product) {
      const error = new Error("Product not found")
      error.statusCode = 404
      throw error
    }

    // Check if user already reviewed
    const alreadyReviewed = product.reviews.find((review) => review.user.toString() === req.user._id.toString())

    if (alreadyReviewed) {
      const error = new Error("You have already reviewed this product")
      error.statusCode = 400
      throw error
    }

    const review = {
      user: req.user._id,
      name: req.user.name,
      rating: Number(rating),
      comment,
    }

    product.reviews.push(review)
    product.numReviews = product.reviews.length
    product.rating = product.reviews.reduce((acc, item) => item.rating + acc, 0) / product.reviews.length

    await product.save()

    res.status(201).json({
      success: true,
      message: "Review added successfully",
    })
  }),
)

// @route   GET /api/products/categories/list
// @desc    Get all product categories
// @access  Public
router.get("/categories/list", async (req, res) => {
  const categories = ["Electronics", "Clothing", "Books", "Home & Garden", "Sports", "Toys", "Beauty", "Food", "Other"]

  res.status(200).json({
    success: true,
    data: categories,
  })
})

export default router// Product catalog and inventory routes 
