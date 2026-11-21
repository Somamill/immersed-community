const test = require('node:test');
const assert = require('node:assert/strict');
const { validContext, contextMeaning } = require('../server/context-meaning.cjs');
const context = { word: '開く', sentence: '窓を開く。', start: 2, end: 4, before: '', after: '' };
test('context selection must match an exact, bounded caption span', () => {
  assert.equal(validContext(context), true);
  for (const change of [{ start: -1 }, { start: 0 }, { end: 3 }, { end: 999 }, { start: NaN }, { before: 'a'.repeat(241) }, { word: '' }]) {
    assert.equal(validContext({ ...context, ...change }), false);
  }
});
test('optional context model cannot prevent ordinary dictionary use on unsupported hosts', async () => {
  const previous = process.env.IMMERSED_CONTEXT_PYTHON;
  delete process.env.IMMERSED_CONTEXT_PYTHON;
  try { assert.deepEqual(await contextMeaning(context), { status: 'unavailable' }); }
  finally { if (previous) process.env.IMMERSED_CONTEXT_PYTHON = previous; }
});

test('dictionary-attested phrases disambiguate te-form stems without rewriting subtitles', async () => {
  const language = require('../server/language.cjs');
  const phrases = await language.contextPhrases('彼の主張は筋が通っている。', 5, 6);
  assert.ok(phrases.some(p => p.form === '筋が通る' && p.senses.some(s => s.english_definitions.includes('to be logical'))));
  assert.ok((await language.contextPhrases('彼の主張は筋が通っている。', 7, 12)).some(p => p.form === '筋が通る'));
  assert.deepEqual(await language.contextPhrases('窓を開く。', 2, 4), []);
});
test('selected pronunciation excludes unrelated readings of the same kanji', async () => {
  const entries = await require('../server/language.cjs').lookup('筋', { reading: 'すじ', pos: 'noun' });
  assert.ok(entries.length > 0);
  assert.ok(entries.every(entry => entry.japanese.every(form => form.reading === 'すじ')));
});
test('context results can only display supplied meanings and literal caption evidence', () => {
  const { selectedMeaning } = require('../server/context-meaning.cjs');
  const data = { word: '教会', sentence: '「紙上の教会」という概念がある', start: 4, end: 6 };
  const choices = [{ form: '教会', gloss: 'church' }, { form: '教会', gloss: 'congregation' }];
  const result = selectedMeaning({ status: 'ready', choice: 1, gloss: 'invented religious institution', phrase: '紙上の教会' }, choices, data);
  assert.equal(result.gloss, 'congregation');
  assert.equal(result.phrase, data.sentence);
  assert.equal(result.explanation, undefined);
  assert.deepEqual(selectedMeaning({ status: 'ready', choice: 100 }, choices, data), { status: 'unclear' });
  assert.equal(selectedMeaning({ status: 'ready', choice: 0, phrase: 'not present' }, choices, data).phrase, data.sentence);
});


test('a validated contracted prohibition is expressed as a prohibition, not a plain infinitive',()=>{
  const {selectedMeaning}=require('../server/context-meaning.cjs');
  const value=selectedMeaning({status:'ready',choice:0},[{form:'しらを切る',gloss:'to play innocent'}],{sentence:'しら切んな！',grammar:['contracted prohibition: ～るな']});
  assert.equal(value.gloss,'Don’t play innocent');assert.equal(value.phrase,'しら切んな！');
});

test('caption whitespace and a purpose stem retain an attested omitted-particle expression',async()=>{
 const phrases=await require('../server/language.cjs').contextPhrases('筋 通しに行くんだよ',0,1);
 assert.equal(phrases[0].form,'筋を通す');
 assert.ok(phrases[0].senses.some(s=>s.english_definitions.includes('to go through the proper channels')));
 assert.ok(!phrases.some(p=>p.form==='筋'));
 assert.deepEqual(await require('../server/language.cjs').contextPhrases('筋を描く',0,1),[]);
});

test('attested expressions constrain model candidates before isolated literal word senses',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'immersed-context-')),bin=path.join(dir,'bin');fs.mkdirSync(bin);
 const python=path.join(bin,'python'),log=path.join(dir,'requests');
 fs.writeFileSync(path.join(dir,'.ready'),'');
 fs.writeFileSync(python,`#!/usr/bin/env node\nrequire('readline').createInterface({input:process.stdin}).on('line',line=>{require('fs').appendFileSync(${JSON.stringify(log)},line+'\\n');const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:{choice:0}}));});`);fs.chmodSync(python,0o755);
 const previous=[process.env.IMMERSED_CONTEXT_PYTHON,process.env.IMMERSED_DATA_ROOT];process.env.IMMERSED_CONTEXT_PYTHON=python;process.env.IMMERSED_DATA_ROOT=dir;
 try{
  const value=await contextMeaning({word:'筋',lemma:'筋',reading:'すじ',pos:'noun',sentence:'筋 通しに行くんだよ',start:0,end:1,before:'',after:''});
  assert.equal(value.status,'ready');assert.equal(value.gloss,'to proceed in a logical manner');
  const input=JSON.parse(fs.readFileSync(log,'utf8').trim()).data;assert.ok(input.choices.every(c=>c.form==='筋を通す'));
 }finally{require('../server/context-meaning.cjs').stop();for(const [i,key] of ['IMMERSED_CONTEXT_PYTHON','IMMERSED_DATA_ROOT'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}fs.rmSync(dir,{recursive:true,force:true});}
});
