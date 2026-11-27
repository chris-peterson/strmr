import {
  readFile,
  writeFile,
  mkdir,
  rename,
  link,
  unlink,
  open,
} from "node:fs/promises";
import { text } from "node:stream/consumers";
import { randomUUID } from "node:crypto";
import { resolve, dirname, basename } from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  readYaml,
  readHistoryInput,
  writeYaml,
  empty,
  merge,
} from "../src/ledger.js";

async function run([command, file, target, ...extra]) {
  if (
    !["import", "backup", "validate"].includes(command) ||
    !file ||
    extra.length ||
    (command === "validate" ? target : !target)
  ) {
    throw new Error(
      "Usage: ledger validate LEDGER | import INPUT_OR_- LEDGER | backup LEDGER DIRECTORY",
    );
  }
  const pasted = command === "import" && file === "-";
  const source = pasted
    ? await text(process.stdin)
    : await readFile(
        file,
        command === "import" && /\.pdf$/i.test(file) ? null : "utf8",
      );
  if (command === "validate") {
    const ledger = readYaml(source);
    console.log(
      ledger.periods.length +
        " valid subscription records and " +
        (ledger.viewing?.length || 0) +
        " viewing entries",
    );
    return;
  }
  if (command === "backup") {
    readYaml(source);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const archive = resolve(
      target,
      "strmr-" +
        new Date().toISOString().replaceAll(":", "-") +
        "-" +
        randomUUID() +
        ".zip",
    );
    const tmp = archive + ".tmp";
    try {
      await writeFile(tmp, zipSync({ "history.yml": strToU8(source) }), {
        mode: 0o600,
        flag: "wx",
      });
      await link(tmp, archive);
    } finally {
      await unlink(tmp).catch(() => {});
    }
    console.log(archive);
    return;
  }
  const incoming = await readHistoryInput(
    source,
    pasted ? "payment-history.txt" : file,
  );
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const lockPath = resolve(dirname(target), "." + basename(target) + ".lock");
  const lock = await open(lockPath, "wx", 0o600);
  const tmp = resolve(dirname(target), "." + randomUUID() + ".tmp");
  try {
    let ledger = empty();
    let exists = false;
    try {
      ledger = readYaml(await readFile(target, "utf8"));
      exists = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const result = merge(ledger, incoming);
    const addedPeriods = result.periods.length - ledger.periods.length;
    const addedViewing =
      (result.viewing?.length || 0) - (ledger.viewing?.length || 0);
    if (!exists || addedPeriods || addedViewing) {
      await writeFile(tmp, writeYaml(result), { mode: 0o600, flag: "wx" });
      await rename(tmp, target);
    }
    console.log(
      "Added " +
        addedPeriods +
        " subscription records and " +
        addedViewing +
        " viewing entries.",
    );
    console.log(
      result.periods.length +
        " subscription records and " +
        (result.viewing?.length || 0) +
        " viewing entries in " +
        target,
    );
  } finally {
    await unlink(tmp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
run(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
