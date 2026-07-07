import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Configuration, schedule, and logs for multiple backup target databases
export const databases = pgTable("databases", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  encryptedUrl: text("encrypted_url").notNull(),
  interval: text("interval", {
    enum: ["3_DAYS", "1_WEEK", "1_MONTH", "1_YEAR", "CUSTOM"],
  })
    .default("1_WEEK")
    .notNull(),
  customDays: integer("custom_days"),
  maxFiles: integer("max_files").default(10).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastStatus: text("last_status", { enum: ["SUCCESS", "FAILED"] }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export type DatabaseRecord = typeof databases.$inferSelect;
