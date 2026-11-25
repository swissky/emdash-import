/**
 * A single-page converter: upload a WordPress export (WXR), get an EmDash
 * site package back. With "media" checked, uploads are fetched from the
 * WordPress site into the package, up to MAX_MEDIA files.
 */

import { convertWxr } from "./convert.js";
import { parseWxrString } from "./wordpress/parser.js";

const MAX_MEDIA = 200;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>EmDash Import</title>
<style>
	body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1.25rem; color: #1a1a1a; }
	h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
	p { color: #555; }
	form { display: grid; gap: 1rem; margin-top: 2rem; }
	label { display: flex; gap: 0.5rem; align-items: center; }
	button { font: inherit; padding: 0.75rem 1rem; border: 0; border-radius: 0.5rem; background: #1a1a1a; color: #fff; cursor: pointer; }
	button:disabled { opacity: 0.6; cursor: progress; }
	output { white-space: pre-wrap; font-size: 0.875rem; }
</style>
</head>
<body>
<h1>EmDash Import</h1>
<p>Upload a WordPress export (Tools &gt; Export &gt; All content). You get an <code>.emdash</code> site package that you import in EmDash under Settings &gt; Transfer. Elementor and Divi pages are converted to EmDash content.</p>
<form method="post" action="/convert" enctype="multipart/form-data">
	<label for="file">WordPress export (.xml)</label>
	<input id="file" name="file" type="file" accept=".xml,application/xml,text/xml" required />
	<label><input name="media" type="checkbox" value="1" /> Copy images into the package (up to ${MAX_MEDIA})</label>
	<button type="submit">Convert</button>
	<output aria-live="polite"></output>
</form>
<script>
	const form = document.querySelector("form");
	const out = form.querySelector("output");
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const button = form.querySelector("button");
		button.disabled = true;
		out.textContent = "Converting…";
		try {
			const response = await fetch(form.action, { method: "POST", body: new FormData(form) });
			if (!response.ok) throw new Error(await response.text());
			const blob = await response.blob();
			const name = (form.file.files[0].name.replace(/\\.xml$/i, "") || "site") + ".emdash";
			const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
			link.click();
			out.textContent = "Done. " + (response.headers.get("x-emdash-import-summary") ?? "");
		} catch (error) {
			out.textContent = "Conversion failed: " + error.message;
		} finally {
			button.disabled = false;
		}
	});
</script>
</body>
</html>`;

async function convert(request: Request): Promise<Response> {
	const form = await request.formData();
	const file = form.get("file");
	if (!(file instanceof File)) return new Response("Upload a WordPress export file.", { status: 400 });
	let wxr;
	try {
		wxr = await parseWxrString(await file.text());
	} catch {
		return new Response("This file is not a WordPress export (WXR).", { status: 400 });
	}
	let fetched = 0;
	const fetchMedia = form.get("media")
		? async (url: string) => {
				if (++fetched > MAX_MEDIA || !/^https?:\/\//i.test(url)) return null;
				const response = await fetch(url, { redirect: "follow" });
				return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
			}
		: undefined;
	const result = await convertWxr(wxr, { fetchMedia });
	const sources = new Map<string, number>();
	for (const entry of result.entries) sources.set(entry.source, (sources.get(entry.source) ?? 0) + 1);
	const notes = result.entries.reduce((n, entry) => n + entry.notes.length, 0);
	const summary = `${result.entries.length} entries (${[...sources].map(([s, n]) => `${n} ${s}`).join(", ")}), ${notes} notes, ${result.skippedMedia.length} images not copied`;
	return new Response(result.archive(), {
		headers: {
			"content-type": "application/x-tar",
			"content-disposition": 'attachment; filename="site.emdash"',
			"x-emdash-import-summary": summary,
		},
	});
}

export default {
	async fetch(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/convert" && request.method === "POST") return convert(request);
		if (pathname === "/" && request.method === "GET") {
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		}
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler;
