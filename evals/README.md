# Release evals

The fixtures use two unrelated synthetic websites. The browser eval unpacks the install ZIP under `/components/site-chat/` on separate loopback origins and serves them through the same local CSP and WebAssembly MIME settings documented for installation.

~~~sh
node --test evals/grounding.test.mjs
python3 evals/sitemap.py
cargo test --locked --manifest-path importer/Cargo.toml
cargo build --locked --manifest-path importer/Cargo.toml
python3 scripts/release.py --output /tmp/site-chat-release
python3 scripts/demo.py provision
python3 evals/browser.py \
  --chromedriver /path/to/chromedriver \
  --importer importer/target/debug/site-chat-import \
  --archive /tmp/site-chat-release/site-chat-0.1.0.zip \
  --model-root demo
~~~

Use a ChromeDriver matching the installed Chrome. For an alternate Chrome installation, pass `--chrome`. Omit `--model-root` to test the excerpt-only and missing-model flows. `--headless` can run those cases without a display. The real model eval needs a browser session with a working WebGPU adapter.

## What the browser run checks

- Configured branding, accent, contact route, sourced answers, and an unsupported question on both sites.
- Zero requests for model or runtime files until visitor opt-in. The optional Gemma run requires a real warmup and completed generation, verifies the expected citation, and prints whether Gemma selected an allowed ID or the excerpt fallback answered.
- Excerpt answers with missing model files and with WebGPU disabled for the test.
- CLI imports give byte-identical outputs on repeat runs, include the studio's JavaScript-rendered heading, and exclude hidden text, forms, and footer content.
- A redirect outside the approved URL fails export. The two destinations run on separate loopback origins so the check measures both export rejection and browser navigation.
- A real stdio MCP handshake exposes `read_page`. Its output matches the CLI and rejects off-origin targets and unlisted paths.

Run the dependency check separately. It submits the locked and pinned package versions to OSV and exits with status 1 when any advisory is returned. See the [review](../SECURITY-REVIEW.md) for the maintenance advisory present during release verification.

~~~sh
python3 evals/dependency_audit.py
python3 scripts/git_checks.py audit
~~~

## 0.1.0 verification

| Check | Result |
| --- | --- |
| Grounding and citation evals | 11 passed |
| Rust policy tests | 2 passed, with strict Clippy and formatting checks |
| Sitemap conversion tests | 2 passed |
| Browser | Chrome 158.0.8127.37, two nested installations on separate synthetic sites |
| Gemma | WebGPU warmup and one real generation completed. The result fell outside the approved ID format. The widget showed the approved excerpt and correct citation. |
| Excerpt fallback | Passed with missing model files and with the WebGPU API disabled in the test. |
| Importer | Three visible sections from each site. Repeat output matched byte for byte, and CLI and MCP output matched on the studio site. |
| Dependency review | 176 versions checked. One upstream maintenance advisory remained after upgrading the MCP SDK. |
