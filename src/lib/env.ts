import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let envLoaded = false;

export type EnvLike = Record<string, string | undefined>;

export function loadEnvOnce(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): void {
  if (envLoaded) return;
  envLoaded = true;
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (env[key] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

export function hasEnvValue(name: string, env: EnvLike = process.env): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}
