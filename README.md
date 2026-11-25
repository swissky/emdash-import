# EmDash Import

Converts a WordPress export (WXR) into an EmDash site package (`.emdash`). Import the package in EmDash under Settings > Transfer; EmDash validates it and shows a plan before anything is written.

Elementor and Divi pages are converted to EmDash content (headings, text, images, galleries, embeds, lists, quotes and columns). Widgets that cannot become static content, such as forms, post lists and third-party modules, are listed per page in the conversion report.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/swissky/emdash-import)

The Worker serves an upload page and converts in memory. It needs no bindings.

## Command line

```sh
pnpm install
node bin/emdash-import.mjs convert export.xml -o site.emdash
node bin/emdash-import.mjs convert export.xml --media --report report.json
```

`--media` downloads the uploads from the WordPress site into the package. Without it, images keep their WordPress URLs.

## Status

Prototype. Classic Divi shortcodes are supported, Divi 5 blocks are not. The package format and parts of the WordPress parser are taken from EmDash (MIT, Cloudflare Inc.).
