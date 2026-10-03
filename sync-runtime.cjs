const fs = require('node:fs');
const path = require('node:path');
const files = ['luna.mjs', 'profile.mjs'];
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../Luna/tools');
if (!files.every(file => fs.existsSync(path.join(source, file)))) {
    if (process.argv[2]) throw new Error('Runtime source is incomplete: ' + source);
    if (!files.every(file => fs.existsSync(path.join(__dirname, 'lib', file))))
        throw new Error('No sibling Luna/tools source or bundled runtime was found');
    console.log('Using bundled Luna runtime (no sibling Luna/tools source found).');
} else {
    fs.mkdirSync(path.join(__dirname, 'lib'), { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(__dirname, 'lib', file));
    console.log('Shared Luna runtime synced from ' + source);
}
