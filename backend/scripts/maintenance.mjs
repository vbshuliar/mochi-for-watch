import {
  createEncryptedBackup,
  restoreEncryptedBackup,
  cleanupEphemeral,
} from "../dist/maintenance.js";
import { Store } from "../dist/store.js";

const [command, ...args] = process.argv.slice(2);
const key = process.env.ENCRYPTION_KEY ?? "";
try {
  if (command === "backup" || command === "restore") {
    if (args.length !== 2)
      throw new Error(
        `Usage: maintenance.mjs ${command} SOURCE NEW_DESTINATION`,
      );
    const operation =
      command === "backup" ? createEncryptedBackup : restoreEncryptedBackup;
    const result = await operation(args[0], args[1], key);
    console.log(
      JSON.stringify({
        operation: command,
        ...result,
        note: "Keep the encryption key separately. No running service was switched to this file.",
      }),
    );
  } else if (command === "retention") {
    if (args.some((arg) => arg !== "--apply") || args.length > 1)
      throw new Error("Usage: maintenance.mjs retention [--apply]");
    if (!process.env.DATABASE_PATH || process.env.DATABASE_PATH === ":memory:")
      throw new Error("Set DATABASE_PATH to the intended existing database.");
    const { existsSync } = await import("node:fs");
    if (!existsSync(process.env.DATABASE_PATH))
      throw new Error("Database does not exist.");
    if (!/^[a-f0-9]{64}$/i.test(key))
      throw new Error("Set a valid ENCRYPTION_KEY.");
    const store = new Store(process.env.DATABASE_PATH, key);
    try {
      console.log(
        JSON.stringify(
          cleanupEphemeral(store, { apply: args.includes("--apply") }),
        ),
      );
    } finally {
      store.close();
    }
  } else
    throw new Error(
      "Choose backup, restore or retention. Build the backend first. Restore requires a new destination; retention defaults to dry-run.",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Maintenance failed.");
  process.exitCode = 1;
}
