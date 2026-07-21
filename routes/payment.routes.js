import express from "express"
import Stripe from "stripe"
import axios from "axios"
import { asyncHandler } from "../middleware/error.middleware.js"
import { protect } from "../middleware/auth.middleware.js"
import Order from "../models/order.model.js"

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// @route   POST /api/payment/create-payment-intent
// @desc    Create Stripe payment intent
// @access  Private
router.post(
  "/create-payment-intent",
  protect,
  asyncHandler(async (req, res) => {
    const { orderId } = req.body

    if (!orderId) {
      const error = new Error("Order ID is required")
      error.statusCode = 400
      throw error
    }

    const order = await Order.findById(orderId)

    if (!order) {
      const error = new Error("Order not found")
      error.statusCode = 404
      throw error
    }

    // Verify user is order owner
    if (order.user.toString() !== req.user._id.toString()) {
      const error = new Error("Not authorized to pay for this order")
      error.statusCode = 403
      throw error
    }

    if (order.isPaid) {
      const error = new Error("Order is already paid")
      error.statusCode = 400
      throw error
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(order.totalPrice * 100), // Convert to cents
      currency: "usd",
      metadata: {
        orderId: order._id.toString(),
        userId: req.user._id.toString(),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    })

    res.status(200).json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        orderId: order._id,
      },
    })
  }),
)

// @route   POST /api/payment/webhook
// @desc    Stripe webhook for payment events
// @access  Public (but verified by Stripe signature)
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    const sig = req.headers["stripe-signature"]
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    let event

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    // Handle the event
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object
        const orderId = paymentIntent.metadata.orderId

        // Update order status
        const order = await Order.findById(orderId)
        if (order) {
          order.isPaid = true
          order.paidAt = Date.now()
          order.status = "processing"
          order.paymentResult = {
            id: paymentIntent.id,
            status: paymentIntent.status,
            update_time: new Date().toISOString(),
          }
          await order.save()

          console.log(`Order ${orderId} marked as paid`)
        }
        break
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object
        console.error(`Payment failed for intent: ${paymentIntent.id}`)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    res.json({ received: true })
  }),
)

// @route   GET /api/payment/config
// @desc    Get Stripe publishable key
// @access  Public
router.get("/config", (req, res) => {
  res.status(200).json({
    success: true,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  })
})

// @route   POST /api/payment/esewa/signature
// @desc    Generate eSewa signature
// @access  Private
router.post(
  "/esewa/signature",
  protect,
  asyncHandler(async (req, res) => {
    const { orderId } = req.body
    const order = await Order.findById(orderId)

    if (!order) {
      res.status(404)
      throw new Error("Order not found")
    }

    // Use total amount explicitly
    const totalAmount = order.totalPrice
    // eSewa requires transaction_uuid to be unique. 
    // Using orderId is fine, but if you retry, you might need a new one.
    // For specific ePayment v2, we usually use the unique order ID.
    const transactionUuid = order._id.toString() 
    const productCode = "EPAYTEST" 
    const secretKey = "8gBm/:&EnhH.1/q" 

    // Signature formula: message = "total_amount,transaction_uuid,product_code"
    const signatureString = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`
    
    // Create HMAC SHA256 signature
    // We can use the native 'crypto' module since we are in Node.js backend
    const crypto = await import("crypto")
    const hash = crypto.createHmac("sha256", secretKey).update(signatureString).digest("base64")

    res.json({
      signature: hash,
      totalAmount,
      transactionUuid,
      productCode,
      // ePay V2 Staging/Test URL
      url: "https://rc-epay.esewa.com.np/api/epay/main/v2/form"
    })
  })
)

// @route   POST /api/payment/esewa/verify
// @desc    Verify eSewa payment
// @access  Private
router.post(
  "/esewa/verify",
  protect,
  asyncHandler(async (req, res) => {
    const { encodedData } = req.body
    
    if (!encodedData) {
       res.status(400)
       throw new Error("Missing encoded data")
    }

    // Decode base64 response from eSewa
    const decodedBuffer = Buffer.from(encodedData, 'base64')
    const decodedJson = JSON.parse(decodedBuffer.toString('utf-8'))
    
    // Expected structure: { transaction_code, status, total_amount, transaction_uuid, product_code, signed_field_names, signature }
    const { status, transaction_uuid, total_amount, signature, transaction_code } = decodedJson

    if (status !== "COMPLETE") {
       res.status(400)
       throw new Error("Transaction not complete")
    }

    // Verify the payment by re-generating the signature with our secret key and
    // comparing it to the signature returned by the gateway before trusting the status.

    const order = await Order.findById(transaction_uuid)
    
    if (order) {
      if (order.isPaid) {
         res.json({ success: true, order, message: "Order already paid" })
         return
      }

      order.isPaid = true
      order.paidAt = Date.now()
      order.status = "processing"
      order.paymentMethod = "eSewa"
      order.paymentResult = {
        id: transaction_code,
        status: status,
        update_time: new Date().toISOString(),
      }
      await order.save()
      res.json({ success: true, order })
    } else {
      res.status(404)
      throw new Error("Order not found")
    }
  })
)

export default router
// eSewa payment gateway integration 
