"""Build the shared, disk-indexed Kotoba Atlas dictionary; never touch library data."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    spec = json.loads(Path(os.environ.get('KOTOBA_ATLAS_SPEC', ROOT / 'dictionary.json')).read_text())
    folder = ROOT / '.data'
    folder.mkdir(exist_ok=True)
    out = Path(os.environ.get('KOTOBA_ATLAS_OUTPUT', folder / 'kotoba-atlas.db'))
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        with sqlite3.connect(out) as existing:
            try:
                installed = dict(existing.execute("SELECT key,value FROM metadata WHERE key IN ('sha256','version','language')"))
                if installed.get('language') == spec['language'] and re.fullmatch(r'\d+\.\d+\.\d+', installed.get('version', '')) and (installed.get('sha256') == spec['sha256'] or tuple(map(int, installed['version'].split('.'))) > tuple(map(int, spec['version'].split('.')))):
                    return out
            except sqlite3.DatabaseError:
                pass
    source = Path(os.environ.get('KOTOBA_ATLAS_ARCHIVE', folder / spec['archive']))
    if not source.exists():
        partial = source.with_suffix('.part')
        import socket
        socket.setdefaulttimeout(30)
        urllib.request.urlretrieve(spec['url'], partial)
        partial.replace(source)
    if hashlib.sha256(source.read_bytes()).hexdigest() != spec['sha256']:
        raise RuntimeError('Kotoba Atlas checksum mismatch; the existing database was not changed')
    temporary = out.with_suffix('.building')
    temporary.unlink(missing_ok=True)
    db = sqlite3.connect(temporary)
    try:
        db.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
            CREATE TABLE entries(id TEXT PRIMARY KEY,word TEXT,reading TEXT,definitions TEXT,score INTEGER,rules TEXT);
            CREATE TABLE forms(form TEXT,entry_id TEXT,PRIMARY KEY(form,entry_id)) WITHOUT ROWID;
            CREATE TABLE pitch(form TEXT,reading TEXT,downstep INTEGER,PRIMARY KEY(form,reading,downstep)) WITHOUT ROWID;
            CREATE TABLE frequency(form TEXT,reading TEXT,rank INTEGER,PRIMARY KEY(form,reading)) WITHOUT ROWID;
            CREATE TABLE kanji(character TEXT PRIMARY KEY,data TEXT);
            CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
            CREATE VIRTUAL TABLE search USING fts5(word,reading,definitions,content='',tokenize='unicode61 remove_diacritics 2');
            BEGIN;''')
        count = 0
        with zipfile.ZipFile(source) as archive:
            index = json.loads(archive.read('index.json'))
            if index.get('revision') != spec['version'] or index.get('targetLanguage') != spec['language']:
                raise ValueError('Kotoba Atlas version/language does not match the pinned manifest')
            for name in archive.namelist():
                if re.fullmatch(r'term_bank_\d+\.json', name):
                    for row in json.loads(archive.read(name)):
                        if len(row) != 8 or not all(isinstance(x, str) for x in [row[0], row[1], row[3], *row[5]]):
                            raise ValueError('Invalid Atlas word record')
                        word, reading = row[:2]
                        identity = 'atlas-' + hashlib.sha256((word + '\0' + reading).encode()).hexdigest()[:32]
                        definitions = '\n\n'.join(row[5])
                        cursor = db.execute('INSERT INTO entries VALUES(?,?,?,?,?,?)', (identity, word, reading, definitions, row[4], row[3]))
                        db.executemany('INSERT INTO forms VALUES(?,?)', [(form, identity) for form in {word, reading} if form])
                        if row[4] >= 0:
                            db.execute('INSERT INTO search(rowid,word,reading,definitions) VALUES(?,?,?,?)', (cursor.lastrowid, word, reading, definitions))
                        count += 1
                elif re.fullmatch(r'term_meta_bank_\d+\.json', name):
                    for form, kind, value in json.loads(archive.read(name)):
                        if kind == 'pitch':
                            db.executemany('INSERT OR IGNORE INTO pitch VALUES(?,?,?)', [(form, value['reading'], p['position']) for p in value['pitches']])
                        elif kind == 'freq':
                            reading = value.get('reading', '') if isinstance(value, dict) else ''
                            rank = value.get('frequency', value) if isinstance(value, dict) else value
                            rank = rank.get('value') if isinstance(rank, dict) else rank
                            if isinstance(rank, (int, float)):
                                db.execute('INSERT INTO frequency VALUES(?,?,?) ON CONFLICT(form,reading) DO UPDATE SET rank=min(rank,excluded.rank)', (form, reading, rank))
                elif re.fullmatch(r'kanji_bank_\d+\.json', name):
                    db.executemany('INSERT INTO kanji VALUES(?,?)', [(row[0], json.dumps(row, ensure_ascii=False)) for row in json.loads(archive.read(name))])
            for name in ['NOTICES.txt', 'SOURCES.json', 'licenses/wadoku.txt']:
                db.execute('INSERT INTO metadata VALUES(?,?)', (name, archive.read(name).decode()))
        if count < 1000000:
            raise ValueError('The Atlas index is unexpectedly incomplete')
        db.executescript('CREATE INDEX entries_word ON entries(word); CREATE INDEX entries_reading ON entries(reading);')
        db.executemany('INSERT INTO metadata VALUES(?,?)', [(key, str(value)) for key, value in {**spec, 'entries': count}.items()])
        db.commit()
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Atlas database integrity check failed')
        db.close()
        temporary.replace(out)
        print(f'Kotoba Atlas {spec["version"]}: {count:,} indexed entries; {out.stat().st_size // 1024 // 1024} MiB', flush=True)
        return out
    except BaseException:
        db.close()
        temporary.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    print(build())
