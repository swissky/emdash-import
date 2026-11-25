export interface BuilderNote {
	widget: string;
	reason:
		| "unsupported"
		| "site_template"
		| "dynamic"
		| "anchor_link"
		| "missing_template"
		| "too_deep"
		| "invalid_data"
		| "empty_fallback";
	text?: string;
}

export function str(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return "";
}

export function obj(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

const TAG_PATTERN = /<[^>]*>/g;
const WS_PATTERN = /\s+/g;

export function plain(html: string): string {
	return html.replace(TAG_PATTERN, " ").replace(WS_PATTERN, " ").trim();
}
