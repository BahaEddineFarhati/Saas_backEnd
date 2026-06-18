# Linkup API - Express + TypeScript REST API

Production-quality Node.js backend for the AI CV Screener SaaS product.

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL 14+
- Prisma (already installed)

### Setup

1. **Install dependencies**

```bash
npm install
```

2. **Configure environment variables**

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `FRONTEND_URL`: Frontend origin for CORS

3. **Run development server**

```bash
npm run dev
```

The server will start on `http://localhost:3001` and automatically reload on file changes.

## Project Structure

```
apps/api/
├── src/
│   ├── index.ts               # Application entry point
│   ├── app.ts                 # Express app factory
│   ├── config.ts              # Environment variable validation
│   ├── routes/
│   │   └── index.ts           # API routes (v1)
│   ├── controllers/           # HTTP request handlers
│   ├── services/              # Business logic layer
│   ├── middleware/            # Express middleware
│   │   ├── errorHandler.ts    # Global error handler
│   │   ├── notFound.ts        # 404 handler
│   │   └── requestLogger.ts   # HTTP logging
│   ├── lib/
│   │   └── prisma.ts          # Prisma client singleton
│   ├── types/
│   │   └── index.ts           # Shared TypeScript types
│   └── utils/
│       ├── AppError.ts        # Custom error class
│       └── catchAsync.ts      # Async error wrapper
├── dist/                      # Compiled JavaScript
├── .env                       # Local environment variables
├── .env.example               # Environment template
├── package.json
└── tsconfig.json
```

## Architecture

### Layered Architecture

The API follows a **three-layer architecture**:

1. **Controllers** (`controllers/`)
   - Handle HTTP request/response logic only
   - Receive typed parameters from routes
   - Delegate business logic to services
   - Return status codes and JSON responses
   - Always wrapped in `catchAsync()`

2. **Services** (`services/`)
   - Contain all business logic
   - Never import `req` or `res` objects
   - Receive plain JavaScript arguments
   - Return plain values or throw `AppError`
   - Can call Prisma or external APIs

3. **Routes** (`routes/`)
   - Define HTTP endpoints and HTTP methods
   - Map requests to controllers
   - Handle request validation (in future)
   - Mount controllers with error handling

### Error Handling

**AppError** - Custom error class for operational errors:

```typescript
throw new AppError(
  "Email already registered",
  409,
  "EMAIL_EXISTS"
);
```

The global error handler (`middleware/errorHandler.ts`) catches all errors:

- `AppError` instances → returns `statusCode`, `code`, and `message`
- Prisma `P2002` (unique violation) → returns 409 Conflict
- Prisma `P2025` (not found) → returns 404 Not Found
- Other errors → returns 500 in production, full stack in development

### Request Lifecycle

```
HTTP Request
    ↓
Helmet (security headers)
    ↓
CORS (frontend origin check)
    ↓
Body Parser (JSON/URL-encoded)
    ↓
Request Logger (morgan)
    ↓
Router → Controller → Service (or thrown error)
    ↓
Response / Error Handler
    ↓
HTTP Response
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled JavaScript (production) |
| `npm run typecheck` | Check TypeScript types without compiling |

## TypeScript Configuration

- **Target**: ES2020
- **Module**: CommonJS
- **Strict Mode**: Enabled (strict null checks, implicit any detection, etc.)
- **Path Aliases**: `@/` → `src/`
- **Source Maps**: Enabled for readable stack traces

## Conventions

### Naming

- Routes: kebab-case (`/api/v1/auth/register`)
- Files: camelCase for utilities (`catchAsync.ts`), PascalCase for classes (`AppError.ts`)
- Functions: camelCase (`createUser`, `validateEmail`)
- Constants: UPPER_SNAKE_CASE (`JWT_SECRET`)

### Error Codes

Use descriptive error codes for API responses:

```typescript
// Controller
try {
  const user = await userService.register(body);
  res.status(201).json({ success: true, data: user });
} catch (error) {
  // Caught by errorHandler and formatted as:
  // { success: false, error: { code: "EMAIL_EXISTS", message: "..." } }
}
```

### Async Handlers

Always wrap async controllers in `catchAsync()` to automatically forward errors:

```typescript
// ✅ Good
export const getUser = catchAsync(async (req, res) => {
  const user = await userService.getById(req.params.id);
  res.json({ success: true, data: user });
});

// ❌ Bad - missing error handling
export const getUser = async (req, res) => {
  const user = await userService.getById(req.params.id);
  res.json({ success: true, data: user });
};
```


### Start Redis (required before running the API)

This project uses Redis for job queues via BullMQ. Start it with Docker:

```bash
docker compose up -d
```

To stop it:

```bash
docker compose down
```

> Redis will be available at `redis://localhost:6379`

### Then start the API

```bash
npm run dev
```

### Type Safety

- No `any` types anywhere
- All function parameters and return types must be typed
- Use interfaces for request/response bodies
- Import types from `@/types`

```typescript
// ✅ Good
export const register = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.register(req.body);
    res.status(201).json({ success: true, data: user });
  }
);

// ❌ Bad
export const register = catchAsync(async (req: any, res: any) => {
  const user = await userService.register(req.body);
  res.json(user);
});
```

## Environment Variables



### Required Variables

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for signing JWT tokens
- `FRONTEND_URL` - Frontend origin (for CORS)

### Optional Variables

- `PORT` (default: `3001`)
- `NODE_ENV` (default: `development`)
- `JWT_REFRESH_SECRET` (defaults to `JWT_SECRET`)
- `LLM_API_KEY` - API key for LLM service

All required variables are validated at startup. If any are missing, the server logs a clear error and exits immediately.

## API Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    "id": "123",
    "email": "user@example.com"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "EMAIL_EXISTS",
    "message": "Email already registered"
  }
}
```

## Health Check

The `/health` endpoint is always available and never requires authentication:

```
GET /health

Response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "environment": "development"
}
```

## Future Enhancements

- Add request validation middleware (e.g., `express-validator`)
- Add authentication/authorization middleware
- Add request rate limiting
- Add OpenAPI/Swagger documentation
- Add structured logging (e.g., `pino`, `winston`)
- Add monitoring and error tracking (e.g., Sentry)
- Add database transaction support in services

## Development Tips

### Debugging

In development, errors include full stack traces for easy debugging. Check your terminal where the server is running.

### Hot Reload

Changes to TypeScript files are automatically detected and the server restarts automatically. Just save the file!

### Type Checking

Run `npm run typecheck` to verify all TypeScript types without compiling. Useful for quick checks during development.

### Testing

(To be implemented in a future sprint)

## Deployment

To run in production:

1. Build the project: `npm run build`
2. Set `NODE_ENV=production`
3. Set production values for all environment variables
4. Start: `npm start`

The compiled JavaScript in `dist/` is what gets executed. Make sure to rebuild after code changes.








## Support

For questions or issues, refer to:
- TypeScript docs: https://www.typescriptlang.org/docs/
- Express docs: https://expressjs.com/
- Prisma docs: https://www.prisma.io/docs/
