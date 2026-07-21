# Admin Setup Guide

This guide explains how to create admin accounts for your e-commerce application.

## Security Notice
Admin accounts have full access to manage products, orders, and users. Keep admin credentials secure!

---

## Method 1: Using the Admin Creation Script (Recommended for First Admin)

This is the easiest way to create your first admin account.

### Steps:

1. **Navigate to the backend folder:**
   ```bash
   cd backend
   ```

2. **Edit the script with your admin details:**
   Open `scripts/createAdmin.js` and change:
   ```javascript
   const adminData = {
     name: "Your Name",
     email: "youremail@example.com",
     password: "YourSecurePassword123",
     role: "admin",
   }
   ```

3. **Run the script:**
   ```bash
   node scripts/createAdmin.js
   ```

4. **Login to the admin panel:**
   - Go to `http://localhost:5173/login`
   - Use your admin email and password
   - You'll automatically have access to the admin dashboard at `/admin`

---

## Method 2: Using the Admin Registration API (For Additional Admins)

Use this method to create additional admin accounts via API.

### Steps:

1. **Add ADMIN_SECRET_KEY to your .env file:**
   ```env
   ADMIN_SECRET_KEY=your_super_secret_random_string_here
   ```
   
   Generate a secure key using:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Make a POST request to register admin:**
   
   **Endpoint:** `POST http://localhost:5000/api/auth/register-admin`
   
   **Body (JSON):**
   ```json
   {
     "name": "Admin Name",
     "email": "admin@example.com",
     "password": "SecurePassword123",
     "adminSecretKey": "your_admin_secret_key_from_env"
   }
   ```

   **Using curl:**
   ```bash
   curl -X POST http://localhost:5000/api/auth/register-admin \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Admin Name",
       "email": "admin@example.com",
       "password": "SecurePassword123",
       "adminSecretKey": "your_admin_secret_key_from_env"
     }'
   ```

3. **The admin account is created and you can login immediately**

---

## Method 3: Promote Existing User to Admin (MongoDB Direct)

If you already have a user account and want to make it an admin:

### Using MongoDB Compass or Studio 3T:
1. Connect to your MongoDB database
2. Find the `users` collection
3. Find the user by email
4. Change the `role` field from `"user"` to `"admin"`
5. Save the changes

### Using MongoDB Shell:
```javascript
use ecommerce

db.users.updateOne(
  { email: "user@example.com" },
  { $set: { role: "admin" } }
)
```

---

## Admin Login

Once you have an admin account:

1. **Frontend Login:**
   - Go to: `http://localhost:5173/login`
   - Enter your admin email and password
   - After login, navigate to: `http://localhost:5173/admin`

2. **Admin Dashboard Features:**
   - View analytics and sales data
   - Manage all products (create, edit, delete)
   - Manage all orders (view, update status)
   - Manage all users (view, deactivate)

---

## Security Best Practices

1. **Use Strong Passwords:** Minimum 12 characters with uppercase, lowercase, numbers, and symbols
2. **Keep ADMIN_SECRET_KEY Secret:** Never commit it to version control or share it
3. **Rotate Keys Regularly:** Change JWT_SECRET and ADMIN_SECRET_KEY periodically
4. **Limit Admin Accounts:** Only create admin accounts for trusted team members
5. **Monitor Admin Activity:** Keep logs of admin actions in production
6. **Use HTTPS in Production:** Always use SSL/TLS for admin operations

---

## Troubleshooting

### "Admin secret key invalid"
- Check that ADMIN_SECRET_KEY is set correctly in your .env file
- Make sure you're sending the exact same key in the API request

### "User already exists"
- This email is already registered
- Use the login page instead or try a different email

### "Cannot connect to MongoDB"
- Ensure MongoDB is running
- Check MONGODB_URI in your .env file

### "JWT token missing"
- Clear your browser cookies and login again
- Check that cookies are enabled in your browser
