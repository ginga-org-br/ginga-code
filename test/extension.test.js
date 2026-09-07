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
test('getLatestVersion discovers release version or fallback', async () => {
    const version = await extension.getLatestVersion();
    assert.strictEqual(typeof version, 'string');
    assert.ok(/^[0-9.]+/.test(version));
});

test('getDownloadUrl resolves valid download url', async () => {
    const url = await extension.getDownloadUrl();
    assert.strictEqual(typeof url, 'string');
    assert.ok(url.startsWith('https://github.com/ginga-org-br/gingaf/releases/download/'));
    assert.ok(url.endsWith('.zip'));
});

test('downloadAndExtract downloads archive directly from github and extracts it', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-dl-'));
    const zipPath = path.join(tmpDir, 'release.zip');
    const targetDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(targetDir, { recursive: true });

    const downloadUrl = await extension.getDownloadUrl();
    const versionMatch = downloadUrl.match(/\/download\/v?([^/]+)\//);
    const version = versionMatch ? versionMatch[1] : await extension.getLatestVersion();
    console.log(`Downloaded version: ${version}`);

    const detected = await extension.downloadAndExtract(zipPath, targetDir, downloadUrl);
    assert.strictEqual(fs.existsSync(zipPath), true);
    assert.ok(fs.statSync(zipPath).size > 0);
    const installed = extension.getInstalledVersion(targetDir);
    assert.strictEqual(installed, version);
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

test('setInstalledVersion and getInstalledVersion persist version to storage', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-ver-'));
    try {
        assert.strictEqual(extension.getInstalledVersion(tmpDir), undefined);
        extension.setInstalledVersion(tmpDir, '0.2.0');
        assert.strictEqual(extension.getInstalledVersion(tmpDir), '0.2.0');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('isNewerVersion compares versions correctly', () => {
    assert.strictEqual(extension.isNewerVersion('0.2.0', '0.1.1'), true);
    assert.strictEqual(extension.isNewerVersion('0.2.0', '0.2.0'), false);
    assert.strictEqual(extension.isNewerVersion('0.1.0', '0.2.0'), false);
    assert.strictEqual(extension.isNewerVersion('0.2.0', undefined), true);
    assert.strictEqual(extension.isNewerVersion('0.2.0', 'unknown'), true);
});

test('checkForUpdate detects whether update is available', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-check-'));
    try {
        extension.setInstalledVersion(tmpDir, '0.0.1');
        const context = { globalStorageUri: { fsPath: tmpDir } };
        const resultOutdated = await extension.checkForUpdate(context);
        assert.strictEqual(resultOutdated.updateAvailable, true);
        assert.strictEqual(resultOutdated.installedVersion, '0.0.1');

        extension.setInstalledVersion(tmpDir, resultOutdated.latestVersion);
        const resultCurrent = await extension.checkForUpdate(context);
        assert.strictEqual(resultCurrent.updateAvailable, false);
        assert.strictEqual(resultCurrent.installedVersion, resultOutdated.latestVersion);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('downloadFile creates destination directory recursively if it does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-mkdir-'));
    try {
        const nestedDir = path.join(tmpDir, 'nested', 'storage');
        const zipPath = path.join(nestedDir, 'sample.txt');
        assert.strictEqual(fs.existsSync(nestedDir), false);
        const downloadUrl = await extension.getDownloadUrl();
        await extension.downloadFile(downloadUrl, zipPath);
        assert.strictEqual(fs.existsSync(zipPath), true);
        assert.strictEqual(fs.existsSync(nestedDir), true);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

