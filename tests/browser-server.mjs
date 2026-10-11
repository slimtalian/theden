import { promises as fs } from "node:fs";
import path from "node:path";
import { createDen, PROJECT } from "../server.mjs";
import { samplePDF, sampleEPUB } from "./fixtures.mjs";
const dataDir = path.join(PROJECT, ".test-runs", "browser");
await fs.mkdir(dataDir, { recursive: true });
await fs.writeFile(path.join(dataDir, "reader-check.pdf"), samplePDF());
await fs.writeFile(path.join(dataDir, "epub-check.epub"), sampleEPUB());
const app = await createDen({
  dataDir,
  libraryPath: path.join(dataDir, "lib"),
  disableDesktop: true,
  host: process.env.DEN_HOST || "127.0.0.1",
});
console.log(await app.listen(4322));
console.log("Isolated browser test library. The main library is untouched.");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
