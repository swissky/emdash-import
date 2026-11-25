/**
 * Media mapping: WordPress attachment URLs to package media ids, and the
 * rewrite of image references in converted content to package placeholders.
 */

import type { PortableTextBlock } from "@emdash-cms/gutenberg-to-portable-text";

import { MEDIA_FILE_PATH, mediaPlaceholder } from "./format/media-refs.js";

const SIZE_SUFFIX = /-\d+x\d+(?=\.[^./?#]+$)/;
const SCALED_SUFFIX = /-scaled(?=\.[^./?#]+$)/;
const LEADING_WWW = /^www\./;

/** Scheme-, www-, query- and size-insensitive key for an upload URL. */
export function mediaUrlKey(url: string): string | null {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace(LEADING_WWW, "").toLowerCase();
		const path = decodeURIComponent(parsed.pathname)
			.replace(SIZE_SUFFIX, "")
			.replace(SCALED_SUFFIX, "");
		return `${host}${path}`;
	} catch {
		return null;
	}
}

export interface PackageMedia {
	id: string;
	mimeType: string;
	filename: string;
	width?: number;
	height?: number;
	alt?: string;
}

export class MediaIndex {
	readonly #byKey = new Map<string, PackageMedia>();
	readonly #byWpId = new Map<number, PackageMedia>();

	add(url: string, wpId: number | undefined, media: PackageMedia): void {
		const key = mediaUrlKey(url);
		if (key) this.#byKey.set(key, media);
		if (wpId !== undefined) this.#byWpId.set(wpId, media);
	}

	byUrl(url: string | undefined): PackageMedia | undefined {
		if (!url) return undefined;
		const key = mediaUrlKey(url);
		return key ? this.#byKey.get(key) : undefined;
	}

	byWpId(id: number | string | undefined): PackageMedia | undefined {
		if (id === undefined || id === "") return undefined;
		return this.#byWpId.get(Number(id));
	}
}

export function mediaFileUrl(media: PackageMedia): string {
	return `${MEDIA_FILE_PATH}${mediaPlaceholder(media.id)}`;
}

/** An image or file field value referencing package media. */
export function mediaValue(media: PackageMedia): Record<string, unknown> {
	const value: Record<string, unknown> = {
		id: media.id,
		provider: "local",
		mimeType: media.mimeType,
		filename: media.filename,
		meta: { storageKey: mediaPlaceholder(media.id) },
	};
	if (media.width) value.width = media.width;
	if (media.height) value.height = media.height;
	if (media.alt) value.alt = media.alt;
	return value;
}

/** An image field value for a file that stays on its original host. */
export function externalImageValue(url: string): Record<string, unknown> {
	return { id: "", provider: "external", src: url };
}

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Point image assets, links, and background images that name a packaged
 * upload at the package media. Everything else stays as converted.
 * Returns the number of references rewritten.
 */
export function rewriteContentMedia(blocks: PortableTextBlock[], media: MediaIndex): number {
	let count = 0;
	const stack: unknown[] = [blocks];
	while (stack.length > 0) {
		const value = stack.pop();
		if (Array.isArray(value)) {
			stack.push(...value);
			continue;
		}
		if (!isNode(value)) continue;
		const asset = value.asset;
		if (value._type === "image" && isNode(asset) && typeof asset.url === "string") {
			const found = media.byUrl(asset.url) ?? media.byWpId(Number(asset._ref));
			if (found) {
				value.asset = { _type: "reference", _ref: found.id, url: mediaFileUrl(found) };
				count++;
			}
		}
		for (const key of ["href", "url", "backgroundImage"]) {
			const current = value[key];
			if (typeof current !== "string" || value._type === "embed") continue;
			const found = media.byUrl(current);
			if (found) {
				value[key] = mediaFileUrl(found);
				count++;
			}
		}
		for (const child of Object.values(value)) {
			if (typeof child === "object" && child !== null) stack.push(child);
		}
	}
	return count;
}
