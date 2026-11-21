import { appendSources, prepareReference, selectedExcerpt, verifiedExcerpt, bookingAnswer, pricingAnswer, projectContext, resolveFactualAnswer, portfolioAnswer, siteTopics, rewriteRequest, rewriteSource } from './retrieval.js';
const $ = id => document.getElementById(id);
let worker, knowledge, ready = false, busy = false, transcript = [], responseNode, current = '', started, timer;
let reference, activeReference, activeProject, lastProjects = [], lastGrounding, activeRewrite, activeQuestion = '', summaryJob = false, loadAbort, removing = false, resumeOnReturn = false;
const supported = globalThis.isSecureContext && 'caches' in globalThis && 'Worker' in globalThis;
let chatOpen = false, hasBeenReady = false, introTimer, retryRequested = false, canRetry = false;
const widget = $('fairinfer-chat-widget'), chat = $('chat'), launcher = $('open-chat'), contact = $('contact');
const log = $('messages'), thread = log.parentElement;
const localDebug = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  && new URLSearchParams(location.search).get('chat-debug') === '1';
let diagnostic, diagnosticRepair = '';
if (localDebug) {
  diagnostic = document.createElement('p');
  diagnostic.className = 'chat-local-diagnostic';
  diagnostic.setAttribute('role', 'status');
  (document.querySelector('main') || document.body).prepend(diagnostic);
}
function reportStartup(text) {
  if (diagnostic && !hasBeenReady) diagnostic.textContent = `Local chat startup: ${text}${diagnosticRepair}`;
}
function status(text) { $('chat-status').textContent = text; }
function settleLauncher() {
  clearTimeout(introTimer);
  launcher.classList.remove('is-wide');
}
function renderChat() {
  widget.hidden = !hasBeenReady;
  chat.hidden = !hasBeenReady || !chatOpen;
  launcher.hidden = !hasBeenReady || chatOpen;
  launcher.setAttribute('aria-expanded', String(hasBeenReady && chatOpen));
  $('chat-stop').hidden = !ready || !busy || summaryJob;
  $('chat-retry').hidden = !canRetry || busy;
}
function setChatOpen(open, focusTarget) {
  settleLauncher();
  chatOpen = open;
  renderChat();
  if (open) thread.scrollTop = thread.scrollHeight;
  focusTarget?.focus({ preventScroll: true });
}
function contactInUse() {
  return !!contact && (location.hash === '#contact' || contact.contains(document.activeElement) || !$('review').hidden);
}
function controls() {
  renderChat();
  $('send').disabled = !ready || busy;
  for (const button of log.querySelectorAll('.chat-topics button')) button.disabled = !ready || busy;
  const hasConversation = transcript.length > 0;
  window.dispatchEvent(new CustomEvent('model-state', { detail: { hasConversation, available: ready && !busy && hasConversation } }));
}
function addMessage(role, text, generated = false) {
  const node = document.createElement('div'); node.className = 'message ' + role;
  const label = document.createElement('strong'); label.textContent = role === 'user' ? 'You\n' : generated ? 'Generated draft\n' : 'Local assistant\n';
  const body = document.createElement('span'); body.textContent = text;
  node.append(label, body); log.append(node);
  while (log.children.length > 12) log.firstElementChild.remove();
  $('starters').hidden = true;
  thread.scrollTop = thread.scrollHeight; return body;
}
function addTopicChoices(container, relatedQuestion = '') {
  const topics = siteTopics(knowledge);
  if (!topics.length) return;
  const related = topics.find(topic => relatedQuestion.toLowerCase().includes(topic.label.toLowerCase()));
  if (related) {
    const note = document.createElement('div');
    note.className = 'chat-related';
    appendSources(note, related.sources, 'Related information:');
    container.append(note);
  }
  const list = document.createElement('ul');
  list.className = 'chat-topics';
  list.setAttribute('aria-label', 'Suggested questions about FairInfer');
  for (const topic of topics) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = topic.label;
    button.setAttribute('aria-label', topic.prompt);
    button.addEventListener('click', () => {
      if (!ready || busy) return;
      $('question').focus({ preventScroll: true });
      submitQuestion(topic.prompt, topic);
    });
    item.append(button);
    list.append(item);
  }
  const services = topics.find(topic => topic.id === 'services');
  const available = services?.text.match(/Available for [^.]+\./i)?.[0];
  if (available) {
    const detail = document.createElement('p');
    detail.className = 'chat-topic-intro';
    detail.textContent = available;
    container.append(detail);
  }
  container.append(list);
}
function stop(text = '', { recover = true, interrupt = true } = {}) {
  const interrupted = interrupt && !summaryJob && !!responseNode;
  if (interrupted) responseNode.textContent = 'The local reply was interrupted.';
  else if (!summaryJob) { responseNode = null; activeRewrite = null; }
  loadAbort?.abort(); loadAbort = null;
  worker?.terminate(); worker = null; busy = false; ready = false; clearTimeout(timer);
  if (summaryJob) window.dispatchEvent(new CustomEvent('summary-failed'));
  summaryJob = false; retryRequested = false;
  canRetry = hasBeenReady && recover;
  $('unload').disabled = true;
  status(hasBeenReady ? text : '');
  const restoreFocus = interrupted && document.activeElement === $('chat-stop');
  controls();
  if (restoreFocus && canRetry) $('chat-retry').focus({ preventScroll: true });
}
function createWorker() {
  const localWorker = new Worker('/assets/gemma-worker.js', { type: 'module' });
  worker = localWorker;
  const failed = reason => {
    if (worker !== localWorker) return;
    reportStartup(reason);
    stop('The local assistant stopped. Retry or contact the founder.');
  };
  localWorker.onerror = event => failed(event.message || 'The model worker could not start.');
  localWorker.onmessage = ({ data }) => {
    if (worker !== localWorker) return;
    if (data.type === 'startup-phase') reportStartup(data.phase + '…');
    else if (data.type === 'cache-repair') {
      diagnosticRepair = ' Replacing an unreadable cached model file.';
      reportStartup('repairing the model cache…');
    } else if (data.type === 'progress' && diagnostic) {
      reportStartup(`verified or loaded ${(data.done / 1e6).toFixed(1)} of ${(data.total / 1e6).toFixed(1)} MB…`);
    } else if (data.type === 'ready') {
      reportStartup(`ready on ${data.device === 'webgpu' ? 'WebGPU' : 'CPU'} after ${((performance.now() - started) / 1000).toFixed(1)} s.`);
      clearTimeout(timer); ready = true; busy = false;
      $('unload').disabled = false;
      if (!hasBeenReady && !contactInUse() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        launcher.classList.add('is-wide');
        introTimer = setTimeout(settleLauncher, 2000);
      }
      hasBeenReady = true;
      canRetry = false;
      status('');
      $('metrics').textContent = `Startup: ${((performance.now() - started) / 1000).toFixed(1)} s. ${data.runtime}. q4.`;
      if (retryRequested && responseNode) {
        retryRequested = false;
        generateReply();
      } else {
        retryRequested = false;
        controls();
      }
    } else if (data.type === 'token') {
      if (!data.text) return;
      if (activeRewrite && responseNode) {
        const follow = log.scrollHeight - log.clientHeight - log.scrollTop < 32;
        if (!current) { responseNode.textContent = ''; status('Writing a draft on this device…'); }
        responseNode.append(document.createTextNode(data.text));
        if (follow) thread.scrollTop = thread.scrollHeight;
      }
      current += data.text;
    }
    else if (data.type === 'complete') {
      clearTimeout(timer); busy = false;
      if (summaryJob) {
        summaryJob = false; window.dispatchEvent(new CustomEvent('summary-draft', { detail: current.slice(0, 2000) }));
        status('Summary draft ready. Review and edit it in the contact form.'); controls(); return;
      }
      const metrics = data.first_token_ms === null ? 'No text generated.' : `First token: ${data.first_token_ms} ms. Generation: ${(data.elapsed_ms / 1000).toFixed(1)} s. Tokens: ${data.tokens}.`;
      $('metrics').textContent = metrics;
      if (activeRewrite) {
        if (current.trim()) {
          appendSources(responseNode.parentElement, activeRewrite.sources, 'Website context:');
          lastGrounding = activeRewrite;
          transcript.push({ role: 'user', content: activeQuestion, generated: true }, { role: 'assistant', content: current.trim(), generated: true });
          transcript = transcript.slice(-8);
          status('Draft complete. Check the website for exact facts.');
        } else {
          responseNode.textContent = 'Gemma did not write a draft. Try rephrasing your request.';
          status('No draft generated.');
        }
        thread.scrollTop = thread.scrollHeight;
        activeRewrite = null; responseNode = null; controls(); return;
      }
      const sources = activeProject?.sources ?? knowledge.sources;
      const verified = selectedExcerpt(current, activeReference.excerpts) || verifiedExcerpt(current, sources);
      const { excerpt, selected, missing } = resolveFactualAnswer(activeQuestion, knowledge, activeProject, verified);
      lastProjects = activeProject?.projects ?? [];
      lastGrounding = excerpt;
      current = excerpt?.text || (missing
        ? `I don’t have ${missing}. Here’s what I can help you explore:`
        : 'I don’t have a sourced answer to that. Here’s what I can help you explore:');
      responseNode.textContent = current;
      if (excerpt) appendSources(responseNode.parentElement, excerpt.sources, activeProject ? 'Published project references:' : undefined);
      else addTopicChoices(responseNode.parentElement, missing ? activeQuestion : undefined);
      responseNode = null;
      thread.scrollTop = thread.scrollHeight;
      const projects = activeProject?.projects.map(project => project.id);
      transcript.push({ role: 'user', content: activeQuestion, projects }, { role: 'assistant', content: current, projects });
      transcript = transcript.slice(-8);
      status(selected ? 'Source-verified excerpt selected with local Gemma.' : excerpt ? (activeProject ? 'Showing a sourced project summary.' : 'Showing a matching published excerpt.') : ''); controls();
    } else if (data.type === 'input-too-long') {
      clearTimeout(timer); busy = false;
      if (summaryJob) window.dispatchEvent(new CustomEvent('summary-failed'));
      else {
        responseNode.textContent = data.message;
        responseNode = null;
        activeRewrite = null;
      }
      summaryJob = false; status(data.message); controls();
    } else if (data.type === 'error') failed(data.message);
  };
}
async function start() {
  if (!supported || busy || ready || removing) return;
  const controller = new AbortController(); loadAbort = controller;
  busy = true; canRetry = false; started = performance.now(); $('metrics').textContent = ''; status(hasBeenReady ? 'Preparing the local assistant…' : ''); controls();
  reportStartup('loading the site reference…');
  timer = setTimeout(() => {
    reportStartup('timed out after 5 minutes.');
    stop('Model setup timed out. Retry or contact the founder.');
  }, 300000);
  try {
    const readJson = async path => {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error('Assistant files are unavailable.');
      return response.json();
    };
    const bundle = knowledge ?? await readJson('/assets/knowledge.json');
    if (controller.signal.aborted) return;
    knowledge = bundle;
    reference ??= prepareReference(knowledge.sources);
    createWorker();
    worker.postMessage({ type: 'load', device: 'webgpu' });
  } catch (error) {
    if (!controller.signal.aborted) {
      reportStartup(error.message);
      stop('Could not start the assistant. Retry or contact the founder.');
    }
  }
}
launcher.onclick = () => setChatOpen(true, $('chat-panel-title'));
$('minimize-chat').onclick = () => setChatOpen(false, launcher);
document.addEventListener('click', event => {
  if (chatOpen && !event.composedPath().includes(widget)) setChatOpen(false);
}, { capture: true });
document.addEventListener('keydown', event => {
  const active = document.activeElement;
  if (event.key === 'Escape' && ready && chatOpen && (chat.contains(active) || active === document.body)) {
    event.preventDefault();
    setChatOpen(false, launcher);
  }
});
contact?.addEventListener('focusin', () => { if (chatOpen || !launcher.hidden) setChatOpen(false); });
window.addEventListener('hashchange', () => {
  if (contact && location.hash === '#contact') setChatOpen(false, contact);
});
$('chat-contact').onclick = () => setChatOpen(false, contact);
$('chat-retry').onclick = () => { retryRequested = !!responseNode; start(); };
$('chat-stop').onclick = () => stop('The reply was stopped. You can retry it here.');
$('unload').onclick = () => stop('Model unloaded. Downloaded files remain cached.', { interrupt: false });
$('clear').onclick = () => {
  if (busy) stop('Conversation cleared.', { interrupt: false });
  responseNode = null; activeRewrite = null; activeQuestion = '';
  status('Conversation cleared.');
  transcript = []; lastGrounding = null; lastProjects = []; log.replaceChildren(); current = '';
  $('starters').hidden = false; controls();
};
$('remove').onclick = async () => {
  removing = true;
  stop('Removing model cache…', { recover: false, interrupt: false });
  try {
    for (const name of await caches.keys()) if (name.startsWith('fairinfer-gemma-')) await caches.delete(name);
    status('Downloaded model removed from this browser.');
  } catch { status('Could not remove the cache. Use browser site-data settings.'); }
  finally { removing = false; canRetry = true; controls(); }
};
function generateReply() {
  responseNode.textContent = activeRewrite ? 'Starting a local draft…' : 'Checking a local answer against the published excerpts…';
  thread.scrollTop = thread.scrollHeight;
  current = ''; busy = true; controls(); status('Generating locally…'); $('metrics').textContent = '';
  timer = setTimeout(() => stop('The reply timed out after 2 minutes. Try again or contact the founder.'), 120000);
  if (activeRewrite) {
    worker.postMessage({ type: 'rewrite', question: activeQuestion, style: rewriteRequest(activeQuestion), context: activeRewrite.text });
  } else {
    activeProject = projectContext(activeQuestion, knowledge, lastProjects);
    activeReference = activeProject ? prepareReference(activeProject.sources) : reference;
    const projectIds = new Set(activeProject?.projects.map(project => project.id));
    const history = transcript.filter(message => !message.generated &&
      (message.projects?.length ? message.projects.every(id => projectIds.has(id)) : !projectIds.size)).slice(-4);
    worker.postMessage({ type: 'answer', question: activeQuestion, context: activeReference.context, history });
  }
}
$('question').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat && ready && !busy) $('chat-form').requestSubmit();
});
$('chat-form').onsubmit = event => {
  event.preventDefault(); if (!ready || busy) return;
  const question = $('question').value.trim(); if (!question) return;
  $('question').value = '';
  submitQuestion(question);
};
function submitQuestion(question, topic) {
  if (topic) {
    addMessage('user', question);
    const reply = addMessage('assistant', topic.text);
    appendSources(reply.parentElement, topic.sources);
    lastGrounding = topic;
    lastProjects = projectContext(question, knowledge)?.projects ?? [];
    const projects = lastProjects.map(project => project.id);
    transcript.push({ role: 'user', content: question, projects }, { role: 'assistant', content: topic.text, projects });
    transcript = transcript.slice(-8);
    status('');
    $('metrics').textContent = '';
    thread.scrollTop = thread.scrollHeight;
    controls();
    return;
  }
  const catalog = portfolioAnswer(question, knowledge);
  if (catalog) {
    addMessage('user', question);
    const reply = addMessage('assistant', catalog.text);
    appendSources(reply.parentElement, catalog.sources, 'Portfolio:');
    lastProjects = []; lastGrounding = null;
    thread.scrollTop = thread.scrollHeight;
    status('');
    return;
  }
  const booking = bookingAnswer(question, knowledge);
  if (booking) {
    lastProjects = [];
    addMessage('user', question);
    const reply = addMessage('assistant', booking.text);
    const links = document.createElement('div'); links.className = 'sources';
    const link = document.createElement('a');
    link.href = booking.href;
    link.textContent = 'Book a free 30-minute call (opens in a new tab)';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
    reply.parentElement.append(links);
    thread.scrollTop = thread.scrollHeight;
    status('');
    return;
  }
  const pricing = pricingAnswer(question);
  if (pricing) {
    lastProjects = [];
    addMessage('user', question);
    const reply = addMessage('assistant', pricing.text);
    appendSources(reply.parentElement, pricing.sources, 'Contact:');
    thread.scrollTop = thread.scrollHeight;
    status('');
    return;
  }
  const style = rewriteRequest(question);
  activeRewrite = style ? rewriteSource(question, knowledge, lastGrounding) : null;
  if (style && !activeRewrite) {
    addMessage('user', question);
    addMessage('assistant', 'Which FairInfer project or service should I use? You can also ask me to rewrite a sourced answer.');
    status('Waiting for a website topic.'); return;
  }
  activeQuestion = question;
  addMessage('user', question);
  responseNode = addMessage('assistant', '', Boolean(activeRewrite));
  generateReply();
}
window.addEventListener('draft-summary', () => {
  if (!ready || busy || !transcript.length) return;
  summaryJob = true; current = ''; busy = true; controls(); status('Drafting a summary locally…');
  timer = setTimeout(() => stop('Summary generation timed out. Write or edit the summary yourself.'), 120000);
  worker.postMessage({ type: 'summary', question: transcript.map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 5000) });
});
window.addEventListener('pagehide', () => {
  resumeOnReturn = busy || ready;
  if (resumeOnReturn) stop();
});
window.addEventListener('pageshow', event => { if (event.persisted && resumeOnReturn) start(); });
for (const button of $('starters').querySelectorAll('button')) button.onclick = () => { $('question').value = button.textContent; $('question').focus(); };
if (!supported) reportStartup('This page needs a secure context, Web Workers, and Cache Storage.');
else if (!navigator.gpu) reportStartup('This browser does not expose WebGPU to the page.');
else start();
