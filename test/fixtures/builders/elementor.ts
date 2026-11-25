/** A fake Elementor site: a landing page, a popup, a global widget and an edge-case page. */

import { type FixturePost, wxr } from "./wxr.js";

const SITE = "https://elementor.example";
const popupAction = `#elementor-action%3Aaction%3Dpopup%3Aopen%26settings%3D${btoa(JSON.stringify({ id: 900 }))}`;

let seq = 0;
const nextId = () => (++seq).toString(16).padStart(7, "0");
const w = (widgetType: string, settings: Record<string, unknown>) => ({
	id: nextId(),
	elType: "widget",
	widgetType,
	settings,
	elements: [],
});
const box = (settings: Record<string, unknown>, elements: unknown[]) => ({
	id: nextId(),
	elType: "container",
	settings,
	elements,
});
const half = (elements: unknown[]) => box({ width: { unit: "%", size: 50 } }, elements);

export const landing = [
	box({}, [
		w("heading", { title: "Welcome to the Lake Café", header_size: "h1" }),
		w("text-editor", { editor: "<p>Fresh coffee <strong>every day</strong> since 1999.</p><ul><li>Espresso</li><li>Cake</li></ul>" }),
		w("spacer", { space: { size: 40 } }),
		w("button", { text: "Book a table", link: { url: "https://elementor.example/booking/", is_external: "" } }),
	]),
	box({ flex_direction: "row" }, [
		half([
			w("heading", { title: "Opening hours", header_size: "h3" }),
			w("button", { text: "Directions", link: { url: "https://maps.example/cafe", is_external: "on" } }),
		]),
		half([w("image", { image: { id: 501, url: `${SITE}/wp-content/uploads/2026/01/terrace-1024x683.jpg`, alt: "Terrace" } })]),
	]),
	w("gallery", {
		gallery: [
			{ id: 501, url: `${SITE}/wp-content/uploads/2026/01/terrace.jpg` },
			{ id: 502, url: `${SITE}/wp-content/uploads/2026/01/cake.jpg` },
		],
	}),
	w("video", { video_type: "youtube", youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
	w("tabs", {
		tabs: [
			{ tab_title: "Breakfast", tab_content: "<p>Served until 11.</p>" },
			{ tab_title: "Lunch", tab_content: "<p>From 12 to 14.</p>" },
		],
	}),
	w("icon-list", {
		icon_list: [
			{ text: "Lakeside seating", link: { url: "" } },
			{ text: "Call us", link: { url: "tel:+41410000000" } },
		],
	}),
	w("counter", { ending_number: 12500, title: "Cups served", suffix: "+" }),
	w("testimonial", { testimonial_content: "Best cake on the lake.", testimonial_name: "Anna", testimonial_job: "Guest" }),
	w("google_maps", { address: "Seestrasse 1, Lauerz" }),
	w("button", { text: "Read the full menu", link: { url: popupAction } }),
	{ id: "g1", elType: "widget", widgetType: "global", templateID: 901, settings: {}, elements: [] },
	w("heading", { title: "Mobile only teaser", __globals__: {}, hide_desktop: "hidden-desktop" }),
	w("form", { form_name: "Contact" }),
	w("posts", {}),
	w("acme-fancy-slider", { title: "Third party" }),
];

const popup = [w("heading", { title: "Full menu", header_size: "h2" }), w("text-editor", { editor: "<p>Soup, salad, cake.</p>" })];
const globalWidget = [w("text-editor", { editor: "<p>Global note: closed on Mondays.</p>" })];

const deep: unknown[] = [];
let cursor = deep;
for (let i = 0; i < 200; i++) {
	const next: unknown[] = [];
	cursor.push(box({}, next));
	cursor = next;
}
cursor.push(w("heading", { title: "Too deep" }));

const builder = (data: unknown, extra: Record<string, string> = {}) => ({
	_elementor_edit_mode: "builder",
	_elementor_data: JSON.stringify(data),
	...extra,
});

export const elementorPosts: FixturePost[] = [
	{ id: 10, title: "Home", slug: "home", content: "<p>SEO copy of the home page</p>", meta: builder(landing) },
	{ id: 11, title: "Booking", slug: "booking", content: "<!-- wp:paragraph --><p>Book here.</p><!-- /wp:paragraph -->" },
	{ id: 12, title: "Broken Elementor", slug: "broken", content: "<p>Fallback copy</p>", meta: { _elementor_edit_mode: "builder", _elementor_data: "{not json" } },
	{ id: 13, title: "Left Elementor", slug: "left", content: "<p>Edited in the block editor later</p>", meta: { _elementor_data: JSON.stringify(landing) } },
	{ id: 14, title: "Deep", slug: "deep", content: "<p>Deep fallback</p>", meta: builder(deep) },
	{ id: 900, title: "Menu popup", slug: "menu-popup", type: "elementor_library", meta: builder(popup, { _elementor_template_type: "popup" }) },
	{ id: 901, title: "Closed note", slug: "closed-note", type: "elementor_library", meta: builder(globalWidget, { _elementor_template_type: "widget" }) },
];

export const elementorAttachments = [
	{ id: 501, url: `${SITE}/wp-content/uploads/2026/01/terrace.jpg` },
	{ id: 502, url: `${SITE}/wp-content/uploads/2026/01/cake.jpg` },
];

export const elementorExport = () => wxr(SITE, elementorPosts, elementorAttachments);
