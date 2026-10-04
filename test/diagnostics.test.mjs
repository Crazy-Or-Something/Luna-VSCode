import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseProfilesText, analyze, compile, errorLocation } from '../lib/diagnostics.mjs';
const profile = { version: 1, keywords: { state: 'function' }, functions: { echo: 'print' }, shortcuts: { hello: { expandsTo: 'print("hello")' } } };
test('profile buffers accept JSONC and reject strict JSON comments', () => {
    const source = '// example\n{"p": {"version":1,"keywords":{},},}';
    assert.equal(parseProfilesText(source, 'p.jsonc').p.version, 1);
    assert.throws(() => parseProfilesText(source, 'p.json'));
});
test('invalid metadata and alias conflicts identify the profile', () => {
    assert.throws(() => parseProfilesText('{"p":{"version":1,"name":false}}', 'p.jsonc'), /Profile "p": name/);
    assert.throws(() => parseProfilesText(JSON.stringify({p:{...profile, shortcuts:{echo:{expandsTo:'print(1)'}}}}), 'p.jsonc'), /Conflicting custom name: echo/);
});
test('translation conflicts point to the original alias token', () => {
    const source = '-- echo\nlocal echo = 1';
    const {issues} = analyze(source, profile);
    assert.equal(issues.length, 1);
    assert.equal(source.slice(issues[0].offset, issues[0].offset + issues[0].length), 'echo');
    assert.equal(issues[0].line, 1);
    assert.match(issues[0].message, /reserved/);
});
test('unfinished strings point at their opening quote', () => {
    const source = 'echo("ok")\necho("unfinished';
    assert.equal(analyze(source, profile).issues[0].offset, source.indexOf('"unfinished'));
});
test('strings comments and members do not cause alias diagnostics', () => {
    assert.deepEqual(analyze('object.echo()\n-- echo\nprint("hello")', profile).issues, []);
    assert.equal(analyze('hello + 1', profile).issues.length, 1);
});
test('JSON error locations accept offsets or line and column', () => {
    assert.deepEqual(errorLocation('abc', 'at position 2'), {offset:2});
    assert.deepEqual(errorLocation('a\nb', 'line 2 column 1'), {line:1,column:0});
});
const runtime = new URL('../../Luna/build/Release/lua.exe', import.meta.url);
test('syntax check compiles without running code and reports original lines', {skip:!fs.existsSync(runtime)}, async () => {
    const {fileURLToPath} = await import('node:url');
    assert.deepEqual(await compile(fileURLToPath(runtime), 'error("must never execute")', 'C:/some folder/test.ln'), []);
    const issues = await compile(fileURLToPath(runtime), 'print(1)\nlocal =', 'C:/some folder/test.ln');
    assert.equal(issues[0].line, 1);
    assert.match(issues[0].message, /translated Lua/);
    await assert.rejects(compile('C:/missing/lua.exe', '', 'test.ln'));
});
