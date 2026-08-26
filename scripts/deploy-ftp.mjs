/**
 * Publish the built Astro site (`dist/`) to the cPanel docroot **over FTP**.
 *
 * ⛔ Why not SSH/scp/rsync: the origin is a SHARED cPanel account under a
 * CloudLinux LVE *Number of Processes* cap. Exceeding it refuses processes
 * ACCOUNT-WIDE — every site on that account goes down together.
 * Deploy tooling must run over lightweight FTP.
 *
 * ## The jail this script depends on
 * The deploy login is a per-directory FTP account chrooted to THIS docroot,
 * created over cPanel API2 `Ftp::addftp` and confirmed with `Ftp::listftp`.
 *
 * ⛔ FTP has no `--delete`. Dropping a file from `dist/` does NOT remove it from
 * the docroot. Mirroring is re-derived here as an explicit, opt-in `--prune` step.
 *
 * Modes:
 *   node scripts/deploy-ftp.mjs                      # dry run: preflight, index, plan
 *   node scripts/deploy-ftp.mjs --publish            # upload new + changed files
 *   node scripts/deploy-ftp.mjs --publish --prune    # …and delete remote orphans
 *   node scripts/deploy-ftp.mjs --verify             # public-URL checks only, no login
 *
 * Flags: --force (override quota refusal) · --first-publish · --verbose
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { config as loadEnv } from "dotenv";

const projectRoot = process.cwd();
const SITE_DOMAIN = "locuz.com.br";
const CANONICAL_HOST = SITE_DOMAIN;
const publicUrl = `https://${CANONICAL_HOST}`;
const distDir = join(projectRoot, "dist");

/** Sibling docroots on this account used for misroute detection. */
const siblingSites = () =>
  (process.env.CPANEL_SIBLING_SITES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Anything under these prefixes is never uploaded and never pruned. */
const PROTECTED_PATHS = [
  /^\.well-known(\/|$)/,
  /^cgi-bin(\/|$)/,
  /^\.ftpquota$/,
  /^\.htpasswd$/,
  /^\.user\.ini$/,
  /^error_log$/,
];

const buildInputs = ["src", "public", "astro.config.mjs", "tailwind.config.mjs", "tsconfig.json", "package.json", ".env"];

const argv = process.argv.slice(2);
const KNOWN_FLAGS = ["--publish", "--prune", "--verify", "--force", "--first-publish", "--verbose"];
const PUBLISH = argv.includes("--publish");
const PRUNE = argv.includes("--prune");
const VERIFY_ONLY = argv.includes("--verify");
const FORCE = argv.includes("--force");
const FIRST_PUBLISH = argv.includes("--first-publish");
const VERBOSE = argv.includes("--verbose");

for (const arg of argv) {
  if (!KNOWN_FLAGS.includes(arg)) {
    console.error(`✗ unknown argument: ${arg}`);
    console.error(`  known flags: ${KNOWN_FLAGS.join(" ")}`);
    process.exit(1);
  }
}
if (VERIFY_ONLY && (PUBLISH || PRUNE)) {
  console.error("✗ --verify makes no changes; drop --publish/--prune");
  process.exit(1);
}
if (PRUNE && !PUBLISH) {
  console.error("✗ --prune only applies to a publish; use: --publish --prune");
  process.exit(1);
}

loadEnv({ path: join(projectRoot, ".env"), override: false, quiet: true });
const env = process.env;

let failures = 0;
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  · ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
};
const check = (ok, good, bad) => (ok ? pass(good) : fail(bad));
const die = (m) => {
  console.error(`\n\x1b[31m✗ ${m}\x1b[0m`);
  process.exit(1);
};

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const extraProtected = (env.CPANEL_PROTECT_PATHS || "")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

const isProtected = (rel) =>
  PROTECTED_PATHS.some((p) => p.test(rel)) ||
  extraProtected.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));

function walkFiles(path, files = []) {
  if (!existsSync(path)) return files;
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    files.push(path);
    return files;
  }
  for (const entry of readdirSync(path)) walkFiles(join(path, entry), files);
  return files;
}

function walkLocal(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkLocal(join(dir, entry.name), rel));
    else if (entry.isFile()) files.push({ rel, size: statSync(join(dir, entry.name)).size });
  }
  return files;
}

const builtHtml = () => walkFiles(distDir).filter((p) => p.endsWith(".html"));

// --- Stage 1: Build Preflight ------------------------------------------------
function buildPreflight() {
  head("Local build");
  if (!existsSync(distDir)) die("no dist/ — run `npm run build` first");
  if (!existsSync(join(distDir, "index.html"))) die("dist/index.html missing — build incomplete");

  if (existsSync(join(projectRoot, "public/.htaccess"))) {
    check(existsSync(join(distDir, ".htaccess")), "dist/.htaccess present", "dist/.htaccess missing from build");
  }

  const builtAt = statSync(join(distDir, "index.html")).mtimeMs;
  const newerInput = buildInputs
    .filter((p) => existsSync(join(projectRoot, p)))
    .flatMap((path) => walkFiles(join(projectRoot, path)))
    .find((path) => statSync(path).mtimeMs > builtAt + 1000);

  if (newerInput) {
    die(`dist/ is older than ${relative(projectRoot, newerInput)} — run \`npm run build\` first`);
  }
  pass(`dist/ is newer than every build input (${builtHtml().length} HTML page(s))`);
}

function canonicalGate() {
  head("Canonical & Metadata");
  const textFiles = walkFiles(distDir).filter((p) => /\.(html|xml|txt|webmanifest)$/i.test(p));
  const localhostRefs = textFiles.filter((p) => /https?:\/\/(localhost|127\.0\.0\.1)/i.test(readFileSync(p, "utf8")));
  check(!localhostRefs.length, "no localhost URLs in build", `${localhostRefs.length} files contain localhost URLs`);

  const index = readFileSync(join(distDir, "index.html"), "utf8");
  const canonical = index.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (canonical) {
    check(canonical.includes(CANONICAL_HOST), `canonical link matches host (${canonical})`, `canonical link is ${canonical}`);
  }
}

// --- Stage 2: cPanel Process Quota -------------------------------------------
async function processQuotaPreflight() {
  head("cPanel process quota");
  if (!env.CPANEL_API_TOKEN) {
    info("no CPANEL_API_TOKEN — skipping quota preflight");
    return true;
  }
  const apiUser = env.CPANEL_API_USER || "zokucomb";
  try {
    const res = await fetch(`https://${env.CPANEL_FTP_HOST}:2083/execute/ResourceUsage/get_usages`, {
      headers: { Authorization: `cpanel ${apiUser}:${env.CPANEL_API_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    const usages = (await res.json())?.data;
    if (Array.isArray(usages)) {
      const nproc = usages.find((u) => u.id === "lvenproc");
      if (nproc?.maximum) {
        const used = Number(nproc.usage);
        const max = Number(nproc.maximum);
        const free = max - used;
        if (free <= 3) {
          fail(`processes: ${used}/${max} — only ${free} slot(s) free; risk of 503 refusal`);
          return FORCE;
        }
        pass(`process slots: ${used}/${max} (${free} free)`);
      }
    }
  } catch (err) {
    warn(`could not read quota (${err.message}) — continuing`);
  }
  return true;
}

// --- Stage 3: FTP Connection -------------------------------------------------
async function connect() {
  const { Client } = await import("basic-ftp");
  const client = new Client(60000);
  client.ftp.verbose = VERBOSE;

  const base = {
    host: env.CPANEL_FTP_HOST,
    port: Number(env.CPANEL_FTP_PORT || 21),
    user: env.CPANEL_FTP_USER,
    password: env.CPANEL_FTP_PASSWORD,
  };
  for (const [k, v] of Object.entries(base)) {
    if (!v) die(`missing env var CPANEL_FTP_${k.toUpperCase()}`);
  }

  if (env.CPANEL_FTP_TLS === "false") {
    info("CPANEL_FTP_TLS=false — connecting over plaintext FTP to jailed root");
    await client.access({ ...base, secure: false });
  } else {
    await client.access(base);
  }
  return client;
}

// --- Stage 4: Remote Index & Diff --------------------------------------------
async function walkRemote(client, rel = "", acc = { files: [], dirs: [] }) {
  const list = await client.list();
  for (const item of list) {
    if (item.name === "." || item.name === "..") continue;
    const r = rel ? `${rel}/${item.name}` : item.name;
    if (item.isDirectory) {
      acc.dirs.push(r);
      if (!isProtected(r)) {
        await client.cd(item.name);
        await walkRemote(client, r, acc);
        await client.cdup();
      }
    } else if (item.isFile) {
      acc.files.push({ rel: r, size: item.size });
    }
  }
  return acc;
}

// Always reupload dynamic entrypoints and configs
const alwaysReupload = (rel) => /(^|\/)\.htaccess$|\.(html|xml|json|txt|webmanifest)$/i.test(rel);

function planChanges(localFiles, remoteFiles) {
  const remoteMap = new Map(remoteFiles.map((f) => [f.rel, f.size]));
  const localMap = new Map(localFiles.map((f) => [f.rel, f.size]));

  const toUpload = localFiles.filter(
    (f) => !remoteMap.has(f.rel) || remoteMap.get(f.rel) !== f.size || alwaysReupload(f.rel)
  );
  const orphans = remoteFiles.filter((f) => !localMap.has(f.rel) && !isProtected(f.rel));

  return { toUpload, orphans };
}

// --- Stage 5: Upload & Prune Execution ---------------------------------------
async function uploadFiles(client, root, files) {
  if (!files.length) {
    pass("nothing to upload — docroot already matches this build");
    return;
  }

  const byDir = new Map();
  for (const f of files) {
    const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : "";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }

  // Upload assets first, HTML entrypoints last
  const isHtml = (f) => f.rel.endsWith(".html");
  const dirs = [...byDir].sort(([a], [b]) => a.localeCompare(b));
  const ordered = [
    ...dirs.flatMap(([dir, entries]) => entries.filter((f) => !isHtml(f)).map((f) => [dir, f])),
    ...dirs.flatMap(([dir, entries]) => entries.filter(isHtml).map((f) => [dir, f])),
  ];

  let done = 0;
  let currentDir = null;
  const started = Date.now();

  for (const [dir, f] of ordered) {
    if (dir !== currentDir) {
      await client.cd(root);
      if (dir) await client.ensureDir(dir);
      currentDir = dir;
    }
    await client.uploadFrom(join(distDir, f.rel), basename(f.rel));
    done++;
    if (process.stdout.isTTY) {
      const rate = done / Math.max(1, (Date.now() - started) / 1000);
      process.stdout.write(`\r  uploading… ${done}/${ordered.length} (${rate.toFixed(1)}/s)`);
    }
  }
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  pass(`uploaded ${done}/${ordered.length} file(s) in ${Math.round((Date.now() - started) / 1000)}s (assets first, HTML last)`);
}

async function pruneOrphans(client, root, orphans, remoteDirs) {
  head("Pruning remote orphans");
  if (!orphans.length) {
    pass("no orphans — docroot holds nothing this build did not produce");
    return;
  }

  const byDir = new Map();
  for (const f of orphans) {
    const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : "";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }

  let removed = 0;
  let bytes = 0;
  for (const [dir, entries] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    await client.cd(root);
    if (dir) await client.cd(dir);
    for (const f of entries) {
      await client.remove(basename(f.rel));
      removed++;
      bytes += f.size;
      if (process.stdout.isTTY) process.stdout.write(`\r  deleting… ${removed}/${orphans.length}`);
    }
  }
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  pass(`deleted ${removed} orphaned file(s), ${formatBytes(bytes)} reclaimed`);

  // Remove empty directories deepest first
  const deepestFirst = [...remoteDirs].sort((a, b) => b.split("/").length - a.split("/").length || b.localeCompare(a));
  let removedDirs = 0;
  for (const dir of deepestFirst) {
    if (isProtected(dir)) continue;
    try {
      await client.cd(root);
      await client.removeEmptyDir(dir);
      removedDirs++;
    } catch {
      /* directory not empty */
    }
  }
  if (removedDirs) pass(`removed ${removedDirs} empty director(ies)`);
}

// --- Stage 6: Public URL Probe -----------------------------------------------
async function verifyLive() {
  head("Public URL Verification");
  const hosts = [CANONICAL_HOST];
  if (!CANONICAL_HOST.startsWith("www.")) hosts.push(`www.${CANONICAL_HOST}`);

  for (const host of hosts) {
    try {
      const cbUrl = `https://${host}/?_cb=${Date.now()}`;
      const res = await fetch(cbUrl, { headers: { "User-Agent": "DeployVerify/1.0" } });
      const lastMod = res.headers.get("last-modified");
      check(res.status === 200, `https://${host}/ returned 200 (Last-Modified: ${lastMod || "n/a"})`, `https://${host}/ status ${res.status}`);
    } catch (err) {
      fail(`could not reach https://${host}/ (${err.message})`);
    }
  }
}

// --- Main Runner -------------------------------------------------------------
async function main() {
  if (VERIFY_ONLY) {
    await verifyLive();
    return;
  }

  buildPreflight();
  canonicalGate();
  if (failures) die("preflight checks failed");

  const quotaOk = await processQuotaPreflight();
  if (!quotaOk) die("process quota preflight refused session");

  const client = await connect();
  try {
    const root = await client.pwd();
    head("Scanning remote filesystem");
    const remote = await walkRemote(client);
    const localFiles = walkLocal(distDir);
    pass(`found ${localFiles.length} local file(s), ${remote.files.length} remote file(s) in jail "${root}"`);

    const { toUpload, orphans } = planChanges(localFiles, remote.files);

    head(PUBLISH ? "Publishing changes" : "Plan (dry-run)");
    info(`${toUpload.length} file(s) to upload, ${orphans.length} orphan(s) detected`);

    if (!PUBLISH) {
      pass("dry run complete — run `npm run deploy` to upload or `npm run deploy -- --prune` to mirror");
      return;
    }

    await uploadFiles(client, root, toUpload);

    if (PRUNE) {
      await pruneOrphans(client, root, orphans, remote.dirs);
    }
  } finally {
    client.close();
  }

  if (PUBLISH) {
    await verifyLive();
  }
}

main().catch((err) => die(err.stack || err.message));
