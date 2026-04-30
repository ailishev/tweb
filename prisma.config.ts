import {defineConfig} from 'prisma/config';

export default defineConfig({
  schema: 'backend/prisma/schema.prisma',
  migrations: {
    path: 'backend/prisma/migrations'
  },
  datasource: {
    url: 'postgresql://neondb_owner:npg_NBD6es1thrVL@ep-solitary-scene-amr2cnwa-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
  }
});
