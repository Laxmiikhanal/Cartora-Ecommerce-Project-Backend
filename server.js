import express from "express"
import mongoose from "mongoose"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import path from "path"
import { fileURLToPath } from "url"

// Load environment variables
dotenv.config()

// ESM-safe __dirname (needed since this project uses "import", not "require")
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Import routes
import authRoutes from "./routes/auth.routes.js"
import userRoutes from "./routes/user.routes.js"
import productRoutes from "./routes/product.routes.js"
import cartRoutes from "./routes/cart.routes.js"
import orderRoutes from "./routes/order.routes.js"
import adminRoutes from "./routes/admin.routes.js"
import paymentRoutes from "./routes/payment.routes.js"
import { transporter } from "./utils/otp.utils.js"

// Import error handler
import { errorHandler } from "./middleware/error.middleware.js"

const app = express()

// Security middleware
// crossOriginResourcePolicy is relaxed to "cross-origin" so that uploaded product
// images (served from this backend, e.g. localhost:5051) can actually be loaded
// by the frontend running on a different origin (e.g. localhost:5173). Without this,
// Helmet's default same-origin policy silently blocks the browser from displaying them.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))

// IMPORTANT: before rate limiter
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1); // most common fix
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
})
app.use("/api/", limiter)

transporter.verify()
  .then(() => console.log("✅ SMTP server is ready"))
  .catch(err => console.error("❌ SMTP verify failed:", err.message))

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

// Body parser middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Cookie parser middleware
app.use(cookieParser())

// API Routes
app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/products", productRoutes)
app.use("/api/cart", cartRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/payment", paymentRoutes)

// Serve uploaded product images (e.g. GET /uploads/1699999999-123456789.jpg)
// This is what was missing — multer was saving files into ./uploads on disk,
// but nothing was telling Express to actually serve that folder over HTTP,
// so the frontend got a 404 trying to load the image URL.
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" })
})

// Error handler middleware (must be last)
app.use(errorHandler)

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log("MongoDB connected successfully")
  } catch (error) {
    console.error("MongoDB connection error:", error.message)
    process.exit(1)
  }
}

// Start server
const PORT = process.env.PORT || 5000

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`)
  })
})

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message)
  process.exit(1)
})