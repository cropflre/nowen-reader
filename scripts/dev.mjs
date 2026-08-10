import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const frontendDir = path.join(rootDir, "frontend");
const isWindows = process.platform === "win32";
const goCommand = isWindows ? "go.exe" : "go";
const windowsShell = process.env.ComSpec || "cmd.exe";
const backendPort = 5080;
const frontendPort = 5090;

function fail(message) {
  console.error(`\n[dev] ${message}`);
  process.exit(1);
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", cwd: rootDir });
  return !result.error && result.status === 0;
}

function npmInvocation(args) {
  if (isWindows) {
    // npm on Windows is a .cmd shim. Spawning npm.cmd directly can throw
    // EINVAL on some Node 20 / Windows combinations, so invoke it through
    // the system command processor instead.
    return {
      command: windowsShell,
      args: ["/d", "/s", "/c", `npm ${args.join(" ")}`],
    };
  }

  return { command: "npm", args };
}

function runNpmSync(args, cwd) {
  const invocation = npmInvocation(args);
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    stdio: "inherit",
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.killed) return;

  try {
    if (isWindows) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Process may already have exited.
  }
}

if (!commandAvailable(goCommand, ["version"])) {
  fail("未检测到 Go。请先安装 Go 1.23+，并确认 go 已加入 PATH。");
}

if (!existsSync(path.join(frontendDir, "package.json"))) {
  fail("未找到 frontend/package.json，请确认当前目录是完整的 nowen-reader 仓库。");
}

if (!(await portIsFree(backendPort))) {
  fail(`后端端口 ${backendPort} 已被占用。请先关闭占用该端口的旧开发进程后再重试。`);
}

if (!(await portIsFree(frontendPort))) {
  fail(`前端端口 ${frontendPort} 已被占用。请先关闭占用该端口的旧开发进程后再重试。`);
}

const viteBin = path.join(
  frontendDir,
  "node_modules",
  ".bin",
  isWindows ? "vite.cmd" : "vite",
);

if (!existsSync(viteBin)) {
  console.log("[dev] 首次启动：正在安装前端依赖...");
  const install = runNpmSync(["install"], frontendDir);
  if (install.error || install.status !== 0) {
    fail("前端依赖安装失败，请检查 npm 输出后重试。");
  }
}

console.log("\n[dev] NowenReader 本地开发环境");
console.log(`[dev] 后端: http://localhost:${backendPort}`);
console.log(`[dev] 前端: http://localhost:${frontendPort}`);
console.log("[dev] 按 Ctrl+C 同时停止前后端。\n");

const children = [];
let stopping = false;

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    terminateProcessTree(child);
  }

  setTimeout(() => process.exit(exitCode), 300).unref();
}

function start(name, command, args, cwd, env = process.env) {
  let child;

  try {
    child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: false,
    });
  } catch (error) {
    console.error(`[dev] ${name} 启动失败: ${error.message}`);
    stopAll(1);
    return null;
  }

  children.push(child);

  child.on("error", (error) => {
    console.error(`[dev] ${name} 启动失败: ${error.message}`);
    stopAll(1);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    const reason = signal ? `signal=${signal}` : `code=${code ?? 1}`;
    console.error(`\n[dev] ${name} 已退出 (${reason})，正在停止其余开发进程...`);
    stopAll(code ?? 1);
  });

  return child;
}

function startNpm(name, args, cwd) {
  const invocation = npmInvocation(args);
  return start(name, invocation.command, invocation.args, cwd);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

start(
  "后端",
  goCommand,
  ["run", "./cmd/server"],
  rootDir,
  { ...process.env, PORT: String(backendPort) },
);

startNpm("前端", ["run", "dev"], frontendDir);
