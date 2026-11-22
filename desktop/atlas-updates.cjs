const { createHash } = require("node:crypto");
const fs = require('node:fs');
const path = require('node:path');
const REPOSITORY = 'https://github.com/Somamill/kotoba-atlas/releases/download/';
const editions = require('../src/dictionary-editions.json').editions;
const newer = (a,b) => a.localeCompare(b, 'en', {numeric:true}) > 0;
function releaseSpec(release, current) {
  const version = /^atlas-v(\d+\.\d+\.\d+)$/.exec(release.tag_name || '')?.[1];
  if (!version || release.draft || release.prerelease) throw Error('No compatible stable dictionary release.');
  const language = current.language === 'de' ? 'German' : current.language === 'en' ? 'English' : null;
  const asset = release.assets?.find(a => language && new RegExp('^Kotoba[-_]Atlas[-_]' + language + '[-_]v[0-9._]+\\.zip$').test(a.name));
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 300 * 1024 * 1024 ||
      asset.browser_download_url !== REPOSITORY + release.tag_name + '/' + asset.name) throw Error('The release has no verified dictionary for your language.');
  return {name:'Kotoba Atlas',version,language:current.language,archive:asset.name,url:asset.browser_download_url,sha256:asset.digest.slice(7)};
}
function createAtlasUpdater({root, run, getSpec = () => require('../server/atlas.cjs').spec, reload = () => require('../server/language.cjs').refreshDictionary(), request = fetch}) {
  let latest = null, task = null, status = 'idle', error = '';
  const info = () => ({status,error,current:getSpec().version,language:getSpec().language,targetLanguage:latest?.language || null,latest:latest?.version || null,available:!!latest && (latest.language!==getSpec().language || newer(latest.version,getSpec().version))});
  async function resolveRelease(language) {
    const response = await request('https://api.github.com/repos/Somamill/kotoba-atlas/releases/latest', {headers:{Accept:'application/vnd.github+json','User-Agent':'immersed-dictionary-updater'},signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Dictionary release check failed. Try again later.');
    const text = await response.text();
    if (text.length > 2e6) throw Error('Dictionary release response is too large.');
    const release = JSON.parse(text), spec = releaseSpec(release, { language });
    const edition = language === 'de' ? 'German' : 'English';
    const name = `Kotoba-Atlas-${edition}-index.json`;
    const index = release.assets.find(asset => asset.name === name);
    if (index) {
      const url = REPOSITORY + release.tag_name + '/' + name;
      if (index.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(index.digest || '') ||
          !Number.isSafeInteger(index.size) || index.size <= 0 || index.size > 32_000)
        throw Error('Dictionary release index could not be verified.');
      const response = await request(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw Error('Dictionary release index is unavailable.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== index.size || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== index.digest)
        throw Error('Dictionary release index failed its checksum.');
      const metadata = JSON.parse(bytes.toString('utf8'));
      if (metadata.format !== 3 || metadata.revision !== spec.version ||
          metadata.sourceLanguage !== 'ja' || metadata.targetLanguage !== language || metadata.downloadUrl !== spec.url)
        throw Error('Dictionary release index does not match the selected edition.');
    }
    return spec;
  }
  async function check() {
    if (getSpec().native) throw Error("Restart without IMMERSED_ATLAS_NATIVE_PATH to update the installed dictionary.");
    if (task) return info();
    const spec = await resolveRelease(getSpec().language);
    if (!task && spec.language === getSpec().language) { latest = spec; error = ''; }
    return info();
  }
  async function start(language) {
    if (getSpec().native) throw Error("Restart without IMMERSED_ATLAS_NATIVE_PATH to change the installed dictionary.");
    language ??= getSpec().language;
    if (!Object.hasOwn(editions,language)) throw Error("Unsupported dictionary language.");
    if (task) return info();
    const switchEdition = language !== getSpec().language;
    const spec = !switchEdition && latest?.language === language ? latest
      : await resolveRelease(language).catch(error => {
        if (!switchEdition) throw error;
        return editions[language];
      });
    if (task) return info();
    latest = spec;
    if (!info().available) return info();
    const folder = process.env.IMMERSED_APP_HOME ? require('../server/data-path.cjs') : path.join(root,'.data');
    fs.mkdirSync(folder,{recursive:true});
    const staging = fs.mkdtempSync(path.join(folder,'atlas-update-'));
    const manifest = path.join(staging,'spec.json'), backup = path.join(staging,'previous.db'), active = path.join(folder,'kotoba-atlas.db');
    if (fs.existsSync(active)) fs.copyFileSync(active,backup,fs.constants.COPYFILE_FICLONE);
    fs.writeFileSync(manifest,JSON.stringify(spec));
    status = 'updating'; error = '';
    let restoreFailed = false;
    task = Promise.resolve().then(() => run('/usr/bin/nice', ['-n','10','python3',path.join(root,'scripts/build-atlas.py')],
      {env:{...process.env,KOTOBA_ATLAS_SPEC:manifest},timeout:10*60*1000,maxBuffer:1024*1024}))
      .then(() => { reload(); if (getSpec().sha256 !== spec.sha256) throw Error('The dictionary update could not be verified.'); status='complete'; })
      .catch(() => {
        if (fs.existsSync(backup)) { try { fs.renameSync(backup,active); reload(); } catch { restoreFailed=true; } }
        status='error';error=restoreFailed ? 'Dictionary update failed. The previous database backup is retained; restart immersed before retrying.' : 'Dictionary update failed. Your previous working dictionary and learning data are retained. Try again.';
      })
      .finally(() => { task=null; if (!restoreFailed) { try { for (const file of [manifest,backup]) if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(staging); } catch {} } });
    return info();
  }
  return {info,check,start};
}
module.exports = {createAtlasUpdater,releaseSpec};
