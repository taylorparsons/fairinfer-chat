import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { modelExcerpt, normalizeKnowledge, rankExcerpts } from '../demo/site-retrieval.mjs';

const cases = JSON.parse(await readFile(new URL('./questions.json', import.meta.url)));
for (const item of cases) {
  test(item.name, () => {
    const { sources } = normalizeKnowledge({ sources: item.sources }, 'https://example.org/desk/');
    const ranked = rankExcerpts(item.question, sources);
    assert.equal(ranked[0]?.source.id ?? null, item.source);
    if (item.excerpt) assert.equal(ranked[0]?.text, item.excerpt);
  });
}

test('citation scheme and credentials validation', () => {
  const paths = ['javascript:alert(1)', 'data:text/html,hello', 'https://user@example.org/a', '/approved#hours'];
  const { sources } = normalizeKnowledge({
    sources: paths.map((path, id) => ({ id, title: 'Opening hours', path, text: 'We open on weekdays.' })),
  }, 'https://example.org/desk/');
  assert.deepEqual(sources.map(source => source.path), ['https://example.org/approved#hours']);
});

test('model choices stay within the approved shortlist', () => {
  const candidates = [{ text: 'One.' }, { text: 'Two.' }];
  assert.equal(modelExcerpt(' S2 ', candidates), candidates[1]);
  assert.equal(modelExcerpt('S2.', candidates), candidates[1]);
  for (const text of ['S999', '<script>alert(1)</script>', 'S2 followed by a claim', 'NONE']) {
    assert.equal(modelExcerpt(text, candidates), undefined);
  }
});
