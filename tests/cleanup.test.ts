import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTempStorage } from "../src/cleanup";

describe("cleanupTempStorage", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  test("removes all leftover files/folders in tmpDir and stale waha-dl-split-* in systemTmpDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "waha-dl-cleanup-test-"));
    roots.push(base);

    const appTmp = join(base, "app-tmp");
    const sysTmp = join(base, "sys-tmp");
    await mkdir(join(appTmp, "dl-old"), { recursive: true });
    await Bun.write(join(appTmp, "dl-old", "part.mp4"), "stale");
    await Bun.write(join(appTmp, "cookie-old.txt"), "stale");

    await mkdir(join(sysTmp, "waha-dl-split-abc"), { recursive: true });
    await Bun.write(join(sysTmp, "waha-dl-split-abc", "seg.mp4"), "stale");
    await mkdir(join(sysTmp, "unrelated-dir"), { recursive: true });

    await cleanupTempStorage(appTmp, sysTmp);

    expect(await readdir(appTmp)).toEqual([]);
    expect(await readdir(sysTmp)).toEqual(["unrelated-dir"]);
  });
});
