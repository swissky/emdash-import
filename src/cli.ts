/**
 * emdash-import convert <export.xml> [-o site.emdash] [--media] [--report report.json]
 *
 * Converts a WordPress export into an EmDash site package. With --media the
 * uploads are downloaded into the package; without it images keep their
 * WordPress URLs. Import the package under Settings > Transfer in EmDash.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";

import { convertWxr } from "./convert.js";
import { parseWxr } from "./wordpress/parser.js";

const USAGE = "Usage: emdash-import convert <export.xml> [-o site.emdash] [--media] [--report report.json]";

async function fetchMedia(url: string): Promise<Uint8Array | null> {
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) return null;
	return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			output: { type: "string", short: "o" },
			media: { type: "boolean", default: false },
			report: { type: "string" },
		},
	});
	const [command, input] = positionals;
	if (command !== "convert" || !input) {
		console.error(USAGE);
		process.exitCode = 2;
		return;
	}
	const output = values.output ?? input.replace(/\.xml$/i, "") + ".emdash";
	const wxr = await parseWxr(createReadStream(input));
	const result = await convertWxr(wxr, { fetchMedia: values.media ? fetchMedia : undefined });
	await new Promise<void>((resolve, reject) => {
		const stream = createWriteStream(output);
		Readable.fromWeb(result.archive() as never).pipe(stream).on("finish", resolve).on("error", reject);
	});

	const counts = Object.entries(result.package.manifest.records)
		.map(([kind, summary]) => `${kind}: ${summary?.count}`)
		.join(", ");
	console.log(`Wrote ${output}\n  ${counts}`);
	const bySource = new Map<string, number>();
	for (const entry of result.entries) bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + 1);
	console.log(`  content: ${[...bySource].map(([source, n]) => `${n} ${source}`).join(", ")}`);
	for (const entry of result.entries) {
		for (const note of entry.notes) {
			const text = note.text ? ` "${note.text}"` : "";
			console.log(`  note ${entry.collection}/${entry.slug}: ${note.widget} ${note.reason}${text}`);
		}
	}
	if (result.skippedMedia.length > 0) console.log(`  media not downloaded: ${result.skippedMedia.length}`);
	if (values.report) await writeFile(values.report, JSON.stringify(result.entries, null, "\t"));
}

await main();
