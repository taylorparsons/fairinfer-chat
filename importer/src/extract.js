const root = document.querySelector(arguments[0]);
if (!root) return [];

const excluded = [
  'nav', 'header', 'footer', 'aside', 'form', 'input', 'textarea', 'select',
  'button', 'script', 'style', 'template', 'noscript', '[hidden]', '[inert]',
  '[aria-hidden="true"]', '[contenteditable]', '[role="navigation"]',
].join(',');
const visibility = new Map();
function visible(element) {
  if (!element) return true;
  if (!visibility.has(element)) {
    const css = getComputedStyle(element);
    visibility.set(element, !element.matches(excluded) && css.display !== 'none'
      && css.visibility !== 'hidden' && css.visibility !== 'collapse'
      && css.opacity !== '0' && css.contentVisibility !== 'hidden'
      && visible(element.parentElement));
  }
  return visibility.get(element);
}

const blockSelector = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,td,th,pre,blockquote';
const sections = [];
let section = { title: document.title, anchor: '', paragraphs: [] };
const flush = () => {
  if (section.paragraphs.length && sections.length < 80) {
    sections.push({ title: section.title, anchor: section.anchor, text: section.paragraphs.join('\n') });
  }
};
for (const block of root.querySelectorAll(blockSelector)) {
  if (sections.length >= 80 || !visible(block)) continue;
  if (block.parentElement?.closest(blockSelector)?.closest(arguments[0]) === root) continue;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return visible(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let text = '';
  while (text.length < 3000 && walker.nextNode()) text += walker.currentNode.nodeValue;
  text = text.replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!text) continue;
  if (/^H[1-6]$/.test(block.tagName)) {
    flush();
    section = { title: text.slice(0, 180), anchor: (block.id || '').slice(0, 240), paragraphs: [] };
  } else if (section.paragraphs.join('\n').length + text.length < 5500) {
    section.paragraphs.push(text);
  }
}
flush();
return sections;
