const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const pinned = require('../dictionary.json');
const { openNativeAtlas } = require('./native-atlas.cjs');
const editions = require('../src/dictionary-editions.json').editions;
let spec = pinned;
let database, native, exact, prefix, fullText, pitchQuery, frequencyQuery, wordQuery;
function initialize() {
  if (database || native) return;
  if (process.env.IMMERSED_ATLAS_NATIVE_PATH) {
    native = openNativeAtlas(process.env.IMMERSED_ATLAS_NATIVE_PATH);
    spec = native.spec;
    return;
  }
  const candidate = new DatabaseSync(path.join(__dirname, '../.data/kotoba-atlas.db'), { readOnly: true });
  const installed = Object.fromEntries(candidate.prepare("SELECT key,value FROM metadata WHERE key IN ('name','version','language','sha256','archive','url')").all().map(row => [row.key,row.value]));
  const baseline = editions[installed.language];
  if (!baseline || !/^\d+\.\d+\.\d+$/.test(installed.version || '') || installed.version.localeCompare(baseline.version, 'en', {numeric:true}) < 0 || !/^[a-f0-9]{64}$/.test(installed.sha256 || '') ||
      (installed.version === baseline.version && installed.sha256 !== baseline.sha256)) {
    candidate.close(); throw new Error('Kotoba Atlas needs updating. Run npm run language:setup.');
  }
  spec = {...baseline, ...installed};
  database = candidate;
  exact = database.prepare('SELECT e.* FROM forms f JOIN entries e ON e.id=f.entry_id WHERE f.form=? ORDER BY e.score DESC,e.word,e.reading LIMIT 30');
  prefix = database.prepare('SELECT * FROM entries WHERE word>=? AND word<? ORDER BY score DESC,word LIMIT 20');
  fullText = database.prepare('SELECT e.* FROM search s JOIN entries e ON e.rowid=s.rowid WHERE search MATCH ? ORDER BY bm25(search),e.score DESC LIMIT 20');
  pitchQuery = database.prepare('SELECT reading,downstep FROM pitch WHERE form=? AND (?=\'\' OR reading=?)');
  frequencyQuery = database.prepare('SELECT min(rank) AS rank FROM frequency WHERE form=? AND (reading=\'\' OR reading=?)');
  wordQuery = database.prepare('SELECT 1 FROM entries WHERE word=? AND score>=0 LIMIT 1');
}
function lookup(form, reading = '') {
  initialize();
  if (native) return native.lookup(form, reading);
  const rows = exact.all(form);
  const pronounced = reading ? rows.filter(row => row.reading === reading) : [];
  return pronounced.length ? pronounced : rows;
}
function search(query) {
  initialize();
  if (native) return native.search(query);
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return prefix.all(query, query + '\u{10ffff}');
  const terms = query.match(/[\p{L}\p{N}]+/gu) || [];
  return terms.length ? fullText.all(terms.map(term => `"${term}"`).join(' AND ')) : [];
}
function has(form) { initialize(); return native ? native.has(form) : !!wordQuery.get(form); }
function meanings(row) {
  const seen = new Set();
  return row.definitions.split('\n\n').filter(part => !part.startsWith('[Pitch •') && !part.startsWith('[Frequency •'))
    .map(part => part.replace(/^\[[^\n]+\]\n/, '').replace(/^Tags:[^\n]*\n/, '')
      .split('\n').map(line => line.trim()).filter(line => line && !seen.has(line) && seen.add(line)).join('\n'))
    .filter(Boolean);
}
function entry(row, legacy) {
  initialize();
  if (native) return native.entry(row, legacy);
  const nativePitch = pitchQuery.all(row.word, row.reading, row.reading);
  const english = row.definitions.includes('[EN •') ? meanings(row) : [];
  return { ...legacy, slug: legacy?.slug || row.id, source: 'Kotoba Atlas',
    dictionaryLanguage: row.definitions.startsWith('[EN •') ? 'en' : row.definitions.startsWith('[JA •') ? 'ja' : spec.language, dictionaryVersion: spec.version,
    definitions: english.length && legacy?.senses ? legacy.senses.map(s=>s.english_definitions.join('; ')).filter(Boolean) : meanings(row), frequency: frequencyQuery.get(row.word, row.reading)?.rank ?? undefined,
    japanese: legacy?.japanese || [{ word: row.word, reading: row.reading || undefined }],
    pitch: nativePitch.length ? nativePitch : legacy?.pitch || [],
    senses: legacy?.senses || [{ english_definitions: english, parts_of_speech: row.rules ? ['verb / adjective'] : [] }] };
}
function reload() { database?.close(); native?.close(); database = native = null; initialize(); }
module.exports = { lookup, search, has, entry, reload, get spec() { initialize(); return spec; } };
