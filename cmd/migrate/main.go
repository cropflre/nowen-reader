package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime)

	importFrom := flag.String("import", "", "Import data from a Prisma/Next.js SQLite database file")
	dbPath := flag.String("db", "", "Target database path (default: auto-detect)")
	showHelp := flag.Bool("help", false, "Show help")
	flag.Parse()

	if *showHelp {
		printUsage()
		return
	}

	// Determine target database path
	targetDB := *dbPath
	if targetDB == "" {
		targetDB = config.DatabaseURL()
	}

	// Initialize target database
	log.Printf("Database: %s", targetDB)
	if err := store.InitDB(targetDB); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer store.CloseDB()

	// Run schema migrations
	log.Println("Running schema migrations...")
	if err := store.RunMigrations(); err != nil {
		log.Fatalf("Schema migration failed: %v", err)
	}
	log.Println("Schema migrations completed successfully.")

	// Import data from Prisma database if specified
	if *importFrom != "" {
		log.Printf("Importing data from: %s", *importFrom)
		if err := store.MigrateFromPrismaDB(*importFrom); err != nil {
			log.Fatalf("Data import failed: %v", err)
		}
		log.Println("Data import completed successfully.")
	}

	log.Println("Done.")
}

func printUsage() {
	fmt.Println(`NowenReader Database Migration Tool

Usage:
  nowen-migrate [flags]

Flags:
  -db string       Target database path (default: auto-detect from DATABASE_URL or ./data/nowen-reader.db)
  -import string   Import data from a Prisma/Next.js SQLite database file
  -help            Show this help

Examples:
  # Run schema migrations on the default database
  nowen-migrate

  # Import data from the old Next.js Prisma database
  nowen-migrate -import ./prisma/dev.db

  # Specify a custom database path
  nowen-migrate -db /data/nowen-reader.db -import /old/prisma/dev.db

Environment Variables:
  DATABASE_URL    Override the default database path
  DATA_DIR        Override the default data directory`)
	os.Exit(0)
}
