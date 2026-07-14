package store

import "strings"

func init() {
	Migrations = append(Migrations, Migration{
		Version:     34,
		Description: "Add user-bound API keys",
		SQL: strings.Join([]string{
			`CREATE TABLE IF NOT EXISTS "ApiKey" (
				"id"         TEXT NOT NULL PRIMARY KEY,
				"userId"     TEXT NOT NULL,
				"name"       TEXT NOT NULL,
				"keyPrefix"  TEXT NOT NULL,
				"secretHash" TEXT NOT NULL,
				"expiresAt"  DATETIME,
				"lastUsedAt" DATETIME,
				"revokedAt"  DATETIME,
				"createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId")
					REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
			);`,
			`CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_secretHash_key" ON "ApiKey"("secretHash");`,
			`CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");`,
			`CREATE INDEX IF NOT EXISTS "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");`,
		}, "\n"),
	})
}
