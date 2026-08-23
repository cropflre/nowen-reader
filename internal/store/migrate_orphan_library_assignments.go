package store

func init() {
	Migrations = append(Migrations, Migration{
		Version:     42,
		Description: "Release content rows assigned to deleted libraries for safe scanner rebinding",
		SQL: `UPDATE "Comic"
		      SET "libraryId" = ''
		      WHERE COALESCE("libraryId", '') <> ''
		        AND NOT EXISTS (
		          SELECT 1 FROM "Library" l WHERE l."id" = "Comic"."libraryId"
		        );`,
	})
}
