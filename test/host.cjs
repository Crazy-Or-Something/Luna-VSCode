const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vscode = require('vscode');
exports.run = async function run() {
    const folder = vscode.workspace.workspaceFolders[0].uri;
    const config = vscode.workspace.getConfiguration('luna', folder);
    await config.update('profileFile', 'profiles/example.jsonc', vscode.ConfigurationTarget.WorkspaceFolder);
    await config.update('profileId', 'example', vscode.ConfigurationTarget.WorkspaceFolder);
    const extension = vscode.extensions.getExtension('crazy-or-something.luna-language');
    assert.ok(extension, 'Extension should be discovered');
    await extension.activate();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder.fsPath, 'sample.ln')));
    assert.equal(document.languageId, 'luna', '.ln language association');
    await vscode.window.showTextDocument(document);
    const items = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2));
    const labels = items.items.map(x => typeof x.label === 'string' ? x.label : x.label.label);
    for (const label of ['echo', 'state', 'hello']) assert.ok(labels.includes(label), 'Missing completion: ' + label);
    const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, new vscode.Position(1, 1));
    assert.ok(hover.length, 'Custom keyword hover');
    const inString = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(2, 9));
    assert.equal(inString.items.some(x => x.label === 'echo' && x.detail === 'echo → print'), false);
    await config.update('profileFile', 'profiles/default.jsonc', vscode.ConfigurationTarget.WorkspaceFolder);
    await config.update('profileId', 'profile1', vscode.ConfigurationTarget.WorkspaceFolder);
    const blank = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2));
    assert.equal(blank.items.some(x => x.label === 'echo'), false, 'Profile switch updates completions');
    async function replace(document, text) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
        await vscode.workspace.applyEdit(edit);
    }
    async function waitFor(predicate) {
        for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
        throw new Error('Diagnostics did not update');
    }
    await config.update('profileFile', 'profiles/example.jsonc', vscode.ConfigurationTarget.WorkspaceFolder);
    await config.update('profileId', 'example', vscode.ConfigurationTarget.WorkspaceFolder);
    await replace(document, 'local echo = 1');
    await waitFor(() => vscode.languages.getDiagnostics(document.uri).some(d => /reserved/.test(d.message)));
    assert.equal(vscode.languages.getDiagnostics(document.uri)[0].range.start.character, 6);
    const profileDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder.fsPath, 'profiles/example.jsonc')));
    const original = profileDoc.getText();
    await replace(profileDoc, '{ invalid');
    await waitFor(() => vscode.languages.getDiagnostics(profileDoc.uri).length > 0);
    await replace(profileDoc, original);
    await replace(document, 'echo("ok")');
    await waitFor(() => vscode.languages.getDiagnostics(document.uri).length === 0 && vscode.languages.getDiagnostics(profileDoc.uri).length === 0);
    await replace(document, 'state f()\nlocal =\nend');
    await vscode.window.showTextDocument(document);
    await config.update('runtimePath', '', vscode.ConfigurationTarget.WorkspaceFolder);
    const checked = await vscode.commands.executeCommand('luna.checkFile');
    assert.equal(checked.issues[0].line, 1);
    assert.equal(vscode.languages.getDiagnostics(document.uri)[0].range.start.line, 1);
    await replace(document, 'echo("ok")');
    await waitFor(() => vscode.languages.getDiagnostics(document.uri).length === 0);
    await replace(document, 'error("must not execute")');
    assert.deepEqual((await vscode.commands.executeCommand('luna.checkFile')).issues, []);
    fs.writeFileSync(path.join(folder.fsPath, 'test-result.json'), JSON.stringify({ passed: true, checks: ['activation', '.ln language', 'custom completion', 'hover', 'string context', 'profile switch', 'live conflict diagnostics', 'unsaved profile diagnostics', 'syntax check', 'diagnostics cleared after edit', 'compile without execution'] }, null, 2));
};
