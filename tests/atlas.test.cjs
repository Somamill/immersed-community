const { test } = require('node:test');
const assert = require('node:assert/strict');
const atlas = require('../server/atlas.cjs');
const { lookup, analyze, search } = require('../server/language.cjs');

test('Atlas is the preferred definition source with German meanings and semantic English retained', async () => {
  const [entry] = await lookup('日本語');
  assert.equal(entry.source, 'Kotoba Atlas');
  assert.equal(entry.dictionaryVersion, '1.0.0');
  assert.equal(entry.dictionaryLanguage, 'de');
  assert.match(entry.definitions.join(' '), /Japanisch|japanisch/);
  assert.ok(entry.senses.some(s => s.english_definitions.some(d => /Japanese/.test(d))));
  assert.ok(entry.pitch.length);
});
test('reported gaps and colloquial expressions resolve without losing caption glyphs', async () => {
  for (const word of ['羅睺', '物ノ怪', '鎌かけて', '草', 'エモい', 'ググる']) {
    assert.ok((await lookup(word)).length, word);
    const tokens = await analyze(word);
    assert.equal(tokens.map(t => t.text).join(''), word);
  }
});
test('indexed German search and native metadata are connected', async () => {
  assert.ok((await search('Katze')).some(e => e.definitions?.some(d => /Katze/.test(d))));
  const [row] = atlas.lookup('日本語', 'にほんご');
  const entry = atlas.entry(row);
  assert.ok(entry.pitch.length);
  assert.ok(entry.frequency > 0);
  assert.deepEqual(atlas.search('zzzznotaword123 " OR * --'), []);
});

test('verb-stem nouns stay whole, resolve by their actual reading, and definitions do not repeat', async () => {
  for (const [word, sentence] of [['変わり身', '変わり身の術'], ['読み物', '読み物を読む'], ['取り締まり', '取り締まりを強化する']]) {
    const tokens = await analyze(sentence);
    const token = tokens.find(t => t.text === word);
    assert.ok(token, sentence);
    assert.equal(token.lemma, word);
    assert.equal(token.pos, 'noun');
    const entries = await lookup(token.lemma, token);
    assert.ok(entries.length, word);
    for (const entry of entries) assert.equal(new Set(entry.definitions).size, entry.definitions.length);
    assert.equal(tokens.map(t => t.text).join(''), sentence);
  }
  assert.deepEqual((await analyze('変わり始めた')).map(t => t.lemma), ['変わる', '始める']);
});

test('English fallback keeps structured glosses rather than flattened page metadata',async()=>{
 const [entry]=await lookup('ノリのいい');assert.equal(entry.dictionaryLanguage,'en');
 assert.ok(entry.definitions.some(x=>x.includes('easily getting into')));
 assert.doesNotMatch(entry.definitions.join(' '),/expadjectivekana|See also|query=|forms|edrdg/);
});
