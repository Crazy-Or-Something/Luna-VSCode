const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const workspace = path.join(root, 'build/vscode-workspace');
const extension = path.resolve(__dirname, '..');
const code = process.argv[2];
if (!code || !fs.existsSync(code)) throw new Error('Pass the full path to Code.exe');
fs.mkdirSync(path.join(workspace, 'profiles'), { recursive: true });
for (const file of ['default.jsonc', 'example.jsonc']) {
    fs.copyFileSync(path.join(root, '../Luna/profiles', file), path.join(workspace, 'profiles', file));
}
fs.writeFileSync(path.join(workspace, 'sample.ln'), 'ec\nstate f()\necho("hello")\nend\n');
const resultFile = path.join(workspace, 'test-result.json');
if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
const args = [
    '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--user-data-dir=' + path.join(root, 'build/vscode-test-user'),
    '--extensions-dir=' + path.join(root, 'build/vscode-test-extensions'),
    '--extensionDevelopmentPath=' + extension,
    '--extensionTestsPath=' + path.join(extension, 'test/host.cjs'),
    workspace
];
const child = spawn(code, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const log = fs.createWriteStream(path.join(root, 'build/vscode-test-host.log'));
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const timer = setTimeout(() => { child.kill(); console.error('VS Code integration test timed out'); process.exitCode = 1; }, 60000);
child.on('error', error => { clearTimeout(timer); log.end(); console.error(error.message); process.exitCode = 1; });
child.on('exit', status => {
    clearTimeout(timer); log.end();
    if (status === 0 && fs.existsSync(resultFile)) console.log(fs.readFileSync(resultFile, 'utf8'));
    else { console.error('VS Code test failed. See build/vscode-test-host.log'); process.exitCode = 1; }
});
