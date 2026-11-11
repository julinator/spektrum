/** Einmalige Aktualisierung von der Kommandozeile: `npm run refresh` */
import { runPipeline } from "./pipeline.ts";

const snapshot = await runPipeline();
console.log(`\n${snapshot.topics.length} Themen (${snapshot.mode}${snapshot.model ? ", " + snapshot.model : ""})`);
for (const t of snapshot.topics) {
  console.log(`- ${t.title} [${t.perspectives.map((p) => p.sourceName).join(", ")}]`);
}
if (snapshot.errors.length) {
  console.log("\nHinweise:");
  for (const e of snapshot.errors) console.log(`  ! ${e}`);
}
