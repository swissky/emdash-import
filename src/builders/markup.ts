/**
 * Writers for WordPress block markup. Page builder converters emit pieces of
 * this markup, and `toPortableText` converts them with the same converter
 * the block editor content goes through.
 *
 * Free HTML (a text editor widget's paragraphs and lists) is a `Piece` of
 * its own: `gutenbergToPortableText` keeps HTML between block comments as
 * one raw `htmlBlock`, so it goes through `htmlToPortableText` instead.
 */

import {
	gutenbergToPortableText,
	htmlToPortableText,
	type PortableTextBlock,
} from "@emdash-cms/gutenberg-to-portable-text";

export type Piece = { blocks: string } | { html: string } | { columns: Piece[][] };

/** Sequential block keys, so the same input always converts to the same output. */
export function keySequence(prefix = "k"): () => string {
	let seq = 0;
	return () => `${prefix}${(++seq).toString(36)}`;
}

export function toPortableText(
	pieces: readonly Piece[],
	nextKey: () => string = keySequence(),
): PortableTextBlock[] {
	const options = { keyGenerator: nextKey };
	const out: PortableTextBlock[] = [];
	let pending: string[] = [];
	const flush = () => {
		if (pending.length > 0) out.push(...gutenbergToPortableText(pending.join("\n\n"), options));
		pending = [];
	};
	for (const piece of pieces) {
		if ("blocks" in piece) {
			if (piece.blocks) pending.push(piece.blocks);
			continue;
		}
		flush();
		if ("html" in piece) {
			if (piece.html.trim()) out.push(...htmlToPortableText(piece.html, options));
			continue;
		}
		const columns = piece.columns
			.map((column) => toPortableText(column, nextKey))
			.filter((content) => content.length > 0);
		if (columns.length > 1) {
			out.push({
				_type: "columns",
				_key: nextKey(),
				columns: columns.map((content) => ({ _type: "column", _key: nextKey(), content })),
			} as PortableTextBlock);
		} else {
			out.push(...(columns[0] ?? []));
		}
	}
	flush();
	return out;
}

const AMP = /&/g;
const LT = /</g;
const GT = />/g;
const QUOTE = /"/g;

export function escapeHtml(text: string): string {
	return text.replace(AMP, "&amp;").replace(LT, "&lt;").replace(GT, "&gt;");
}

export function escapeAttr(text: string): string {
	return escapeHtml(text).replace(QUOTE, "&quot;");
}

function wrap(name: string, inner: string, attrs?: Record<string, unknown>): string {
	const json = attrs && Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : "";
	return `<!-- wp:${name}${json} -->\n${inner}\n<!-- /wp:${name} -->`;
}

/** A heading; levels are clamped to 2..6 because the entry title is the h1. */
export function heading(html: string, level = 2): string {
	const h = Math.min(6, Math.max(2, level));
	return wrap(
		"heading",
		`<h${h} class="wp-block-heading">${html}</h${h}>`,
		h === 2 ? undefined : { level: h },
	);
}

export function paragraph(html: string): string {
	return wrap("paragraph", `<p>${html}</p>`);
}

export function link(textHtml: string, href: string, newTab = false): string {
	const target = newTab ? ' target="_blank" rel="noopener"' : "";
	return `<a href="${escapeAttr(href)}"${target}>${textHtml}</a>`;
}

export interface ImageRef {
	url: string;
	id?: number;
	alt?: string;
	caption?: string;
	href?: string;
}

function imgTag(image: ImageRef): string {
	const cls = image.id ? ` class="wp-image-${image.id}"` : "";
	return `<img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt ?? "")}"${cls}/>`;
}

export function image(img: ImageRef): string {
	const inner = img.href ? `<a href="${escapeAttr(img.href)}">${imgTag(img)}</a>` : imgTag(img);
	const caption = img.caption
		? `<figcaption class="wp-element-caption">${escapeHtml(img.caption)}</figcaption>`
		: "";
	return wrap(
		"image",
		`<figure class="wp-block-image">${inner}${caption}</figure>`,
		img.id ? { id: img.id } : undefined,
	);
}

export function gallery(images: readonly ImageRef[]): string {
	if (images.length === 0) return "";
	const inner = images.map((img) => image(img)).join("\n");
	return wrap("gallery", `<figure class="wp-block-gallery has-nested-images">\n${inner}\n</figure>`);
}

const YOUTUBE = /(?:youtube\.com|youtu\.be)/i;
const VIMEO = /vimeo\.com/i;

export function embed(url: string): string {
	const provider = YOUTUBE.test(url) ? "youtube" : VIMEO.test(url) ? "vimeo" : undefined;
	const attrs: Record<string, unknown> = { url, type: "video" };
	if (provider) attrs.providerNameSlug = provider;
	return wrap(
		"embed",
		`<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\n${escapeHtml(url)}\n</div></figure>`,
		attrs,
	);
}

export function video(src: string): string {
	return wrap("video", `<figure class="wp-block-video"><video controls src="${escapeAttr(src)}"></video></figure>`);
}

/** A quote; the converter drops `<cite>`, so the attribution is a paragraph of the quote. */
export function quote(html: string, cite?: string): string {
	const citation = cite ? `<p>${escapeHtml(cite)}</p>` : "";
	return wrap("quote", `<blockquote class="wp-block-quote">${html}${citation}</blockquote>`);
}

export function list(itemsHtml: readonly string[]): string {
	if (itemsHtml.length === 0) return "";
	const items = itemsHtml.map((item) => wrap("list-item", `<li>${item}</li>`)).join("\n");
	return wrap("list", `<ul class="wp-block-list">\n${items}\n</ul>`);
}

export function rawHtml(html: string): string {
	return wrap("html", html);
}
