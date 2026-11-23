# FairInfer Chat model comparison design

## Decision

Visitors should be able to chat about the website in the page widget. They can ask questions in their own words, follow up on an answer, or change topics. Replies use approved website content and link to the source. The visitor can ask another question from the same conversation.

Add a local browser benchmark that runs the same questions through excerpt-only search, the Gemma 3 270M IT q4 release baseline, and one or more candidate models. Add a second comparison axis for lexical versus hybrid vector retrieval so retrieval gains can be measured separately from model selection. All arms use the installed `<site-chat>` widget, the same approved content, and the same rendering code, with retrieval held fixed when comparing selectors. A candidate earns consideration when it improves the passages users see and fits the startup, latency, and download budgets for the target devices.

The first version targets WebGPU via the existing Transformers.js and ONNX Runtime Web stack. Compare one-pass excerpt selection with an optional three-call inference loop using the same model. The benchmark evaluates passage selection and grounded multi-turn conversation for Site Chat. The original FairInfer demo also generates creative drafts, which require a separate evaluation if they become part of the model decision.

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

## Browser vector index

### Index and query path

Build the index from the site's approved knowledge snapshot. Reuse the production passage splitter so both search paths reference the same text and citation. Assign each passage a key from its source ID and its position within that source. Embed each passage with one pinned model and write a compact binary table with one int8 vector per passage. Store the keys or their row mapping separately from the vectors. Read display text and citation URLs from the approved knowledge snapshot.

Pin the embedding model revision and asset hashes, index format version, dimensions, query and passage preprocessing, normalization, quantization settings, and a SHA-256 of the knowledge snapshot. The browser validates format, bounds, and snapshot identity before use. Rebuild when the content, passage splitter, or embedding model changes. On missing, stale, corrupt, or unsupported assets, use the existing excerpt search and record the reason in the eval.

After opt-in, embed the submitted query locally with the encoder paired with the index. Apply the same normalization contract and compare against the packed vectors with a flat dot-product scan. For the first version, use symmetric quantization of normalized passage vectors with a shared scale, so unpacked float32 copies of the entire table are unnecessary. Treat 384 dimensions as a sizing example and derive the actual dimensions from the selected encoder.

Retrieve a bounded list from the lexical ranker and from the semantic scan. Drop semantic candidates below a calibrated score threshold, fuse eligible lists with reciprocal rank fusion, deduplicate by passage key, and retain up to three passages. Fit the semantic threshold on a separate calibration split before comparing results on held-out questions. Dispatch only when at least one lexical or semantic passage qualifies under the selected retrieval mode. A semantic-only candidate may qualify on its calibrated score. Treat worker dispatches on the held-out out-of-scope cases as regressions. When no passage qualifies, show the existing no-answer state. The index derives its matches from site text and the visitor's query. It requires no hand-written phrases, synonyms, or question-to-answer mappings.

Keep approved text and citations as the only rendered answer content. The semantic search path can return cited excerpts without enabling Gemma. Measure semantic and LLM asset requests independently. Before opt-in, the default excerpt path uses the existing knowledge bundle and fetches neither optional asset bundle. Index and encoder assets are pinned, served from the site's origin, and used locally.

### Download budget

Use **1 MB for the index** and **10 MB for the complete incremental semantic bundle** as initial targets. Count the index, metadata, tokenizer, encoder weights, and any runtime files the browser must fetch to enable semantic search from the default excerpt path. Report both published asset bytes and actual cold-cache response bytes. Account for a shared runtime once in the combined first-load total and report generation weights separately.

The raw int8 vector table uses dimensions × passage count bytes. At 384 dimensions it is 38.4 KB for 100 passages or 384 KB for 1,000 passages, before metadata. Size from the site's actual passage count. Preflight reports budget overruns explicitly. A run that exceeds the target can report accuracy results and cannot qualify as within budget.

### Eval matrix

| Retrieval | Selector | What the comparison measures |
| --- | --- | --- |
| Lexical | First eligible excerpt | Current no-model baseline. |
| Hybrid | First eligible excerpt | Change from retrieval alone and the download cost of semantic search without a generation model. |
| Lexical | Pinned Gemma | Existing release behavior with model selection. |
| Hybrid | Pinned Gemma | Effect of changing retrieval with the selector held fixed. |
| Lexical and hybrid | Each candidate LLM | Change from swapping the selector at a fixed retrieval mode and any interaction between the two. |

Keep the fixture text, browser, candidate limit, and questions fixed across arms. Capture each dispatch's ordered passage keys and scores. For paired selector comparisons, verify that the shortlist and order match for the same question and retrieval mode. Preserve the existing model-only command behavior. Add a proposed `--semantic-root` option that supplies provisioned encoder assets and fixture indexes and enables the hybrid arms.

Include held-out paraphrases with little lexical overlap, disambiguation cases such as weekday versus weekend rates, unrelated or unsupported questions near a known topic, and sites with similar wording for distinct passages. Freeze fixture expectations before running the held-out set. Build indexes from approved fixture passages only.

Report **Recall@3** over all answerable cases, first-ranked excerpt accuracy, final cited-answer accuracy, unsupported-answer rate, and unexpected selector dispatches. Count questions rescued and made worse versus the lexical arm on paired cases. Break out query embedding, vector scan and fusion, and time to the rendered answer. Measure bytes and cold startup with fresh browser profiles. A hybrid run that falls back to lexical search records a degraded result. It does not count as a successful semantic run.

Before promoting hybrid search, verify that the browser can retrieve and cite passages with the generation model disabled, uses lexical fallback when an index is stale or missing, and stays within the measured download budget. Review whether held-out paraphrases improve without increasing unsupported answers or losing correct citations.

## Browser inference loop

Use the existing Transformers.js and ONNX Runtime Web stack for the query encoder and LLM. Keep orchestration in JavaScript with one loaded LLM worker and one in-flight model call per browser tab. The query encoder remains an optional asset of semantic search. Reusing the LLM for all stages adds calls and uses the same LLM download.

### Request flow

| Stage | Model output | JavaScript validation |
| --- | --- | --- |
| 1. Interpret | A bounded, standalone question for retrieval, or a request to clarify an ambiguous reference. | Use the current message and bounded conversation context. Validate the response shape and length. Keep the original message for evaluation. Use it for retrieval when a rewrite is unusable and the turn is self-contained. |
| 2. Answer | A short draft with passage IDs for each factual claim, or an explicit decline. | Run the configured retrieval mode on the standalone question. Pass up to three ranked, approved passages. Check that each cited ID belongs to this turn's shortlist before evaluating the draft. |
| 3. Evaluate | Accept, retry with a reason, or decline. | Give the evaluator the draft, question, relevant context, and cited passages. Accept only if the verdict confirms that the passages support the claims and that the answer responds to the current turn. Resolve links from the approved snapshot and render plain text with citations. |

The worker exposes distinct request types for interpretation, drafting, and evaluation. Keep the constrained selection contract for the one-pass and excerpt-loop eval arms. Validate every stage's response in JavaScript, including the draft's claim-to-passage mapping. Model verification can miss unsupported claims, so score accepted drafts against independently labeled evidence in the eval. Use request and attempt IDs to ignore stale results. Start the next stage only after the prior call settles and releases request-scoped resources. If retrieval produces no eligible passages, skip selection and use the retry or no-answer path.

### Retry, progress, and resource handling

Allow one retry of the three-stage flow for a recoverable issue, such as a rewrite that retrieves the wrong topic or an excerpt rejected for insufficient evidence. Cap each request at two attempts and six LLM calls. Configure per-stage token limits and a single wall-clock deadline shared by both attempts. A retry begins with a new rewrite using the original question and the validated failure reason. Stop if that rewrite and its inputs would repeat an already failed attempt. The visitor sees a status update before retrying and can cancel throughout.

JavaScript ends the loop on cancellation, deadline, worker error, GPU device loss, or an out-of-memory signal. Use configured input and output limits and one in-flight call to control resource use. Handle observable failures without relying on a device-memory estimate. If the worker cannot confirm cancellation before the deadline, terminate it and ignore late messages. A worker failure can use the existing approved-excerpt fallback, with the result attributed to fallback. After an explicit finding of insufficient evidence, show the no-match state if the retry fails. The eval must record any incorrect fallback separately from an accepted selection.

### Eval arms and acceptance

Make the loop an opt-in eval arm. For the excerpt-loop comparison, configure the answer stage to return a constrained passage selection and the evaluation stage to verify that excerpt. Pair it with one-pass excerpt selection using the same LLM revision, device, fixture, index, and lexical or hybrid retrieval configuration. The full loop can change the candidate list through query rewriting. To isolate the changes, also run a rewrite-plus-selection arm with no model evaluator, and an evaluation arm that consumes the same candidate lists and selected IDs as the one-pass baseline. Use the frozen held-out set to score the outcome independently of the model's verdict.

Report correct cited answers gained and lost on paired cases, shortlist recall before and after rewriting, evaluator false accepts and false rejects, recovery after retry, fallbacks, interruptions, and no-match outcomes. Measure actual stage calls, per-stage latency, median and p95 end-to-end latency, and completion and failure rates. Test normal completion, status before retry, cancellation, deadline exhaustion, invalid output, and a worker or GPU failure. Treat unsupported factual claims and mismatched citations as regressions in the conversational arm. In the excerpt arms, rendered answer text must match an approved passage.

Add a separate routing model as a later eval arm if the single-model loop reveals a routing gap. Compare it against the same loop with the existing model and include its incremental download, startup time, and device impact.

## Website conversation

Keep a bounded history in the tab for follow-up references. Use recent user turns, verified assistant replies, and cited passage IDs as context. Treat conversation history as a reference for interpreting the next question. Retrieve approved evidence again for each factual reply. A topic change starts retrieval from the new question. A clear-chat control discards the conversation and cancels any pending turn. When the reference remains ambiguous, ask one focused clarifying question and wait for the visitor's reply. An unsupported question gets the existing no-match response with the site's contact link.

Keep the excerpt-only path usable when optional models are disabled or unavailable. A visitor can still ask a standalone question and get a cited passage. When the conversational arm cannot verify a draft, render a cited excerpt only if that excerpt independently answers the resolved question. Use the no-match state or ask for clarification when the evidence is insufficient.

### Conversation eval

Run complete dialogues through the real widget. Preserve the same tab between turns in a dialogue and start each dialogue with cleared history. Add fixture expectations per turn for the intended meaning, accepted supporting passage IDs, required facts, and whether to answer, clarify, or decline. Check factual support and citation targets without requiring a fixed reply string. Keep fixture questions and answers in the eval suite so the product works with each site's reviewed content.

| Dialogue | Expected behavior |
| --- | --- |
| Follow-up to the weekday day-pass price | Interpret “What about weekends?” using the earlier question. Cite the approved weekend price. |
| Follow-up with two possible referents | Ask which item the visitor means. Use the next reply to resolve the reference before answering. |
| Topic switch or factual correction | Use the new topic or detail and cite the corresponding passages. |
| Unsupported follow-up after a sourced answer | Show the no-match state when the approved site content has no answer. |
| Clear chat and repeat an elliptical question | Treat it as a new conversation and ask for the missing detail. |
| Turn interrupted by cancellation or worker failure | Render no stale draft. Keep the next turn usable and record any excerpt fallback. |

Compare one-pass excerpt selection, the three-stage excerpt loop, and the three-stage conversational arm with the same model and retrieval configuration. Report grounded follow-up accuracy, claim support, citation validity, clarification and decline accuracy, context carryover after topic switches, and per-turn latency. Use controlled replays of the same shortlist and excerpt ID to isolate evaluator behavior. Report the full conversational arm separately where the draft may cite more than one approved passage.

## Cases and scoring

| Case type | Expected result |
| --- | --- |
| Direct answer and paraphrase | Exact approved passage and citation. Include questions for which the first-ranked excerpt is already correct. |
| Competing passages | A specific passage must win, including cases where the expected passage ranks second or third. Seed these with approved synthetic examples and verify their rank at suite startup. |
| Ambiguous question | Any enumerated passage and citation pair can pass. For “How much is a day pass?”, the weekday and weekend prices share the `#passes` citation, so checking the citation alone would miss a wrong answer to a day-specific question. |
| Unsupported or out-of-scope question | No citation and zero worker `answer` messages. Keep the existing release scope and synthetic fallback checks runnable as regression coverage. |
| Worker decline, invalid reply, or failure | Use the first approved excerpt when available. Exercise these paths as compatibility checks and record distinct reasons. Score only naturally occurring outcomes in the quality comparison. |

At startup, verify the lexical fixture expectations with `rankExcerpts()` on the same normalized knowledge. In hybrid arms, record the actual browser shortlist after fusion and use it to score shortlist coverage. Classify answerable cases whose expected passage is absent from the top three as retrieval misses and keep them in the end-to-end score. Publish shortlist coverage and the count of genuine reranking opportunities. Treat annotated rank expectations that drift as fixture failures so the benchmark cannot lose its hard cases silently.

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

Start with the two existing arms and fixture cases. Then parameterize the loader and add candidate preflight. Add the index builder and browser query path, then run the crossed comparison with repeatable timing and byte reporting. Add the inference loop after recording the one-pass baselines. Defer CI with a GPU runner, additional inference backends, and an in-product model picker until the benchmark establishes a need for them.
