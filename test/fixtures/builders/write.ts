/** Regenerates the page builder WXR fixtures: `pnpm tsx test/fixtures/builders/write.ts`. */
import { writeFileSync } from "node:fs";

import { diviExport } from "./divi.js";
import { elementorExport } from "./elementor.js";

const dir = new URL("../", import.meta.url);
writeFileSync(new URL("elementor-export.xml", dir), elementorExport());
writeFileSync(new URL("divi-export.xml", dir), diviExport());
