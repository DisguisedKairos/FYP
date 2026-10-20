CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`number` text NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `bank_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_account_balance" CHECK("bank_accounts"."balance_cents" >= 0 AND "bank_accounts"."balance_cents" <= 9000000000000),
	CONSTRAINT "bank_account_status" CHECK("bank_accounts"."status" IN ('active', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_namespace_number` ON `bank_accounts` (`namespace`,`number`);--> statement-breakpoint
CREATE INDEX `bank_accounts_user` ON `bank_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `bank_auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `bank_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_operations_request` ON `bank_operations` (`user_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `bank_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`user_id` text,
	`csrf_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `bank_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bank_sessions_expiry` ON `bank_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`operation_id` text,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`counterparty` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`created_at` text NOT NULL,
	`reference` text NOT NULL,
	`is_internal` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `bank_operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bank_transactions_account_date` ON `bank_transactions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bank_users` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_users_namespace_email` ON `bank_users` (`namespace`,`email`);