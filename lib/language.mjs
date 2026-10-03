import { tokenize } from './luna.mjs';
export const builtinHelp = {
    print: 'Print values to the console.',
    assert: 'Check a condition and raise an error if it is false.',
    error: 'Raise a runtime error.',
    ipairs: 'Iterate sequential integer entries of a table.',
    pairs: 'Iterate all entries of a table.',
    next: 'Get the next key and value from a table.',
    type: 'Return the type name of a value.',
    tostring: 'Convert a value to a string.',
    tonumber: 'Convert a value to a number.',
    pcall: 'Call a function with protected error handling.',
    select: 'Select values from variable arguments.',
    rawget: 'Read a table entry without invoking a metamethod.',
    rawset: 'Write a table entry without invoking a metamethod.',
    'math.abs': 'Return the absolute value.',
    'math.floor': 'Round down to an integer.',
    'math.ceil': 'Round up to an integer.',
    'math.random': 'Generate a pseudorandom number.',
    'string.format': 'Format values into a string.',
    'string.len': 'Return the length of a string in bytes.',
    'string.sub': 'Extract part of a string.',
    'table.insert': 'Insert an element into a sequence.',
    'table.remove': 'Remove an element from a sequence.',
    'table.concat': 'Join sequence values into a string.'
};
const words = 'and break do else elseif end false for function global goto if in local nil not or repeat return then true until while'.split(' ');
const own = (object, key) => Object.hasOwn(object, key);
export function completions(profile) {
    const items = words.map(name => ({ name, kind: 'keyword', detail: 'Lua keyword', documentation: name }));
    for (const [name, documentation] of Object.entries(builtinHelp))
        items.push({ name, kind: 'function', detail: 'Lua function', documentation, insert: name + '(' + '$' + '{1})' });
    for (const [name, target] of Object.entries(profile.keywords ?? {}))
        items.push({ name, kind: 'keyword', detail: name + ' → ' + target, documentation: 'Local name for the Lua keyword ' + target });
    for (const [name, target] of Object.entries(profile.functions ?? {}))
        items.push({ name, kind: 'function', detail: name + ' → ' + target, documentation: builtinHelp[target] ?? ('Calls ' + target), insert: name + '(' + '$' + '{1})' });
    for (const [name, rule] of Object.entries(profile.shortcuts ?? {})) {
        if (rule.enabled !== false) items.push({ name, kind: 'shortcut', detail: name + ' → ' + rule.expandsTo, documentation: rule.description ?? rule.expandsTo });
    }
    const fn = Object.entries(profile.keywords ?? {}).find(([, target]) => target === 'function')?.[0] ?? 'function';
    items.push({ name: fn + ' block', filter: fn, kind: 'snippet', detail: 'Named function using your profile', insert: fn + ' $' + '{1:name}($' + '{2})\n\t$' + '{0}\nend' });
    return items;
}
export function tokenContext(source, offset) {
    const tokens = tokenize(source, { allowIncomplete: true });
    const token = tokens.find(t => t.start <= offset && offset < t.end);
    const last = tokens.at(-1);
    const incompleteAtEnd = offset === source.length && last?.end === offset &&
        ((last.kind === 'comment' && !/[\r\n]$/.test(last.text)) ||
         (last.kind === 'string' && (
             ((last.text[0] === '"' || last.text[0] === "'") && (last.text.length < 2 || last.text.at(-1) !== last.text[0])) ||
             (last.text.startsWith('[') && !/\](=*)\]$/.test(last.text))
         )));
    if (token?.kind === 'string' || token?.kind === 'comment' || incompleteAtEnd)
        return { blocked: true, member: null };
    const member = /([A-Za-z_][A-Za-z0-9_]*)[.:][A-Za-z0-9_]*$/.exec(source.slice(0, offset));
    return { blocked: false, member: member?.[1] ?? null };
}
export function highlightTokens(source, profile) {
    const tokens = tokenize(source, { allowIncomplete: true }).filter(t => t.kind !== 'space' && t.kind !== 'comment');
    const result = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind !== 'name') continue;
        const previous = tokens[i - 1]?.text;
        const canonicalPrevious = (profile.keywords ?? {})[previous] ?? previous;
        if (['.', ':', '::', 'goto'].includes(canonicalPrevious)) continue;
        let kind = null;
        if (own(profile.keywords ?? {}, token.text)) kind = 'keyword';
        else if (own(profile.functions ?? {}, token.text) && tokens[i + 1]?.text === '(') kind = 'function';
        else if (own(profile.shortcuts ?? {}, token.text) && profile.shortcuts[token.text].enabled !== false) kind = 'macro';
        if (kind) result.push({ ...token, kind });
    }
    return result;
}
