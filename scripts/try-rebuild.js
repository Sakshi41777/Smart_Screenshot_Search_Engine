const { spawnSync } = require("child_process");

if (String(process.env.SKIP_REBUILD || "").trim() === "1") {
  console.log("SKIP_REBUILD=1 set; skipping electron-rebuild.");
  process.exit(0);
}

const result = spawnSync(
  "npx",
  ["electron-rebuild", "-f", "-m", "backend_node"],
  { stdio: "inherit", shell: true }
);

process.exit(result.status ?? 1);
