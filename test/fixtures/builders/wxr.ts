/** Writes small WXR exports for page builder fixtures. */

export interface FixturePost {
	id: number;
	title: string;
	slug: string;
	type?: string;
	status?: string;
	content?: string;
	meta?: Record<string, string>;
}

export interface FixtureAttachment {
	id: number;
	url: string;
}

const cdata = (value: string) => `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

export function wxr(site: string, posts: FixturePost[], attachments: FixtureAttachment[] = []): string {
	const items = [
		...attachments.map(
			(a) => `	<item>
		<title>${a.url.split("/").pop()}</title>
		<wp:post_id>${a.id}</wp:post_id>
		<wp:post_date>${cdata("2026-01-01 10:00:00")}</wp:post_date>
		<wp:post_type>${cdata("attachment")}</wp:post_type>
		<wp:status>${cdata("inherit")}</wp:status>
		<wp:attachment_url>${cdata(a.url)}</wp:attachment_url>
	</item>`,
		),
		...posts.map(
			(p) => `	<item>
		<title>${cdata(p.title)}</title>
		<link>${site}/${p.slug}/</link>
		<content:encoded>${cdata(p.content ?? "")}</content:encoded>
		<excerpt:encoded>${cdata("")}</excerpt:encoded>
		<wp:post_id>${p.id}</wp:post_id>
		<wp:post_date>${cdata("2026-01-02 10:00:00")}</wp:post_date>
		<wp:post_date_gmt>${cdata("2026-01-02 09:00:00")}</wp:post_date_gmt>
		<wp:post_modified_gmt>${cdata("2026-01-03 09:00:00")}</wp:post_modified_gmt>
		<wp:post_name>${cdata(p.slug)}</wp:post_name>
		<wp:status>${cdata(p.status ?? "publish")}</wp:status>
		<wp:post_parent>0</wp:post_parent>
		<wp:menu_order>0</wp:menu_order>
		<wp:post_type>${cdata(p.type ?? "page")}</wp:post_type>
${Object.entries(p.meta ?? {})
	.map(
		([key, value]) => `		<wp:postmeta>
			<wp:meta_key>${cdata(key)}</wp:meta_key>
			<wp:meta_value>${cdata(value)}</wp:meta_value>
		</wp:postmeta>`,
	)
	.join("\n")}
	</item>`,
		),
	];
	return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
	xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
	<title>Builder Test Site</title>
	<link>${site}</link>
	<description>Fake site for page builder imports</description>
	<language>en-US</language>
	<wp:wxr_version>1.2</wp:wxr_version>
	<wp:base_site_url>${site}</wp:base_site_url>
	<wp:base_blog_url>${site}</wp:base_blog_url>
${items.join("\n")}
</channel>
</rss>
`;
}
