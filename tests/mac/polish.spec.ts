import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('header coverage and advanced katakana follow level changes and explicit word choices',async({page})=>{
  await page.route(/\/api\/desktop\/levels(?:\?|$)/,route=>route.fulfill({json:{'政治':3,'ポッドキャスト':1}}));
  await page.goto('/');
  await page.evaluate(()=>(window as any).eval(`(async()=>{
    prefs.level=2; prefs.knowledge={}; levels={'政治':3,'ポッドキャスト':1};
    source={type:'youtube',id:'5C3hh2fO4mE',title:'日本語'};
    youtube={getCurrentTime:()=>1,getPlayerState:()=>2};
    cues=[{start:0,end:4,text:'政治とポッドキャスト。',uncertain:true}];
    coverageTokens=await analyze(cues[0].text);updateCoverage();cueIndex=-1;await renderCue();
  })()`));
  await expect(page.locator('#understanding')).toBeVisible();
  await expect(page.locator('#understanding')).toHaveText('100%');
  await expect(page.getByRole('button',{name:'Look up ポッドキャスト',exact:true})).not.toHaveClass(/unknown/);
  expect(await page.locator('.line').evaluate(n=>getComputedStyle(n).borderBottomStyle)).toBe('none');
  await page.evaluate(()=>(window as any).eval('prefs.level=3;updateCoverage();cueIndex=-1;renderCue();'));
  await expect(page.locator('#understanding')).toHaveText('50%');
  await expect(page.getByRole('button',{name:'Look up ポッドキャスト',exact:true})).toHaveClass(/unknown/);
  await page.evaluate(()=>(window as any).eval("prefs.level=2;prefs.knowledge={'ポッドキャスト':false};updateCoverage();cueIndex=-1;renderCue();"));
  await expect(page.locator('#understanding')).toHaveText('50%');
  await page.screenshot({path:'work/coverage-polish-preview.png'});
});

test('honorific vocabulary lookup resolves the whole displayed word',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>(window as any).eval("youtube={getCurrentTime:()=>1,getPlayerState:()=>2};cues=[{start:0,end:5,text:'ポッドキャストにお便りください。'}];cueIndex=-1;renderCue();"));
  const word=page.getByRole('button',{name:'Look up お便り',exact:true});
  await expect(word).toBeVisible();await word.hover();
  await expect(page.locator('#definitions')).toContainText(/Brief|Nachricht|letter|correspondence/);
  await expect(page.locator('#lookupWord')).toHaveText('お便り');
  await expect(page.getByRole('button',{name:'Save word',exact:true})).toBeEnabled();
});

test('embedded player keys and rewind buttons route to subtitle blocks instead of timed seeking',async({page})=>{
  await page.route('https://www.youtube.com/embed/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<button aria-label="Rewind 10 seconds">Back</button><button aria-label="Fast forward 10 seconds">Forward</button><input aria-label="Search" />'}));
  await page.goto('https://www.youtube.com/embed/5C3hh2fO4mE');
  await page.evaluate(()=>{(window as any).__jumps=[];(window as any).__oldSeeks=0;(window as any).webkit={messageHandlers:{immersedPlayer:{postMessage:(x:any)=>(window as any).__jumps.push(x.direction)}}};document.addEventListener('click',()=>{(window as any).__oldSeeks++;});});
  await page.addScriptTag({content:fs.readFileSync('desktop/player-bridge.js','utf8')});
  await page.getByRole('button',{name:'Previous subtitle',exact:true}).click();
  await page.getByRole('button',{name:'Next subtitle',exact:true}).click();
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('l');
  expect(await page.evaluate(()=>(window as any).__jumps)).toEqual([-1,1,-1,1]);
  expect(await page.evaluate(()=>(window as any).__oldSeeks)).toBe(0);
  await page.getByRole('textbox',{name:'Search',exact:true}).focus();await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(()=>(window as any).__jumps.length)).toBe(4);
});

test('YouTube reading stays centered during a paused delayed seek and its panes resize persistently',async({page})=>{
 await page.goto('/');
 await page.evaluate(()=>(window as any).eval(`youtube={getCurrentTime:()=>10,getPlayerState:()=>2,seekTo:()=>{}};source={type:'youtube',id:'5C3hh2fO4mE'};cues=[{start:0,end:1,text:'最初の文。'},{start:30,end:35,text:'次の字幕です。'}];seekTo(30.015);cueSeek.until=0;renderCue();`));
 await expect(page.locator('.line')).toContainText('次の字幕');
 expect(await page.locator('.line').evaluate(e=>getComputedStyle(e).textAlign)).toBe('center');
 expect(await page.locator('#subtitles').evaluate(e=>getComputedStyle(e).fontSize)).toBe(await page.locator('.line').evaluate(e=>getComputedStyle(e).fontSize));
 const divider=page.getByRole('separator',{name:'Resize video and reading panes'});await expect(divider).toBeVisible();
 await divider.focus();await page.keyboard.press('ArrowLeft');await expect(divider).toHaveAttribute('aria-valuenow','58');
 await page.reload();await expect(divider).toHaveAttribute('aria-valuenow','58');
 const before=await page.locator('.videoCard').boundingBox(),rect=await divider.boundingBox();
 await page.mouse.move(rect!.x+rect!.width/2,rect!.y+rect!.height/2);await page.mouse.down();await page.mouse.move(rect!.x-80,rect!.y+rect!.height/2);await page.mouse.up();
 await expect.poll(async()=>Math.round((await page.locator('.videoCard').boundingBox())!.width)).toBeLessThan(Math.round(before!.width)-40);
 await page.setViewportSize({width:480,height:900});await expect(divider).toBeHidden();
});
test('marked-word milestones count real choices and unknown highlights are distinct',async({page})=>{
 await page.goto('/');
 await page.evaluate(()=>(window as any).eval(`prefs.knowledge=Object.fromEntries(Array.from({length:9},(_,i)=>['known-'+i,true]));youtube={getCurrentTime:()=>.5,getPlayerState:()=>2,pauseVideo:()=>{}};source={type:'youtube',id:'5C3hh2fO4mE'};cues=[{start:0,end:4,text:'猫'}];cueIndex=-1;renderCue();`));
 await page.evaluate(()=>(window as any).eval(`openLookup({text:'猫',lemma:'猫',reading:'ねこ'},true)`));
 await page.locator('#wordStates').getByRole('button',{name:'Mark unknown',exact:true}).click();
 const word=page.getByRole('button',{name:'Look up 猫',exact:true});await expect(word).toHaveClass(/unknown/);
 await expect(word).toHaveCSS('border-bottom-width','2px');
 await page.locator('#wordStates').getByRole('button',{name:'Mark known',exact:true}).click();await expect(page.locator('#learningFeedback')).toHaveText('10 words marked known');
 await page.locator('#wordStates').getByRole('button',{name:'Mark known',exact:true}).click();expect(await page.evaluate(()=>(window as any).eval('Object.values(prefs.knowledge).filter(x=>x===true).length'))).toBe(10);
 await page.locator('#closeLookup').click();await page.getByRole('button',{name:'Words',exact:true}).click();await expect(page.locator('#panelBody')).toContainText('10 / 20 words marked known');
});
test('Settings checks and updates Kotoba Atlas explicitly, reporting progress and installed version',async({page})=>{
 let started=false;
 await page.route('**/api/desktop/dictionary-update*',route=>{const post=route.request().method()==='POST';if(post)started=true;return route.fulfill({json:{status:post?'updating':started?'complete':'idle',current:started?'1.0.2':'1.0.0',latest:'1.0.2',available:!started}});});
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();expect(started).toBe(false);
 await page.getByRole('button',{name:'Check dictionary updates',exact:true}).click();await expect(page.getByRole('button',{name:'Update to 1.0.2',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Update to 1.0.2',exact:true}).click();await expect(page.locator('#panelBody')).toContainText('Installed: 1.0.2');expect(started).toBe(true);
});

test('lookup context starts independently, repeats reuse it, and technical labels are opt-in',async({page})=>{
 let contextCalls=0;
 let releaseDictionary!: () => void;
 const dictionaryGate = new Promise<void>(resolve => { releaseDictionary = resolve; });
 await page.route(/\/api\/immersion\/dictionary\?/,async route=>{
  await dictionaryGate;
  await route.fulfill({json:{data:[{slug:'test',japanese:[{word:'文学',reading:'ぶんがく'}],senses:[{english_definitions:['literature'],parts_of_speech:['noun (common) (futsuumeishi)']}]}]}});
 });
 await page.route(/\/api\/immersion\/context-meaning\?/,route=>{contextCalls++;return route.fulfill({json:{status:'ready',gloss:'literature'}});});
 await page.goto('/');
 await page.evaluate(()=>(window as any).eval(`youtube={getCurrentTime:()=>1,getPlayerState:()=>2};source={type:'youtube',id:'AnKu-KThJPE'};cues=[{start:0,end:5,text:'文学について話す'}];cueIndex=-1;renderCue();`));
 const word=page.getByRole('button',{name:'Look up 文学',exact:true});await word.hover();
 try {
  await expect(page.locator('#contextMeaning')).toContainText('literature');
  await expect(page.locator('#definitions')).toHaveText('Looking up…');
 } finally {
  releaseDictionary();
 }
 await expect(page.locator('#definitions')).toContainText('literature');
 await expect(page.locator('#definitions')).not.toContainText('futsuumeishi');
 await expect(page.locator('#grammar')).toBeHidden();
 await page.getByRole('button',{name:'Close lookup',exact:true}).click();await page.mouse.move(0,0);await page.waitForTimeout(250);await word.hover();
 await expect(page.locator('#contextMeaning')).toContainText('literature');expect(contextCalls).toBe(1);
 await page.evaluate(()=>(window as any).eval('extras.dictionaryDetails=true;renderDefinitions();'));
 await expect(page.locator('#definitions')).toContainText('futsuumeishi');
});

test('transparent fullscreen captions have dark glyph edges on a white video',async({page})=>{
 await page.goto('/');
 await page.evaluate(()=>(window as any).eval(`youtube={getCurrentTime:()=>1,getPlayerState:()=>2};cues=[{start:0,end:5,text:'白い映像でも読みやすい字幕'}];cueIndex=-1;renderCue();`));
 await page.evaluate(()=>{const video=document.getElementById('video')!;video.classList.add('fullscreenActive');const overlay=document.createElement('div');overlay.className='fullscreenStudy';overlay.append(document.getElementById('subtitles')!);video.append(overlay);video.querySelector('.placeholder')?.remove();document.body.append(video);Object.assign(video.style,{background:'white',position:'fixed',inset:'0',zIndex:'999',width:'100vw',height:'100vh'});});
 const style=await page.locator('.fullscreenStudy .line').evaluate(n=>({stroke:getComputedStyle(n).webkitTextStrokeWidth,shadow:getComputedStyle(n).textShadow}));
 expect(await page.locator('.fullscreenStudy .subtitles').evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 expect(parseFloat(style.stroke)).toBeGreaterThanOrEqual(1);expect(style.shadow).toContain('rgb(0, 0, 0)');
 await page.screenshot({path:'work/subtitle-white-contrast.png'});
});

test('lookup motion is brief and respects Reduce Motion',async({page})=>{
 await page.goto('/');await page.evaluate(()=>(window as any).eval("openLookup({text:'文学',lemma:'文学',pos:'noun',reading:'ぶんがく'},true)"));
 expect(await page.locator('#lookup').evaluate(n=>getComputedStyle(n).animationDuration)).toBe('0.12s');
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.locator('#lookup').evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
});
