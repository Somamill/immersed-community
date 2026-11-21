// Preserve the shared source parser; the Mac reading view uses complete blocks.
const {parseCaptionTrack,compactCaptionUpdates} = require('../src/captions.ts');
const captionFormat = 'reading-blocks-v2';
function normalizeCaptionCache(data,quality) {
  if (data.source === 'youtube') data = {...data,source:'human'};
  if (quality === 'accurate' && data.source === 'youtube-asr') return null;
  if (!['human','youtube-asr'].includes(data.source) || data.captionFormat === captionFormat) return data;
  const cues = compactCaptionUpdates(data.cues);
  return cues.length ? {...data,cues,captionFormat} : null;
}
module.exports = {captionFormat,normalizeCaptionCache,
  parseYouTubeCaptions: value => compactCaptionUpdates(parseCaptionTrack(value))};
