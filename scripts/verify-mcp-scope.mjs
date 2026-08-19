import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const BASELINE = "51e49cd3bfba970ceb22e96875875020df5ad870";
const ROOT = process.cwd();
const ALLOWED_PATHS = new Set([
  "package-lock.json",
  "package.json",
  "scripts/verify-mcp-scope.mjs",
  "server/accountSnapshotService.test.ts",
  "server/accountSnapshotService.ts",
  "server/mcpAuthRoutes.test.ts",
  "server/mcpAuthRoutes.ts",
  "server/mcpAuthService.test.ts",
  "server/mcpAuthService.ts",
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

async function assertPackageDelta() {
  const baselinePackage = JSON.parse(baselineText("package.json"));
  const currentPackage = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const expectedPackage = structuredClone(baselinePackage);
  expectedPackage.scripts["test:mcp"] =
    "node --import tsx --test server/accountSnapshotService.test.ts server/aeoCoursePurchases.test.ts server/mcpAuthRoutes.test.ts server/mcpAuthService.test.ts";
  expectedPackage.scripts["verify:mcp-scope"] =
    "node scripts/verify-mcp-scope.mjs";
  expectedPackage.scripts["security:scan:mcp"] =
    "secretlint server/accountSnapshotService.ts server/accountSnapshotService.test.ts server/aeoCoursePurchases.test.ts server/mcpAuthRoutes.ts server/mcpAuthService.ts server/mcpAuthRoutes.test.ts server/mcpAuthService.test.ts scripts/verify-mcp-scope.mjs server/index.ts shared/schema.ts package.json package-lock.json && git diff --no-ext-diff --unified=0 51e49cd3bfba970ceb22e96875875020df5ad870 -- | secretlint --stdinFileName=mcp.diff";
  if (stable(currentPackage) !== stable(expectedPackage)) {
    throw new Error("package.json contains changes outside the fixed MCP scripts and dependencies");
  }

  const baselineLock = JSON.parse(baselineText("package-lock.json"));
  const currentLockText = await readFile(path.join(ROOT, "package-lock.json"), "utf8");
  const currentLock = JSON.parse(currentLockText);
  if (stable(currentLock) !== stable(baselineLock)) {
    throw new Error("package-lock contains unauthorized metadata or dependency changes");
  }
  const baselineLockText = baselineText("package-lock.json");
  if (
    createHash("sha256").update(currentLockText).digest("hex") !==
    createHash("sha256").update(baselineLockText).digest("hex")
  ) {
    throw new Error("package-lock contains changes outside the approved deterministic lockfile");
  }
}

async function assertProductionSourceBoundaries() {
  const routeSource = await readFile(path.join(ROOT, "server/mcpAuthRoutes.ts"), "utf8");
  const routeForbidden = [
    /console\s*\./u,
    /googleAccessToken/u,
    /googleRefreshToken/u,
    /profileImageUrl/u,
    /setInterval\s*\(/u,
    /setTimeout\s*\(/u,
  ];
  for (const pattern of routeForbidden) {
    if (pattern.test(routeSource)) {
      throw new Error(`forbidden MCP route source pattern: ${pattern}`);
    }
  }

  const snapshotSource = await readFile(
    path.join(ROOT, "server/accountSnapshotService.ts"),
    "utf8",
  );
  for (const pattern of [
    /console\s*\./u,
    /\.(?:insert|update|delete)\s*\(/u,
    /\b(?:cache|retry)\b/iu,
  ]) {
    if (pattern.test(snapshotSource)) {
      throw new Error(`forbidden account snapshot source pattern: ${pattern}`);
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

  await assertPackageDelta();
  await assertProductionSourceBoundaries();

  console.log(`verify:mcp-scope: ok (${submission.length} submission paths)`);
}

if (import.meta.main) {
  await main();
}
