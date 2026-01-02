const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmDirSafe(dir) {
  if (!(await exists(dir))) return;
  await fsp.rm(dir, { recursive: true, force: true });
}

async function copyDir(src, dst) {
  // Node 16+ supports fs.cp, but keep a manual fallback.
  if (typeof fsp.cp === 'function') {
    await fsp.mkdir(dst, { recursive: true });
    await fsp.cp(src, dst, { recursive: true });
    return;
  }

  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to);
    } else if (e.isFile()) {
      await fsp.copyFile(from, to);
    }
  }
}

async function main() {
  const root = path.join(__dirname, '..');
  const src = path.join(root, 'renderer');
  const out = path.join(root, 'out');

  if (!(await exists(path.join(src, 'index.html')))) {
    console.error('[pages-build] renderer/index.html が見つかりません');
    process.exit(1);
  }

  await rmDirSafe(out);
  await copyDir(src, out);

  // Cloudflare PagesのFunctionsは別ディレクトリ指定なのでここでは触らない。
  console.log(`[pages-build] copied ${path.relative(root, src)} -> ${path.relative(root, out)}`);
}

main().catch((e) => {
  console.error('[pages-build] failed:', e);
  process.exit(1);
});
