import { body, param } from "express-validator"

/**
 * Centralised password policy.
 * Coursework requirement: minimum 12 characters, with upper, lower, number and special.
 * Keeping this in one place means the policy is consistent everywhere it is enforced.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/**
 * Reusable strength check for use outside express-validator (e.g. change/reset password).
 * Returns { valid: boolean, message?: string }.
 */
export const validatePasswordStrength = (password) => {
  if (typeof password !== "string") {
    return { valid: false, message: "Password must be a string" }
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` }
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters` }
  }
  if (!/[a-z]/.test(password)) return { valid: false, message: "Password must include a lowercase letter" }
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Password must include an uppercase letter" }
  if (!/[0-9]/.test(password)) return { valid: false, message: "Password must include a number" }
  if (!/[^A-Za-z0-9]/.test(password)) return { valid: false, message: "Password must include a special character" }
  return { valid: true }
}

// express-validator chain for the password field, mirroring the policy above.
const passwordRules = () =>
  body("password")
    .isString()
    .withMessage("Password must be a string")
    .isLength({ min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })
    .withMessage(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`)
    .matches(/[a-z]/)
    .withMessage("Password must include a lowercase letter")
    .matches(/[A-Z]/)
    .withMessage("Password must include an uppercase letter")
    .matches(/[0-9]/)
    .withMessage("Password must include a number")
    .matches(/[^A-Za-z0-9]/)
    .withMessage("Password must include a special character")

// Email field chain. `.isString()` FIRST is the key NoSQL-injection guard:
// if `email` arrives as an object/array (e.g. {"$ne": null}) the request is rejected
// before it ever reaches a Mongo query.
const emailRules = () =>
  body("email")
    .isString()
    .withMessage("Invalid email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail()

export const registerValidator = [
  body("name")
    .isString()
    .withMessage("Name must be a string")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters"),
  emailRules(),
  passwordRules(),
]

export const loginValidator = [
  emailRules(),
  body("password").isString().withMessage("Password is required").notEmpty().withMessage("Password is required"),
]

// For endpoints that only take an email (send-otp, forgot-password).
export const emailValidator = [emailRules()]

export const productValidator = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Product name is required")
    .isLength({ max: 100 })
    .withMessage("Name cannot exceed 100 characters"),
  body("description")
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .isLength({ max: 2000 })
    .withMessage("Description cannot exceed 2000 characters"),
  body("price")
    .notEmpty()
    .withMessage("Price is required")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),
  body("category").notEmpty().withMessage("Category is required"),
  body("stock")
    .notEmpty()
    .withMessage("Stock is required")
    .isInt({ min: 0 })
    .withMessage("Stock must be a non-negative integer"),
]

export const idValidator = [param("id").isMongoId().withMessage("Invalid ID format")]
