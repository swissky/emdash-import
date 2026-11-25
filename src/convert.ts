/**
 * WordPress export (WXR) to an EmDash site package.
 *
 * The package holds the site's collections, fields, taxonomies, entries,
 * menus, settings and, when a media fetcher is given, its uploads. Ids are
 * derived from WordPress ids, so the same export yields the same package.
 */

import type { BuilderNote } from "./builders/common.js";
import { type ContentSource, convertPostContent, elementorTemplates } from "./content.js";
import { type AssembledPackage, PackageAssembler } from "./format/assembler.js";
import {
	compareStreamOrder,
	RECORD_KINDS,
	type SitePackageRecord,
	syntheticId,
} from "./format/kinds.js";
import { StagedPackageWriter } from "./format/package.js";
import { packSitePackage } from "./format/tar.js";
import { ulidFromHash } from "./ids.js";
import { MediaIndex, type PackageMedia, mediaValue, rewriteContentMedia } from "./media.js";
import type { WxrData, WxrPost } from "./wordpress/parser.js";
import { slugify } from "./wordpress/slugify.js";
import {
	getFilenameFromUrl,
	guessMimeType,
	isInternalPostType,
	mapPostTypeToCollection,
	relativizeContentLinks,
} from "./wordpress/utils.js";

export type MediaFetcher = (url: string) => Promise<Uint8Array | null>;

export interface ConvertOptions {
	locale?: string;
	/** Downloads an upload; without it, images keep their WordPress URLs. */
	fetchMedia?: MediaFetcher;
	/** Timestamp for records without a source date; fixed for reproducible packages. */
	now?: string;
}

export interface EntryReport {
	collection: string;
	slug: string;
	title: string;
	source: ContentSource;
	notes: BuilderNote[];
}

export interface ConvertResult {
	package: AssembledPackage;
	archive: () => ReadableStream<Uint8Array>;
	entries: EntryReport[];
	skippedMedia: string[];
}

const SKIPPED_POST_TYPES = new Set(["elementor_library", "et_pb_layout", "et_template"]);
const STATUS: Record<string, string> = {
	publish: "published",
	future: "scheduled",
	draft: "draft",
	pending: "draft",
	private: "draft",
};
const TAXONOMY_NAMES: Record<string, string> = { category: "category", post_tag: "tag" };

function iso(gmt: string | undefined, fallback: string): string {
	if (!gmt || gmt.startsWith("0000")) return fallback;
	const date = new Date(`${gmt.replace(" ", "T")}Z`);
	return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function label(slug: string): string {
	const words = slug.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

class Records {
	readonly #items: { record: SitePackageRecord; depth?: number }[] = [];

	add(record: SitePackageRecord, depth?: number): void {
		this.#items.push({ record, depth });
	}

	/** Records in package order: by kind, then stream order within a kind. */
	ordered(): { record: SitePackageRecord; depth?: number }[] {
		const rank = new Map<string, number>(RECORD_KINDS.map((kind, index) => [kind, index]));
		return this.#items.toSorted((a, b) => {
			const byKind = (rank.get(a.record.kind) ?? 0) - (rank.get(b.record.kind) ?? 0);
			if (byKind !== 0) return byKind;
			return compareStreamOrder(
				a.record.kind,
				{ id: a.record.id, depth: a.depth },
				{ id: b.record.id, depth: b.depth },
			);
		});
	}
}

function convertiblePosts(wxr: WxrData): WxrPost[] {
	return wxr.posts.filter(
		(post) =>
			post.postType !== undefined &&
			!isInternalPostType(post.postType) &&
			!SKIPPED_POST_TYPES.has(post.postType) &&
			post.status !== "trash" &&
			post.status !== "auto-draft",
	);
}

async function addMedia(
	wxr: WxrData,
	records: Records,
	assembler: PackageAssembler,
	fetchMedia: MediaFetcher,
	now: string,
): Promise<{ media: MediaIndex; skipped: string[] }> {
	const media = new MediaIndex();
	const skipped: string[] = [];
	for (const attachment of wxr.attachments) {
		if (!attachment.url || attachment.id === undefined) continue;
		const bytes = await fetchMedia(attachment.url).catch(() => null);
		if (!bytes) {
			skipped.push(attachment.url);
			continue;
		}
		const filename = getFilenameFromUrl(attachment.url) ?? `media-${attachment.id}`;
		const item: PackageMedia = {
			id: await ulidFromHash("wp", "media", String(attachment.id)),
			filename,
			mimeType: guessMimeType(filename) ?? "application/octet-stream",
			alt: attachment.meta.get("_wp_attachment_image_alt") || undefined,
		};
		media.add(attachment.url, attachment.id, item);
		records.add({
			kind: "media",
			id: item.id,
			filename,
			mimeType: item.mimeType,
			size: bytes.byteLength,
			alt: item.alt,
			createdAt: iso(attachment.postDate, now),
			blob: await assembler.addBlob(bytes),
		});
	}
	return { media, skipped };
}

async function addCollections(
	posts: readonly WxrPost[],
	records: Records,
	now: string,
): Promise<void> {
	const collections = new Map<string, boolean>();
	for (const post of posts) {
		const slug = mapPostTypeToCollection(post.postType ?? "post");
		collections.set(slug, (collections.get(slug) ?? false) || post.meta.has("_thumbnail_id"));
	}
	for (const [slug, hasThumbnail] of collections) {
		const id = await ulidFromHash("wp", "collection", slug);
		records.add({
			kind: "collection",
			id,
			slug,
			label: label(slug),
			supports: ["drafts", "revisions", "search"],
			source: "import:wordpress",
			hasSeo: true,
			hidden: false,
			routable: true,
			editLocking: true,
			createdAt: now,
			updatedAt: now,
		});
		const fields: [string, string, string, "TEXT" | "JSON"][] = [
			["title", "Title", "string", "TEXT"],
			["content", "Content", "portableText", "JSON"],
			["excerpt", "Excerpt", "text", "TEXT"],
		];
		if (hasThumbnail) fields.push(["featured_image", "Featured Image", "image", "TEXT"]);
		for (const [index, [fieldSlug, fieldLabel, type, columnType]] of fields.entries()) {
			records.add({
				kind: "field",
				id: await ulidFromHash("wp", "field", slug, fieldSlug),
				collectionId: id,
				slug: fieldSlug,
				label: fieldLabel,
				type,
				columnType,
				required: fieldSlug === "title",
				sortOrder: index,
				searchable: fieldSlug === "title" || fieldSlug === "content",
				translatable: true,
				indexed: false,
				createdAt: now,
			});
		}
	}
}

/** WordPress taxonomy slug and term slug to the term's package id. */
type TermIds = Map<string, string>;

async function addTaxonomies(
	wxr: WxrData,
	posts: readonly WxrPost[],
	records: Records,
	locale: string,
	now: string,
): Promise<TermIds> {
	const termIds: TermIds = new Map();
	const byTaxonomy = new Map<string, typeof wxr.terms>();
	for (const term of wxr.terms) {
		if (term.taxonomy === "nav_menu" || term.taxonomy.startsWith("elementor_")) continue;
		const list = byTaxonomy.get(term.taxonomy) ?? [];
		list.push(term);
		byTaxonomy.set(term.taxonomy, list);
	}
	for (const [taxonomy, terms] of byTaxonomy) {
		const name = TAXONOMY_NAMES[taxonomy] ?? taxonomy.replaceAll("-", "_");
		const collections = new Set<string>();
		for (const post of posts) {
			const assigned =
				taxonomy === "category"
					? post.categories
					: taxonomy === "post_tag"
						? post.tags
						: (post.customTaxonomies?.get(taxonomy) ?? []);
			if (assigned.length > 0) collections.add(mapPostTypeToCollection(post.postType ?? "post"));
		}
		records.add({
			kind: "taxonomy_def",
			id: await ulidFromHash("wp", "taxonomy", taxonomy),
			name,
			label: name === "tag" ? "Tags" : name === "category" ? "Categories" : label(name),
			hierarchical: taxonomy !== "post_tag",
			collections: [...collections].toSorted(),
			locale,
			createdAt: now,
		});
		const bySlug = new Map(terms.map((term) => [term.slug, term]));
		const depthOf = (slug: string, seen = new Set<string>()): number => {
			const parent = bySlug.get(slug)?.parent;
			if (!parent || !bySlug.has(parent) || seen.has(parent)) return 0;
			seen.add(slug);
			return 1 + depthOf(parent, seen);
		};
		for (const term of terms) {
			termIds.set(`${taxonomy}\u0000${term.slug}`, await ulidFromHash("wp", "term", String(term.id)));
		}
		for (const [index, term] of terms.entries()) {
			const parentId =
				term.parent && bySlug.has(term.parent)
					? termIds.get(`${taxonomy}\u0000${term.parent}`)
					: undefined;
			const id = termIds.get(`${taxonomy}\u0000${term.slug}`) ?? "";
			records.add(
				{
					kind: "term",
					id,
					name,
					slug: term.slug,
					label: term.name,
					parentId,
					data: term.description ? { description: term.description } : undefined,
					locale,
					sortOrder: index,
				},
				depthOf(term.slug),
			);
		}
	}
	return termIds;
}

interface EntryRef {
	collection: string;
	id: string;
}

async function addMenus(
	wxr: WxrData,
	entries: ReadonlyMap<number, EntryRef>,
	termIds: TermIds,
	records: Records,
	locale: string,
	now: string,
): Promise<void> {
	const termById = new Map(wxr.terms.map((term) => [term.id, term]));
	for (const menu of wxr.navMenus) {
		const menuId = await ulidFromHash("wp", "menu", String(menu.id));
		records.add({
			kind: "menu",
			id: menuId,
			name: menu.name,
			label: menu.label,
			locale,
			createdAt: now,
			updatedAt: now,
		});
		const byId = new Map(menu.items.map((item) => [item.id, item]));
		const depthOf = (id: number, seen = new Set<number>()): number => {
			const parent = byId.get(id)?.parentId;
			if (!parent || !byId.has(parent) || seen.has(parent)) return 0;
			seen.add(id);
			return 1 + depthOf(parent, seen);
		};
		for (const item of menu.items) {
			const base = {
				kind: "menu_item" as const,
				id: await ulidFromHash("wp", "menu_item", String(item.id)),
				menuId,
				parentId:
					item.parentId && byId.has(item.parentId)
						? await ulidFromHash("wp", "menu_item", String(item.parentId))
						: undefined,
				sortOrder: item.sortOrder,
				label: item.title || "Link",
				target: item.target || undefined,
				cssClasses: item.classes || undefined,
				locale,
				createdAt: now,
			};
			const entry = item.objectId === undefined ? undefined : entries.get(item.objectId);
			const term = item.objectId === undefined ? undefined : termById.get(item.objectId);
			const termId = term ? termIds.get(`${term.taxonomy}\u0000${term.slug}`) : undefined;
			if (item.type === "post_type" && entry) {
				const type = entry.collection === "pages" ? "page" : entry.collection === "posts" ? "post" : "collection";
				records.add(
					{ ...base, type, referenceCollection: entry.collection, referenceGroup: entry.id },
					depthOf(item.id),
				);
			} else if (item.type === "taxonomy" && term && termId) {
				const name = TAXONOMY_NAMES[term.taxonomy] ?? term.taxonomy;
				records.add(
					{ ...base, type: "taxonomy", referenceCollection: name, referenceGroup: termId },
					depthOf(item.id),
				);
			} else {
				records.add({ ...base, type: "custom", customUrl: item.url || "/" }, depthOf(item.id));
			}
		}
	}
}

export async function convertWxr(wxr: WxrData, options: ConvertOptions = {}): Promise<ConvertResult> {
	const locale = options.locale ?? wxr.site.language?.split("-")[0]?.toLowerCase() ?? "en";
	const now = options.now ?? new Date().toISOString();
	const records = new Records();
	const writer = new StagedPackageWriter();
	const assembler = new PackageAssembler(writer);
	const siteUrl = wxr.site.baseBlogUrl ?? wxr.site.link ?? "";
	const posts = convertiblePosts(wxr);

	const { media, skipped } = options.fetchMedia
		? await addMedia(wxr, records, assembler, options.fetchMedia, now)
		: { media: new MediaIndex(), skipped: [] };
	await addCollections(posts, records, now);
	const termIds = await addTaxonomies(wxr, posts, records, locale, now);

	const attachmentUrls = new Map<number, string>();
	for (const attachment of wxr.attachments) {
		if (attachment.id !== undefined && attachment.url) attachmentUrls.set(attachment.id, attachment.url);
	}
	const postLinks = new Map<number, string>();
	for (const post of wxr.posts) if (post.id !== undefined && post.link) postLinks.set(post.id, post.link);
	const templates = elementorTemplates(wxr.posts);
	const reports: EntryReport[] = [];
	const entryRefs = new Map<number, EntryRef>();
	const usedSlugs = new Set<string>();

	for (const post of posts) {
		const collection = mapPostTypeToCollection(post.postType ?? "post");
		const id = await ulidFromHash("wp", "entry", String(post.id));
		let slug = post.postName || slugify(post.title ?? "") || `entry-${post.id}`;
		while (usedSlugs.has(`${collection}\u0000${slug}`)) slug = `${slug}-${post.id}`;
		usedSlugs.add(`${collection}\u0000${slug}`);
		if (post.id !== undefined) entryRefs.set(post.id, { collection, id });

		const converted = convertPostContent(post, {
			elementorTemplates: templates,
			urlForId: (wpId) => postLinks.get(wpId) ?? attachmentUrls.get(wpId),
			attachmentUrl: (wpId) => attachmentUrls.get(wpId),
			homeUrl: siteUrl,
		});
		rewriteContentMedia(converted.blocks, media);
		if (siteUrl) relativizeContentLinks(converted.blocks, siteUrl);
		reports.push({ collection, slug, title: post.title ?? "", source: converted.source, notes: converted.notes });

		const fields: Record<string, unknown> = { title: post.title || slug, content: converted.blocks };
		if (post.excerpt) fields.excerpt = post.excerpt;
		const thumbnail = media.byWpId(post.meta.get("_thumbnail_id"));
		if (thumbnail) fields.featured_image = JSON.stringify(mediaValue(thumbnail));
		const status = STATUS[post.status ?? ""] ?? "draft";
		const date = iso(post.postDateGmt, now);
		records.add({
			kind: "entry",
			id,
			collection,
			slug,
			status,
			createdAt: date,
			updatedAt: iso(post.postModifiedGmt, date),
			publishedAt: status === "published" ? date : undefined,
			scheduledAt: status === "scheduled" ? date : undefined,
			locale,
			fields: JSON.parse(JSON.stringify(fields)),
		});

		const assigned: [string, string[]][] = [
			["category", post.categories],
			["post_tag", post.tags],
			...(post.customTaxonomies ?? new Map<string, string[]>()),
		];
		for (const [taxonomy, slugs] of assigned) {
			for (const termSlug of new Set(slugs)) {
				const termGroup = termIds.get(`${taxonomy}\u0000${termSlug}`);
				if (!termGroup) continue;
				const link = { kind: "content_term" as const, collection, entryGroup: id, termGroup };
				records.add({ ...link, id: syntheticId(link) });
			}
		}
	}

	await addMenus(wxr, entryRefs, termIds, records, locale, now);
	if (wxr.site.title) records.add({ kind: "setting", id: "site:title", value: wxr.site.title });
	if (wxr.site.description) records.add({ kind: "setting", id: "site:tagline", value: wxr.site.description });

	for (const { record, depth } of records.ordered()) await assembler.addRecord(record, { depth });
	const origin = siteUrl || wxr.site.title || "wordpress";
	const assembled = await assembler.finish({
		packageId: await ulidFromHash("wp", "package", origin, String(wxr.posts.length)),
		originSiteId: await ulidFromHash("wp", "site", origin),
		createdAt: now,
		createdByEmDashVersion: "emdash-import/0.1.0",
		defaultLocale: locale,
	});
	return {
		package: assembled,
		archive: () => packSitePackage(writer.files()),
		entries: reports,
		skippedMedia: skipped,
	};
}
