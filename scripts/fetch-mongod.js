// scripts/fetch-mongod.js
// Downloads the MongoDB Community server for Windows once and keeps only
// mongod.exe, renamed to smartshot-mongod.exe, in vendor/mongodb/.
// electron-builder then ships it inside the installer (see package.json "build").
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "vendor", "mongodb");
const OUT_EXE = path.join(OUT_DIR, "smartshot-mongod.exe");
const VERSIONS = [process.env.MONGOD_VERSION, "7.0.48", "7.0.14", "8.0.38"].filter(Boolean);

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const total = Number(res.headers["content-length"] || 0);
        let got = 0;
        let lastPct = -1;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          got += chunk.length;
          if (total) {
            const pct = Math.floor((got / total) * 100);
            if (pct % 10 === 0 && pct !== lastPct) {
              lastPct = pct;
              process.stdout.write(`  ${pct}%\n`);
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name) {
      return full;
    }
  }
  return "";
}

async function main() {
  if (process.platform !== "win32") {
    console.log("fetch-mongod: Windows-only build step, skipping on", process.platform);
    return;
  }
  if (fs.existsSync(OUT_EXE)) {
    console.log("fetch-mongod: already have", path.relative(ROOT, OUT_EXE));
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const zipPath = path.join(OUT_DIR, "mongodb.zip");
  const extractDir = path.join(OUT_DIR, "extract");

  let lastErr = null;
  for (const version of VERSIONS) {
    const url = `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${version}.zip`;
    try {
      console.log(`fetch-mongod: downloading MongoDB ${version} ...`);
      await download(url, zipPath);
      fs.rmSync(extractDir, { recursive: true, force: true });
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`],
        { stdio: "inherit" }
      );
      const mongod = findFile(extractDir, "mongod.exe");
      if (!mongod) throw new Error("mongod.exe not found in archive");
      fs.copyFileSync(mongod, OUT_EXE);
      fs.writeFileSync(path.join(OUT_DIR, "VERSION.txt"), version + "\n");
      console.log(`fetch-mongod: saved ${path.relative(ROOT, OUT_EXE)} (MongoDB ${version})`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`fetch-mongod: ${version} failed: ${err.message}`);
    } finally {
      fs.rmSync(zipPath, { force: true });
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }
  if (lastErr) {
    console.error("fetch-mongod: could not download MongoDB. Set MONGOD_VERSION to a valid version and retry.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
