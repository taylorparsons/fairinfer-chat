# Site Chat v0.1.1

Gemma now chooses from a short list of approved website excerpts. The decoder can emit only the number of an offered passage or a decline. The widget displays the selected passage verbatim with its citation. A model decline or invalid worker response uses the deterministic approved excerpt.

[Download ZIP](https://github.com/taylorparsons/fairinfer-chat/releases/download/v0.1.1/site-chat-0.1.1.zip) · [SHA-256](https://github.com/taylorparsons/fairinfer-chat/releases/download/v0.1.1/site-chat-0.1.1.zip.sha256) · [Installation guide](https://github.com/taylorparsons/fairinfer-chat/blob/v0.1.1/INSTALL.md)

## Verification

Chrome verified both supported model selections and a third selection with two allowed excerpts. Unsupported and override prompts sent zero requests to Gemma. A synthetic forged completion and an explicit model decline both used the approved fallback. Nested installs and the Rust Selenium CLI and MCP importer passed on two synthetic sites. [Evals and results](https://github.com/taylorparsons/fairinfer-chat/tree/v0.1.1/evals) · [Security review](https://github.com/taylorparsons/fairinfer-chat/blob/v0.1.1/SECURITY-REVIEW.md)

# Site Chat v0.1.0

Site Chat packages FairInfer’s browser chat as a configurable, self-hosted component. It starts with cited excerpt search. Visitors can opt in to Gemma on devices with WebGPU.

## Install

1. Download and unpack the ZIP under your site's static assets.
2. Prepare a reviewed `knowledge.json` file with approved excerpts and their URLs. Use the optional Rust Selenium CLI or its read-only MCP `read_page` tool to extract rendered pages from an explicit list. A local sitemap can provide candidates for that list.
3. Add the JavaScript module and `<site-chat>` element to your pages. Configure the title, accent, starter questions, and contact link.

[Download ZIP](https://github.com/taylorparsons/fairinfer-chat/releases/download/v0.1.0/site-chat-0.1.0.zip) · [SHA-256](https://github.com/taylorparsons/fairinfer-chat/releases/download/v0.1.0/site-chat-0.1.0.zip.sha256) · [Installation guide](https://github.com/taylorparsons/fairinfer-chat/blob/v0.1.0/INSTALL.md) · [Selenium import guide](https://github.com/taylorparsons/fairinfer-chat/tree/v0.1.0/importer)

## Verification

Chrome passed nested ZIP installations on two synthetic sites with different content and branding. It verified real WebGPU generation, excerpt search with missing model files, and excerpt search with WebGPU disabled. The model’s real completion in the recorded fixture fell outside the allowed ID format, so the widget returned the approved excerpt and citation. [Evals and results](https://github.com/taylorparsons/fairinfer-chat/tree/main/evals)

## Model scope and security

The widget sends a question to Gemma only after it finds a relevant set of approved excerpts. It uses an accepted model ID to select an excerpt and displays the original source text. When a completion falls outside the ID format, the widget uses the highest-ranked excerpt.

In the browser security regression, two unsupported and scope-override prompts produced a refusal and sent zero answer messages to the ready Gemma worker. A separate test injected a synthetic completion containing a fabricated price and markup. The widget discarded both and kept the approved citation. [Security eval](https://github.com/taylorparsons/fairinfer-chat/blob/main/evals/browser.py) · [Security review](https://github.com/taylorparsons/fairinfer-chat/blob/main/SECURITY-REVIEW.md) · [Report a vulnerability](https://github.com/taylorparsons/fairinfer-chat/blob/main/SECURITY.md)

Local Gemma uses about 399 MB of pinned model and runtime files. The widget uses MIT. The model and runtime files retain the included upstream terms.
