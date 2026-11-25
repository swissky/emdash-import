/**
 * In-memory package writer with the interface `PackageAssembler` expects.
 * Files are kept as bytes; `files()` yields them in container order
 * (manifest first) for `packSitePackage`.
 */

import { TransferError } from "./errors.js";
import { canonicalJson } from "./canonical.js";
import { packageDigest, sha256Hex, type Sha256Digest } from "./digest.js";
import type { RecordKind, RecordOfKind } from "./kinds.js";
import {
	parseManifest,
	serializeManifest,
	type IndexChunkRef,
	type PackageFileEntry,
	type SitePackageManifest,
} from "./manifest.js";
import { indexChunkPath, MANIFEST_PATH, mediaBlobPath, recordChunkPath } from "./paths.js";
import { encodeChunk, encodeRecordLine } from "./records.js";
import type { PackageFileSource } from "./tar.js";

const encoder = new TextEncoder();

export class StagedPackageWriter {
	readonly #files = new Map<string, Uint8Array>();

	async writeFile(path: string, bytes: Uint8Array): Promise<PackageFileEntry> {
		this.#files.set(path, bytes);
		return { path, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) };
	}

	async writeRecordChunk<K extends RecordKind>(
		kind: K,
		seq: number,
		records: readonly RecordOfKind<K>[],
	): Promise<PackageFileEntry> {
		const path = recordChunkPath(kind, seq);
		for (const record of records) {
			if (record.kind !== kind) {
				throw new TransferError("TRANSFER_RECORD_INVALID", "Record kind does not match its chunk", {
					detail: { path, id: record.id },
				});
			}
		}
		const lines = records.map((record) => encodeRecordLine(record));
		const entry = await this.writeFile(path, encodeChunk(lines, path));
		return { ...entry, records: records.length };
	}

	async writeIndexChunk(seq: number, entries: readonly PackageFileEntry[]): Promise<IndexChunkRef> {
		const path = indexChunkPath(seq);
		const lines = entries.map((entry) => canonicalJson(entry));
		const file = await this.writeFile(path, encodeChunk(lines, path));
		return { path, bytes: file.bytes, sha256: file.sha256, entries: entries.length };
	}

	async writeBlob(sha256: string, body: Uint8Array, bytes: number): Promise<PackageFileEntry> {
		const path = mediaBlobPath(sha256);
		this.#files.set(path, body);
		return { path, bytes, sha256 };
	}

	async writeManifest(manifest: SitePackageManifest): Promise<Sha256Digest> {
		const text = serializeManifest(parseManifest(serializeManifest(manifest)));
		this.#files.set(MANIFEST_PATH, encoder.encode(text));
		return packageDigest(manifest);
	}

	get(path: string): Uint8Array | undefined {
		return this.#files.get(path);
	}

	*files(): Iterable<PackageFileSource> {
		const manifest = this.#files.get(MANIFEST_PATH);
		if (!manifest) throw new Error("Package has no manifest yet");
		yield { path: MANIFEST_PATH, bytes: manifest.byteLength, body: () => manifest };
		for (const [path, bytes] of this.#files) {
			if (path !== MANIFEST_PATH) yield { path, bytes: bytes.byteLength, body: () => bytes };
		}
	}
}
