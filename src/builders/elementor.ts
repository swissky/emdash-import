/**
 * Elementor documents (`_elementor_data`) to block markup pieces, following
 * the widget mapping of the EmDash design "Import pages built with Elementor".
 *
 * Layout elements contribute their children in document order; a row of
 * percent-width children becomes columns. Elements hidden on desktop are
 * skipped. Widgets that render site templates and unknown widgets are
 * reported as notes.
 */

import { type BuilderNote, obj, plain, str } from "./common.js";
import * as m from "./markup.js";
import type { Piece } from "./markup.js";

export interface ElementorElement {
	id?: string;
	elType?: string;
	widgetType?: string;
	settings?: Record<string, unknown>;
	elements?: ElementorElement[];
	templateID?: number | string;
}

export interface ElementorOptions {
	/** Elementor library documents by WordPress id (popups, global widgets). */
	templates?: ReadonlyMap<number, ElementorElement[]>;
	/** WordPress post or attachment id to its address on the old site. */
	urlForId?: (id: number) => string | undefined;
	pageUrl?: string;
	homeUrl?: string;
}

const MAX_DEPTH = 64;
const LAYOUT_ONLY = new Set(["spacer", "divider", "menu-anchor"]);
const SITE_TEMPLATE = new Set([
	"posts",
	"loop-grid",
	"loop-carousel",
	"form",
	"nav-menu",
	"search-form",
	"search",
	"share-buttons",
	"archive-posts",
	"sitemap",
	"login",
]);
const HEADING_LEVEL = /^h([1-6])$/;
const TAG_NAME = /name="([^"]+)"/;
const TAG_SETTINGS = /settings="([^"]*)"/;
const POPUP_SETTINGS = /settings=([^&]+)/;

export function isElementorPost(meta: ReadonlyMap<string, string>): boolean {
	return meta.get("_elementor_edit_mode") === "builder" && meta.has("_elementor_data");
}

export function parseElementorData(raw: string | undefined): ElementorElement[] | null {
	if (!raw) return null;
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? (value as ElementorElement[]) : null;
	} catch {
		return null;
	}
}

function list(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(obj) : [];
}

interface Link {
	url: string;
	newTab: boolean;
}

class Walker {
	readonly pieces: Piece[] = [];
	readonly notes: BuilderNote[];
	readonly #options: ElementorOptions;
	readonly #popups: Set<number>;
	readonly #pendingPopups: ElementorElement[][] = [];

	constructor(options: ElementorOptions, notes: BuilderNote[] = [], popups = new Set<number>()) {
		this.#options = options;
		this.notes = notes;
		this.#popups = popups;
	}

	blocks(markup: string): void {
		if (markup) this.pieces.push({ blocks: markup });
	}

	html(html: string): void {
		if (html.trim()) this.pieces.push({ html });
	}

	walk(elements: readonly ElementorElement[], depth: number): void {
		if (depth > MAX_DEPTH) {
			this.notes.push({ widget: "document", reason: "too_deep" });
			return;
		}
		for (const element of elements) {
			this.element(element, depth);
			for (let popup = this.#pendingPopups.shift(); popup; popup = this.#pendingPopups.shift()) {
				this.walk(popup, depth + 1);
			}
		}
	}

	element(element: ElementorElement, depth: number): void {
		const settings = obj(element.settings);
		if (settings.hide_desktop === "hidden-desktop") return;
		if (element.elType === "widget") {
			this.widget(element, settings, depth);
			return;
		}
		const children = element.elements ?? [];
		const rows = percentRows(element, children);
		if (rows) this.columns(rows, depth);
		else this.walk(children, depth + 1);
	}

	columns(rows: ElementorElement[][], depth: number): void {
		for (const row of rows) {
			if (row.length === 1) {
				this.walk(row, depth + 1);
				continue;
			}
			const cols = row.map((child) => {
				const inner = new Walker(this.#options, this.notes, this.#popups);
				inner.walk([child], depth + 1);
				return inner.pieces;
			});
			this.pieces.push({ columns: cols });
		}
	}

	link(settings: Record<string, unknown>, key = "link"): Link | null {
		const tag = str(obj(settings.__dynamic__)[key]);
		if (tag) {
			const resolved = this.#dynamicLink(tag);
			return resolved ? { url: resolved, newTab: false } : null;
		}
		const value = obj(settings[key]);
		const url = str(value.url).trim();
		if (!url) return null;
		if (url.startsWith("#elementor-action")) {
			this.#queuePopup(url);
			return null;
		}
		if (url.startsWith("#")) {
			this.notes.push({ widget: "link", reason: "anchor_link", text: url });
			return null;
		}
		return { url, newTab: value.is_external === "on" || value.is_external === true };
	}

	#dynamicLink(tag: string): string | undefined {
		const name = TAG_NAME.exec(tag)?.[1];
		if (name === "post-url") return this.#options.pageUrl;
		if (name === "site-url") return this.#options.homeUrl;
		if (name === "internal-url") {
			const raw = TAG_SETTINGS.exec(tag)?.[1];
			let settings: Record<string, unknown> = {};
			try {
				settings = obj(JSON.parse(decodeURIComponent(raw ?? "")));
			} catch {
				settings = {};
			}
			const id = Number(settings.post_id ?? settings.attachment_id);
			const url = Number.isFinite(id) ? this.#options.urlForId?.(id) : undefined;
			if (url) return url;
		}
		this.notes.push({ widget: "dynamic", reason: "dynamic", text: name });
		return undefined;
	}

	#queuePopup(url: string): void {
		let id = Number.NaN;
		try {
			const encoded = POPUP_SETTINGS.exec(decodeURIComponent(url))?.[1] ?? "";
			id = Number(obj(JSON.parse(atob(encoded))).id);
		} catch {
			return;
		}
		if (!Number.isFinite(id) || this.#popups.has(id)) return;
		this.#popups.add(id);
		const popup = this.#options.templates?.get(id);
		if (popup) this.#pendingPopups.push(popup);
		else this.notes.push({ widget: "popup", reason: "missing_template", text: String(id) });
	}

	widget(element: ElementorElement, s: Record<string, unknown>, depth: number): void {
		const type = element.widgetType ?? "";
		if (type === "global") {
			const template = this.#options.templates?.get(Number(element.templateID));
			if (template) this.walk(template, depth + 1);
			else
				this.notes.push({
					widget: "global",
					reason: "missing_template",
					text: str(element.templateID),
				});
			return;
		}
		if (LAYOUT_ONLY.has(type)) return;
		if (SITE_TEMPLATE.has(type)) {
			this.notes.push({ widget: type, reason: "site_template" });
			return;
		}
		switch (type) {
			case "heading": {
				const title = str(s.title);
				if (!title) return;
				const level = Number(HEADING_LEVEL.exec(str(s.header_size) || "h2")?.[1] ?? 2);
				const link = this.link(s);
				this.blocks(m.heading(link ? m.link(title, link.url, link.newTab) : title, level));
				return;
			}
			case "text-editor":
				this.html(str(s.editor));
				return;
			case "image": {
				const image = obj(s.image);
				const url = str(image.url);
				if (!url) return;
				const link = s.link_to === "custom" ? this.link(s) : null;
				this.blocks(
					m.image({
						url,
						id: Number(image.id) || undefined,
						alt: str(image.alt),
						caption: s.caption_source === "custom" ? str(s.caption) : undefined,
						href: link?.url,
					}),
				);
				return;
			}
			case "gallery":
			case "image-gallery":
			case "image-carousel":
			case "media-carousel": {
				const items = list(s.gallery ?? s.wp_gallery ?? s.carousel ?? s.slides);
				this.blocks(
					m.gallery(
						items
							.map((item) => obj(item.image ?? item))
							.filter((item) => str(item.url))
							.map((item) => ({ url: str(item.url), id: Number(item.id) || undefined })),
					),
				);
				return;
			}
			case "video": {
				const source = str(s.video_type) || "youtube";
				const url =
					source === "hosted"
						? str(obj(s.hosted_url).url)
						: str(s[`${source}_url`]) || str(s.youtube_url);
				if (!url) return;
				this.blocks(source === "hosted" ? m.video(url) : m.embed(url));
				return;
			}
			case "google_maps": {
				const address = str(s.address);
				if (!address) return;
				const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
				this.blocks(m.paragraph(m.link(m.escapeHtml(address), href, true)));
				return;
			}
			case "button": {
				const text = m.escapeHtml(str(s.text));
				const link = this.link(s);
				if (!text) return;
				this.blocks(m.paragraph(link ? m.link(text, link.url, link.newTab) : text));
				return;
			}
			case "icon-list": {
				const items = list(s.icon_list).map((item) => {
					const text = m.escapeHtml(str(item.text));
					const link = this.link(item);
					if (!link) return text;
					return m.link(text || m.escapeHtml(link.url), link.url, link.newTab);
				});
				this.blocks(m.list(items.filter(Boolean)));
				return;
			}
			case "icon-box":
			case "image-box": {
				const link = this.link(s);
				const image = obj(s.image);
				if (type === "image-box" && str(image.url)) {
					this.blocks(
						m.image({ url: str(image.url), id: Number(image.id) || undefined, href: link?.url }),
					);
				}
				const title = m.escapeHtml(str(s.title_text));
				if (title) this.blocks(m.heading(link ? m.link(title, link.url) : title, 3));
				this.html(str(s.description_text));
				return;
			}
			case "counter": {
				const end = Number(s.ending_number);
				if (!Number.isFinite(end)) return;
				const sep = s.thousand_separator === "" ? "" : ",";
				const grouped = sep ? end.toLocaleString("en-US").replaceAll(",", sep) : String(end);
				const value = `${str(s.prefix)}${grouped}${str(s.suffix)}`;
				this.blocks(m.paragraph(`<strong>${m.escapeHtml(value)}</strong> ${m.escapeHtml(str(s.title))}`.trim()));
				return;
			}
			case "tabs":
			case "accordion":
			case "toggle": {
				for (const tab of list(s.tabs)) {
					const title = m.escapeHtml(str(tab.tab_title));
					if (title) this.blocks(m.heading(title, 3));
					this.html(str(tab.tab_content));
				}
				return;
			}
			case "nested-tabs":
			case "nested-accordion": {
				const titles = list(s.tabs ?? s.items).map((tab) => str(tab.tab_title ?? tab.item_title));
				(element.elements ?? []).forEach((child, index) => {
					const title = titles[index];
					if (title) this.blocks(m.heading(m.escapeHtml(title), 3));
					this.walk([child], depth + 1);
				});
				return;
			}
			case "testimonial":
			case "testimonial-carousel":
			case "reviews": {
				const items = type === "testimonial" ? [s] : list(s.slides);
				for (const item of items) {
					const content = str(item.testimonial_content ?? item.content);
					if (!content) continue;
					const who = [str(item.testimonial_name ?? item.name), str(item.testimonial_job ?? item.title)]
						.filter(Boolean)
						.join(", ");
					this.blocks(m.quote(`<p>${content}</p>`, who || undefined));
				}
				return;
			}
			case "slides": {
				for (const slide of list(s.slides)) {
					const title = m.escapeHtml(str(slide.heading));
					if (title) this.blocks(m.heading(title, 3));
					this.html(str(slide.description));
				}
				return;
			}
			case "html":
				// Rendered through EmDash's sanitizer; scripts never run.
				if (str(s.html).trim()) this.blocks(m.rawHtml(str(s.html)));
				return;
			case "shortcode":
				this.notes.push({ widget: type, reason: "unsupported", text: plain(str(s.shortcode)) });
				return;
			default:
				this.notes.push({
					widget: type || element.elType || "unknown",
					reason: "unsupported",
					text: plain(str(s.title ?? s.text ?? s.editor)).slice(0, 120) || undefined,
				});
		}
	}
}

/**
 * Children of a row whose widths are all in percent, wrapped into rows as
 * Elementor wraps them; null when the element is not such a row.
 */
function percentRows(
	element: ElementorElement,
	children: readonly ElementorElement[],
): ElementorElement[][] | null {
	if (children.length < 2) return null;
	const settings = obj(element.settings);
	const isSection = element.elType === "section";
	const isRow = element.elType === "container" && settings.flex_direction === "row";
	if (!isSection && !isRow) return null;
	const widths = children.map((child) => {
		const s = obj(child.settings);
		if (child.elType === "column") return Number(s._column_size ?? s._inline_size);
		const width = obj(s.width);
		return width.unit === "%" ? Number(width.size) : Number.NaN;
	});
	if (widths.some((w) => !Number.isFinite(w) || w <= 0)) return null;
	const rows: ElementorElement[][] = [];
	let row: ElementorElement[] = [];
	let used = 0;
	children.forEach((child, index) => {
		const width = widths[index] ?? 100;
		if (row.length > 0 && used + width > 100.5) {
			rows.push(row);
			row = [];
			used = 0;
		}
		row.push(child);
		used += width;
	});
	if (row.length > 0) rows.push(row);
	return rows;
}

export function elementorToPieces(
	elements: readonly ElementorElement[],
	options: ElementorOptions = {},
): { pieces: Piece[]; notes: BuilderNote[] } {
	const walker = new Walker(options);
	walker.walk(elements, 0);
	return { pieces: walker.pieces, notes: walker.notes };
}
