import { join } from "node:path";

const MAX_LINES = 500;
const IGNORE_PREFIXES = [
  "node_modules/",
  "dist/",
  ".git/",
];

const root = process.cwd();
const glob = new Bun.Glob("**/*.ts");
const violations: Array<{ file: string; lines: number }> = [];

for await (const file of glob.scan({ cwd: root })) {
  if (IGNORE_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;

  const fullPath = join(root, file);
  const text = await Bun.file(fullPath).text();
  const lines = text.split(/\r?\n/).length;

  if (lines > MAX_LINES) {
    violations.push({ file, lines });
  }
}

if (violations.length > 0) {
  console.error(`Line limit exceeded (>${MAX_LINES} lines):`);
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`Lint OK: no .ts files exceed ${MAX_LINES} lines.`);
