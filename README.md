# Site Chat

A self-hosted web component for asking about approved website content. It shows cited excerpts on its own and can use Google Gemma on the visitor's device. It grew out of FairInfer's staging chat.

Download the [versioned install ZIP](https://github.com/taylorparsons/fairinfer-chat/releases/latest), follow the [installation guide](INSTALL.md), and point the widget at your site's reviewed JSON. The checked-in [tool library](examples/library/) and [studio tours](examples/studio/) examples use the same widget with separate content, labels, and colors.

## Import knowledge with Selenium

The optional Rust companion uses Selenium's WebDriver stack to render and extract approved pages. It follows the local Chrome automation approach of [Taylor's Rust Selenium MCP](https://github.com/taylorparsons/selenium-mcp) and provides a dedicated `read_page` tool. Use the [import guide](importer/README.md) for its CLI and MCP configuration. You can also prepare the JSON by hand.

## Evaluate the release

Read the [release notes](RELEASE-NOTES.md) for the install and verification summary.

Run `node --test evals/grounding.test.mjs` for the deterministic grounding checks and `cargo test --locked --manifest-path importer/Cargo.toml` for the importer policy checks. The [browser eval guide and results](evals/README.md) cover ZIP installs, CLI and MCP extraction, and real WebGPU inference. See the [security review](SECURITY-REVIEW.md) and [reporting policy](SECURITY.md).

## Run the original FairInfer demo

Use Python 3.11 or later and a browser with a working WebGPU adapter. Review the [Gemma Terms of Use](demo/assets/gemma-TERMS.txt) before downloading the model. The first provision downloads about 399 MB of pinned model and runtime files. Keep room for another copy in browser Cache Storage.

```sh
git clone https://github.com/taylorparsons/fairinfer-chat.git
cd fairinfer-chat
python3 scripts/demo.py provision
python3 scripts/demo.py serve
```

Open [the local demo with startup status](http://127.0.0.1:8787/?chat-debug=1). Select **Fairinfer chat** after warmup. Try **Is ClairaVoice available?** for a sourced answer or **Create a haiku of what FairInfer does** for a generated draft. The demo uses WebGPU. If the browser lacks an adapter, the startup status reports it and the launcher stays hidden. **Chat options** includes controls to clear the conversation, unload the model, or remove its browser cache.

## How it was built

1. The original site used a Rust build to extract approved Home, Work, and chat documentation sections and to add a reviewed project cache. [The resulting knowledge snapshot](demo/assets/knowledge.json) ships with this demo. The page renders the snapshot locally so readers can follow citations to the exact reference text.
2. [The browser worker](demo/assets/gemma-worker.js) loads the q4 ONNX build of Google Gemma 3 270M IT through Transformers.js and ONNX Runtime Web. [The manifest](demo/assets/model-release.json) pins the model revision, byte counts, and SHA-256 hashes. The provisioner verifies downloaded files, and the worker verifies the browser’s same-origin cache before loading and warming up the model.
3. [The widget controller](demo/assets/assistant.js) passes a bounded set of excerpts into the worker. [The retrieval module](demo/assets/retrieval.js) resolves factual replies against approved text and renders source links. The browser streams creative and rewrite requests as labeled drafts. The conversation stays in page memory, and prompts go to the browser worker.
4. The original extraction uses the browser code and knowledge bundle from the staging checkout at `5e3e1a6bf616e0d380d12dab9611f39042d3a386`. The standalone HTML embeds the original widget and links to FairInfer’s public contact options. A loopback Python server replaces the website host for local development.

## Licenses

The original chat and demo code use the [MIT License](LICENSE). Google’s Gemma model uses the [Gemma Terms of Use](demo/assets/gemma-TERMS.txt) and carries its [model notice](demo/assets/Gemma-Notice.txt). Transformers.js uses [Apache 2.0](demo/assets/transformers-LICENSE.txt). ONNX Runtime Web has its own [MIT license and Microsoft copyright notice](demo/assets/onnxruntime-LICENSE.txt). Runtime binaries and model files are provisioned separately from the repository.

## Local Git checks

Enable the versioned hooks after cloning.

```sh
git config --local core.hooksPath .githooks
git config --local commit.template .gitmessage
python3 scripts/git_checks.py audit
```

Before a commit, the hooks check the Git index for common credential patterns, local paths, generated files, and errors from `git diff --check`. The audit also checks snapshots from reachable commits. Credential and workstation-path findings report filenames without printing the matching text.

Use a Conventional Commits subject such as `fix(chat): keep the composer focused` or `docs: update the demo instructions`. Git-generated merge and revert subjects and autosquash prefixes are accepted.
