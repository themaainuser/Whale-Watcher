import "dotenv/config";
import { importEthLabels } from "./eth-labels.js";
import { importRippleToml } from "./ripple-toml.js";
import { importTagpacks } from "./tagpacks.js";
import { importXrpscan } from "./xrpscan.js";

const runners: Record<string, () => Promise<number>> = {
  "eth-labels": importEthLabels,
  xrpscan: importXrpscan,
  "ripple-toml": importRippleToml,
  tagpacks: importTagpacks,
};

async function main(): Promise<void> {
  const choice = process.argv[2] ?? "all";
  if (choice !== "all" && !(choice in runners)) {
    console.error(
      `Unknown importer "${choice}". Options: ${Object.keys(runners).join(", ")}, all`,
    );
    process.exitCode = 1;
    return;
  }
  const names = choice === "all" ? Object.keys(runners) : [choice];
  let failures = 0;
  try {
    for (const name of names) {
      try {
        const count = await runners[name]();
        console.log(`${name}: ${count} labels imported`);
      } catch (error) {
        failures += 1;
        console.error(`${name}: failed`, error);
      }
    }
  } finally {
    const { pool } = await import("../db.js");
    await pool.end();
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
