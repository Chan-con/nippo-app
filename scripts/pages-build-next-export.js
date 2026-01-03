const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function rmDirSafeWithRetries(dir, opts) {
  const attempts = opts?.attempts ?? 6;
  const delayMs = opts?.delayMs ?? 40;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = e && typeof e === 'object' ? e.code : undefined;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTEMPTY') return;
      await sleep(delayMs * (i + 1));
    }
  }
}

async function emptyDirWithRetries(dir, opts) {
  const attempts = opts?.attempts ?? 6;
  const delayMs = opts?.delayMs ?? 40;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  for (let i = 0; i < attempts; i++) {
    try {
      if (!exists(dir)) return;
      const entries = fs.readdirSync(dir);
      for (const name of entries) {
        const p = path.join(dir, name);
        fs.rmSync(p, { recursive: true, force: true });
      }
      return;
    } catch (e) {
      const code = e && typeof e === 'object' ? e.code : undefined;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTEMPTY') return;
      await sleep(delayMs * (i + 1));
    }
  }
}

async function renameWithRetries(src, dest, opts) {
  const attempts = opts?.attempts ?? 8;
  const delayMs = opts?.delayMs ?? 50;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (e) {
      const code = e && typeof e === 'object' ? e.code : undefined;
      if (code !== 'EPERM' && code !== 'EACCES') throw e;
      await sleep(delayMs * (i + 1));
    }
  }
  // last attempt (surface the error)
  fs.renameSync(src, dest);
}

async function moveDirContentsWithFallback(srcDir, destDir) {
  if (!exists(srcDir)) return false;

  await rmDirSafeWithRetries(destDir);
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });

  const entries = fs.readdirSync(srcDir);
  for (const name of entries) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    try {
      await renameWithRetries(src, dest);
    } catch (e) {
      const code = e && typeof e === 'object' ? e.code : undefined;
      if (code !== 'EPERM' && code !== 'EACCES') throw e;
      // Fallback: copy then remove (less atomic, but avoids directory rename issues)
      fs.cpSync(src, dest, { recursive: true });
      await rmDirSafeWithRetries(src);
    }
  }

  // Ensure src dir is empty (and still exists)
  await emptyDirWithRetries(srcDir);
  return true;
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
      apiMoved = await moveDirContentsWithFallback(apiDir, apiBackupDir);
    }

    runNextBuild(rootDir);
  } finally {
    if (apiMoved) {
      // Restore regardless of build success.
      fs.mkdirSync(apiDir, { recursive: true });
      await emptyDirWithRetries(apiDir);
      await moveDirContentsWithFallback(apiBackupDir, apiDir);
      await rmDirSafeWithRetries(apiBackupDir);
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
