const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

exports.activate = async function activate(context) {
    const { readProfiles, selectProfile } = await import('./lib/profile.mjs');
    const { validateProfile } = await import('./lib/luna.mjs');
    const { completions, tokenContext, highlightTokens } = await import('./lib/language.mjs');
    const events = new vscode.EventEmitter();
    const legend = new vscode.SemanticTokensLegend(['keyword', 'function', 'macro'], []);
    const selector = { language: 'luna', scheme: 'file' };
    const diagnostics = vscode.languages.createDiagnosticCollection('luna');
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
    status.command = 'luna.selectProfile';
    const empty = { version: 1, keywords: {}, functions: {}, shortcuts: {} };

    function getState(document) {
        const resource = document?.uri ?? vscode.window.activeTextEditor?.document.uri;
        const folder = resource && vscode.workspace.getWorkspaceFolder(resource);
        const config = vscode.workspace.getConfiguration('luna', resource);
        const configured = config.get('profileFile', 'profiles/default.jsonc');
        const filename = path.isAbsolute(configured) ? configured : folder ? path.resolve(folder.uri.fsPath, configured) : null;
        if (!filename || (!fs.existsSync(filename) && configured === 'profiles/default.jsonc'))
            return { profile: empty, id: '', filename, label: 'Lua names' };
        try {
            const collection = readProfiles(filename, validateProfile);
            const selected = selectProfile(collection, config.get('profileId', '') || undefined);
            return { ...selected, collection, filename, label: selected.profile.name ?? selected.id };
        } catch (error) {
            return { profile: empty, filename, label: 'Profile error', error: error.message };
        }
    }
    function update() {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.languageId === 'luna') {
            const state = getState(active);
            status.text = '$(code) Luna: ' + state.label;
            status.tooltip = state.error ?? ('Active profile: ' + (state.id || 'canonical Lua') + '\nClick to select a profile.');
            status.show();
        } else status.hide();
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId !== 'luna') continue;
            const state = getState(document);
            if (state.error) {
                const range = new vscode.Range(0, 0, 0, Math.min(document.lineAt(0).text.length, 1));
                diagnostics.set(document.uri, [new vscode.Diagnostic(range, 'Luna profile: ' + state.error, vscode.DiagnosticSeverity.Warning)]);
            } else diagnostics.delete(document.uri);
        }
        events.fire();
    }
    let timer;
    function scheduleUpdate() { clearTimeout(timer); timer = setTimeout(update, 100); }
    context.subscriptions.push(status, diagnostics, events, { dispose: () => clearTimeout(timer) });

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
        try { collection = readProfiles(state.filename, validateProfile); }
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
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{json,jsonc}');
    context.subscriptions.push(watcher, watcher.onDidChange(scheduleUpdate), watcher.onDidCreate(scheduleUpdate), watcher.onDidDelete(scheduleUpdate),
        vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('luna')) scheduleUpdate(); }),
        vscode.workspace.onDidSaveTextDocument(document => { if (/\.(json|jsonc)$/i.test(document.fileName)) scheduleUpdate(); }),
        vscode.workspace.onDidOpenTextDocument(scheduleUpdate),
        vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
        vscode.window.onDidChangeActiveTextEditor(scheduleUpdate));
    update();
};
