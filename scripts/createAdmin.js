import mongoose from "mongoose"
import dotenv from "dotenv"
import User from "../models/user.model.js"

dotenv.config()

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI)

    console.log("MongoDB Connected...")

    // Admin login details. This password meets the 12-char + complexity policy.
    // It is a throwaway dev credential — change it before any real deployment.
    const adminData = {
      name: "Admin User",
      email: "admin@cartora.com",
      password: "Admin@Cartora2026",
      role: "admin",
    }

    // Remove any existing account with this email so we can (re)create it with a
    // known password. This also clears any failed-login lockout on the old account.
    const deleted = await User.deleteOne({ email: adminData.email })
    if (deleted.deletedCount > 0) {
      console.log("Removed existing account for", adminData.email)
    }

    // Create admin user
    const admin = await User.create(adminData)

    console.log("\n✅ Admin account ready! Log in with:")
    console.log("   Email:   ", admin.email)
    console.log("   Password:", adminData.password)

    process.exit(0)
  } catch (error) {
    console.error("Error creating admin:", error.message)
    process.exit(1)
  }
}

createAdmin()