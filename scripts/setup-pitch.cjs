const fs = require('node:fs');
const path = require('node:path');
const target = path.join(require('../server/data-path.cjs'), 'accents.txt');
fs.mkdirSync(path.dirname(target), { recursive: true });
require('./pinned-download.cjs')(target, '8bd0dd127dab32ceec94cb03ab1ba6b68858ea73421dfa1731af2f373deb4f20', ['https://raw.githubusercontent.com/mifunetoshiro/kanjium/9ebca4589565c696e7c39e089e2e928ad65f678c/data/source_files/raw/accents.txt']);
console.log('Pinned Kanjium pitch accents installed. Uros O., CC BY-SA 4.0; see THIRD_PARTY.md.');
