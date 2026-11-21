# Install Site Chat

Unpack the release. Copy the `site-chat` directory into your site's static files, then replace its sample `knowledge.json` with approved content from your site. Add this to each page that should have chat.

~~~html
<script type="module" src="/components/site-chat/site-chat.mjs"></script>
<site-chat
  title="Ask Acme"
  accent="#254c68"
  knowledge="/components/site-chat/knowledge.json"
  contact="/contact/"
  contact-label="Contact Acme"
></site-chat>
~~~

Change both paths if you install into a different directory. The widget loads its CSS, worker and runtime files relative to the module. `knowledge` defaults to `knowledge.json` next to the module. You can host a different knowledge file on another path on the same origin. Relative citation URLs resolve against the knowledge file's URL. The default sample contains synthetic library content.

~~~json
{
  "version": 1,
  "starters": ["When does the desk open?"],
  "sources": [{
    "id": "desk-hours",
    "title": "Desk hours",
    "path": "/visit/#desk-hours",
    "text": "The desk opens at 9:00 a.m. on weekdays."
  }]
}
~~~

Serve with HTTPS in production. Loopback is suitable for development. Use JavaScript MIME types for `.mjs` and `.js` files and `application/wasm` for WebAssembly. Serve the widget and knowledge from the same origin. Preserve the site's existing CSP and verify WebGPU compatibility with your hosting setup. The provided preview uses `worker-src 'self' blob:`, allows WebAssembly with `script-src 'self' 'wasm-unsafe-eval'`, and sends COOP/COEP headers. Cross-origin isolation can affect embedded resources and integrations on a host page.

## Optional local Gemma

Excerpt search works as soon as the knowledge file loads. To make Gemma available, review the [Gemma terms](assets/gemma-TERMS.txt), then run the following from your site's directory using Python 3.11 or later. Deploy the model and runtime files it places under `site-chat/models` and `site-chat/vendor` along with the widget. The provisioner checks all 13 pinned sizes and hashes.

~~~sh
python3 components/site-chat/setup.py provision --directory components/site-chat
~~~

A visitor starts the roughly 399 MB browser load by selecting **Enable local Gemma**. The widget keeps excerpt search available when WebGPU or model files are unavailable. It sends search and optional model input to local code. It does not have a hosted inference endpoint.

The original widget code is MIT. Redistributing any other components follows their included terms and notices. Some static hosts limit file size below the 323 MB weight file. Use a static origin that can serve that file or deploy excerpt search by itself.
