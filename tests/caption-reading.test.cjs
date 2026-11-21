const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseYouTubeCaptions,normalizeCaptionCache,captionFormat}=require('../desktop/captions.cjs');
const {parseCaptionTrack,sentenceTarget}=require('../src/captions.ts');
const track={events:[
 {tStartMs:1000,dDurationMs:4000,wWinId:1,segs:[{utf8:'今日は'},{utf8:'公園',tOffsetMs:200},{utf8:'へ行く',tOffsetMs:500}]},
 {tStartMs:3000,wWinId:1,segs:[]},
 {tStartMs:4000,dDurationMs:3000,wWinId:1,segs:[{utf8:'次の'},{utf8:'字幕です',tOffsetMs:400}]},
]};
test('reading collapses rolling reveal frames and retains explicit source clears and seeks',()=>{
 const raw=parseCaptionTrack(track),reading=parseYouTubeCaptions(track);
 assert.equal(raw.length,5);assert.equal(reading.length,2);
 assert.deepEqual(reading.map(c=>[c.start,c.end,c.text]),[[1,3,'今日は公園へ行く'],[4,7,'次の字幕です']]);
 assert.equal(reading[0].hardEnd,true);assert.equal(sentenceTarget(raw,1.1,1),4);assert.equal(sentenceTarget(raw,4.5,-1),1);
});
test('legacy rolling caches compact without rewriting words and accurate mode rejects automatic captions',()=>{
 const raw=parseCaptionTrack(track).map(c=>({...c,sentenceStart:1}));
 const old={source:'youtube-asr',cues:raw},fixed=normalizeCaptionCache(old,'balanced');
 assert.equal(old.cues.length,5);assert.equal(fixed.cues.length,2);assert.equal(fixed.captionFormat,captionFormat);
 assert.equal(fixed.cues[1].sentenceStart,4);assert.equal(normalizeCaptionCache(old,'accurate'),null);
 const creator=normalizeCaptionCache({...old,source:'youtube'},'accurate');assert.equal(creator.source,'human');
 const speech={pipeline:'mac-whisper-context-v3',cues:[{start:1,end:3,text:'同じ文'}]};assert.equal(normalizeCaptionCache(speech,'accurate'),speech);
});
test('independent repeated phrases do not collapse into one reading block',()=>{
 const reading=parseYouTubeCaptions({events:[{tStartMs:1000,dDurationMs:1000,segs:[{utf8:'はい'}]},{tStartMs:2000,dDurationMs:1000,segs:[{utf8:'はいどうぞ'}]}]});
 assert.equal(reading.length,2);
});
