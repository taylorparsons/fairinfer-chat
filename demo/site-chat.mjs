import { modelExcerpt, normalizeKnowledge, publicLink, rankExcerpts } from './site-retrieval.mjs';

const files = new URL('./', import.meta.url);
const unavailable = 'Excerpt search is available.';
const missing = 'I couldn’t find an excerpt that answers that question.';
const cap = 900000;

function add(parent, tag, text) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  parent.append(element);
  return element;
}

function button(parent, text) {
  const control = add(parent, 'button', text);
  control.type = 'button';
  return control;
}

async function readKnowledge(url) {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit' });
  if (!response.ok) throw new Error('Could not load the knowledge file.');
  const stream = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let data = '';
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      data += value;
      if (data.length > cap) throw new Error('Knowledge file exceeds the size limit.');
    }
  } finally {
    await stream.cancel();
  }
  return normalizeKnowledge(JSON.parse(data), url);
}

class SiteChat extends HTMLElement {
  #ui;
  #knowledge;
  #worker;
  #ready = false;
  #pending = null;
  #timer;

  connectedCallback() {
    if (this.#ui) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = add(shadow, 'link');
    style.rel = 'stylesheet';
    style.href = new URL('site-chat.css', files).href;
    const shell = add(shadow, 'div');
    shell.className = 'shell';
    const color = this.getAttribute('accent');
    if (/^#[0-9a-f]{6}$/i.test(color ?? '')) shell.style.setProperty('--site-chat-accent', color);
    const launcher = button(shell, this.getAttribute('title') || 'Ask this site');
    launcher.className = 'launcher';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'site-chat-panel');

    const panel = add(shell, 'section');
    panel.id = 'site-chat-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'site-chat-title');
    const header = add(panel, 'header');
    const title = add(header, 'h2', launcher.textContent);
    title.id = 'site-chat-title';
    const close = button(header, 'Close');
    const log = add(panel, 'div');
    log.className = 'log';
    log.setAttribute('role', 'log');
    log.setAttribute('aria-label', 'Conversation');
    const starters = add(panel, 'div');
    starters.className = 'starters';
    const form = add(panel, 'form');
    const label = add(form, 'label', 'Your question');
    label.htmlFor = 'site-chat-question';
    const input = add(form, 'input');
    input.id = 'site-chat-question';
    input.required = true;
    input.maxLength = 300;
    const send = button(form, 'Ask');
    send.type = 'submit';
    const footer = add(panel, 'footer');
    const local = button(footer, 'Enable local Gemma');
    local.title = 'Uses about 399 MB of model and runtime files the first time';
    const status = add(footer, 'p', 'Search published excerpts. Optional Gemma uses about 399 MB on first load.');
    status.setAttribute('role', 'status');
    const contact = publicLink(this.getAttribute('contact'), document.baseURI);
    if (contact) add(footer, 'a', this.getAttribute('contact-label') || 'Contact').href = contact.href;
    const terms = add(footer, 'a', 'Gemma terms');
    terms.href = new URL('assets/gemma-TERMS.txt', files).href;

    this.#ui = { log, starters, send, local, status };
    launcher.addEventListener('click', () => {
      launcher.hidden = true;
      launcher.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      input.focus();
      this.#loadKnowledge().catch(() => { status.textContent = 'Could not load the site’s excerpts.'; });
    });
    const hide = () => {
      panel.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    };
    close.addEventListener('click', hide);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question || send.disabled) return;
      input.value = '';
      void this.#ask(question);
    });
    local.addEventListener('click', () => {
      if (this.#worker) this.#stop(unavailable);
      else this.#start();
    });
    if (!globalThis.isSecureContext || !navigator.gpu || !('caches' in globalThis) || !('Worker' in globalThis)) {
      local.disabled = true;
      status.textContent = 'WebGPU is unavailable. Search published excerpts.';
    }
  }

  disconnectedCallback() {
    if (this.#worker) this.#stop(unavailable);
  }

  async #loadKnowledge() {
    if (this.#knowledge) return this.#knowledge;
    const url = new URL(this.getAttribute('knowledge') || new URL('knowledge.json', files), document.baseURI);
    if (url.origin !== location.origin || url.username || url.password) {
      return Promise.reject(new Error('Knowledge must use the site’s origin.'));
    }
    this.#knowledge = readKnowledge(url).then(knowledge => {
      for (const question of knowledge.starters) {
        button(this.#ui.starters, question).addEventListener('click', () => {
          if (!this.#ui.send.disabled) void this.#ask(question);
        });
      }
      return knowledge;
    }).catch(error => {
      this.#knowledge = null;
      throw error;
    });
    return this.#knowledge;
  }

  async #ask(question) {
    const { log, send } = this.#ui;
    send.disabled = true;
    if (log.children.length >= 12) {
      log.firstElementChild.remove();
      log.firstElementChild.remove();
    }
    add(log, 'p', question).className = 'question';
    const reply = add(log, 'p', 'Looking up published excerpts…');
    log.scrollTop = log.scrollHeight;
    try {
      const { sources } = await this.#loadKnowledge();
      const candidates = rankExcerpts(question, sources);
      if (!candidates.length || !this.#ready) {
        this.#finish({ reply, candidates });
        return;
      }
      this.#pending = { reply, candidates, output: '' };
      this.#timer = setTimeout(() => this.#stop('Local selection timed out. ' + unavailable), 30000);
      this.#worker.postMessage({
        type: 'answer', single: true, question,
        passages: candidates.map(({ text }) => text),
      });
    } catch {
      this.#stop('Could not load the site’s excerpts.');
      reply.textContent = 'Could not complete this search.';
      send.disabled = false;
    }
  }

  #finish(request, viaModel = false) {
    const { reply, candidates, output } = request;
    const choice = viaModel && modelExcerpt(output, candidates);
    const result = choice || candidates[0];
    reply.textContent = result?.text ?? missing;
    if (result) {
      add(reply, 'a', result.source.title).href = result.source.path;
      reply.dataset.mode = choice ? 'gemma-selected' : viaModel ? 'gemma-fallback' : 'excerpt';
    }
    this.#ui.send.disabled = false;
    this.#ui.log.scrollTop = this.#ui.log.scrollHeight;
  }

  #start() {
    const { local, status } = this.#ui;
    status.textContent = 'Loading pinned model files on this device…';
    local.textContent = 'Cancel loading';
    let worker;
    try {
      worker = new Worker(new URL('assets/gemma-worker.js', files), { type: 'module' });
      this.#worker = worker;
      worker.onerror = () => {
        if (this.#worker === worker) this.#stop('Gemma could not start. ' + unavailable);
      };
      worker.onmessage = ({ data }) => {
        if (this.#worker !== worker) return;
        if (data.type === 'ready') {
          clearTimeout(this.#timer);
          this.#ready = true;
          local.textContent = 'Unload Gemma';
          status.textContent = 'Gemma is ready on this device.';
        } else if (data.type === 'progress' && !this.#ready && data.total > 0) {
          status.textContent = 'Verified ' + Math.floor(100 * data.done / data.total) + '% of model files.';
        } else if (data.type === 'token' && this.#pending) {
          this.#pending.output = (this.#pending.output + data.text).slice(0, 120);
        } else if (data.type === 'complete' && this.#pending) {
          clearTimeout(this.#timer);
          const request = this.#pending;
          this.#pending = null;
          this.#finish(request, true);
        } else if (data.type === 'error' || data.type === 'input-too-long') {
          this.#stop('Gemma could not complete the operation. ' + unavailable);
        }
      };
      this.#timer = setTimeout(() => this.#stop('Model setup timed out. ' + unavailable), 300000);
      worker.postMessage({ type: 'load', device: 'webgpu' });
    } catch {
      this.#stop('Gemma could not start. ' + unavailable);
    }
  }

  #stop(message) {
    clearTimeout(this.#timer);
    this.#worker?.terminate();
    this.#worker = null;
    this.#ready = false;
    if (this.#pending) this.#finish(this.#pending);
    this.#pending = null;
    this.#ui.local.textContent = 'Enable local Gemma';
    this.#ui.status.textContent = message;
  }
}

if (!customElements.get('site-chat')) customElements.define('site-chat', SiteChat);
