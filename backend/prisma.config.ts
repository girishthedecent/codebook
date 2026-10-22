import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Left unresolved when unset so `prisma generate` works before .env exists.
    url: process.env.DATABASE_URL,
  },
});
