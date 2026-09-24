import { readFileSync } from "node:fs";
import { sqlite } from "../src/server/db";
sqlite
  .transaction(() => sqlite.exec(readFileSync("migrations/0001.sql", "utf8")))
  .immediate();
sqlite.close();
console.log("Tiny Notes: five tables ready.");
