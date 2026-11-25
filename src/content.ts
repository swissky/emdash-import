/**
 * Chooses each post's content source and converts it to Portable Text:
 * Elementor data when Elementor built the post, Divi shortcodes when the
 * content holds them, otherwise the block editor or classic HTML as
 * EmDash's own WordPress import does.
 */

import {
	gutenbergToPortableText,
	type PortableTextBlock,
} from "@emdash-cms/gutenberg-to-portable-text";

import type { BuilderNote } from "./builders/common.js";
import { diviToPieces, isDiviContent } from "./builders/divi.js";
import {
	type ElementorElement,
	elementorToPieces,
	isElementorPost,
	parseElementorData,
} from "./builders/elementor.js";
import { keySequence, toPortableText } from "./builders/markup.js";
import type { WxrPost } from "./wordpress/parser.js";

export type ContentSource = "gutenberg" | "elementor" | "divi";

export interface ConvertedContent {
	source: ContentSource;
	blocks: PortableTextBlock[];
	notes: BuilderNote[];
}

export interface ContentContext {
	elementorTemplates: ReadonlyMap<number, ElementorElement[]>;
	urlForId: (id: number) => string | undefined;
	attachmentUrl: (id: number) => string | undefined;
	homeUrl?: string;
}

export function convertPostContent(post: WxrPost, context: ContentContext): ConvertedContent {
	const content = post.content ?? "";
	const keyGenerator = keySequence();
	const gutenberg = () => gutenbergToPortableText(content, { keyGenerator });
	if (isElementorPost(post.meta)) {
		const elements = parseElementorData(post.meta.get("_elementor_data"));
		if (elements) {
			const { pieces, notes } = elementorToPieces(elements, {
				templates: context.elementorTemplates,
				urlForId: context.urlForId,
				pageUrl: post.link,
				homeUrl: context.homeUrl,
			});
			const blocks = toPortableText(pieces, keyGenerator);
			if (blocks.length > 0) return { source: "elementor", blocks, notes };
			notes.push({ widget: "document", reason: "empty_fallback" });
			return { source: "gutenberg", blocks: gutenberg(), notes };
		}
		return {
			source: "gutenberg",
			blocks: gutenberg(),
			notes: [{ widget: "document", reason: "invalid_data" }],
		};
	}
	if (isDiviContent(content)) {
		const { pieces, notes } = diviToPieces(content, { attachmentUrl: context.attachmentUrl });
		return { source: "divi", blocks: toPortableText(pieces, keyGenerator), notes };
	}
	return { source: "gutenberg", blocks: gutenberg(), notes: [] };
}

/** Elementor library documents (popups, global widgets) by WordPress id. */
export function elementorTemplates(posts: readonly WxrPost[]): Map<number, ElementorElement[]> {
	const templates = new Map<number, ElementorElement[]>();
	for (const post of posts) {
		if (post.postType !== "elementor_library" || post.id === undefined) continue;
		const elements = parseElementorData(post.meta.get("_elementor_data"));
		if (elements) templates.set(post.id, elements);
	}
	return templates;
}
