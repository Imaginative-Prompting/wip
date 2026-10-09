#!/usr/bin/env node
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  config,
  catalog,
  validate,
  json,
  atomic,
  upsert,
  setCurrent,
  projectDir,
  slug,
} from "../src/store.mjs";
import { start } from "../src/server.mjs";

const [command = "help", ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(`Expected --name value: ${args[i]}`);
  flags[args[i].slice(2)] = args[++i];
}
try {
  if (command === "help") {
    console.log(`WIP — file-based review for people and agents

  wip serve [--config wip.json] [--port 7353]
  wip list [--config wip.json]
  wip validate [--config wip.json]
  wip project --id project-id --title "Project name" [--config wip.json]
  wip get --project project-id --id entry-id [--config wip.json]
  wip put --project project-id --file entry.json [--expected 3] [--config wip.json]
  wip current --project project-id --file track.json [--expected 2] [--config wip.json]

Existing entries/current cuts REQUIRE --expected with the revision you read.
The server is read-only; agents write through the CLI or the documented files.`);
  } else {
    const c = await config(flags.config);
    const expected =
      flags.expected == null ? undefined : Number(flags.expected);
    if (command === "serve")
      await start(c, flags.port == null ? undefined : Number(flags.port));
    else if (command === "list")
      console.log(JSON.stringify(await catalog(c), null, 2));
    else if (command === "validate") {
      const result = await validate(c);
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length || result.missing.length) process.exitCode = 1;
    } else if (command === "get")
      console.log(
        JSON.stringify(
          await json(
            path.join(
              projectDir(c, flags.project),
              flags.id === "current"
                ? "current.json"
                : `entries/${
                    slug(flags.id)
                      ? flags.id
                      : (() => {
                          throw new Error("Invalid ID");
                        })()
                  }.json`,
            ),
          ),
          null,
          2,
        ),
      );
    else if (command === "put")
      console.log(
        JSON.stringify(
          await upsert(
            c,
            flags.project,
            await json(path.resolve(flags.file)),
            expected,
          ),
          null,
          2,
        ),
      );
    else if (command === "current")
      console.log(
        JSON.stringify(
          await setCurrent(
            c,
            flags.project,
            await json(path.resolve(flags.file)),
            expected,
          ),
          null,
          2,
        ),
      );
    else if (command === "project") {
      if (!slug(flags.id) || !flags.title)
        throw new Error("Project needs a valid ID and title");
      const dir = projectDir(c, flags.id);
      await mkdir(path.join(dir, "entries"), { recursive: true });
      const file = path.join(dir, "project.json");
      try {
        await readFile(file);
        throw new Error("Project already exists");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await atomic(file, { id: flags.id, title: flags.title, description: "" });
      console.log(`Created ${flags.id}`);
    } else throw new Error(`Unknown command: ${command}`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
