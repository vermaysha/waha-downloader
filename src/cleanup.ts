import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Cleans leftover temporary files inside `tmpDir` and any stale `waha-dl-split-*`
 * directories in `systemTmpDir` on application startup.
 */
export async function cleanupTempStorage(
  tmpDir: string,
  systemTmpDir: string = tmpdir(),
): Promise<void> {
  await mkdir(tmpDir, { recursive: true });
  const entries = await readdir(tmpDir);
  await Promise.all(
    entries.map((name) =>
      rm(join(tmpDir, name), { recursive: true, force: true }),
    ),
  );

  try {
    const sysEntries = await readdir(systemTmpDir);
    await Promise.all(
      sysEntries
        .filter((name) => name.startsWith("waha-dl-split-"))
        .map((name) =>
          rm(join(systemTmpDir, name), { recursive: true, force: true }),
        ),
    );
  } catch {
    // Best-effort cleanup of system temp directory.
  }
}
