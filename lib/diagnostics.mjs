import { parseJSONC } from './profile.mjs';
import { validateProfile, translate, tokenize } from './luna.mjs';
import { spawn } from 'node:child_process';

export function parseProfilesText(text, filename) {
    const data = filename.toLowerCase().endsWith('.jsonc') ? parseJSONC(text) : JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Profiles file must be an object');
    const collection = Object.hasOwn(data, 'version') ? { default: data } : data;
    if (!Object.keys(collection).length) throw new Error('Profiles collection is empty');
    for (const [id, profile] of Object.entries(collection)) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) throw new Error('Invalid profile ID: ' + id);
        try { validateProfile(profile); }
        catch (error) { throw new Error('Profile "' + id + '": ' + error.message); }
    }
    return collection;
}

export function errorLocation(source, message) {
    const position = /\bposition (\d+)/i.exec(message);
    if (position) return { offset: Math.min(source.length, Number(position[1])) };
    const line = /\bline (\d+)(?: column (\d+))?/i.exec(message);
    if (line) return { line: Number(line[1]) - 1, column: line[2] ? Number(line[2]) - 1 : undefined };
    return { line: 0 };
}

export function analyze(source, profile) {
    try { return { translated: translate(source, profile), issues: [] }; }
    catch (error) {
        const location = errorLocation(source, error.message);
        // The compiler reports translation conflicts by line. Locate the offending name when possible.
        const name = /^Line \d+: "([A-Za-z_][A-Za-z0-9_]*)"/.exec(error.message)?.[1];
        if (name) {
            const token = tokenize(source, { allowIncomplete: true }).find(t => t.kind === 'name' && t.text === name &&
                source.slice(0, t.start).split(/\r\n|\r|\n/).length - 1 === location.line);
            if (token) Object.assign(location, { offset: token.start, length: token.text.length });
        } else if (/Unterminated|Unescaped newline/.test(error.message)) {
            const tokens = tokenize(source, { allowIncomplete: true });
            const token = tokens.find(t => {
                try { tokenize(t.text); return false; } catch { return true; }
            });
            if (token) Object.assign(location, { offset: token.start, length: Math.max(1, token.end - token.start) });
        }
        return { issues: [{ message: error.message, ...location }] };
    }
}

// Compile stdin as text; never invoke the returned chunk.
export function compile(runtime, source) {
    // Lua truncates long chunk paths in errors; use a short stable label for parsing.
    const chunkName = '@LunaCheck';
    const loader = 'local f,e=load(io.read("*a"),' + JSON.stringify(chunkName) + ',"t"); if not f then io.stderr:write(e,"\\n"); os.exit(1) end';
    return new Promise((resolve, reject) => {
        const child = spawn(runtime, ['-e', loader], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Lua syntax check timed out')); }, 10000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.stdin.on('error', () => {});
        child.stderr.on('data', chunk => {
            stderr += chunk;
            if (stderr.length > 1024 * 1024) { child.kill(); clearTimeout(timer); reject(new Error('Lua check output limit exceeded')); }
        });
        child.on('close', status => {
            clearTimeout(timer);
            if (status === 0) return resolve([]);
            // Match the complete chunk path, including drive letters and colons.
            const prefix = chunkName.slice(1) + ':';
            const start = stderr.indexOf(prefix);
            const detail = start >= 0 ? /^(\d+):\s*([\s\S]*)/.exec(stderr.slice(start + prefix.length)) : null;
            if (!detail) return reject(new Error(stderr.trim() || 'Lua check failed (' + status + ')'));
            resolve([{ line: Number(detail[1]) - 1, message: detail[2].trim() + ' (translated Lua)' }]);
        });
        child.stdin.end(source.replace(/^\uFEFF/, ''));
    });
}
