import { sourceRelease } from "./lib/dist-source.ts";
import { cp, readdir, rm, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, logStep, logDetail, summaryBox } from "./lib/format.ts";
import { capture, releaseTargets, withArchive, prepareDist } from "./lib/release.ts";

await cli("dist → main + tag + __dist__", async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targets = await releaseTargets(args);
  let changed = 0,
    skipped = 0;
  for (const row of targets) {
    const version = JSON.parse(await readFile(join(row.dir, "package.json"), "utf8"))
      .version as string;
    const source = { tag: `v${version}` };
    const url = capture("git", ["remote", "get-url", "origin"], row.dir);
    await withArchive(row, async (archive, temp) => {
      const output = await prepareDist(archive, temp);
      if (dryRun) {
        await sourceRelease(row.dir, version, true);
        logDetail(`[would push] ${row.short}: main + ${source.tag}`);
      } else {
        logStep(`${row.short}: push main + ${source.tag}…`);
        await sourceRelease(row.dir, version);
      }
      // An isolated clone leaves the source checkout, index and branches untouched.
      const repo = await mkdtemp(join(tmpdir(), "hyperttp-dist-git-"));
      try {
        capture("git", ["init", repo]);
        capture("git", ["remote", "add", "origin", url], repo);
        const ref = "refs/heads/__dist__";
        const listing = capture("git", ["ls-remote", "origin", ref], repo);
        if (listing) {
          capture("git", ["fetch", "--depth=1", "origin", ref], repo);
          capture("git", ["checkout", "-b", "__dist__", "FETCH_HEAD"], repo);
        } else capture("git", ["checkout", "--orphan", "__dist__"], repo);
        for (const name of await readdir(repo))
          if (name !== ".git") await rm(join(repo, name), { recursive: true, force: true });
        await cp(output, repo, { recursive: true });
        capture("git", ["add", "-A"], repo);
        if (!capture("git", ["status", "--porcelain"], repo)) {
          skipped++;
          logDetail(`[skip] ${row.short}: дистрибутив не изменился`);
          return;
        }
        changed++;
        if (dryRun) {
          logDetail(`[would push] ${row.short}/__dist__`);
          return;
        }
        // Obtain the user's identity from the source repo, including local config.
        const name = capture("git", ["var", "GIT_AUTHOR_IDENT"], row.dir);
        const match = /^(.*) <([^>]+)>/.exec(name);
        if (!match) throw new Error("Не удалось определить Git identity.");
        capture(
          "git",
          [
            "-c",
            `user.name=${match[1]}`,
            "-c",
            `user.email=${match[2]}`,
            "commit",
            "-m",
            `chore: release v${version}`,
          ],
          repo,
        );
        logStep(`${row.short}: push __dist__…`);
        capture("git", ["push", "origin", `HEAD:${ref}`], repo);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    });
  }
  summaryBox("GitHub dist", {
    "Режим:": dryRun ? "dry-run" : "push",
    "Изменено:": changed,
    "Пропущено:": skipped,
  });
});
