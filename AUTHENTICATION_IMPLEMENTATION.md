# Authentication System Implementation

## Overview
This document describes the complete login and logout system implementation for the SaaS platform.

## Implementation Summary

### Files Created

1. **src/utils/jwt.ts** - JWT token generation and verification utilities
   - `generateAccessToken()` - Creates 15-minute access tokens
   - `generateRefreshToken()` - Creates 7-day refresh tokens
   - `verifyAccessToken()` - Validates access tokens
   - `verifyRefreshToken()` - Validates refresh tokens

2. **src/services/authService.ts** - Core authentication business logic
   - `login(email, password)` - Authenticates user and issues tokens
   - `logout(refreshToken)` - Invalidates refresh token (idempotent)
   - `refreshAccessToken(refreshToken)` - Issues new access token

3. **src/controllers/authController.ts** - HTTP endpoint handlers
   - `loginController` - POST /api/v1/auth/login
   - `logoutController` - POST /api/v1/auth/logout
   - `refreshTokenController` - POST /api/v1/auth/refresh

4. **src/routes/authRoutes.ts** - Route definitions for auth endpoints

5. **src/middleware/authMiddleware.ts** - Token verification middleware
   - `verifyAuthToken` - Protects routes requiring authentication

## API Endpoints

### 1. Login
**POST /api/v1/auth/login**

Request:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Success Response (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "user": {
      "id": "cuid123",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "RECRUITER",
      "organisationId": "org123"
    }
  }
}
```

Error Response (401):
```json
{
  "success": false,
  "error": {
    "message": "Invalid email or password",
    "code": "INVALID_CREDENTIALS"
  }
}
```

### 2. Logout
**POST /api/v1/auth/logout**

Request:
```json
{
  "refreshToken": "eyJhbGc..."
}
```

Success Response (200):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Note:** Logout is idempotent. Calling logout twice with the same token returns success both times.

### 3. Refresh Token
**POST /api/v1/auth/refresh**

Request:
```json
{
  "refreshToken": "eyJhbGc..."
}
```

Success Response (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc..."
  }
}
```

Error Response (401):
```json
{
  "success": false,
  "error": {
    "message": "Invalid or expired refresh token",
    "code": "INVALID_REFRESH_TOKEN"
  }
}
```

## Security Features

### 1. Token Separation
- **Access Token**: 15-minute expiration, used for API requests
- **Refresh Token**: 7-day expiration, used only to obtain new access tokens
- Tokens are distinguished by a `type` field in the payload

### 2. Password Security
- Passwords are hashed using bcrypt before storage (already implemented in schema)
- Password verification uses bcrypt's secure comparison

### 3. Generic Error Messages
- Login returns "Invalid email or password" for both:
  - Non-existent emails
  - Incorrect passwords
- This prevents attackers from enumerating valid email addresses

### 4. Refresh Token Storage
- All issued refresh tokens are stored in the database
- Allows server-side invalidation on logout
- Expired tokens are automatically cleaned up when refresh is attempted

### 5. Token Expiration Handling
- Expired refresh tokens are deleted from the database when:
  - Refresh endpoint is called with an expired token
  - Logout is called with an expired token
- New access tokens cannot be obtained from expired refresh tokens

## Usage with Protected Routes

To protect a route requiring authentication, use the `verifyAuthToken` middleware:

```typescript
import { Router } from "express";
import { verifyAuthToken } from "@/middleware/authMiddleware";
import { catchAsync } from "@/utils/catchAsync";

const router = Router();

router.get(
  "/profile",
  verifyAuthToken,
  catchAsync(async (req, res) => {
    // req.user.userId contains the authenticated user's ID
    const userId = req.user?.userId;
    res.json({ message: `User ${userId} profile` });
  })
);
```

## Token Lifecycle Example

1. **User logs in** (POST /auth/login)
   - Server validates credentials
   - Server generates access token (15 min expiry) and refresh token (7 day expiry)
   - Refresh token stored in database
   - Both tokens returned to client

2. **Client uses access token** (API request with Bearer token)
   - Client includes access token in Authorization header: `Bearer eyJhbGc...`
   - Server validates token with `verifyAuthToken` middleware
   - Request proceeds with access granted

3. **After 15 minutes**
   - Access token expires
   - Client automatically calls refresh endpoint with refresh token
   - Server validates refresh token and generates new access token
   - Session continues transparently

4. **User logs out**
   - Client sends refresh token to logout endpoint
   - Server deletes refresh token from database
   - Session fully invalidated

5. **After 7 days (refresh token expires)**
   - Refresh token becomes invalid
   - Client cannot obtain new access tokens
   - User must log in again

## Error Handling

All authentication errors are handled by the global error handler middleware. Custom error codes include:

| Code | Status | Meaning |
|------|--------|---------|
| INVALID_CREDENTIALS | 401 | Wrong email or password |
| INVALID_ACCESS_TOKEN | 401 | Access token invalid or expired |
| INVALID_REFRESH_TOKEN | 401 | Refresh token invalid or expired |
| INVALID_INPUT | 400 | Missing required fields |
| MISSING_AUTH_HEADER | 401 | No Authorization header |
| INVALID_AUTH_FORMAT | 401 | Malformed Authorization header |

## Testing the Implementation

### 1. Test Login
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### 2. Test Refresh
```bash
curl -X POST http://localhost:3001/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"eyJhbGc..."}'
```

### 3. Test Protected Route
```bash
curl -X GET http://localhost:3001/api/v1/profile \
  -H "Authorization: Bearer eyJhbGc..."
```

### 4. Test Logout
```bash
curl -X POST http://localhost:3001/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"eyJhbGc..."}'
```

## Implementation Status

✅ All termination criteria met:
- ✅ Logging in with correct credentials returns both access and refresh tokens
- ✅ Logging in with incorrect credentials returns generic error message
- ✅ Refresh endpoint issues new access token with valid refresh token
- ✅ Expired refresh tokens are deleted and return error
- ✅ Logout is idempotent (calling twice returns success both times)
