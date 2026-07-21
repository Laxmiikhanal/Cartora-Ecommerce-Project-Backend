import mongoose from "mongoose"
import dotenv from "dotenv"
import Product from "../models/product.model.js"

dotenv.config()

// Generates a self-contained SVG image (data URI). Because the image data is embedded,
// it always renders with no external network request or image host required.
const img = (label, color) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">` +
      `<rect width="600" height="400" fill="${color}"/>` +
      `<text x="50%" y="50%" font-family="Arial, sans-serif" font-size="34" fill="#ffffff" ` +
      `text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`,
  )

const products = [
  // Electronics
  { name: "Wireless Noise-Cancelling Headphones", description: "Over-ear Bluetooth headphones with active noise cancellation and 30-hour battery life.", price: 4500, compareAtPrice: 5500, category: "Electronics", brand: "SoundCore", stock: 25, featured: true, images: [{ url: img("Headphones", "#0d9488"), alt: "Wireless Headphones" }] },
  { name: "Smart Fitness Watch", description: "Tracks heart rate, sleep and steps. Water resistant with a 7-day battery.", price: 6200, category: "Electronics", brand: "FitPro", stock: 40, featured: true, images: [{ url: img("Smart Watch", "#0ea5e9"), alt: "Smart Fitness Watch" }] },
  { name: "Portable Bluetooth Speaker", description: "Compact wireless speaker with rich bass and 12-hour playtime. Water resistant.", price: 2800, category: "Electronics", brand: "SoundCore", stock: 55, images: [{ url: img("Speaker", "#0891b2"), alt: "Bluetooth Speaker" }] },
  { name: "USB-C Fast Charger 65W", description: "Compact 65W GaN charger with two USB-C ports. Charges laptops and phones fast.", price: 1900, category: "Electronics", brand: "PowerPro", stock: 90, images: [{ url: img("Charger", "#f97316"), alt: "USB-C Charger" }] },
  // Clothing
  { name: "Classic Cotton T-Shirt", description: "Soft 100% cotton crew-neck t-shirt, available in everyday colours.", price: 850, compareAtPrice: 1200, category: "Clothing", brand: "UrbanWear", stock: 120, images: [{ url: img("T-Shirt", "#f59e0b"), alt: "Cotton T-Shirt" }] },
  { name: "Denim Jacket", description: "Timeless mid-wash denim jacket, tailored fit, machine washable.", price: 3600, category: "Clothing", brand: "UrbanWear", stock: 45, featured: true, images: [{ url: img("Denim Jacket", "#1e3a8a"), alt: "Denim Jacket" }] },
  { name: "Cotton Summer Dress", description: "Lightweight floral summer dress, breathable and comfortable.", price: 2200, category: "Clothing", brand: "Bloom", stock: 60, images: [{ url: img("Summer Dress", "#ec4899"), alt: "Summer Dress" }] },
  // Sports
  { name: "Trail Running Shoes", description: "Lightweight running shoes with breathable mesh and cushioned soles.", price: 3800, category: "Sports", brand: "Strider", stock: 60, featured: true, images: [{ url: img("Running Shoes", "#ec4899"), alt: "Running Shoes" }] },
  { name: "Premium Yoga Mat", description: "Non-slip 6mm yoga mat with carry strap, made from eco-friendly TPE.", price: 1800, category: "Sports", brand: "ZenFlow", stock: 50, images: [{ url: img("Yoga Mat", "#f43f5e"), alt: "Yoga Mat" }] },
  { name: "Adjustable Dumbbell 20kg", description: "Space-saving adjustable dumbbell, quick weight change for full-body workouts.", price: 5500, category: "Sports", brand: "FitPro", stock: 20, images: [{ url: img("Dumbbell", "#334155"), alt: "Adjustable Dumbbell" }] },
  // Books
  { name: "The Pragmatic Programmer", description: "A classic software engineering book on writing better, more maintainable code.", price: 1500, category: "Books", brand: "Addison-Wesley", stock: 35, images: [{ url: img("Book", "#8b5cf6"), alt: "The Pragmatic Programmer" }] },
  { name: "Atomic Habits", description: "Bestselling guide to building good habits and breaking bad ones, one small change at a time.", price: 1200, category: "Books", brand: "Random House", stock: 80, featured: true, images: [{ url: img("Atomic Habits", "#0d9488"), alt: "Atomic Habits" }] },
  // Home & Garden
  { name: "Ceramic Plant Pot", description: "Minimalist glazed ceramic pot with drainage hole, ideal for indoor plants.", price: 950, category: "Home & Garden", brand: "GreenHome", stock: 80, images: [{ url: img("Plant Pot", "#10b981"), alt: "Ceramic Plant Pot" }] },
  { name: "Scented Soy Candle", description: "Hand-poured soy wax candle, 40-hour burn time, calming lavender scent.", price: 800, category: "Home & Garden", brand: "Bloom", stock: 100, images: [{ url: img("Soy Candle", "#a855f7"), alt: "Scented Candle" }] },
  { name: "Bamboo Cutting Board", description: "Sustainable bamboo cutting board with juice groove, gentle on knives.", price: 1300, category: "Home & Garden", brand: "GreenHome", stock: 65, images: [{ url: img("Cutting Board", "#a16207"), alt: "Bamboo Cutting Board" }] },
  // Food
  { name: "Organic Green Tea", description: "Loose-leaf organic green tea, 100g pack. Smooth, fresh and antioxidant-rich.", price: 600, category: "Food", brand: "LeafLife", stock: 200, images: [{ url: img("Green Tea", "#65a30d"), alt: "Organic Green Tea" }] },
  { name: "Dark Chocolate Truffles", description: "Handmade 70% dark chocolate truffles, box of 12. Rich and velvety.", price: 1400, category: "Food", brand: "Cacao Co.", stock: 90, images: [{ url: img("Truffles", "#78350f"), alt: "Dark Chocolate Truffles" }] },
  // Beauty
  { name: "Matte Lipstick Set", description: "Set of 4 long-lasting matte lipsticks in everyday shades.", price: 1400, compareAtPrice: 1900, category: "Beauty", brand: "Bloom", stock: 70, images: [{ url: img("Lipstick", "#db2777"), alt: "Matte Lipstick Set" }] },
  { name: "Vitamin C Face Serum", description: "Brightening serum with 15% vitamin C, hyaluronic acid and vitamin E.", price: 1800, category: "Beauty", brand: "Bloom", stock: 85, featured: true, images: [{ url: img("Face Serum", "#f59e0b"), alt: "Vitamin C Serum" }] },
  // Toys
  { name: "Wooden Building Blocks", description: "Set of 50 smooth wooden blocks for kids — safe, colourful and educational.", price: 2200, category: "Toys", brand: "PlayWood", stock: 45, featured: true, images: [{ url: img("Building Blocks", "#0891b2"), alt: "Wooden Building Blocks" }] },
]

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log("MongoDB Connected...")

    await Product.deleteMany({})
    console.log("Cleared existing products")

    const created = await Product.insertMany(products)
    console.log(`\n✅ Added ${created.length} products to the catalogue!`)

    process.exit(0)
  } catch (error) {
    console.error("Error seeding products:", error.message)
    process.exit(1)
  }
}

seed()
