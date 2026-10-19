// ALPHA FEED v2 — snapshot validator (run by the scheduled workflow).
// v2 is a single-file build: the edition snapshot is embedded in index.html.
// This script does NOT fetch new RSS. It verifies the snapshot is intact:
// index.html exists, carries the masthead + publisher credit, has the
// per-section pages, and contains none of the banned UI words.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mustContain = [
  "ALPHA FEED",
  "Developed by Jatin Singh",
  "showPage",
  "30*60*1000",
  "Indian Markets",
  "Global Markets",
];
const mustNotContain = ["delayed", "github", "vercel", "hourly"];
let ok = true;
for (const s of mustContain) {
  if (!html.includes(s)) {
    console.error(`MISSING: ${JSON.stringify(s)}`);
    ok = false;
  }
}
for (const s of mustNotContain) {
  if (html.toLowerCase().includes(s)) {
    console.error(`BANNED WORD PRESENT: ${JSON.stringify(s)}`);
    ok = false;
  }
}
console.log(`index.html: ${html.length} chars, checks ${ok ? "PASSED" : "FAILED"}`);
if (!ok) process.exit(1);
