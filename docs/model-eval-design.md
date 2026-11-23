# FairInfer Chat model comparison design

## Decision

Add a local browser benchmark that runs the same questions through excerpt-only search, the Gemma 3 270M IT q4 release baseline, and one or more candidate models. All arms use the installed `<site-chat>` widget, the same approved content, and the same retrieval and rendering code. A candidate earns consideration when it improves the passages users see and fits the startup, latency, and download budgets for the target devices.

The first version targets WebGPU via the existing Transformers.js and ONNX Runtime Web stack. The benchmark evaluates passage selection for Site Chat. The original FairInfer demo also generates creative drafts, which require a separate evaluation if they become part of the model decision.

## Why the existing harness needs an addition

- [`evals/browser.py`](https://github.com/taylorparsons/fairinfer-chat/blob/main/evals/browser.py) exercises the install ZIP, default model, fallback behavior, and Rust importer. Its `--model-root` supplies `models/` and `vendor/` assets. The worker and manifest still come from the ZIP.
- [`gemma-worker.js`](https://github.com/taylorparsons/fairinfer-chat/blob/main/demo/assets/gemma-worker.js) hardcodes the Gemma model directory, q4 dtype, and external data setting. Its passage-selection path scores the numbered choices with constrained logits and emits `NONE` or `S1` through `S3`.
- [`site-chat.mjs`](https://github.com/taylorparsons/fairinfer-chat/blob/main/demo/site-chat.mjs) gives the worker up to three ranked passages after opt-in. It renders the approved passage and its citation. A worker error or timeout can render the default excerpt with `data-mode="excerpt"`, so the benchmark needs to observe worker events as well as the rendered result.

## Architecture

| Area | Proposed change |
| --- | --- |
| `evals/compare_models.py` | Add an opt-in comparison command. Reuse loopback serving, ZIP extraction, and WebDriver session helpers from `evals/browser.py`. Keep importer and install assertions in the release suite. |
| `evals/model_cases.json` | Store versioned cases with stable IDs, fixture site, question, expected outcome, and acceptable exact excerpt and citation pairs. |
| Existing manifest and worker | Read model directory, dtype, and external-data flag from the local manifest. Existing manifests use the current Gemma defaults. Retain the pinned file verification, WebGPU load, real warmup, and widget message contract. |
| Per-model fixture | Extract the same ZIP into each arm's temporary site directory. For candidate arms, overlay the reviewed `assets/model-release.json` and mount its provisioned `models/` and `vendor/` trees. Use the archive manifest for the Gemma baseline and verify that its provisioned files match. |
| Results | Write versioned JSON for comparison and a Markdown summary for review. Store results outside the repo unless an operator explicitly chooses to commit a run. |

### Model profile

Keep the existing pinned manifest format and add an optional `loader` object with `model_dir` and `external_data`. Reuse `dtype` and the existing manifest fields for model ID, artifact, revision, runtime, cache, and files with byte counts and SHA-256 digests. Derive candidate cache names from the manifest fingerprint. Validate that the model directory is a local path under `models/`, that referenced files satisfy existing path rules, and that the candidate uses the same verified vendor runtime files as the baseline. Use the existing provisioner to prepare each profile before running comparisons. Provisioning may fetch pinned files. Browser inference and the benchmark run use loopback assets.

Each candidate must support `AutoTokenizer`, the multi-turn selection template, `AutoModelForCausalLM`, the profile's dtype and external-data settings, and constrained one-token selection. Verify that digits `0` through `3` each map to a distinct single token with special tokens disabled. Run one real selection smoke case in a separate preflight browser profile to catch tokenizer or logits incompatibilities before collecting scores. If a model needs a different prompt, selector, backend, or runtime, evaluate that combination as a separate experiment with its own identifier.

### Proposed command

```sh
python3 evals/compare_models.py \
  --chromedriver /path/to/chromedriver \
  --archive /tmp/site-chat-release/site-chat-0.1.1.zip \
  --baseline-root demo \
  --candidate candidate-a=/path/to/provisioned-candidate \
  --repeats 3 \
  --output /tmp/site-chat-model-eval
```

Build the archive from the implementation checkout. Repeat `--candidate` for each provisioned model. Include both baselines automatically. Allow `--cases` for a second case set, with the versioned synthetic suite as the default. Each arm runs serially on the same browser and device. Rotate the arm order across repeats, preserve case order across arms within each repeat, and keep the order or seed in the report.

## Cases and scoring

| Case type | Expected result |
| --- | --- |
| Direct answer and paraphrase | Exact approved passage and citation. Include questions for which the first-ranked excerpt is already correct. |
| Competing passages | A specific passage must win, including cases where the expected passage ranks second or third. Seed these with approved synthetic examples and verify their rank at suite startup. |
| Ambiguous question | Any enumerated passage and citation pair can pass. For “How much is a day pass?”, the weekday and weekend prices share the `#passes` citation, so checking the citation alone would miss a wrong answer to a day-specific question. |
| Unsupported or out-of-scope question | No citation and zero worker `answer` messages. Keep the existing release scope and synthetic fallback checks runnable as regression coverage. |
| Worker decline, invalid reply, or failure | Use the first approved excerpt when available. Exercise these paths as compatibility checks and record distinct reasons. Score only naturally occurring outcomes in the quality comparison. |

At startup, reuse `rankExcerpts()` with the same normalized fixture knowledge to record candidate order and verify the case set. Classify answerable cases whose expected passage is absent from the top three as retrieval misses and keep them in the end-to-end score. Publish shortlist coverage and the count of genuine reranking opportunities. Treat annotated rank expectations that drift as fixture failures so the benchmark cannot lose its hard cases silently.

For every run, capture the worker dispatch count and outcome, selected rank if available, exact visible excerpt text, citation, and timings. Observe worker events before the widget consumes them and observe the DOM for the rendered outcome. Record readiness failures, `NONE`, invalid output, `input-too-long`, runtime errors, timeouts, and post-failure worker unavailability separately. Associate observations with the active request and worker instance. When a failure unloads the worker, record the failed case and re-enable the worker before the next model case. If restart fails, mark the remaining model cases unavailable, retain the partial results, and skip the quality comparison for that arm.

| Metric | Definition |
| --- | --- |
| End-to-end accuracy | Correct rendered excerpt and citation pairs / all answerable cases. Credit a correct fallback here and disclose how it was produced. |
| Correct model selection | Correct worker selections / answerable cases dispatched with an acceptable passage on the shortlist. Include declines, wrong selections, errors, and timeouts in the denominator. Report dispatch coverage alongside it. |
| Reranking effect | Count rescued answers, answers made worse, and net change on the same cases against excerpt-only. Report the pairwise change versus Gemma too. |
| Fallback rate | Approved default-excerpt responses after dispatch / model-dispatched cases, split by reason. Report unsupported cases and retrieval misses separately. |
| Cold start | Browser time from enable click to `ready` using a fresh browser profile and empty site storage. Includes loopback asset transfer, verification, initialization, and warmup. |
| Cached start | Enable to `ready` after a reload on the same origin and profile, with model Cache Storage populated and a fresh worker. Label it separately from cold start. |
| Warm response | Submit to final rendered result, timed inside the browser to avoid WebDriver polling latency. Report median, p95, and sample count for completed requests, with separate timeout and failure counts. |
| Asset size | Model bytes and total model-plus-runtime bytes from the manifest. Record browser version, device and GPU details where available, archive hash, manifest hashes, and case-set hash. |

## Acceptance checks and rollout

1. Verify that the same questions and pinned fixture content run through all arms. Excerpt-only makes no model or runtime requests, and model arms make none before opt-in. Confirm real warmup and the expected manifest fingerprint for each model arm.
2. Keep the existing grounding and release browser checks green. Verify that worker output cannot add text or markup to the response and that an unsupported question does not reach the worker. The original demo continues to load the pinned Gemma and complete its draft smoke check.
3. Exercise one reviewed non-Gemma profile end to end on a WebGPU device. Test missing or mismatched assets, incompatible tokenizers, timeout attribution, and correct fallback classification. Unsupported hardware and candidate failures must appear as explicit results. Write reports even on partial failures and return a nonzero exit for invalid setup, incomplete requested runs, or grounding regressions. Ordinary differences in model accuracy remain report results.
4. Keep the comparison command opt-in. First collect the excerpt-only and Gemma baselines, then run the candidate on the same device. Measure on the device classes that matter before setting promotion thresholds. A candidate should show a paired gain on the questions it can improve, preserve approved-text and citation behavior, and meet the chosen device budgets.

Start with the two existing arms and fixture cases. Then parameterize the loader and add candidate preflight, followed by repeatable timing and reporting. Defer CI with a GPU runner, additional inference backends, and an in-product model picker until the benchmark establishes a need for them.
