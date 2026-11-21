const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
test('balanced captions migrate to blocks while accurate uses local speech and creator tracks remain authoritative',{timeout:25000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'immersed-captions-')),bin=path.join(dir,'bin'),log=path.join(dir,'speech');fs.mkdirSync(bin);
 const cache=path.join(dir,'.data/mac-transcripts-v2');fs.mkdirSync(cache,{recursive:true});
 const legacy={source:'youtube-asr',cues:[{start:1,end:1.2,text:'日',hardEnd:true,sentenceStart:1},{start:1.2,end:3,text:'日本語です',sentenceStart:1}]};
 fs.writeFileSync(path.join(cache,'aaaaaaaaaaa-balanced.json'),JSON.stringify(legacy));fs.writeFileSync(path.join(cache,'aaaaaaaaaaa-accurate.json'),JSON.stringify(legacy));
 const script=(name,body)=>{const file=path.join(bin,name);fs.writeFileSync(file,'#!/usr/bin/env node\n'+body);fs.chmodSync(file,0o755);return file;};
 script('yt-dlp',`const fs=require('fs'),a=process.argv.slice(2),out=a[a.indexOf('-o')+1],creator=a.at(-1).includes('bbbbbbbbbbb');if(a.includes('--skip-download')){fs.writeFileSync(out.replace('%(ext)s','info.json'),JSON.stringify({original_language:'ja',title:'詩人・山田太郎',channel:'読書倶楽部',subtitles:creator?{'ja-orig':[]}: {}}));fs.writeFileSync(out.replace('%(ext)s','ja-orig.json3'),JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'日本'},{utf8:'語です',tOffsetMs:200}]}]}));}else fs.writeFileSync(out.replace('%(ext)s','webm'),'audio');`);
 script('ffprobe',`console.log('4');`);
 const python=script('python',`const fs=require('fs');require('readline').createInterface({input:process.stdin}).on('line',line=>{const d=JSON.parse(line);fs.appendFileSync(process.env.CAPTION_LOG,line+'\\n');console.log(JSON.stringify({id:d.id,status:'ready',cues:[{start:0,end:4,text:'音声からの字幕'}]}));});`);
 const child=spawn(process.execPath,['-e',`const s=require('./desktop/server.cjs').server;s.listen(0,'127.0.0.1',()=>console.log('PORT:'+s.address().port));`],{cwd:path.join(__dirname,'..'),env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,IMMERSED_DATA_ROOT:dir,IMMERSED_PYTHON:python,CAPTION_LOG:log},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(dir,{recursive:true,force:true});});
 async function until(check){for(let i=0;i<400;i++){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timed out '+stderr);}
 const port=await until(()=>/PORT:(\d+)/.exec(stdout)?.[1]);const request=(id,quality,method='GET')=>fetch('http://127.0.0.1:'+port+'/api/desktop/transcribe?videoId='+id+'&quality='+quality,{method,headers:{'X-Immersed-Request':'1'}}).then(r=>r.json());
 const balanced=await request('aaaaaaaaaaa','balanced');assert.equal(balanced.cues.length,1);assert.equal(balanced.cues[0].text,'日本語です');const balancedFile = path.join(cache, 'aaaaaaaaaaa-balanced.json');
 assert.deepEqual(JSON.parse(fs.readFileSync(balancedFile, 'utf8')), legacy);
 assert.equal(fs.existsSync(balancedFile + '.rolling-v1.bak'), false);
 await request('aaaaaaaaaaa', 'balanced', 'POST');
 assert.deepEqual(JSON.parse(fs.readFileSync(balancedFile + '.rolling-v1.bak', 'utf8')), legacy);
 assert.equal((await request('aaaaaaaaaaa','accurate')).status,'idle');await request('aaaaaaaaaaa','accurate','POST');
 const recognized=await until(async()=>{const d=await request('aaaaaaaaaaa','accurate');return d.status==='ready'&&d;});assert.equal(recognized.cues[0].text,'音声からの字幕');
 const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.length,1);assert.equal(calls[0].context,'詩人・山田太郎。 読書倶楽部');
 await request('bbbbbbbbbbb','accurate','POST');const creator=await until(async()=>{const d=await request('bbbbbbbbbbb','accurate');return d.status==='ready'&&d;});assert.equal(creator.source,'human');assert.equal(creator.cues.length,1);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1);
});
