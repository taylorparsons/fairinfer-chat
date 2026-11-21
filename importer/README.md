# Import approved pages with Selenium

Use a recent stable Rust toolchain, Chrome, and a ChromeDriver that matches Chrome. The companion uses the same Rust Selenium WebDriver library as [Taylor Parsons's Selenium MCP](https://github.com/taylorparsons/selenium-mcp). Run ChromeDriver locally with its loopback allowlist. The companion starts and closes a fresh headless Chrome session for each import.

~~~sh
chromedriver --port=9515 --allowed-ips=127.0.0.1
~~~

Prepare a text file with one approved page path per line. Start with the site's index, services, and FAQ. Absolute URLs on the configured origin also work. Blank lines and lines beginning with `#` are skipped. Use a separately named review file to inspect the result before replacing published content.

~~~text
/
/services/
/faq/
~~~

~~~sh
cargo run --locked --manifest-path importer/Cargo.toml -- \
  --origin https://example.org import approved-pages.txt > knowledge.review.json
~~~

The importer takes up to 30 explicit URLs on one HTTPS origin. It extracts visible heading and body sections after the browser loads each page. Citation URLs use existing heading IDs when present. The default selector is `main, [role=main], article`. Pass `--selector` with a site-specific CSS selector to target a different content container or to wait for a rendered section on a JavaScript-heavy site. Use `--browser-binary` for a non-default Chrome installation. The importer preserves paragraph text as displayed, normalizes whitespace, and emits stable section IDs and source URLs.

Review the output for stale information, personal data, and pages you want omitted. You can edit it and add at most four `starters` strings before serving it with the widget. For development on loopback, use `--allow-loopback --origin http://127.0.0.1:PORT`.

## Start with a sitemap

For a flat sitemap already downloaded from the site, generate candidates and choose up to 30 pages to keep in `approved-pages.txt`. For a sitemap index, choose a child sitemap first.

~~~sh
python3 scripts/sitemap_urls.py --origin https://example.org sitemap.xml > candidate-pages.txt
~~~

## MCP tool

Build the companion once with `cargo build --locked --manifest-path importer/Cargo.toml`. Register its binary with your MCP client over stdio and use these arguments.

~~~text
site-chat-import --origin https://example.org mcp approved-pages.txt
~~~

`read_page` accepts one `url` from the startup URL file and responds with the same citation-ready JSON as the CLI. Continue using the original [Selenium MCP](https://github.com/taylorparsons/selenium-mcp) for interactive browser automation.

Run the importer as a local preparation step against sites you control or have permission to process. Chrome executes page scripts and can fetch subresources and redirects. The importer checks that the final URL matches the exact approved page before export. Use a dedicated restricted environment when approved pages can access internal resources.
