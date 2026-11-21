const stopWords = new Set('a an and are as at be by can do does for from how i in is it me of on or that the this to what which who with you your fairinfer llc'.split(' '));
const synonyms = { pricing: 'rate price consulting', cost: 'rate price consulting', prices: 'rate price consulting', voice: 'voice speech', claire: 'clairavoice', claravoice: 'clairavoice', memory: 'memory clairavoice', scam: 'cortege fraud', traceability: 'athena delivery', services: 'consulting services discovery architecture', build: 'consulting systems services', provide: 'consulting services', nonprofit: 'nonprofits mission', problems: 'operational problem discovery' };
function words(text) {
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  return [...new Set(tokens.flatMap(w => [w, ...(synonyms[w]?.split(' ') || [])]).filter(w => w.length > 2 && !stopWords.has(w)))];
}
export function retrieve(question, bundle) {
  const query = words(question); if (!query.length) return [];
  const ranked = bundle.sources.map(source => {
    const title = words(source.title + ' ' + source.id), body = words(source.text);
    return { source, score: query.reduce((sum, w) => sum + (title.includes(w) ? 4 : body.includes(w) ? 1 : 0), 0) };
  }).filter(r => r.score >= 2).sort((a, b) => b.score - a.score);
  return ranked.slice(0, 2).map(r => r.source);
}
export function appendSources(container, sources, caption = 'Website excerpts used:') {
  const links = document.createElement('div'); links.className = 'sources';
  const label = document.createElement('span'); label.textContent = caption; links.append(label);
  for (const source of sources) {
    const external = /^https:\/\/taylorparsons\.github\.io\/(?:projects\/[a-z0-9_-]+\.html|#projects)$/.test(source.path)
      || /^https:\/\/github\.com\/taylorparsons\/[a-z0-9_-]+\/blob\/[a-f0-9]{40}\/README\.md$/.test(source.path);
    const snapshot = /^\/(?:work\/|legal\.html)?(#[a-z0-9-]+)$/.exec(source.path);
    const workPage = source.path === 'https://fairinfer.com/work/';
    if (!external && !snapshot && !workPage) continue;
    const link = document.createElement('a'); link.href = snapshot?.[1] ?? source.path; link.textContent = source.title;
    if (external) {
      link.textContent = `${source.title}\u00a0↗`;
      link.setAttribute('aria-label', `${source.title} (opens in a new tab)`);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    links.append(link);
  }
  container.append(links);
}
const normalized = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
const lines = text => String(text).trim().split(/\n+|(?<=[.!?])\s+/).map(line => line.trim()).filter(Boolean);
const isExcerpt = text => text.length >= 15 && /[.!]$/.test(text);
const outputExcerpt = matches => ({ text: matches.map(match => match.text).join('\n'), sources: [...new Set(matches.map(match => match.source))] });
export function prepareReference(sources) {
  const excerpts = new Map();
  const context = sources.map(source => [source.title, ...lines(source.text).map(text => {
    if (!isExcerpt(text)) return text;
    const id = `S${excerpts.size + 1}`;
    excerpts.set(id, { text, source });
    return `${id} ${text}`;
  })].join('\n')).join('\n\n');
  return { context, excerpts };
}
export function selectedExcerpt(answer, excerpts) {
  const ids = String(answer).trim().split(/[,\s]+/);
  if (ids.length > 2 || ids.some(id => !excerpts.has(id))) return null;
  return outputExcerpt([...new Set(ids)].map(id => excerpts.get(id)));
}
export function verifiedExcerpt(answer, sources) {
  const candidate = lines(answer).map(normalized);
  if (!candidate.length || candidate.length > 2) return null;
  const published = sources.flatMap(source => lines(source.text).filter(isExcerpt).map(text => ({ text, source })));
  const matches = candidate.map(line => published.find(({ text }) => normalized(text) === line));
  if (matches.some(match => !match)) return null;
  return outputExcerpt(matches);
}
export function relevantExcerpt(question, sources) {
  const query = words(question);
  const ranked = sources.flatMap(source => lines(source.text).filter(isExcerpt).map(text => ({ text, source, score: query.filter(word => words(text).includes(word)).length })));
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 2 ? { text: ranked[0].text, sources: [ranked[0].source] } : null;
}
const projectPhrase = text => normalized(text).replace(/[^a-z0-9]+/g, ' ').trim();
export function projectContext(question, bundle, previous = []) {
  const projectText = ` ${projectPhrase(question)} `;
  const mentions = (bundle.projects ?? []).filter(project =>
    project.aliases.some(alias => projectText.includes(` ${alias} `))).slice(0, 2);
  const followup = /^ *(?:what|which|how|does|do|can|is|are|where|tell|explain)\b/.test(projectText)
    && /\b(?:it|its|(?:this|that|the) (?:app|tool|project))\b/.test(projectText)
    && /\b(?:use|uses|work|works|built|written|language|support|supports|require|store|storage|save|voice|cli|command|features|dependencies)\b/.test(projectText);
  const projects = mentions.length ? mentions : followup && previous.length === 1 ? previous : [];
  if (!projects.length) return null;
  const localSources = bundle.sources.filter(source => projects.some(project => project.id === source.id));
  return { projects, sources: [...localSources, ...projects.flatMap(project => project.sources)] };
}

export function publishedProjectAnswer(question, context) {
  const phrase = projectPhrase(question);
  const subject = phrase.replace(/^(?:what (?:is|are)|tell me about|describe|explain) /, '')
    .replace(/^what does (.+?) do$/, '$1');
  const overview = context.projects.find(project => project.aliases.includes(subject));
  if (overview) return { text: overview.sources[0].text, sources: [overview.sources[0]] };
  const aliases = new Set(context.projects.flatMap(project => project.aliases.flatMap(alias => alias.split(' '))));
  const generic = new Set(['about', 'tell', 'have', 'support', 'supports', 'use', 'uses', 'does', 'project', 'tool', 'app', 'with', 'that', 'this', 'its']);
  const terms = [...new Set(words(question).filter(word => !aliases.has(word) && !generic.has(word))
    .map(word => word === 'language' ? 'written' : word))];
  if (!terms.length) return null;
  const candidates = context.sources.flatMap(source => lines(source.text).filter(isExcerpt).map(text => ({
    text, source, score: terms.filter(term => words(text).includes(term)).length,
  })));
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best?.score >= Math.min(2, terms.length) ? { text: best.text, sources: [best.source] } : null;
}

export function portfolioAnswer(question, bundle) {
  const text = projectPhrase(question);
  if (!/^(?:(?:what|which) (?:open source projects|projects on (?:your|the) portfolio)(?: are (?:in|on) (?:your|the) portfolio| do you (?:have|maintain))?|(?:list|show me|tell me about) (?:your |the )?open source projects|open source (?:projects|portfolio))$/.test(text)) return null;
  const labels = (bundle.projects ?? []).map(project => project.label);
  return labels.length ? {
    text: `The open source portfolio lists: ${labels.join(', ')}.`,
    sources: [{ title: 'Open source project catalog', path: 'https://taylorparsons.github.io/#projects' }],
  } : null;
}

const topicDefinitions = [
  { id: 'services', label: 'Consulting services', prompt: 'What consulting services does FairInfer offer?',
    alias: /^(?:what does fairinfer(?: llc)? do|what do you do|fairinfer(?: llc)?|consulting services)$/,
    excerpts: [/^fairinfer llc works with organizations /i, /^available for discovery/i] },
  { id: 'clairavoice', label: 'ClairaVoice', alias: /^clai?ra ?voice$/,
    excerpts: [/^clairavoice is an ongoing /i, /^clairavoice is not currently being offered /i] },
  { id: 'athena', label: 'ATHENA', alias: /^athena$/,
    excerpts: [/^athena is an agent-agnostic framework /i, /^it creates a traceable path /i] },
  { id: 'cortege', label: 'CORTEGE', alias: /^cortege$/,
    excerpts: [/^cortege is an ai security companion /i] },
  { id: 'ai-interview-practice', label: 'AI Interview Practice', alias: /^ai interview practice$/,
    excerpts: [/^ai interview practice closes both gaps\b/i] },
  { id: 'ate-the-mic', label: 'Ate the Mic', alias: /^ate the mic$/,
    excerpts: [/^ate the mic gives them that/i, /^four modes cover different needs/i] },
];
const chatOverview = {
  id: 'how-chat-works',
  alias: /^(?:how does (?:this |the |your )?(?:chat|assistant) work|how (?:this |the |your )?(?:chat|assistant) works|this chat|gemma)$/,
  excerpts: [/^fairinfer’s chat uses /i, /^the chat generates replies /i],
};
function topicOverview(definition, bundle) {
  const source = bundle.sources.find(source => source.id === definition.id);
  if (!source) return null;
  const candidates = lines(source.text).filter(isExcerpt);
  const [first, ...others] = definition.excerpts.map(pattern => candidates.find(line => pattern.test(line)));
  if (!first) return null;
  return { text: [first, ...others.filter(Boolean)].join(' '), sources: [source] };
}
export function siteTopics(bundle) {
  return topicDefinitions.flatMap(definition => {
    const overview = topicOverview(definition, bundle);
    if (!overview) return [];
    return [{ ...overview, id: definition.id, label: definition.label,
      prompt: definition.prompt || `Tell me about ${definition.label}.` }];
  });
}

const contactOptions = { title: 'FairInfer contact options', path: 'https://fairinfer.com/work/' };
export function bookingAnswer(question, bundle) {
  const text = normalized(question).replace(/[.!?]+$/, '').trim();
  const action = /^(?:(?:(?:how|where) (?:can|could|do|should) (?:i|we)|how to|(?:can|could|may) (?:i|we)|(?:i|we) (?:want|would like) to|please) )?(?:book|schedule|set up|reserve) (?:some time|time|a (?:free )?(?:30-minute )?(?:call|meeting|consultation|appointment|slot))(?: (?:with|to talk to) (?:you|the founder|fairinfer(?: llc)?))?$/;
  const linkRequest = /^(?:booking link|(?:what(?: is|'s) (?:your|the)|(?:can|could) you (?:share|send)(?: me)? (?:your|the)) (?:booking|scheduling|calendar) link|(?:do you have|is there) a link to (?:book|schedule) (?:time|a call))$/;
  if (!action.test(text) && !linkRequest.test(text)) return null;
  const href = bundle.booking_url;
  if (typeof href !== 'string' || !href.startsWith('https://cal.com/')) return null;
  return { text: 'You can book a free 30-minute call with FairInfer.', href };
}

export function pricingAnswer(question) {
  const text = normalized(question).replace(/[.!?]+$/, '').trim();
  if (!/^(?:what (?:is|are) (?:your |the )?(?:hourly |consulting )*(?:rate|rates|price|prices|pricing|fees)|what (?:do|would) you charge(?: per hour| for consulting)?|how much (?:do|would) you charge(?: per hour| for consulting)?|how much (?:does|would) consulting cost|(?:consulting |hourly )?(?:pricing|rate|rates))$/.test(text)) return null;
  return { text: 'Consulting rates aren’t published. Contact the founder to discuss pricing.', sources: [contactOptions] };
}

export function publishedSiteAnswer(question, bundle) {
  const query = normalized(question).replace(/[.!?]+$/, '').trim();
  if (/^(?:how (?:can|do|should) i (?:contact|reach) (?:you|the founder|fairinfer(?: llc)?)|how (?:can|do) i send (?:you )?an inquiry)$/.test(query)) {
    return { text: 'The FairInfer Work page lists the current contact options.', sources: [contactOptions] };
  }
  const subject = query.match(/^(?:what is|tell me about|describe|explain) (.+)$/)?.[1] ?? query;
  const topic = topicDefinitions.find(definition => definition.alias.test(subject) || (definition.prompt && normalized(definition.prompt).replace(/[.!?]+$/, '') === query))
    ?? (chatOverview.alias.test(subject) ? chatOverview : null);
  return topic ? topicOverview(topic, bundle) : null;
}

// A keyword match or valid sentence ID does not establish any of these facts.
// Add a rule with its exact public evidence when the site publishes a new fact.
const specificFacts = [
  {
    request: /\b(?:phone|telephone|fax) numbers?\b|\b(?:support|contact) (?:number|line|hotline)\b|\b(?:number|line) (?:should|can|do|could) (?:i|we) (?:call|dial)\b/,
    missing: 'a published phone number for that request',
  },
  {
    request: /\b(?:e-?mail|mailing|street|office) address\b|\b(?:your|founder's|fairinfer's|support) e-?mail\b|\bcontact (?:details|information|info)\b/,
    missing: 'published contact details for that request',
  },
  {
    request: /\b(?:what|which) (?:date|day|year|month|time)\b|\b(?:release|launch|opening) dates?\b|\bwhen\b.*\b(?:open(?:s|ing)?|releas(?:e|ed|es|ing)|launch(?:ed|es|ing)?|go(?:es)? live|ship(?:s|ped)?|available|start(?:s|ed)?|clos(?:e|es|ed))\b/,
    missing: 'a published date or time for that request',
  },
  {
    request: /\b(?:prices?|pricing|refunds?|fees?|hourly rates?|subscription (?:cost|terms)|how much (?:does|do|would|will) .+\b(?:cost|charge))\b/,
    missing: 'published pricing or payment terms for that request',
  },
  {
    request: /\b(?:how many|number of)\b.*\b(?:install(?:s|ed|ations?)?|download(?:s|ed)?)\b|\b(?:install(?:ation)?|download) (?:counts?|numbers?|totals?|figures|stats|statistics)\b/,
    missing: 'a published install count for that request',
  },
  {
    request: /\b(?:how many|number of|(?:what|which) (?:percent(?:age)?|proportion|fraction)|how (?:popular|widely used)|what (?:is|was) (?:the )?(?:adoption|uptake)|(?:adoption|user|subscriber) (?:counts?|numbers?|totals?|figures|stats|statistics))\b/,
    missing: 'a published figure for that request',
    evidence: {
      question: /^how many (?:practice |training |speaking )?modes does ate the mic (?:offer|have|support)$/,
      id: 'ate-the-mic',
      excerpts: [/^four modes cover different needs\b/i],
    },
  },
  {
    request: /\b(?:availability|available (?:as|to|for)|commercial product|on sale|(?:can|could) (?:i|we) (?:buy|purchase)|where (?:can|do) (?:i|we) (?:buy|purchase))\b|^(?:is|are)\b.*\bavailable(?: (?:now|today|yet))?$/,
    missing: 'published availability information for that request',
    evidence: {
      question: /^(?:is clai?ra ?voice (?:currently )?available(?: (?:as a commercial product|to (?:buy|purchase)))?(?: (?:now|today|yet))?|can i (?:buy|purchase) clai?ra ?voice(?: (?:now|today|yet))?)$/,
      id: 'clairavoice',
      excerpts: [/^clairavoice is not currently being offered as a commercial product\.$/i],
    },
  },
];

export function resolveFactualAnswer(question, bundle, project, verified) {
  const query = normalized(question).replace(/’/g, "'").replace(/[.!?]+$/, '').trimEnd();
  const fact = specificFacts.find(rule => rule.request.test(query));
  if (fact) {
    const evidence = fact.evidence;
    const excerpt = evidence?.question.test(query) ? topicOverview(evidence, bundle) : null;
    const selected = !!(excerpt && verified?.text === excerpt.text && verified.sources.length === 1
      && verified.sources[0].path === excerpt.sources[0].path);
    return { excerpt, selected, missing: fact.missing };
  }
  const projectAnswer = project && publishedProjectAnswer(question, project);
  const selected = !!(verified && (!projectAnswer || verified.text === projectAnswer.text));
  const excerpt = (selected && verified) || projectAnswer || (project ? null :
    publishedSiteAnswer(question, bundle) || relevantExcerpt(question, retrieve(question, bundle)));
  return { excerpt, selected };
}

export function rewriteRequest(question) {
  const text = question.trim();
  if (/^(?:(?:can|could|would) you |please )?(?:write|create|compose|make)\b.*\b(?:w?rap) battle\b|^(?:(?:a|an) )?(?:epic )?w?rap battle\b/i.test(text)) return 'rap-battle';
  if (/^(?:(?:can|could|would) you |please )?(?:write|create|compose|make|turn)\b.*\b(?:haiku|poem)\b|^(?:a )?(?:haiku|poem)\b/i.test(text)) {
    return /\bhaiku\b/i.test(text) ? 'haiku' : 'poem';
  }
  if (/^(?:(?:can|could|would) you |please )?(?:rewrite|rephrase|summarize|shorten)\b|^(?:(?:can|could|would) you |please )?(?:make|say|explain) (?:that|it|this|your (?:last|previous) answer)\s+(?:shorter|more simply|in (?:plain|simple) (?:English|language)|in one sentence)\b/i.test(text)) {
    return 'rewrite';
  }
  return null;
}
export function rewriteSource(question, bundle, previous) {
  const topic = question.match(/\b(?:about|of what|on)\s+(.+)/i)?.[1];
  if (!topic && previous) return previous;
  const subject = topic || question;
  const ranked = retrieve(subject, bundle);
  const match = relevantExcerpt(subject, ranked);
  if (match) return match;
  const named = ranked.find(source => words(subject).includes(source.id) || normalized(source.title).includes(normalized(subject.replace(/[.!?]+$/, ''))));
  const excerpt = named && lines(named.text).find(line => isExcerpt(line) && line.length >= 50);
  if (excerpt) return { text: excerpt, sources: [named] };
  if (/\bfair\s*infer\b/i.test(subject) || (!topic && /\b(?:haiku|poem)\s*[.!?]*$/i.test(subject))) {
    return relevantExcerpt('operational problem discovery', bundle.sources.filter(source => source.id === 'services'));
  }
  return null;
}
