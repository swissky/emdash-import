/** A fake Divi site: a landing page with rows, modules and edge cases. */

import { type FixturePost, wxr } from "./wxr.js";

const SITE = "https://divi.example";

const landing = `[et_pb_section fb_built="1" _builder_version="4.27.4"][et_pb_row _builder_version="4.27.4"][et_pb_column type="4_4"][et_pb_heading title="Welcome to the Boat Rental" title_level="h1"][/et_pb_heading][et_pb_text _builder_version="4.27.4"]<p>Rent a <strong>pedal boat</strong> by the hour.</p>
<ul><li>Pedal boats</li><li>Kayaks</li></ul>[/et_pb_text][et_pb_button button_text="Book now" button_url="${SITE}/booking/" url_new_window="off"][/et_pb_button][/et_pb_column][/et_pb_row][et_pb_row column_structure="1_2,1_2"][et_pb_column type="1_2"][et_pb_blurb title="Kayak tours" url="${SITE}/tours/" image="${SITE}/wp-content/uploads/2026/02/kayak-300x200.jpg"]<p>Guided tours on Sundays.</p>[/et_pb_blurb][/et_pb_column][et_pb_column type="1_2"][et_pb_image src="${SITE}/wp-content/uploads/2026/02/dock.jpg" alt="The dock"][/et_pb_image][/et_pb_column][/et_pb_row][/et_pb_section][et_pb_section][et_pb_row][et_pb_column type="4_4"][et_pb_gallery gallery_ids="601,602"][/et_pb_gallery][et_pb_video src="https://vimeo.com/76979871"][/et_pb_video][et_pb_tabs][et_pb_tab title="Prices"]<p>CHF 25 per hour.</p>[/et_pb_tab][et_pb_tab title="Rules"]<p>Life jackets required.</p>[/et_pb_tab][/et_pb_tabs][et_pb_toggle title="Do I need a licence?"]<p>No.</p>[/et_pb_toggle][et_pb_testimonial author="Marco" job_title="Visitor"]<p>Great afternoon on the lake.</p>[/et_pb_testimonial][et_pb_number_counter title="Happy rowers" number="830"][/et_pb_number_counter][et_pb_cta title="Groups welcome" button_text="Ask us" button_url="${SITE}/contact/"]<p>Ten or more people?</p>[/et_pb_cta][et_pb_divider][/et_pb_divider][et_pb_text disabled_on="on|on|on"]<p>Hidden everywhere</p>[/et_pb_text][et_pb_contact_form title="Contact"][et_pb_contact_field field_title="Name"][/et_pb_contact_field][/et_pb_contact_form][et_pb_blog posts_number="3"][/et_pb_blog][dsm_fancy_box title="Third party"][/dsm_fancy_box][et_pb_code]<div class="notice">Code module <em>HTML</em></div>[/et_pb_code][et_pb_map address="Seestrasse 2, Lauerz"][/et_pb_map][/et_pb_column][/et_pb_row][/et_pb_section]`;

export const diviPosts: FixturePost[] = [
	{ id: 20, title: "Home", slug: "home", content: landing, meta: { _et_pb_use_builder: "on" } },
	{ id: 21, title: "Plain post", slug: "plain", type: "post", content: "<p>Classic editor post.</p>" },
	{ id: 22, title: "Saved layout", slug: "saved-layout", type: "et_pb_layout", content: "[et_pb_section][/et_pb_section]" },
];

export const diviAttachments = [
	{ id: 601, url: `${SITE}/wp-content/uploads/2026/02/kayak.jpg` },
	{ id: 602, url: `${SITE}/wp-content/uploads/2026/02/dock.jpg` },
];

export const diviExport = () => wxr(SITE, diviPosts, diviAttachments);
