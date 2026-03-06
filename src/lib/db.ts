import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import path from "path";

// 数据库路径 - 优先级: DATABASE_URL 环境变量 > 默认 (cwd/data.db)
function getDbUrl(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    if (envUrl.startsWith("file:")) return envUrl;
    return `file:${envUrl}`;
  }
  return `file:${path.join(process.cwd(), "data.db")}`;
}

// PrismaLibSql@7 构造函数接受 Config（而非 Client 实例），内部自行创建连接
const dbConfig = { url: getDbUrl() };
const adapter = new PrismaLibSql(dbConfig);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// 通过独立的 libsql 原生客户端注入性能 PRAGMA（libsql 本地模式默认已开启 WAL）
async function optimizeLibsql() {
  try {
    const client = createClient(dbConfig);
    await client.execute("PRAGMA synchronous = NORMAL;");
    await client.execute("PRAGMA mmap_size = 268435456;");
    await client.execute("PRAGMA cache_size = -64000;");
    await client.execute("PRAGMA temp_store = MEMORY;");
    client.close();
    console.log("[DB] LibSQL 内存加速引擎已启动 🚀");
  } catch (err) {
    console.error("[DB] LibSQL 性能参数注入失败:", err);
  }
}

optimizeLibsql();
