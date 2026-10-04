const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

exports.activate = async function activate(context) {
    const { selectProfile } = await import('./lib/profile.mjs');
    const { parseProfilesText, errorLocation, analyze, compile } = await import('./lib/diagnostics.mjs');
    const { completions, tokenContext, highlightTokens } = await import('./lib/language.mjs');
    const events = new vscode.EventEmitter();
    const legend = new vscode.SemanticTokensLegend(['keyword', 'function', 'macro'], []);
    const selector = { language: 'luna', scheme: 'file' };
    const diagnostics = vscode.languages.createDiagnosticCollection('luna');
    const output = vscode.window.createOutputChannel('Luna');
    const checks = new Map();
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
    status.command = 'luna.selectProfile';
    const empty = { version: 1, keywords: {}, functions: {}, shortcuts: {} };

    const sameFile = (left, right) => process.platform === 'win32' ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right);
    function getState(document) {
        const resource = document?.uri ?? vscode.window.activeTextEditor?.document.uri;
        const folder = resource && vscode.workspace.getWorkspaceFolder(resource);
        const config = vscode.workspace.getConfiguration('luna', resource);
        const configured = config.get('profileFile', 'profiles/default.jsonc');
        const filename = path.isAbsolute(configured) ? configured : folder ? path.resolve(folder.uri.fsPath, configured) : null;
        if (!filename || (!fs.existsSync(filename) && configured === 'profiles/default.jsonc'))
            return { profile: empty, id: '', filename, label: 'Lua names' };
        try {
            const opened = vscode.workspace.textDocuments.find(doc => sameFile(doc.fileName, filename));
            const collection = parseProfilesText(opened ? opened.getText() : fs.readFileSync(filename, 'utf8'), filename);
            const selected = selectProfile(collection, config.get('profileId', '') || undefined);
            return { ...selected, collection, filename, label: selected.profile.name ?? selected.id };
        } catch (error) {
            return { profile: empty, filename, label: 'Profile error', error: error.message };
        }
    }
    function toDiagnostic(document, issue) {
        let range;
        if (issue.offset !== undefined) {
            const start = document.positionAt(issue.offset);
            const end = document.positionAt(issue.offset + (issue.length ?? 1));
            range = new vscode.Range(start, end);
        } else {
            const line = Math.max(0, Math.min(document.lineCount - 1, issue.line ?? 0));
            const text = document.lineAt(line).text;
            const column = Math.min(text.length, issue.column ?? 0);
            range = new vscode.Range(line, column, line, issue.column === undefined ? text.length : Math.min(text.length, column + 1));
        }
        const diagnostic = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'Luna';
        return diagnostic;
    }
    function update() {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.languageId === 'luna') {
            const state = getState(active);
            status.text = '$(code) Luna: ' + state.label;
            status.tooltip = state.error ?? ('Active profile: ' + (state.id || 'canonical Lua') + '\nClick to select a profile.');
            status.show();
        } else status.hide();
        diagnostics.clear();
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId !== 'luna') continue;
            const state = getState(document);
            if (state.error) {
                diagnostics.set(document.uri, [toDiagnostic(document, { line: 0, message: 'Luna profile: ' + state.error })]);
                if (state.filename && fs.existsSync(state.filename)) {
                    const uri = vscode.Uri.file(state.filename);
                    const opened = vscode.workspace.textDocuments.find(doc => sameFile(doc.fileName, state.filename));
                    // Selection errors belong to the source; only file errors belong to the profile.
                    try { parseProfilesText(opened ? opened.getText() : fs.readFileSync(state.filename, 'utf8'), state.filename); }
                    catch (error) {
                        if (opened) diagnostics.set(uri, [toDiagnostic(opened, { message: error.message, ...errorLocation(opened.getText(), error.message) })]);
                        else diagnostics.set(uri, [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), error.message, vscode.DiagnosticSeverity.Error)]);
                    }
                }
            } else {
                const checked = checks.get(document.uri.toString());
                const issues = checked?.version === document.version ? checked.issues : analyze(document.getText(), state.profile).issues;
                diagnostics.set(document.uri, issues.map(issue => toDiagnostic(document, issue)));
            }
        }
        events.fire();
    }
    let timer;
    function scheduleUpdate() { clearTimeout(timer); timer = setTimeout(update, 100); }
    context.subscriptions.push(status, output, diagnostics, events, { dispose: () => clearTimeout(timer) });

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
        provideCompletionItems(document, position) {
            const source = document.getText();
            const location = tokenContext(source, document.offsetAt(position));
            if (location.blocked) return [];
            const state = getState(document);
            return completions(state.profile).filter(entry => location.member
                ? entry.name.startsWith(location.member + '.')
                : !entry.name.includes('.')).map(entry => {
                const name = location.member ? entry.name.slice(location.member.length + 1) : entry.name;
                const kinds = { keyword: vscode.CompletionItemKind.Keyword, function: vscode.CompletionItemKind.Function, shortcut: vscode.CompletionItemKind.Snippet, snippet: vscode.CompletionItemKind.Snippet };
                const item = new vscode.CompletionItem(name, kinds[entry.kind]);
                item.detail = entry.detail;
                item.documentation = entry.documentation;
                item.filterText = entry.filter ?? name;
                if (entry.insert) {
                    const insert = location.member ? entry.insert.slice(location.member.length + 1) : entry.insert;
                    item.insertText = new vscode.SnippetString(insert);
                }
                return item;
            });
        }
    }, '.'));
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, {
        onDidChangeSemanticTokens: events.event,
        provideDocumentSemanticTokens(document) {
            const builder = new vscode.SemanticTokensBuilder(legend);
            for (const token of highlightTokens(document.getText(), getState(document).profile)) {
                const position = document.positionAt(token.start);
                builder.push(position.line, position.character, token.text.length, legend.tokenTypes.indexOf(token.kind), 0);
            }
            return builder.build();
        }
    }, legend));
    context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position) {
            if (tokenContext(document.getText(), document.offsetAt(position)).blocked) return null;
            const range = document.getWordRangeAtPosition(position);
            if (!range) return null;
            const name = document.getText(range);
            const info = completions(getState(document).profile).find(entry => entry.name === name);
            if (!info) return null;
            const text = new vscode.MarkdownString();
            text.appendCodeblock(info.detail, 'text');
            text.appendText('\n' + info.documentation);
            return new vscode.Hover(text, range);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('luna.selectProfile', async () => {
        const document = vscode.window.activeTextEditor?.document;
        const state = getState(document);
        if (!state.filename) return vscode.window.showInformationMessage('Open a workspace folder containing your Luna profiles.');
        let collection;
        try {
            const opened = vscode.workspace.textDocuments.find(doc => sameFile(doc.fileName, state.filename));
            collection = parseProfilesText(opened ? opened.getText() : fs.readFileSync(state.filename, 'utf8'), state.filename);
        }
        catch (error) { return vscode.window.showErrorMessage('Luna: ' + error.message); }
        const choices = Object.entries(collection).map(([id, profile]) => ({
            label: profile.name ?? id, description: id, detail: profile.description ?? '', id
        }));
        const selected = await vscode.window.showQuickPick(choices, { title: 'Select Luna profile', placeHolder: state.id || 'Choose a profile' });
        if (!selected) return;
        const resource = document?.uri;
        const folder = resource && vscode.workspace.getWorkspaceFolder(resource);
        await vscode.workspace.getConfiguration('luna', resource).update('profileId', selected.id,
            folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
        update();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('luna.openProfile', async () => {
        const state = getState(vscode.window.activeTextEditor?.document);
        if (!state.filename) return vscode.window.showInformationMessage('Open a workspace folder first.');
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(state.filename));
            return vscode.window.showTextDocument(document);
        } catch (error) { return vscode.window.showErrorMessage('Luna: ' + error.message); }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('luna.checkFile', async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== 'luna') return vscode.window.showInformationMessage('Open a Luna (.ln) file first.');
        if (!vscode.workspace.isTrusted) return vscode.window.showWarningMessage('Trust this workspace before launching the Lua runtime.');
        const version = document.version;
        const state = getState(document);
        update();
        if (state.error) return;
        const result = analyze(document.getText(), state.profile);
        if (result.issues.length) return;
        const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        const configured = vscode.workspace.getConfiguration('luna', document.uri).get('runtimePath', '');
        const roots = [folder, path.resolve(context.extensionPath, '../Luna')].filter(Boolean);
        const candidates = roots.flatMap(root => ['build/Release/lua.exe', 'build/lua.exe', 'build/lua'].map(file => path.join(root, file)));
        const runtime = configured ? (path.isAbsolute(configured) ? configured : folder ? path.resolve(folder, configured) : configured) : candidates.find(file => fs.existsSync(file));
        if (!runtime) return vscode.window.showErrorMessage('Build the Lua runtime or configure luna.runtimePath to check Lua syntax.');
        try {
            const issues = await compile(runtime, result.translated, document.fileName);
            if (document.isClosed || document.version !== version || JSON.stringify(getState(document).profile) !== JSON.stringify(state.profile)) return;
            checks.set(document.uri.toString(), { version, issues });
            update();
            output.appendLine(document.fileName + ': ' + (issues.length ? issues.map(issue => issue.message).join('\n') : 'Syntax OK'));
            if (issues.length) output.show(true);
            else vscode.window.setStatusBarMessage('Luna: Syntax OK', 4000);
            return { issues };
        } catch (error) { vscode.window.showErrorMessage('Luna check: ' + error.message); return { error: error.message }; }
    }));
    function profilesChanged() { checks.clear(); scheduleUpdate(); }
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{json,jsonc}');
    context.subscriptions.push(watcher, watcher.onDidChange(profilesChanged), watcher.onDidCreate(profilesChanged), watcher.onDidDelete(profilesChanged),
        vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('luna')) { checks.clear(); scheduleUpdate(); } }),
        vscode.workspace.onDidSaveTextDocument(document => { if (/\.(json|jsonc)$/i.test(document.fileName)) scheduleUpdate(); }),
        vscode.workspace.onDidOpenTextDocument(scheduleUpdate),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (/\.(json|jsonc)$/i.test(event.document.fileName)) checks.clear();
            else checks.delete(event.document.uri.toString());
            scheduleUpdate();
        }),
        vscode.workspace.onDidCloseTextDocument(document => { checks.delete(document.uri.toString()); diagnostics.delete(document.uri); scheduleUpdate(); }),
        vscode.window.onDidChangeActiveTextEditor(scheduleUpdate));
    update();
};
