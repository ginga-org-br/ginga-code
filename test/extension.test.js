const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const url = require('node:url');
const extension = require('../src/extension.js');

test('Extension exports launch functions', () => {
    assert.strictEqual(typeof extension.activate, 'function');
    assert.strictEqual(typeof extension.deactivate, 'function');
});

const packageJson = require('../package.json');

test('Extension activate registers commands', () => {
    const subscriptions = [];
    const context = { subscriptions };
    extension.activate(context);

    const contributedCommands = packageJson.contributes.commands.map(c => c.command);
    const registeredCommands = subscriptions.filter(s => s && s.name).map(s => s.name);

    for (const cmd of contributedCommands) {
        assert.ok(registeredCommands.includes(cmd));
    }

    const openPlayerSub = subscriptions.find(s => s && s.name === 'ginga.openPlayer');
    assert.ok(openPlayerSub);
    assert.strictEqual(typeof openPlayerSub.cb, 'function');
});

test('getExecutableInStorage detects binary if present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-test-'));
    try {
        assert.strictEqual(extension.getExecutableInStorage(tmpDir), undefined);

        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');

        const detected = extension.getExecutableInStorage(tmpDir);
        assert.strictEqual(detected, fakeExe);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('downloadAndExtract downloads archive directly from github and extracts it', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-dl-'));
    const zipPath = path.join(tmpDir, 'release.zip');
    const targetDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(targetDir, { recursive: true });

    const detected = await extension.downloadAndExtract(zipPath, targetDir);
    assert.strictEqual(fs.existsSync(zipPath), true);
    assert.ok(fs.statSync(zipPath).size > 0);
    const samplePath = path.join(tmpDir, 'sample.ncl');
    fs.writeFileSync(samplePath, '<ncl></ncl>');

    const context = {
        globalStorageUri: { fsPath: targetDir },
        subscriptions: []
    };

    const child = await extension.openPlayer(context, { fsPath: samplePath });
    assert.ok(child && child.pid);
    extension.stopPlayer();

    const extractedFolderUrl = url.pathToFileURL(targetDir).href;
    console.log(`Extracted folder URL: ${extractedFolderUrl}`);
});

test('resolveOrDownloadExecutable uses storage binary if already present', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-storage-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');

        const context = {
            globalStorageUri: { fsPath: tmpDir }
        };

        const resolved = await extension.resolveOrDownloadExecutable(context, 'sample.ncl');
        assert.strictEqual(resolved, fakeExe);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('openPlayer handles launch with document URI', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-open-'));
    const origSpawn = cp.spawn;
    let spawned = false;
    cp.spawn = () => {
        spawned = true;
        return {
            pid: 1234,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }

        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        const context = {
            globalStorageUri: { fsPath: tmpDir },
            subscriptions: []
        };

        const child = await extension.openPlayer(context, { fsPath: samplePath });
        assert.strictEqual(spawned, true);
        assert.ok(child && child.pid);
        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
