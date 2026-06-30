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

4. **Bootstrap the first organisation and admin account**

   Public registration has been removed. The only way to create the first organisation
   and admin account is through a database seed or manual insert:

   ```bash
   # Option A: Use the Prisma seed script
   npx prisma db seed

   # Option B: Manual insert via Prisma Studio
   npx prisma studio
   ```

   Create an `Organisation` row, then create a `User` row with `role: ADMIN` and
   `isActive: true` linked to that organisation. Subsequent users are added exclusively
   through the admin invite flow inside the app.

   > **Important**: There is no public registration endpoint. All new users must be
   > invited by an existing admin from the Entreprise management page.

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

- Routes: kebab-case (`/api/v1/auth/login`)
- Files: camelCase for utilities (`catchAsync.ts`), PascalCase for classes (`AppError.ts`)
- Functions: camelCase (`createUser`, `validateEmail`)
- Constants: UPPER_SNAKE_CASE (`JWT_SECRET`)

### Error Codes

Use descriptive error codes for API responses:

```typescript
// Controller
try {
  const result = await authService.login(email, password);
  res.status(200).json({ success: true, data: result });
} catch (error) {
  // Caught by errorHandler and formatted as:
  // { success: false, error: { code: "INVALID_CREDENTIALS", message: "..." } }
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
export const getOrganisation = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const org = await organisationService.getOrganisation(req.user!.organisationId);
    res.status(200).json({ success: true, data: org });
  }
);

// ❌ Bad
export const getOrganisation = catchAsync(async (req: any, res: any) => {
  const org = await organisationService.getOrganisation(req.user.organisationId);
  res.json(org);
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
- `LLM_API_KEY` - API key for LLM service (set only when `LLM_PROVIDER=cloud`)
- `LLM_API_URL` - base URL of the cloud provider endpoint, for Mistral use `https://api.mistral.ai/v1`
- `LLM_MODEL` - cloud model name, for Mistral use `mistral-small-latest`
- `SMTP_HOST` - SMTP server for invite emails
- `SMTP_PORT` (default: `587`)
- `SMTP_USER` - SMTP auth username
- `SMTP_PASS` - SMTP auth password
- `SMTP_FROM` (default: `LinkUp <noreply@linkup.com>`)

> If SMTP variables are not set, invite links are printed to the server console instead (useful during development).

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








## File Storage

CV files are stored in a Cloudflare R2 bucket (or any S3-compatible provider such as MinIO or AWS S3).

### Setting up Cloudflare R2

1. **Create a Cloudflare account** at [cloudflare.com](https://cloudflare.com) and enable R2 from the dashboard.

2. **Create a bucket** named `cv-files`:
   - Dashboard → R2 Object Storage → Create bucket
   - Name: `cv-files`

3. **Enable public access** (required so uploaded URLs can be opened in a browser):
   - Open the bucket → Settings → Public access
   - Enable "R2.dev subdomain" — Cloudflare shows you a URL like `https://pub-xxxx.r2.dev`
   - Alternatively, add a custom domain under the same settings tab.

4. **Create API credentials**:
   - Dashboard → R2 → Manage R2 API tokens → Create API token
   - Permissions: Object Read & Write on bucket `cv-files`
   - Copy the **Access Key ID** and **Secret Access Key**.

5. **Find your Account ID**:
   - Top-right of the Cloudflare dashboard, or the R2 overview page.

6. **Set environment variables** in `.env`:

```env
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=<access_key_id>
STORAGE_SECRET_KEY=<secret_access_key>
STORAGE_BUCKET=cv-files
STORAGE_PUBLIC_URL=https://pub-xxxx.r2.dev   # from step 3
```

> `STORAGE_PUBLIC_URL` is the base URL returned by `uploadFile`. It defaults to `STORAGE_ENDPOINT` if not set, which works for local MinIO but **not** for R2 (the API endpoint requires auth). Always set it when using R2.

### Setting up MinIO (local development)

```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Then open `http://localhost:9001`, create a bucket named `cv-files`, and set its access policy to **public**.

```env
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=cv-files
# STORAGE_PUBLIC_URL not needed — defaults to STORAGE_ENDPOINT
```

### Storage API (`src/lib/storage.ts`)

```typescript
import { uploadFile, deleteFile } from "@/lib/storage";

// Upload
const url = await uploadFile(buffer, "resume.pdf", "application/pdf");
// → "https://pub-xxxx.r2.dev/cv-files/resume.pdf"

// Delete
await deleteFile(url);
```

Both functions throw an `AppError` on failure — errors are caught by the global error handler automatically.

## Support

For questions or issues, refer to:
- TypeScript docs: https://www.typescriptlang.org/docs/
- Express docs: https://expressjs.com/
- Prisma docs: https://www.prisma.io/docs/
