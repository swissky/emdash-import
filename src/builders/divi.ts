/**
 * Divi Builder content (`[et_pb_*]` shortcodes in `post_content`) to block
 * markup pieces. Sections, rows and columns contribute their modules in
 * document order; a row with several columns becomes a columns block.
 * Modules hidden on desktop and layout-only modules are skipped; modules
 * that render site templates and unknown modules are reported as notes.
 */

import { type BuilderNote, plain } from "./common.js";
import * as m from "./markup.js";
import type { Piece } from "./markup.js";

interface Shortcode {
	tag: string;
	attrs: Record<string, string>;
	children: Shortcode[];
	/** HTML directly inside the shortcode. */
	content: string;
}

export interface DiviOptions {
	/** WordPress attachment id to its URL (gallery modules store ids only). */
	attachmentUrl?: (id: number) => string | undefined;
}

const MAX_DEPTH = 64;
const TOKEN = /\[(\/)?([a-z][a-z0-9_-]*)((?:\s+[^\]]*?)?)\s*(\/)?\]/g;
const ATTR = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
const VIDEO_FILE = /\.(mp4|webm|ogv|mov)(\?|$)/i;
const HEADING_LEVEL = /^h([1-6])$/;
const CONTAINERS = new Set([
	"et_pb_section",
	"et_pb_fullwidth_section",
	"et_pb_row",
	"et_pb_row_inner",
	"et_pb_column",
	"et_pb_column_inner",
]);
const LAYOUT_ONLY = new Set(["et_pb_divider", "et_pb_social_media_follow"]);
const SITE_TEMPLATE = new Set([
	"et_pb_blog",
	"et_pb_portfolio",
	"et_pb_filterable_portfolio",
	"et_pb_fullwidth_portfolio",
	"et_pb_contact_form",
	"et_pb_signup",
	"et_pb_search",
	"et_pb_menu",
	"et_pb_fullwidth_menu",
	"et_pb_shop",
	"et_pb_comments",
	"et_pb_login",
	"et_pb_sidebar",
	"et_pb_post_nav",
	"et_pb_post_slider",
	"et_pb_fullwidth_post_slider",
	"et_pb_post_title",
	"et_pb_fullwidth_post_title",
]);
const CONTAINER_MODULES = new Set([
	"et_pb_slider",
	"et_pb_fullwidth_slider",
	"et_pb_tabs",
	"et_pb_accordion",
]);
const ITEM_MODULES = new Set(["et_pb_tab", "et_pb_toggle", "et_pb_accordion_item"]);

export function isDiviContent(content: string | undefined): boolean {
	return content?.includes("[et_pb_section") === true;
}

/** Divi encodes quotes and brackets inside attribute values. */
function decodeAttr(value: string): string {
	return value.replaceAll("%22", '"').replaceAll("%91", "[").replaceAll("%93", "]");
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(ATTR)) {
		const name = match[1];
		if (name) attrs[name.toLowerCase()] = decodeAttr(match[2] ?? match[3] ?? match[4] ?? "");
	}
	return attrs;
}

/** Parse Divi shortcodes into a tree; text outside any shortcode is dropped. */
export function parseDivi(content: string): Shortcode[] {
	const root: Shortcode = { tag: "root", attrs: {}, children: [], content: "" };
	const stack: Shortcode[] = [root];
	let last = 0;
	for (const match of content.matchAll(TOKEN)) {
		const top = stack.at(-1) ?? root;
		const index = match.index ?? 0;
		if (stack.length > 1) top.content += content.slice(last, index);
		last = index + match[0].length;
		const [, closing, tag = "", rawAttrs = "", selfClosing] = match;
		// Third-party modules sit directly in a column; any other shortcode is
		// text of the module it appears in.
		const inColumn = top.tag.startsWith("et_pb_column");
		if (!tag.startsWith("et_pb_") && !(inColumn && !closing) && !stack.some((n) => n.tag === tag)) {
			if (stack.length > 1) top.content += match[0];
			continue;
		}
		if (closing) {
			const open = stack.findLastIndex((node) => node.tag === tag);
			if (open > 0) stack.length = open;
			continue;
		}
		const node: Shortcode = { tag, attrs: parseAttrs(rawAttrs), children: [], content: "" };
		top.children.push(node);
		if (!selfClosing && stack.length <= MAX_DEPTH) stack.push(node);
	}
	return root.children;
}

function attr(node: Shortcode, name: string): string {
	return node.attrs[name] ?? "";
}

function linkUrl(node: Shortcode, name: string): string {
	const url = attr(node, name).trim();
	return url && !url.startsWith("#") ? url : "";
}

function mapsLink(address: string): string {
	const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
	return m.paragraph(m.link(m.escapeHtml(address), href, true));
}

class Walker {
	readonly pieces: Piece[] = [];
	readonly notes: BuilderNote[];
	readonly #options: DiviOptions;

	constructor(options: DiviOptions, notes: BuilderNote[] = []) {
		this.#options = options;
		this.notes = notes;
	}

	blocks(markup: string): void {
		if (markup) this.pieces.push({ blocks: markup });
	}

	html(html: string): void {
		if (html.trim()) this.pieces.push({ html: html.trim() });
	}

	walk(nodes: readonly Shortcode[]): void {
		for (const node of nodes) this.node(node);
	}

	node(node: Shortcode): void {
		// `disabled_on` is "phone|tablet|desktop".
		if (attr(node, "disabled_on").split("|")[2] === "on" || attr(node, "disabled") === "on") return;
		if (CONTAINERS.has(node.tag)) {
			const columns = node.children.filter((child) => child.tag.startsWith("et_pb_column"));
			if (node.tag.startsWith("et_pb_row") && columns.length > 1) this.columns(columns);
			else this.walk(node.children);
			return;
		}
		this.module(node);
	}

	columns(columns: readonly Shortcode[]): void {
		const cols = columns.map((column) => {
			const inner = new Walker(this.#options, this.notes);
			inner.walk(column.children);
			return inner.pieces;
		});
		this.pieces.push({ columns: cols });
	}

	module(node: Shortcode): void {
		const tag = node.tag;
		if (LAYOUT_ONLY.has(tag)) return;
		if (SITE_TEMPLATE.has(tag)) {
			this.notes.push({ widget: tag, reason: "site_template" });
			return;
		}
		if (CONTAINER_MODULES.has(tag)) {
			this.walk(node.children);
			return;
		}
		const title = m.escapeHtml(attr(node, "title"));
		if (ITEM_MODULES.has(tag)) {
			if (title) this.blocks(m.heading(title, 3));
			this.html(node.content);
			return;
		}
		switch (tag) {
			case "et_pb_text":
				this.html(node.content);
				return;
			case "et_pb_code":
			case "et_pb_fullwidth_code":
				// Rendered through EmDash's sanitizer; scripts never run.
				if (node.content.trim()) this.blocks(m.rawHtml(node.content.trim()));
				return;
			case "et_pb_heading": {
				const level = Number(HEADING_LEVEL.exec(attr(node, "title_level"))?.[1] ?? 2);
				if (title) this.blocks(m.heading(title, level));
				return;
			}
			case "et_pb_image":
			case "et_pb_fullwidth_image": {
				const src = attr(node, "src");
				if (!src) return;
				this.blocks(
					m.image({
						url: src,
						alt: attr(node, "alt"),
						href: linkUrl(node, "url") || undefined,
						caption: attr(node, "title_text") || undefined,
					}),
				);
				return;
			}
			case "et_pb_gallery": {
				const images = attr(node, "gallery_ids")
					.split(",")
					.map((id) => Number(id.trim()))
					.filter((id) => Number.isInteger(id) && id > 0)
					.flatMap((id) => {
						const url = this.#options.attachmentUrl?.(id);
						return url ? [{ url, id }] : [];
					});
				this.blocks(m.gallery(images));
				return;
			}
			case "et_pb_video":
			case "et_pb_fullwidth_video": {
				const src = attr(node, "src");
				if (src) this.blocks(VIDEO_FILE.test(src) ? m.video(src) : m.embed(src));
				return;
			}
			case "et_pb_button": {
				const text = m.escapeHtml(attr(node, "button_text"));
				const url = linkUrl(node, "button_url");
				const newTab = attr(node, "url_new_window") === "on";
				if (text) this.blocks(m.paragraph(url ? m.link(text, url, newTab) : text));
				return;
			}
			case "et_pb_blurb": {
				const image = attr(node, "image");
				const url = linkUrl(node, "url");
				if (image) this.blocks(m.image({ url: image, alt: attr(node, "alt"), href: url || undefined }));
				if (title) this.blocks(m.heading(url ? m.link(title, url) : title, 3));
				this.html(node.content);
				return;
			}
			case "et_pb_cta":
			case "et_pb_fullwidth_header":
			case "et_pb_slide": {
				const heading = title || m.escapeHtml(attr(node, "heading"));
				if (heading) this.blocks(m.heading(heading, tag === "et_pb_fullwidth_header" ? 2 : 3));
				const sub = m.escapeHtml(attr(node, "subhead"));
				if (sub) this.blocks(m.paragraph(sub));
				this.html(node.content);
				const text = m.escapeHtml(attr(node, "button_text") || attr(node, "button_one_text"));
				const href = linkUrl(node, "button_url") || linkUrl(node, "button_one_url");
				if (text && href) this.blocks(m.paragraph(m.link(text, href)));
				return;
			}
			case "et_pb_testimonial": {
				const who = [attr(node, "author"), attr(node, "job_title"), attr(node, "company_name")]
					.filter(Boolean)
					.join(", ");
				if (node.content.trim()) this.blocks(m.quote(node.content.trim(), who || undefined));
				return;
			}
			case "et_pb_number_counter":
			case "et_pb_circle_counter": {
				const number = attr(node, "number");
				const suffix = attr(node, "percent_sign") === "on" ? "%" : "";
				if (number) {
					this.blocks(m.paragraph(`<strong>${m.escapeHtml(number + suffix)}</strong> ${title}`.trim()));
				}
				return;
			}
			case "et_pb_map":
			case "et_pb_fullwidth_map": {
				const address = attr(node, "address");
				if (address) this.blocks(mapsLink(address));
				return;
			}
			default:
				this.notes.push({
					widget: tag,
					reason: "unsupported",
					text: (title || plain(node.content)).slice(0, 120) || undefined,
				});
		}
	}
}

export function diviToPieces(
	content: string,
	options: DiviOptions = {},
): { pieces: Piece[]; notes: BuilderNote[] } {
	const walker = new Walker(options);
	walker.walk(parseDivi(content));
	return { pieces: walker.pieces, notes: walker.notes };
}
