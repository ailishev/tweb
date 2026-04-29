import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3001),
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,
  otpTtlMs: 1000 * 60 * 5
};
