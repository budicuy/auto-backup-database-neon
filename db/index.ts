import { drizzle } from 'drizzle-orm/neon-serverless';
import { neon } from '@neondatabase/serverless';
import { Client } from 'pg';
import * as schema from './schema';

// Standard connection string (pooled or unpooled)
const databaseUrl = process.env.DATABASE_URL!;

// Drizzle instance for normal server action / route queries using serverless driver
export const db = drizzle(neon(databaseUrl), { schema });

export function getDirectPgClient() {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  return new Client({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false // Required for Neon SSL connection
    }
  });
}
