import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

// 数据库路径 - 优先级: DATABASE_URL 环境变量 > 默认 (cwd/data.db)
function getDbUrl(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    // 已经是 file: 开头则直接用
    if (envUrl.startsWith("file:")) return envUrl;
    return `file:${envUrl}`;
  }
  return `file:${path.join(process.cwd(), "data.db")}`;
}

const adapter = new PrismaLibSql({
  url: getDbUrl(),
});

// Use singleton pattern for Prisma Client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
