import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { convertWxr } from "../src/convert.js";
import { parseWxrString } from "../src/wordpress/parser.js";
import { readPackage } from "./package.js";

const NOW = "2026-11-25T00:00:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const fakeImage = async (url: string) => new TextEncoder().encode(`bytes of ${url}`);

async function convert(name: string, withMedia = true) {
	const wxr = await parseWxrString(fixture(name));
	const result = await convertWxr(wxr, { now: NOW, fetchMedia: withMedia ? fakeImage : undefined });
	return { result, pkg: await readPackage(result.archive()) };
}

function text(content: unknown): string {
	return JSON.stringify(content);
}

function entry(pkg: Awaited<ReturnType<typeof readPackage>>, slug: string) {
	const found = pkg.byKind("entry").find((record) => record.slug === slug);
	if (!found) throw new Error(`entry ${slug} missing`);
	return found;
}

describe("convertWxr", () => {
	it.each(["sample-export.xml", "realistic-export.xml", "hyphenated-post-types-export.xml", "elementor-export.xml", "divi-export.xml"])(
		"writes a package whose every record validates: %s",
		async (name) => {
			const { pkg } = await convert(name);
			expect(pkg.records.length).toBeGreaterThan(0);
			for (const [kind, summary] of Object.entries(pkg.manifest.records)) {
				expect(pkg.byKind(kind as never).length, kind).toBe(summary?.count);
			}
		},
	);

	it("produces identical bytes for the same export", async () => {
		const a = await convert("elementor-export.xml");
		const b = await convert("elementor-export.xml");
		expect(a.result.package.digest).toEqual(b.result.package.digest);
	});

	it("keeps WordPress URLs when no media fetcher is given", async () => {
		const { pkg } = await convert("elementor-export.xml", false);
		expect(pkg.byKind("media")).toHaveLength(0);
		expect(text(entry(pkg, "home").fields.content)).toContain("https://elementor.example/wp-content/uploads/2026/01/terrace-1024x683.jpg");
	});
});

describe("Elementor pages", () => {
	it("imports a builder page from its Elementor data, not the SEO copy", async () => {
		const { pkg, result } = await convert("elementor-export.xml");
		const content = text(entry(pkg, "home").fields.content);
		expect(content).toContain("Welcome to the Lake Café");
		expect(content).not.toContain("SEO copy of the home page");
		expect(result.entries.find((e) => e.slug === "home")?.source).toBe("elementor");
	});

	it("converts widgets to headings, lists, columns, galleries, embeds and quotes", async () => {
		const { pkg } = await convert("elementor-export.xml");
		const blocks = entry(pkg, "home").fields.content as { _type: string; style?: string }[];
		const types = blocks.map((block) => block._type);
		expect(types).toEqual(expect.arrayContaining(["columns", "gallery", "embed"]));
		expect(blocks[0]).toMatchObject({ _type: "block", style: "h2" });
		const content = text(blocks);
		for (const expected of ["Opening hours", "Breakfast", "Served until 11.", "12,500+", "Anna, Guest", "tel:+41410000000"]) {
			expect(content).toContain(expected);
		}
	});

	it("points packaged images at package media placeholders", async () => {
		const { pkg } = await convert("elementor-export.xml");
		const content = text(entry(pkg, "home").fields.content);
		const terrace = pkg.byKind("media").find((media) => media.filename === "terrace.jpg");
		expect(terrace).toBeDefined();
		expect(content).toContain(`emdash-media:${terrace?.id}`);
		expect(content).not.toContain("terrace-1024x683.jpg");
	});

	it("inserts popup and global widget content and skips desktop-hidden elements", async () => {
		const { pkg } = await convert("elementor-export.xml");
		const content = text(entry(pkg, "home").fields.content);
		expect(content).toContain("Soup, salad, cake.");
		expect(content).toContain("Global note: closed on Mondays.");
		expect(content).not.toContain("Mobile only teaser");
	});

	it("reports widgets it cannot convert", async () => {
		const { result } = await convert("elementor-export.xml");
		const notes = result.entries.find((e) => e.slug === "home")?.notes ?? [];
		expect(notes).toEqual(
			expect.arrayContaining([
				{ widget: "form", reason: "site_template" },
				{ widget: "posts", reason: "site_template" },
				{ widget: "acme-fancy-slider", reason: "unsupported", text: "Third party" },
			]),
		);
	});

	it("falls back to post_content for invalid, abandoned or too deep Elementor data", async () => {
		const { pkg, result } = await convert("elementor-export.xml");
		expect(text(entry(pkg, "broken").fields.content)).toContain("Fallback copy");
		expect(text(entry(pkg, "left").fields.content)).toContain("Edited in the block editor later");
		expect(text(entry(pkg, "left").fields.content)).not.toContain("Lake Café");
		expect(text(entry(pkg, "deep").fields.content)).toContain("Deep fallback");
		expect(result.entries.find((e) => e.slug === "broken")?.notes).toEqual([{ widget: "document", reason: "invalid_data" }]);
		expect(result.entries.find((e) => e.slug === "left")?.notes).toEqual([]);
	});

	it("does not import Elementor library templates as entries", async () => {
		const { pkg } = await convert("elementor-export.xml");
		expect(pkg.byKind("entry").map((e) => e.slug)).not.toContain("menu-popup");
		expect(pkg.byKind("collection").map((c) => c.slug)).toEqual(["pages"]);
	});
});

describe("Divi pages", () => {
	it("converts modules in document order and keeps rows as columns", async () => {
		const { pkg, result } = await convert("divi-export.xml");
		const blocks = entry(pkg, "home").fields.content as { _type: string }[];
		const content = text(blocks);
		expect(result.entries.find((e) => e.slug === "home")?.source).toBe("divi");
		expect(content).not.toContain("[et_pb_");
		expect(blocks.map((b) => b._type)).toEqual(expect.arrayContaining(["columns", "gallery", "embed", "htmlBlock"]));
		for (const expected of ["Welcome to the Boat Rental", "Kayak tours", "CHF 25 per hour.", "Do I need a licence?", "Marco, Visitor", "Ask us"]) {
			expect(content).toContain(expected);
		}
		expect(content.indexOf("Welcome to the Boat Rental")).toBeLessThan(content.indexOf("Kayak tours"));
	});

	it("resolves gallery attachment ids and skips disabled modules", async () => {
		const { pkg } = await convert("divi-export.xml");
		const blocks = entry(pkg, "home").fields.content as { _type: string; images?: unknown[] }[];
		expect(blocks.find((b) => b._type === "gallery")?.images).toHaveLength(2);
		expect(text(blocks)).not.toContain("Hidden everywhere");
	});

	it("reports site template and third-party modules, and leaves non-Divi posts alone", async () => {
		const { pkg, result } = await convert("divi-export.xml");
		expect(result.entries.find((e) => e.slug === "home")?.notes).toEqual([
			{ widget: "et_pb_contact_form", reason: "site_template" },
			{ widget: "et_pb_blog", reason: "site_template" },
			{ widget: "dsm_fancy_box", reason: "unsupported", text: "Third party" },
		]);
		expect(result.entries.find((e) => e.slug === "plain")?.source).toBe("gutenberg");
		expect(pkg.byKind("entry").map((e) => e.slug)).not.toContain("saved-layout");
	});
});
