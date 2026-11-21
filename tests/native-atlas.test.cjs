const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openNativeAtlas } = require("../server/native-atlas.cjs");

test("native Atlas resolves normalized readings and reverse definitions without mixing fallback languages", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immersed-native-atlas-"));
  const file = path.join(dir, "dictionary.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE about(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO about VALUES ('schema','1'),('starter','false'),('version','1.0.4-beta.2'),('language','de');
    CREATE TABLE entries(id INTEGER PRIMARY KEY,term TEXT,reading TEXT,reading_key TEXT,score INTEGER,rules TEXT,kind TEXT,rank INTEGER,gloss TEXT);
    CREATE VIRTUAL TABLE search USING fts5(term, reading, meaning, content='');
  `);
  const add = db.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, 10, '', 'lexical', 42, ?)");
  add.run(1, "日本語", "にほんご", "にほんご", JSON.stringify([
    "[DE • WaDoku]\nJapanisch", "[DE • Fixture]\nJapanisch", "[EN • Jitendex]\nJapanese",
    "[Pitch • WaDoku]\nPitch: 0 (heiban)",
  ]));
  add.run(2, "猫", "ねこ", "ねこ", JSON.stringify(["[EN • Jitendex]\ncat"]));
  db.exec("INSERT INTO search(rowid,term,reading,meaning) VALUES (1,'日本語','にほんご','Japanisch'),(2,'猫','ねこ','cat')");
  db.close();
  const atlas = openNativeAtlas(file);
  t.after(() => { atlas.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const japanese = atlas.entry(atlas.lookup("ニホンゴ")[0]);
  assert.deepEqual(japanese.definitions, ["Japanisch"]);
  assert.deepEqual(japanese.pitch, [{ reading: "にほんご", downstep: 0 }]);
  assert.equal(japanese.frequency, 42);
  assert.equal(japanese.dictionaryLanguage, "de");
  const fallback = atlas.entry(atlas.search("cat")[0]);
  assert.equal(fallback.dictionaryLanguage, "en");
  assert.deepEqual(fallback.definitions, ["cat"]);
  assert.ok(atlas.has("猫"));
  assert.deepEqual(atlas.search('" OR 1=1'), []);
});
