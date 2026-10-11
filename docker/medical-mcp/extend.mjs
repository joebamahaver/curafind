import { readFileSync, writeFileSync } from "node:fs";

const file = "/app/build/index.js";
const source = readFileSync(file, "utf8");
const marker = "return server;";
if (!source.includes(marker)) throw new Error("Upstream entry point changed; review the extension.");
writeFileSync(file, 'import { registerTrialSearch } from "./curafind-trial-search.js";\n' +
  source.replace(marker, "registerTrialSearch(server);\n" + marker));
