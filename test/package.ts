/** Test helpers: read a converted package back and validate every file. */

import { sha256Hex } from "../src/format/digest.js";
import type { RecordKind, SitePackageRecord } from "../src/format/kinds.js";
import { parseIndexLine, parseManifest, type SitePackageManifest } from "../src/format/manifest.js";
import { decodeRecordLine, splitChunkLines } from "../src/format/records.js";
import { readSitePackageArchive } from "../src/format/tar.js";

export interface ReadPackage {
	manifest: SitePackageManifest;
	records: SitePackageRecord[];
	byKind<K extends RecordKind>(kind: K): Extract<SitePackageRecord, { kind: K }>[];
}

/** Unpacks an archive, checks every indexed file's digest, and decodes every record. */
export async function readPackage(archive: ReadableStream<Uint8Array>): Promise<ReadPackage> {
	const files = await readSitePackageArchive(archive);
	const manifestBytes = files.get("manifest.json");
	if (!manifestBytes) throw new Error("manifest.json missing");
	const manifest = parseManifest(manifestBytes);
	const records: SitePackageRecord[] = [];
	for (const ref of manifest.index) {
		const indexBytes = files.get(ref.path);
		if (!indexBytes) throw new Error(`missing ${ref.path}`);
		if ((await sha256Hex(indexBytes)) !== ref.sha256) throw new Error(`digest ${ref.path}`);
		for (const line of splitChunkLines(indexBytes, ref.path)) {
			const entry = parseIndexLine(line);
			const bytes = files.get(entry.path);
			if (!bytes) throw new Error(`missing ${entry.path}`);
			if ((await sha256Hex(bytes)) !== entry.sha256) throw new Error(`digest ${entry.path}`);
			const kind = /^records\/([a-z_]+)\//.exec(entry.path)?.[1] as RecordKind | undefined;
			if (!kind) continue;
			splitChunkLines(bytes, entry.path).forEach((recordLine, index) => {
				records.push(decodeRecordLine(kind, recordLine, { path: entry.path, line: index + 1 }).record);
			});
		}
	}
	return {
		manifest,
		records,
		byKind: <K extends RecordKind>(kind: K) =>
			records.filter((record): record is Extract<SitePackageRecord, { kind: K }> => record.kind === kind),
	};
}
