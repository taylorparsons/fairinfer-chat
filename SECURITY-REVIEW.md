# Security review

Reviewed the Site Chat widget, Rust Selenium importer and MCP tool, install ZIP, and Git history for the 0.1.0 release. A separate code review inspected the trust boundaries and the evals. The baseline is a site owner preparing approved public content on a local workstation, with the release served from a trusted HTTPS origin.

| Boundary | Control and verification |
| --- | --- |
| Knowledge and citations | The widget fetches a bounded JSON file from its origin, with credentials omitted and redirects rejected. It inserts questions and source text as text nodes. Citation parsing accepts HTTPS and same-origin HTTP for local preview, and rejects credentials and executable schemes. Grounding tests exercise wrong-topic matches, missing price, count and location evidence, and unsafe links. |
| Model behavior | A click enables the local worker. It can select an ID from a short list of excerpts. The widget displays the exact approved excerpt for a recognized ID, or the deterministic first excerpt when model output falls outside the protocol. Output that contains new claims stays out of the reply. Evals record completed selection and fallback separately. With real Gemma ready, unsupported and scope-override probes sent zero answer messages. A separate fabricated worker completion tested the UI’s fallback and text-only output. |
| Asset integrity | Setup verifies all 13 pinned lengths and SHA-256 hashes before writing files. The browser verifies the model and runtime downloads entering Cache Storage and rechecks cached entries on warmup. Transformer and ONNX executable module loads use ordinary same-origin URLs. Deployers should serve the reviewed files from the trusted, versioned widget directory. |
| Selenium scope | CLI and MCP require an explicit list on a single origin, use a fresh headless Chrome profile, and check the exact approved URL before returning extracted text. CLI and MCP reject mismatched origins and unapproved paths. Extraction drops navigation, form controls, and hidden content, and bounds URL count and exported JSON size. |
| Browser network | Chrome processes navigation, redirects and page scripts before the importer validates the final URL. A redirect eval confirms that the destination can receive a request even though export fails. An approved DNS name can resolve to an internal address. Run the local importer on sites you control or have permission to process and isolate browser egress where the network requires it. Review extracted text before sending it to an MCP client or publishing it. |
| Release contents | The archive includes only the widget, pinned manifest, setup and install instructions, and license notices. The dependency and Git audits run against the source checkout. The current and historical FairInfer snapshot uses published reference material. Both Git email identities in the history already appear in the maintainer's public Selenium commit data. |

## Dependency review

The first OSV pass flagged a Streamable HTTP client advisory for `rmcp` 3.8.0. The companion exposes only stdio. The release updates to `rmcp` 3.11.0 and disables unused driver-manager and MCP features. The repeat OSV scan queried 176 locked and pinned versions and returned one maintenance advisory for `chrono`, which the upstream MCP SDK still depends on. The advisory lists no fixed release. [RUSTSEC-2026-0462](https://rustsec.org/advisories/RUSTSEC-2026-0462.html) · [RUSTSEC-2026-0543](https://rustsec.org/advisories/RUSTSEC-2026-0543.html)

The review covers this implementation and the recorded tests. Hosts can supply misleading text, and lexical relevance can still miss intent. Keep the approved corpus current and use the linked source to verify consequential information. [Run the evals](evals/README.md)

Report issues through the [security policy](SECURITY.md).

## v0.1.1 constrained selection

The reusable widget passes only shortlisted excerpt text to the worker. At decoding time, the pinned Transformers.js runtime masks every token except the numbers assigned to those excerpts and `0`. The worker converts the selected number to an allowed excerpt ID. An explicit `0` declines Gemma's ranking and returns the deterministic cited excerpt. An unexpected token is a worker error and also falls back to cited text.

The UI continues to validate the worker response independently against its current shortlist. The browser eval checks that two supported prompts produce real model selections, that off-topic and override probes send zero answer requests, and that a synthetic forged claim or explicit model decline produces the approved fallback. [Browser eval](evals/browser.py)
