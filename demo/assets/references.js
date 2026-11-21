const container = document.querySelector('#references');

try {
  const response = await fetch('/assets/knowledge.json');
  if (!response.ok) throw new Error('Reference bundle unavailable.');
  const { sources } = await response.json();
  for (const source of sources) {
    const article = document.createElement('article');
    article.id = source.id;
    const title = document.createElement('h3');
    title.textContent = source.title;
    const excerpt = document.createElement('p');
    excerpt.textContent = source.text;
    article.append(title, excerpt);
    container.append(article);
  }
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
} catch {
  const message = document.createElement('p');
  message.textContent = 'The chat reference bundle could not be loaded.';
  container.append(message);
}
