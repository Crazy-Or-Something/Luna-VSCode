import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { completions, highlightTokens, tokenContext } from '../lib/language.mjs';
import { tokenize } from '../lib/luna.mjs';
const profile = { version: 1, keywords: { state: 'function' }, functions: { echo: 'print' }, shortcuts: {
    hello: { expandsTo: 'print("hello")', description: 'Say hello', enabled: true },
    hidden: { expandsTo: 'print("hidden")', enabled: false }
} };
test('completions include active profile names and descriptions', () => {
    const items = completions(profile);
    for (const name of ['state', 'echo', 'hello', 'print', 'math.floor']) assert.ok(items.some(x => x.name === name));
    assert.equal(items.find(x => x.name === 'hello').documentation, 'Say hello');
    assert.equal(items.some(x => x.name === 'hidden'), false);
    assert.equal(items.find(x => x.name === 'echo').insert, 'echo(' + '$' + '{1})');
    assert.match(items.find(x => x.name === 'state block').insert, /^state /);
});
test('blank profile does not suggest example aliases', () => {
    const items = completions({ version: 1 });
    assert.equal(items.some(x => ['state', 'echo', 'hello'].includes(x.name)), false);
});
test('semantic highlights exclude strings, comments and member names', () => {
    const source = 'state f()\n echo("state echo hello")\n hello\n object.echo()\n-- state echo\nend';
    assert.deepEqual(highlightTokens(source, profile).map(x => [x.text, x.kind]), [['state', 'keyword'], ['echo', 'function'], ['hello', 'macro']]);
});
test('disabled shortcuts are not semantically highlighted', () => {
    assert.equal(highlightTokens('hidden', profile).length, 0);
});
test('completion context handles comments and unfinished strings', () => {
    for (const source of ['-- echo', '"echo', "'echo", '--[=[echo', '[=[echo']) assert.equal(tokenContext(source, source.length).blocked, true);
    assert.equal(tokenContext('echo("hello")', 8).blocked, true);
    assert.equal(tokenContext('echo("hello")', 13).blocked, false);
    assert.equal(tokenContext('math.fl', 7).member, 'math');
    assert.equal(tokenContext('object:', 7).member, 'object');
});
test('tolerant editor scanner keeps preceding tokens; compiler stays strict', () => {
    const source = 'state f()\n echo("unfinished';
    assert.equal(highlightTokens(source, profile)[0].text, 'state');
    assert.throws(() => tokenize(source), /Unterminated/);
    assert.equal(tokenize(source, { allowIncomplete: true }).at(-1).kind, 'string');
});
test('bundled runtime matches shared CLI source', () => {
    for (const file of ['luna.mjs', 'profile.mjs']) {
        assert.equal(fs.readFileSync(new URL('../lib/' + file, import.meta.url), 'utf8'),
            fs.readFileSync(new URL('../../Luna/tools/' + file, import.meta.url), 'utf8'));
    }
});
