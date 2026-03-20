package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	dbPath := "data/nowen-reader.db"
	if len(os.Args) > 1 {
		dbPath = os.Args[1]
	}

	fmt.Printf("=== SQLite Database Check Tool ===\n")
	fmt.Printf("Database: %s\n\n", dbPath)

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// 1. 运行完整性检查
	fmt.Println("[1] Running PRAGMA integrity_check...")
	rows, err := db.Query("PRAGMA integrity_check")
	if err != nil {
		log.Fatalf("integrity_check failed: %v", err)
	}
	var issues []string
	for rows.Next() {
		var result string
		rows.Scan(&result)
		issues = append(issues, result)
		fmt.Printf("  %s\n", result)
	}
	rows.Close()

	if len(issues) == 1 && issues[0] == "ok" {
		fmt.Println("\n✅ Database is healthy!")
		return
	}

	fmt.Printf("\n❌ Found %d integrity issues\n", len(issues))

	// 2. 尝试列出所有表
	fmt.Println("\n[2] Listing tables...")
	tableRows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
	if err != nil {
		fmt.Printf("  Failed: %v\n", err)
	} else {
		for tableRows.Next() {
			var name string
			tableRows.Scan(&name)
			// 统计行数
			var count int
			err := db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) FROM "%s"`, name)).Scan(&count)
			if err != nil {
				fmt.Printf("  📋 %s — ERROR reading: %v\n", name, err)
			} else {
				fmt.Printf("  📋 %s — %d rows\n", name, count)
			}
		}
		tableRows.Close()
	}

	// 3. 尝试恢复：导出到新数据库
	fmt.Println("\n[3] Attempting recovery via VACUUM INTO...")
	newDBPath := dbPath + ".recovered"
	os.Remove(newDBPath) // 删除旧的恢复文件

	_, err = db.Exec(fmt.Sprintf(`VACUUM INTO '%s'`, newDBPath))
	if err != nil {
		fmt.Printf("  ❌ VACUUM INTO failed: %v\n", err)
		fmt.Println("  Trying alternative recovery: export/import...")

		// 备选方案：创建新数据库并逐表复制
		newDB, err2 := sql.Open("sqlite", newDBPath)
		if err2 != nil {
			log.Fatalf("  Failed to create recovery database: %v", err2)
		}
		defer newDB.Close()

		// 获取所有表的建表语句
		schemaRows, _ := db.Query("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
		var schemas []string
		for schemaRows.Next() {
			var s string
			schemaRows.Scan(&s)
			schemas = append(schemas, s)
		}
		schemaRows.Close()

		// 在新数据库中创建表
		for _, s := range schemas {
			if _, err := newDB.Exec(s); err != nil {
				fmt.Printf("  Warning: failed to create table: %v\n", err)
			}
		}
		fmt.Printf("  Created %d tables in recovery database\n", len(schemas))
		fmt.Printf("  Recovery database saved to: %s\n", newDBPath)
		fmt.Println("  ⚠️  Manual data migration needed — please contact developer")
	} else {
		fmt.Printf("  ✅ Recovery successful! New database: %s\n", newDBPath)
		fmt.Println("\n  To use the recovered database:")
		fmt.Println("    1. Stop the server")
		fmt.Printf("    2. Rename %s → %s.corrupt\n", dbPath, dbPath)
		fmt.Printf("    3. Rename %s → %s\n", newDBPath, dbPath)
		fmt.Println("    4. Delete .db-shm and .db-wal files")
		fmt.Println("    5. Restart the server")
	}
}
