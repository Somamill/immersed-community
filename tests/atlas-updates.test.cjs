const {test}=require('node:test');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createAtlasUpdater,releaseSpec}=require('../desktop/atlas-updates.cjs');
const current={name:'Kotoba Atlas',version:'1.0.0',language:'de',sha256:'a'.repeat(64)};
const asset={name:'Kotoba_Atlas_German_v1_0_2.zip',size:60000000,digest:'sha256:'+'b'.repeat(64),browser_download_url:'https://github.com/Somamill/kotoba-atlas/releases/download/atlas-v1.0.2/Kotoba_Atlas_German_v1_0_2.zip'};
const release={tag_name:'atlas-v1.0.2',assets:[asset]};
test('dictionary updates only accept stable same-language official assets with SHA256',()=>{
 assert.equal(releaseSpec(release,current).version,'1.0.2');
 for(const changed of [{browser_download_url:'https://evil.test/file.zip'},{digest:null},{size:500*1024*1024},{name:'other.zip'}])assert.throws(()=>releaseSpec({...release,assets:[{...asset,...changed}]},current));
 assert.throws(()=>releaseSpec({...release,prerelease:true},current));
 assert.throws(()=>releaseSpec(release,{...current,language:'en'}));
});
for(const fail of [false,true])test('dictionary update '+(fail?'rolls back a failed build':'keeps one job and activates a verified build'),async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'immersed-atlas-update-test-'));fs.mkdirSync(path.join(root,'.data'));const active=path.join(root,'.data/kotoba-atlas.db');fs.writeFileSync(active,'working');
 let runs=0,finish;const held=new Promise(resolve=>finish=resolve);
 const next=releaseSpec(release,current);
 const updater=createAtlasUpdater({root,getSpec:()=>fs.readFileSync(active,'utf8')==='working'?current:next,reload:()=>{},request:async()=>new Response(JSON.stringify(release)),run:async(command,args,options)=>{
  runs++;assert.equal(command,'/usr/bin/nice');assert.ok(args.at(-1).endsWith('scripts/build-atlas.py'));assert.equal(JSON.parse(fs.readFileSync(options.env.KOTOBA_ATLAS_SPEC)).sha256,next.sha256);await held;fs.writeFileSync(active,'updated');if(fail)throw Error('test failure');
 }});
 assert.equal((await updater.check()).available,true);assert.equal((await updater.start()).status,'updating');await updater.start();assert.equal(runs,1);finish();
 for(let i=0;i<50&&updater.info().status==='updating';i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(updater.info().status,fail?'error':'complete');assert.equal(updater.info().current,fail?'1.0.0':'1.0.2');
 assert.equal(fs.readFileSync(active,'utf8'),fail?'working':'updated');
 assert.deepEqual(fs.readdirSync(path.join(root,'.data')),['kotoba-atlas.db']);
 fs.unlinkSync(active);fs.rmdirSync(path.join(root,'.data'));fs.rmdirSync(root);
});

test('an explicit language choice can switch editions at the same version and rejects unknown languages',async()=>{
 const editions=require('../src/dictionary-editions.json').editions;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'immersed-language-test-'));fs.mkdirSync(path.join(root,'.data'));
 const active=path.join(root,'.data/kotoba-atlas.db');fs.writeFileSync(active,'de');let selected;
 const updater=createAtlasUpdater({root,getSpec:()=>editions[fs.readFileSync(active,'utf8')],reload:()=>{},request:async()=>{throw Error("offline");},run:async(_cmd,_args,options)=>{
  selected=JSON.parse(fs.readFileSync(options.env.KOTOBA_ATLAS_SPEC));fs.writeFileSync(active,'en');
 }});
 assert.equal((await updater.start('en')).status,'updating');
 for(let i=0;i<50&&updater.info().status==='updating';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(selected.sha256,editions.en.sha256);assert.equal(updater.info().language,'en');assert.equal(updater.info().status,'complete');
 await assert.rejects(updater.start('ja'),/Unsupported/);
 fs.rmSync(root,{recursive:true,force:true});
});

test('a published index must match its stable language asset and checksum', async () => {
  const name = 'Kotoba-Atlas-German-index.json';
  const index = JSON.stringify({format:3,revision:'1.0.2',sourceLanguage:'ja',targetLanguage:'de',downloadUrl:asset.browser_download_url});
  const indexAsset = {name,size:Buffer.byteLength(index),digest:'sha256:'+createHash('sha256').update(index).digest('hex'),
    browser_download_url:'https://github.com/Somamill/kotoba-atlas/releases/download/atlas-v1.0.2/'+name};
  const manifest = {...release,assets:[asset,indexAsset]};
  let response = index;
  const updater = createAtlasUpdater({getSpec:()=>current,request:async url =>
    new Response(url === indexAsset.browser_download_url ? response : JSON.stringify(manifest))});
  assert.equal((await updater.check()).latest,'1.0.2');
  response = index.replace('"de"','"en"');
  await assert.rejects(updater.check(),/checksum/);
});
