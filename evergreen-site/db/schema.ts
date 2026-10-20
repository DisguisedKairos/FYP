import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("bank_users", {
  id: text("id").primaryKey(), namespace: text("namespace").notNull(),
  name: text("name").notNull(), email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("bank_users_namespace_email").on(t.namespace, t.email)]);

export const accounts = sqliteTable("bank_accounts", {
  id: text("id").primaryKey(), namespace: text("namespace").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(), number: text("number").notNull(),
  balanceCents: integer("balance_cents").notNull().default(0),
  status: text("status").notNull().default("active"), createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("bank_accounts_namespace_number").on(t.namespace, t.number),
  index("bank_accounts_user").on(t.userId),
  check("bank_account_balance", sql`${t.balanceCents} >= 0 AND ${t.balanceCents} <= 9000000000000`),
  check("bank_account_status", sql`${t.status} IN ('active', 'closed')`),
]);

export const sessions = sqliteTable("bank_sessions", {
  tokenHash: text("token_hash").primaryKey(), namespace: text("namespace").notNull(),
  userId: text("user_id").references(() => users.id), csrfToken: text("csrf_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("bank_sessions_expiry").on(t.expiresAt)]);

export const operations = sqliteTable("bank_operations", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id),
  requestId: text("request_id").notNull(), payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("bank_operations_request").on(t.userId, t.requestId)]);

export const transactions = sqliteTable("bank_transactions", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull().references(() => accounts.id),
  operationId: text("operation_id").references(() => operations.id), type: text("type").notNull(),
  description: text("description").notNull(), amountCents: integer("amount_cents").notNull(),
  counterparty: text("counterparty").notNull(), status: text("status").notNull().default("completed"),
  createdAt: text("created_at").notNull(), reference: text("reference").notNull(),
  isInternal: integer("is_internal").notNull().default(0),
}, (t) => [index("bank_transactions_account_date").on(t.accountId, t.createdAt)]);

export const authAttempts = sqliteTable("bank_auth_attempts", {
  key: text("key").primaryKey(), attempts: integer("attempts").notNull().default(0),
  resetAt: integer("reset_at").notNull(),
});
