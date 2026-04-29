# Full-stack monorepo scaffold (Vercel-ready)

## Monorepo layout
- `frontend/` — frontend workspace package (Vite scripts).
- `backend/` — backend workspace package (Express + Prisma).
- `backend/api/index.js` — Vercel serverless entrypoint.
- `vercel.json` — rewrite API traffic and serve SPA output.

## API surface
- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/user/me`
- `GET /api/chats/list`
- `GET /api/chats/:id/messages`
- `POST /api/messages/send`

## Prisma models
- `User`
- `Session`
- `PhoneOtp`
- `Profile`
- `Chat`
- `ChatMember`
- `Message`

## Local run
```bash
pnpm install
pnpm dev:backend
pnpm dev:frontend
```

## Vercel
- Build command: `pnpm build:frontend`
- Output directory: `dist`
- Backend route: `/api/* -> backend/api/index.js`
