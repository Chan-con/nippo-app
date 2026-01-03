const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function rmDirSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function runNextBuild(rootDir) {
  const nextCli = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!exists(nextCli)) {
    throw new Error(`next CLI entry not found: ${nextCli}`);
  }

  const result = spawnSync(process.execPath, [nextCli, 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_STATIC_EXPORT: '1',
      NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
    },
  });

  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const outDir = path.join(rootDir, 'out');

  const apiDir = path.join(rootDir, 'app', 'api');
  const apiBackupDir = path.join(rootDir, 'app', '__api_disabled_for_export');

  rmDirSafe(outDir);

  let apiMoved = false;
  try {
    // Next.js static export can't include Route Handlers (app/api).
    // We keep Cloudflare Pages Functions in /functions for /api/*.
    if (exists(apiDir)) {
      rmDirSafe(apiBackupDir);
      fs.renameSync(apiDir, apiBackupDir);
      apiMoved = true;
    }

    runNextBuild(rootDir);
  } finally {
    if (apiMoved) {
      // Restore regardless of build success.
      rmDirSafe(apiDir);
      fs.renameSync(apiBackupDir, apiDir);
    }
  }

  if (!exists(outDir)) {
    console.error('[pages:build] out/ was not generated.');
    process.exit(1);
  }

  console.log('[pages:build] generated out/ for Cloudflare Pages');
}

main().catch((e) => {
  console.error('[pages:build] failed:', e);
  process.exit(1);
});
