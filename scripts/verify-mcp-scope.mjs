import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const BASELINE = "d683e78ab8f62c46ef1c0f3ac3171a13f4f14fce";
const ROOT = process.cwd();
const ALLOWED_PATHS = new Set([
  ".secretlintignore",
  ".secretlintrc.json",
  "package-lock.json",
  "package.json",
  "scripts/verify-mcp-scope.mjs",
  "server/index.ts",
  "server/mcpAuthRoutes.test.ts",
  "server/mcpAuthRoutes.ts",
  "server/mcpAuthService.test.ts",
  "server/mcpAuthService.ts",
  "shared/schema.ts",
]);

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function nulPaths(output) {
  return output.split("\0").filter((entry) => entry.length > 0);
}

function statusPaths(output) {
  const records = nulPaths(output);
  const result = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) {
      throw new Error("invalid git status record");
    }
    const status = record.slice(0, 2);
    result.push(record.slice(3));
    if (status.includes("R") || status.includes("C")) {
      index += 1;
      if (index >= records.length) {
        throw new Error("invalid git rename record");
      }
      result.push(records[index]);
    }
  }
  return result;
}

export function normalizeSubmissionPath(value) {
  const normalized = value;
  if (
    normalized.length === 0 ||
    normalized.includes("\\") ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`unsafe submission path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

async function assertNoSymlink(pathname) {
  const segments = pathname.split("/");
  let current = ROOT;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`symlink is forbidden: ${pathname}`);
    }
  }
}

function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function baselineText(pathname) {
  return runGit(["show", `${BASELINE}:${pathname}`]);
}

function assertIndexDelta() {
  const diff = runGit([
    "diff",
    "--no-ext-diff",
    "--unified=0",
    BASELINE,
    "--",
    "server/index.ts",
  ]);
  const allowedAdditions = new Set([
    "import { setupMcpAuthRoutes } from './mcpAuthRoutes';",
    "setupMcpAuthRoutes(app);",
    "  '/mcp/internal',",
  ]);
  const additions = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("-")) {
      throw new Error("server/index.ts may not delete or rewrite existing lines");
    }
    if (line.startsWith("+")) {
      additions.push(line.slice(1));
    }
  }
  if (
    additions.length !== allowedAdditions.size ||
    additions.some((line) => !allowedAdditions.has(line))
  ) {
    throw new Error("server/index.ts contains changes outside the fixed MCP wiring");
  }
}

async function assertPackageDelta() {
  const baselinePackage = JSON.parse(baselineText("package.json"));
  const currentPackage = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const expectedPackage = structuredClone(baselinePackage);
  expectedPackage.scripts["test:mcp"] =
    "node --import tsx --test server/mcpAuthRoutes.test.ts server/mcpAuthService.test.ts";
  expectedPackage.scripts["verify:mcp-scope"] =
    "node scripts/verify-mcp-scope.mjs";
  expectedPackage.scripts["security:scan:mcp"] =
    "secretlint server/mcpAuthRoutes.ts server/mcpAuthService.ts server/mcpAuthRoutes.test.ts server/mcpAuthService.test.ts scripts/verify-mcp-scope.mjs server/index.ts shared/schema.ts package.json package-lock.json && git diff --no-ext-diff --unified=0 d683e78ab8f62c46ef1c0f3ac3171a13f4f14fce -- | secretlint --stdinFileName=mcp.diff";
  expectedPackage.devDependencies.secretlint = "13.0.4";
  expectedPackage.devDependencies[
    "@secretlint/secretlint-rule-preset-recommend"
  ] = "13.0.4";
  expectedPackage.overrides = { "form-data": "2.5.6" };
  if (stable(currentPackage) !== stable(expectedPackage)) {
    throw new Error("package.json contains changes outside the fixed MCP scripts and dependencies");
  }

  const baselineLock = JSON.parse(baselineText("package-lock.json"));
  const currentLockText = await readFile(path.join(ROOT, "package-lock.json"), "utf8");
  const currentLock = JSON.parse(currentLockText);
  const expectedRoot = structuredClone(baselineLock.packages[""]);
  expectedRoot.devDependencies.secretlint = "13.0.4";
  expectedRoot.devDependencies[
    "@secretlint/secretlint-rule-preset-recommend"
  ] = "13.0.4";
  if (stable(currentLock.packages[""]) !== stable(expectedRoot)) {
    throw new Error("package-lock root contains unauthorized direct dependency changes");
  }
  if (
    createHash("sha256").update(currentLockText).digest("hex") !==
    "f6b279cf76ece316131e3f11200be6253fbb898884f8ee2f801fa222d33d5115"
  ) {
    throw new Error("package-lock contains changes outside the approved deterministic lockfile");
  }
}

async function assertProductionSourceBoundaries() {
  const source = await readFile(path.join(ROOT, "server/mcpAuthRoutes.ts"), "utf8");
  const forbidden = [
    /console\s*\./u,
    /googleAccessToken/u,
    /googleRefreshToken/u,
    /profileImageUrl/u,
    /setInterval\s*\(/u,
    /setTimeout\s*\(/u,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`forbidden MCP route source pattern: ${pattern}`);
    }
  }
}

async function main() {
  const tracked = nulPaths(
    runGit(["diff", "--name-only", "-z", BASELINE, "--"]),
  );
  const status = statusPaths(
    runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  );
  const submission = [
    ...new Set([...tracked, ...status].map(normalizeSubmissionPath)),
  ].sort();

  for (const pathname of submission) {
    if (!ALLOWED_PATHS.has(pathname)) {
      throw new Error(`path is outside the MCP allowlist: ${pathname}`);
    }
    await assertNoSymlink(pathname);
    console.log(`mcp scope path: ${JSON.stringify(pathname)}`);
  }

  assertIndexDelta();
  await assertPackageDelta();
  await assertProductionSourceBoundaries();

  console.log(`verify:mcp-scope: ok (${submission.length} submission paths)`);
}

if (import.meta.main) {
  await main();
}
