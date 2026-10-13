import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);

// Run actual source modules with explicit service mocks. A fresh cache per load
// isolates module state (including evaltools' model cursor) between test cases.
export function load(file, mocks = {}, cache = new Map()) {
  let filename = path.resolve(root, file);
  if (!fs.existsSync(filename)) {
    filename = [".ts", ".tsx"].map(extension => filename + extension).find(fs.existsSync);
  }
  if (!filename) throw new Error(`Cannot resolve test module: ${file}`);
  if (cache.has(filename)) return cache.get(filename);
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) return load("src/" + id.slice(2), mocks, cache);
    if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id), mocks, cache);
    return require(id);
  };
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

export async function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const apply = entries => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    apply(values);
    return await run();
  } finally {
    apply(previous);
  }
}
