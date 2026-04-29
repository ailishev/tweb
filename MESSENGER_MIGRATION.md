# Messenger backend migration scaffold

This repository now includes a standalone backend scaffold under `backend/` using Express + Prisma + PostgreSQL.

## Included modules
- `POST /auth/request-otp`
- `POST /auth/verify-otp`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /user/me`
- `GET /user/:id`
- `GET /chats/list`
- `GET /chats/:id/messages`
- `POST /messages/send`

## Prisma models
- User
- Session
- PhoneOtp
- Profile
- Chat
- ChatMember
- Message

## Run backend
```bash
cd backend
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
```

## Frontend API layer scaffold
Added `src/services` with:
- `apiClient.ts`
- `authService.ts`
- `userService.ts`
- `chatService.ts`
- `messageService.ts`

These services are ready to be wired into existing stores/managers as the next migration phase.
