const { DatabaseSync } = require("node:sqlite");

function openNativeAtlas(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const about = Object.fromEntries(db.prepare("SELECT key,value FROM about").all().map(({key, value}) => [key, value]));
    if (about.schema !== "1" || !["en", "de"].includes(about.language) || about.starter !== "false" ||
        !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(about.version || ""))
      throw Error("Unsupported Kotoba Atlas native database.");
    const columns = "entries.id, entries.term AS word, entries.reading, entries.score, entries.rules, entries.rank, entries.gloss";
    const eligible = "kind IN ('lexical','name')";
    const surface = db.prepare(`SELECT ${columns} FROM entries WHERE term=? AND ${eligible} ORDER BY score DESC,id LIMIT 30`);
    const readings = db.prepare(`SELECT ${columns} FROM entries WHERE reading_key=? AND ${eligible} ORDER BY score DESC,id LIMIT 30`);
    const prefixes = db.prepare(`SELECT ${columns} FROM entries WHERE term >= ? AND term < ? AND ${eligible} ORDER BY score DESC,id LIMIT 30`);
    const reverse = db.prepare(`SELECT ${columns} FROM search JOIN entries ON entries.id=search.rowid WHERE search MATCH ? AND ${eligible} ORDER BY bm25(search) LIMIT 40`);
    const has = db.prepare("SELECT 1 FROM entries WHERE term=? AND kind='lexical' AND score>=0 LIMIT 1");
    const dedup = rows => [...new Map(rows.map(row => [row.id, row])).values()];
    const readingKey = value => value.normalize("NFKC").replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
    const glosses = row => JSON.parse(row.gloss);
    const languageGloss = (parts, language) => parts.filter(part => part.startsWith("[" + language.toUpperCase() + " •"));
    const clean = part => part.replace(/^\[[^\n]+\]\n/, "").replace(/^Tags:[^\n]*\n/, "")
      .split(/\nforms\n/, 1)[0].trim();
    return {
      spec: { name: "Kotoba Atlas", language: about.language, version: about.version, native: true },
      lookup(form, reading = "") {
        const exact = surface.all(form);
        const hit = exact.length ? exact : readings.all(readingKey(form));
        const preferred = reading ? hit.filter(row => readingKey(row.reading) === readingKey(reading)) : [];
        return dedup(preferred.length ? preferred : hit);
      },
      search(query) {
        if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query))
          return dedup([...surface.all(query), ...readings.all(readingKey(query)), ...prefixes.all(query, query + "\u{10ffff}")]).slice(0, 30);
        const words = query.match(/[\p{L}\p{N}]+/gu);
        return words ? dedup(reverse.all(words.map(word => '"' + word + '"').join(" AND "))).slice(0, 30) : [];
      },
      has(form) { return !!has.get(form); },
      entry(row, legacy) {
        const parts = glosses(row), target = languageGloss(parts, about.language), english = languageGloss(parts, "en");
        const selected = target.length ? target : english.length ? english : languageGloss(parts, "ja");
        const dictionaryLanguage = target.length ? about.language : english.length ? "en" : "ja";
        const pitch = parts.filter(part => part.startsWith("[Pitch •")).flatMap(part => {
          const downstep = /^Pitch: (\d+)/m.exec(part)?.[1];
          return downstep === undefined ? [] : [{ reading: row.reading, downstep: Number(downstep) }];
        });
        return { ...legacy, slug: legacy?.slug || "atlas-native-" + row.id, source: "Kotoba Atlas",
          dictionaryLanguage, dictionaryVersion: about.version,
          definitions: [...new Set(selected.map(clean).filter(Boolean))],
          frequency: row.rank ?? undefined,
          japanese: legacy?.japanese || [{ word: row.word, reading: row.reading || undefined }],
          pitch: pitch.length ? pitch : legacy?.pitch || [],
          senses: legacy?.senses || [{ english_definitions: [...new Set(english.map(clean))], parts_of_speech: [] }] };
      },
      close() { db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
module.exports = { openNativeAtlas };
