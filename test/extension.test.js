const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const url = require('node:url');
const extension = require('../src/extension.js');
const { GingaDebugSession } = require('../src/debugAdapter.js');

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
    if (process.platform === 'linux') {
        assert.ok(url.endsWith('.deb'));
    }
});

test('downloadAndExtract downloads archive directly from github and extracts it', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-dl-'));
    try {
        const pkgExt = process.platform === 'linux' ? 'deb' : 'zip';
        const pkgPath = path.join(tmpDir, `release.${pkgExt}`);
        const targetDir = path.join(tmpDir, 'extracted');
        fs.mkdirSync(targetDir, { recursive: true });

        let downloadUrl;
        try {
            downloadUrl = await extension.getDownloadUrl();
        } catch (err) {
            if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || (err.message && err.message.includes('getaddrinfo'))) {
                return;
            }
            throw err;
        }

        const versionMatch = downloadUrl.match(/\/download\/v?([^/]+)\//);
        const version = versionMatch ? versionMatch[1] : await extension.getLatestVersion();

        try {
            await extension.downloadAndExtract(pkgPath, targetDir, downloadUrl);
        } catch (err) {
            if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || (err.message && err.message.includes('getaddrinfo'))) {
                return;
            }
            throw err;
        }

        assert.strictEqual(fs.existsSync(pkgPath), true);
        assert.ok(fs.statSync(pkgPath).size > 0);
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
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
        try {
            const downloadUrl = await extension.getDownloadUrl();
            await extension.downloadFile(downloadUrl, zipPath);
            assert.strictEqual(fs.existsSync(zipPath), true);
            assert.strictEqual(fs.existsSync(nestedDir), true);
        } catch (err) {
            if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || (err.message && err.message.includes('getaddrinfo'))) {
                return;
            }
            throw err;
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('isDifferentVersion checks if installed version is different from server', () => {
    assert.strictEqual(extension.isDifferentVersion('0.3.0', '0.2.0'), true);
    assert.strictEqual(extension.isDifferentVersion('0.3.0', '0.3.0'), false);
    assert.strictEqual(extension.isDifferentVersion('v0.3.0', '0.3.0'), false);
    assert.strictEqual(extension.isDifferentVersion('0.3.0', undefined), true);
    assert.strictEqual(extension.isDifferentVersion('0.3.0', 'unknown'), true);
});

test('getDownloadUrl returns linux amd64 deb URL on linux', async () => {
    if (process.platform === 'linux' && process.arch === 'x64') {
        const downloadUrl = await extension.getDownloadUrl();
        assert.strictEqual(downloadUrl, 'https://github.com/ginga-org-br/gingaf/releases/download/v0.3.0/gingaf-v0.3.0-linux-amd64.deb');
    }
});

test('resolveOrDownloadExecutable re-downloads when installed version differs from server', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-diff-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        extension.setInstalledVersion(tmpDir, '0.0.1');

        let downloaded = false;
        const origDownloadAndExtract = extension.downloadAndExtract;
        extension.downloadAndExtract = async (packagePath, storageDir, dlUrl) => {
            downloaded = true;
            fs.writeFileSync(fakeExe, '');
            extension.setInstalledVersion(storageDir, '0.3.0');
            return fakeExe;
        };

        const context = {
            globalStorageUri: { fsPath: tmpDir }
        };

        try {
            const resolved = await extension.resolveOrDownloadExecutable(context, 'sample.ncl');
            assert.strictEqual(downloaded, true);
            assert.strictEqual(resolved, fakeExe);
        } finally {
            extension.downloadAndExtract = origDownloadAndExtract;
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('getDownloadUrl resolves latest available Windows zip release (v0.2.0)', async () => {
    const downloadUrl = await extension.getDownloadUrl('win32', 'x64');
    assert.strictEqual(downloadUrl, 'https://github.com/ginga-org-br/gingaf/releases/download/v0.2.0/gingaf-v0.2.0-windows-x64.zip');
    const version = await extension.getLatestVersion('win32', 'x64');
    assert.strictEqual(version, '0.2.0');
});

test('getDownloadUrl resolves latest available Linux deb release (v0.3.0)', async () => {
    const downloadUrl = await extension.getDownloadUrl('linux', 'x64');
    assert.strictEqual(downloadUrl, 'https://github.com/ginga-org-br/gingaf/releases/download/v0.3.0/gingaf-v0.3.0-linux-amd64.deb');
    const version = await extension.getLatestVersion('linux', 'x64');
    assert.strictEqual(version, '0.3.0');
});

test('getLatestRelease returns structured release information and uses cache', async () => {
    extension.clearReleaseCache();
    const release = await extension.getLatestRelease('win32', 'x64');
    assert.strictEqual(release.version, '0.2.0');
    assert.strictEqual(release.assetName, 'gingaf-v0.2.0-windows-x64.zip');
    assert.strictEqual(release.downloadUrl, 'https://github.com/ginga-org-br/gingaf/releases/download/v0.2.0/gingaf-v0.2.0-windows-x64.zip');

    const cached = await extension.getLatestRelease('win32', 'x64');
    assert.strictEqual(cached, release);
});

test('fetchReleaseTagsFallback dynamically retrieves tags from release feeds', async () => {
    const tags = await extension.fetchReleaseTagsFallback();
    assert.ok(Array.isArray(tags));
    assert.ok(tags.length > 0);
    assert.ok(tags.includes('0.2.0'));
});

test('fetchExpandedAssets dynamically discovers assets for given tag', async () => {
    const assets02 = await extension.fetchExpandedAssets('0.2.0');
    assert.ok(Array.isArray(assets02));
    const winZip = assets02.find(a => a.name.includes('windows'));
    assert.ok(winZip);
    assert.ok(winZip.browser_download_url.endsWith('.zip'));
});

test('ginga.stopPlayer command terminates active player process', async () => {
    const subscriptions = [];
    const context = { subscriptions };
    extension.activate(context);

    const stopCmd = subscriptions.find(s => s && s.name === 'ginga.stopPlayer');
    assert.ok(stopCmd);
    assert.strictEqual(typeof stopCmd.cb, 'function');

    const origSpawn = cp.spawn;
    let killed = false;
    cp.spawn = () => ({
        pid: 9999,
        on: () => { },
        unref: () => { },
        kill: () => { killed = true; }
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-stop-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });
        assert.ok(extension.getActivePlayerProcess());

        stopCmd.cb();
        assert.strictEqual(killed, true);
        assert.strictEqual(extension.getActivePlayerProcess(), undefined);
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('status bar item displays player status and hides on exit or stop', async () => {
    const subscriptions = [];
    const context = { subscriptions };
    extension.activate(context);

    const statusBarItem = extension.getStatusBarItem();
    assert.ok(statusBarItem);
    assert.strictEqual(statusBarItem.command, 'ginga.stopPlayer');
    assert.strictEqual(statusBarItem.tooltip, 'Ginga Player is running (click to stop)');
    assert.ok(statusBarItem.text.includes('Ginga Player'));
    assert.strictEqual(statusBarItem.visible, false);
    assert.ok(subscriptions.includes(statusBarItem));

    const origSpawn = cp.spawn;
    let exitCallback;
    let killed = false;
    cp.spawn = () => ({
        pid: 8888,
        on: (event, cb) => {
            if (event === 'exit') exitCallback = cb;
        },
        unref: () => { },
        kill: () => { killed = true; }
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-status-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });
        assert.strictEqual(statusBarItem.visible, true);

        extension.stopPlayer();
        assert.strictEqual(statusBarItem.visible, false);
        assert.strictEqual(killed, true);

        killed = false;
        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });
        assert.strictEqual(statusBarItem.visible, true);

        if (exitCallback) {
            exitCallback(0);
        }
        assert.strictEqual(statusBarItem.visible, false);

        extension.deactivate();
        assert.strictEqual(statusBarItem.visible, false);
        assert.strictEqual(extension.getStatusBarItem(), undefined);
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('player stdout and stderr are streamed to output channel', async () => {
    const subscriptions = [];
    const context = { subscriptions };
    extension.activate(context);

    const channel = extension.getOutputChannel();
    assert.ok(channel);
    channel.content = '';

    const { EventEmitter } = require('node:events');
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    mockStdout.unref = () => { };
    mockStderr.unref = () => { };

    let spawnedOptions = undefined;
    const origSpawn = cp.spawn;
    cp.spawn = (cmd, args, options) => {
        spawnedOptions = options;
        return {
            pid: 7777,
            stdout: mockStdout,
            stderr: mockStderr,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-stdout-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });

        assert.deepStrictEqual(spawnedOptions.stdio, ['pipe', 'pipe', 'pipe']);

        mockStdout.emit('data', Buffer.from('[ncldoc_cli] Executing ginga/examples/video.ncl in headless mode\n[Clock: 0.0s] NCLDocument will start\n'));
        mockStderr.emit('data', Buffer.from('[Clock: 0.0s] Node "video": sleeping->occurring\n'));

        assert.ok(channel.content.includes('[ncldoc_cli] Executing ginga/examples/video.ncl in headless mode\n'));
        assert.ok(channel.content.includes('[Clock: 0.0s] NCLDocument will start\n'));
        assert.ok(channel.content.includes('[Clock: 0.0s] Node "video": sleeping->occurring\n'));

        extension.stopPlayer();
        assert.strictEqual(mockStdout.listenerCount('data'), 0);
        assert.strictEqual(mockStderr.listenerCount('data'), 0);
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        extension.deactivate();
    }
});

test('package.json does not contribute vscode.gingafSaveBeforeRun configuration', () => {
    const config = packageJson.contributes.configuration.properties['vscode.gingafSaveBeforeRun'];
    assert.strictEqual(config, undefined);
});

test('openPlayer automatically saves dirty document before launching', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-save-'));
    const origSpawn = cp.spawn;
    const origEditor = extension.vscode.window.activeTextEditor;

    let saved = false;
    let launched = false;
    cp.spawn = () => {
        launched = true;
        return {
            pid: 5555,
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

        extension.vscode.window.activeTextEditor = {
            document: {
                fileName: samplePath,
                isDirty: true,
                save: async () => {
                    saved = true;
                    extension.vscode.window.activeTextEditor.document.isDirty = false;
                    return true;
                }
            }
        };

        const context = {
            globalStorageUri: { fsPath: tmpDir },
            subscriptions: []
        };

        await extension.openPlayer(context);
        assert.strictEqual(saved, true);
        assert.strictEqual(launched, true);
        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        extension.vscode.window.activeTextEditor = origEditor;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('parseArgs parses arrays, strings, and quoted tokens', () => {
    assert.deepStrictEqual(extension.parseArgs(['--fullscreen', '--log-level', 'debug']), ['--fullscreen', '--log-level', 'debug']);
    assert.deepStrictEqual(extension.parseArgs('--fullscreen --log-level debug'), ['--fullscreen', '--log-level', 'debug']);
    assert.deepStrictEqual(extension.parseArgs('--title "Sample App" --mode \'test-mode\''), ['--title', 'Sample App', '--mode', 'test-mode']);
    assert.deepStrictEqual(extension.parseArgs(''), []);
    assert.deepStrictEqual(extension.parseArgs([]), []);
    assert.deepStrictEqual(extension.parseArgs(null), []);
    assert.deepStrictEqual(extension.parseArgs(undefined), []);
});

test('package.json contributes vscode.gingafArgs configuration schema', () => {
    const config = packageJson.contributes.configuration.properties['vscode.gingafArgs'];
    assert.ok(config);
    assert.ok(config.type.includes('array'));
    assert.ok(config.type.includes('string'));
    assert.deepStrictEqual(config.default, []);
    assert.ok(config.description.includes('command-line arguments'));
});

test('package.json contributes ginga.restartPlayer command and editor context menus', () => {
    const restartCmd = packageJson.contributes.commands.find(c => c.command === 'ginga.restartPlayer');
    assert.ok(restartCmd);
    assert.strictEqual(restartCmd.title, 'Restart Ginga Application');
    assert.strictEqual(restartCmd.icon, '$(sync)');

    const titleMenu = packageJson.contributes.menus['editor/title'].find(m => m.command === 'ginga.restartPlayer');
    assert.strictEqual(titleMenu, undefined);

    const titleCommands = packageJson.contributes.menus['editor/title'].map(m => m.command);
    assert.deepStrictEqual(titleCommands, ['ginga.openPlayer', 'ginga.debugPlayer']);

    const contextMenu = packageJson.contributes.menus['editor/context'].find(m => m.command === 'ginga.restartPlayer');
    assert.ok(contextMenu);
    assert.ok(contextMenu.when.includes('resourceExtname == .ncl'));
});

test('extension activate registers ginga.restartPlayer command', () => {
    const subscriptions = [];
    const context = { subscriptions };
    extension.activate(context);

    const restartSub = subscriptions.find(s => s && s.name === 'ginga.restartPlayer');
    assert.ok(restartSub);
    assert.strictEqual(typeof restartSub.cb, 'function');
});

test('openPlayer passes configured vscode.gingafArgs array to cp.spawn', async () => {
    const config = extension.vscode.workspace.getConfiguration();
    config.update('vscode.gingafArgs', ['--fullscreen', '--log-level', 'debug']);

    let capturedArgs = undefined;
    const origSpawn = cp.spawn;
    cp.spawn = (cmd, args) => {
        capturedArgs = args;
        return {
            pid: 4001,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-args-arr-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });

        assert.ok(capturedArgs);
        assert.deepStrictEqual(capturedArgs, ['--fullscreen', '--log-level', 'debug', samplePath]);
        extension.stopPlayer();
    } finally {
        config.update('vscode.gingafArgs', []);
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('openPlayer passes configured vscode.gingafArgs string to cp.spawn', async () => {
    const config = extension.vscode.workspace.getConfiguration();
    config.update('vscode.gingafArgs', '--width 1280 --height 720');

    let capturedArgs = undefined;
    const origSpawn = cp.spawn;
    cp.spawn = (cmd, args) => {
        capturedArgs = args;
        return {
            pid: 4002,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-args-str-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });

        assert.ok(capturedArgs);
        assert.deepStrictEqual(capturedArgs, ['--width', '1280', '--height', '720', samplePath]);
        extension.stopPlayer();
    } finally {
        config.update('vscode.gingafArgs', []);
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('openPlayer with empty vscode.gingafArgs passes only documentPath', async () => {
    const config = extension.vscode.workspace.getConfiguration();
    config.update('vscode.gingafArgs', []);

    let capturedArgs = undefined;
    const origSpawn = cp.spawn;
    cp.spawn = (cmd, args) => {
        capturedArgs = args;
        return {
            pid: 4003,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-args-empty-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });

        assert.deepStrictEqual(capturedArgs, [samplePath]);
        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('restartPlayer terminates running process and launches a new player instance', async () => {
    const origSpawn = cp.spawn;
    let killedPids = [];
    let spawnedCount = 0;

    cp.spawn = () => {
        const pid = 6000 + spawnedCount++;
        return {
            pid,
            on: () => { },
            unref: () => { },
            kill: () => { killedPids.push(pid); }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-restart-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        const context = { globalStorageUri: { fsPath: tmpDir }, subscriptions: [] };

        await extension.openPlayer(context, { fsPath: samplePath });
        const firstProcess = extension.getActivePlayerProcess();
        assert.ok(firstProcess);
        assert.strictEqual(firstProcess.pid, 6000);

        await extension.restartPlayer(context, { fsPath: samplePath });
        const secondProcess = extension.getActivePlayerProcess();
        assert.ok(secondProcess);
        assert.strictEqual(secondProcess.pid, 6001);
        assert.deepStrictEqual(killedPids, [6000]);

        extension.stopPlayer();
        assert.deepStrictEqual(killedPids, [6000, 6001]);
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('restartPlayer launches player directly when no process is running', async () => {
    const origSpawn = cp.spawn;
    let launched = false;
    cp.spawn = () => {
        launched = true;
        return {
            pid: 7001,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-restart-direct-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        const context = { globalStorageUri: { fsPath: tmpDir }, subscriptions: [] };
        assert.strictEqual(extension.getActivePlayerProcess(), undefined);

        await extension.restartPlayer(context, { fsPath: samplePath });
        assert.strictEqual(launched, true);
        assert.ok(extension.getActivePlayerProcess());

        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('restartPlayer saves dirty active document before relaunching', async () => {
    const origSpawn = cp.spawn;
    const origEditor = extension.vscode.window.activeTextEditor;
    let saved = false;

    cp.spawn = () => ({
        pid: 8001,
        on: () => { },
        unref: () => { },
        kill: () => { }
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-restart-save-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        extension.vscode.window.activeTextEditor = {
            document: {
                fileName: samplePath,
                isDirty: true,
                save: async () => {
                    saved = true;
                    extension.vscode.window.activeTextEditor.document.isDirty = false;
                    return true;
                }
            }
        };

        const context = { globalStorageUri: { fsPath: tmpDir }, subscriptions: [] };
        await extension.restartPlayer(context);

        assert.strictEqual(saved, true);
        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        extension.vscode.window.activeTextEditor = origEditor;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('package.json contributes dedicated ncl language and configuration', () => {
    const nclLang = packageJson.contributes.languages.find(l => l.id === 'ncl');
    assert.ok(nclLang);
    assert.deepStrictEqual(nclLang.extensions, ['.ncl']);
    assert.ok(nclLang.aliases.includes('NCL'));
    assert.strictEqual(nclLang.configuration, './languages/ncl-language-configuration.json');

    const configPath = path.join(__dirname, '..', nclLang.configuration);
    assert.ok(fs.existsSync(configPath));
    const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepStrictEqual(configContent.comments.blockComment, ['<!--', '-->']);
    assert.ok(configContent.brackets.some(b => b[0] === '<' && b[1] === '>'));
});

test('package.json contributes ginga debugger and snippets', () => {
    const debuggerEntry = packageJson.contributes.debuggers.find(d => d.type === 'ginga');
    assert.ok(debuggerEntry);
    assert.strictEqual(debuggerEntry.label, 'Ginga Debug');
    assert.ok(debuggerEntry.languages.includes('ncl'));
    assert.ok(debuggerEntry.configurationSnippets.length > 0);
    assert.strictEqual(debuggerEntry.configurationAttributes.launch.required[0], 'program');
});

test('package.json contributes breakpoints for ncl, xml, html, and lua', () => {
    assert.ok(Array.isArray(packageJson.contributes.breakpoints));
    const languages = packageJson.contributes.breakpoints.map(b => b.language);
    assert.ok(languages.includes('ncl'));
    assert.ok(languages.includes('xml'));
    assert.ok(languages.includes('html'));
    assert.ok(languages.includes('lua'));
});

test('package.json contributes ginga.debugPlayer command and editor menus', () => {
    const debugCmd = packageJson.contributes.commands.find(c => c.command === 'ginga.debugPlayer');
    assert.ok(debugCmd);
    assert.strictEqual(debugCmd.title, 'Debug Ginga Application');
    assert.strictEqual(debugCmd.icon, '$(debug-alt)');

    const titleMenu = packageJson.contributes.menus['editor/title'].find(m => m.command === 'ginga.debugPlayer');
    assert.ok(titleMenu);
    assert.ok(titleMenu.when.includes('editorLangId == ncl'));

    const contextMenu = packageJson.contributes.menus['editor/context'].find(m => m.command === 'ginga.debugPlayer');
    assert.ok(contextMenu);
    assert.ok(contextMenu.when.includes('editorLangId == ncl'));
});

test('extension activate registers ginga.debugPlayer command and debug providers', () => {
    const subscriptions = [];
    const context = { subscriptions };
    extension.activate(context);

    const debugSub = subscriptions.find(s => s && s.name === 'ginga.debugPlayer');
    assert.ok(debugSub);
    assert.strictEqual(typeof debugSub.cb, 'function');

    const providerSub = subscriptions.find(s => s && s.type === 'ginga' && s.provider);
    assert.ok(providerSub);

    const factorySub = subscriptions.find(s => s && s.type === 'ginga' && s.factory);
    assert.ok(factorySub);
});

test('isGingaApplication recognizes NCL, XML, and HTML applications', () => {
    assert.strictEqual(extension.isGingaApplication({ languageId: 'ncl', fileName: 'sample.ncl' }), true);
    assert.strictEqual(extension.isGingaApplication({ languageId: 'xml', fileName: 'test.ncl' }), true);
    assert.strictEqual(extension.isGingaApplication({ languageId: 'html', fileName: 'index.html' }), true);
    assert.strictEqual(extension.isGingaApplication({ languageId: 'plaintext', fileName: 'app.ncl' }), true);
    assert.strictEqual(extension.isGingaApplication({ languageId: 'javascript', fileName: 'app.js' }), false);
    assert.strictEqual(extension.isGingaApplication(null), false);
    assert.strictEqual(extension.isGingaApplication(undefined), false);
    assert.strictEqual(extension.isGingaDocument({ languageId: 'ncl', fileName: 'sample.ncl' }), true);
});

test('GingaConfigurationProvider resolves default debug configuration and provides initial configurations', () => {
    const provider = new extension.GingaConfigurationProvider();
    const provided = provider.provideDebugConfigurations(undefined);
    assert.ok(Array.isArray(provided));
    assert.strictEqual(provided[0].type, 'ginga');
    assert.strictEqual(provided[0].request, 'launch');
    assert.strictEqual(provided[0].program, '${file}');

    const config = provider.resolveDebugConfiguration(undefined, {});
    assert.strictEqual(config.type, 'ginga');
    assert.strictEqual(config.name, 'Debug Ginga Application');
    assert.strictEqual(config.request, 'launch');
    assert.ok(config.program);

    const substituted = provider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
        type: 'ginga',
        request: 'launch',
        name: 'Debug Ginga Application',
        program: '${file}'
    });
    assert.strictEqual(substituted.type, 'ginga');
    assert.ok(substituted.program);
});

test('GingaDebugAdapterDescriptorFactory creates DebugAdapterInlineImplementation descriptor', () => {
    const factory = new extension.GingaDebugAdapterDescriptorFactory();
    const descriptor = factory.createDebugAdapterDescriptor();
    assert.ok(descriptor instanceof extension.vscode.DebugAdapterInlineImplementation);
    assert.ok(descriptor.session instanceof extension.GingaDebugSession);
    assert.ok(descriptor.adapter instanceof extension.GingaDebugAdapter);

    const received = [];
    descriptor.adapter.onDidSendMessage((msg) => {
        received.push(msg);
    });

    descriptor.adapter.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].command, 'initialize');
    assert.strictEqual(received[0].success, true);
    descriptor.adapter.dispose();
});


test('GingaDebugSession handles initialize, launch, and reports capabilities', () => {
    const session = new extension.GingaDebugSession();
    const initResp = session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    assert.strictEqual(initResp.success, true);
    assert.strictEqual(initResp.body.supportsConfigurationDoneRequest, true);

    const events = [];
    session.on('message', m => { if (m.type === 'event') events.push(m); });

    const launchResp = session.handleMessage({
        seq: 2,
        command: 'launch',
        arguments: { program: '/test/main.ncl' }
    });
    assert.strictEqual(launchResp.success, true);
    assert.strictEqual(session.isRunning, true);
    assert.strictEqual(session.currentFile, '/test/main.ncl');
    assert.ok(events.some(e => e.event === 'initialized'));
});

test('GingaDebugSession plays and pauses at breakpoints in NCL XML', () => {
    const session = new extension.GingaDebugSession();
    const events = [];
    session.on('message', m => { if (m.type === 'event') events.push(m); });

    session.handleMessage({
        seq: 1,
        command: 'launch',
        arguments: { program: '/test/main.ncl' }
    });

    const bpResp = session.handleMessage({
        seq: 2,
        command: 'setBreakpoints',
        arguments: {
            source: { path: '/test/main.ncl' },
            breakpoints: [{ line: 12 }, { line: 28 }]
        }
    });
    assert.strictEqual(bpResp.success, true);
    assert.strictEqual(bpResp.body.breakpoints.length, 2);
    assert.strictEqual(bpResp.body.breakpoints[0].verified, true);

    session.handleMessage({ seq: 3, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 12);
    assert.ok(events.some(e => e.event === 'stopped' && e.body.reason === 'breakpoint'));

    events.length = 0;
    session.handleMessage({ seq: 4, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 28);
    assert.ok(events.some(e => e.event === 'stopped' && e.body.reason === 'breakpoint'));

    events.length = 0;
    session.handleMessage({ seq: 5, command: 'continue', arguments: {} });
    assert.ok(events.some(e => e.event === 'terminated'));
});

test('GingaDebugSession handles stepping and inspecting frames and variables', () => {
    const session = new extension.GingaDebugSession();
    session.handleMessage({
        seq: 1,
        command: 'launch',
        arguments: { program: '/test/main.ncl' }
    });

    const stepResp = session.handleMessage({ seq: 2, command: 'next', arguments: {} });
    assert.strictEqual(stepResp.success, true);
    assert.strictEqual(session.currentLine, 2);

    const traceResp = session.handleMessage({ seq: 3, command: 'stackTrace', arguments: {} });
    assert.strictEqual(traceResp.success, true);
    assert.strictEqual(traceResp.body.stackFrames[0].line, 2);

    const scopesResp = session.handleMessage({ seq: 4, command: 'scopes', arguments: {} });
    assert.strictEqual(scopesResp.success, true);
    assert.strictEqual(scopesResp.body.scopes.length, 1);
    assert.strictEqual(scopesResp.body.scopes[0].name, 'Active NCL Context');

    const varsResp = session.handleMessage({
        seq: 5,
        command: 'variables',
        arguments: { variablesReference: 1000 }
    });
    assert.strictEqual(varsResp.success, true);
    const varNames = varsResp.body.variables.map(v => v.name);
    assert.ok(varNames.includes('activeContext'));
    assert.ok(varNames.includes('currentLine'));
});

test('debugPlayer saves dirty active document and starts VS Code debugging mode', async () => {
    let debugStarted = false;
    let capturedConfig = undefined;
    const origStartDebugging = extension.vscode.debug.startDebugging;
    const origEditor = extension.vscode.window.activeTextEditor;

    extension.vscode.debug.startDebugging = async (folder, config) => {
        debugStarted = true;
        capturedConfig = config;
        return true;
    };

    let saved = false;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-debug-'));
    try {
        const samplePath = path.join(tmpDir, 'debug.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        extension.vscode.window.activeTextEditor = {
            document: {
                fileName: samplePath,
                isDirty: true,
                save: async () => {
                    saved = true;
                    extension.vscode.window.activeTextEditor.document.isDirty = false;
                    return true;
                }
            }
        };

        const config = extension.vscode.workspace.getConfiguration();
        config.update('vscode.gingafArgs', ['--log-level', 'trace']);

        await extension.debugPlayer({});

        assert.strictEqual(saved, true);
        assert.strictEqual(debugStarted, true);
        assert.strictEqual(capturedConfig.type, 'ginga');
        assert.strictEqual(capturedConfig.name, 'Debug Ginga Application');
        assert.strictEqual(capturedConfig.program, samplePath);
        assert.deepStrictEqual(capturedConfig.gingafArgs, ['--log-level', 'trace']);
    } finally {
        extension.vscode.debug.startDebugging = origStartDebugging;
        extension.vscode.window.activeTextEditor = origEditor;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('package.json contributes explorer/context menu items for Ginga files', () => {
    const explorerMenus = packageJson.contributes.menus['explorer/context'];
    assert.ok(explorerMenus);

    const commands = ['ginga.openPlayer', 'ginga.stopPlayer', 'ginga.restartPlayer', 'ginga.debugPlayer'];
    for (const cmd of commands) {
        const item = explorerMenus.find(m => m.command === cmd);
        assert.ok(item);
        assert.ok(item.when.includes('resourceExtname == .ncl'));
        assert.ok(item.when.includes('resourceExtname == .html'));
    }
});

test('package.json contributes default keybindings for player execution and debugging', () => {
    const keybindings = packageJson.contributes.keybindings;
    assert.ok(keybindings);

    const openKb = keybindings.find(k => k.command === 'ginga.openPlayer');
    assert.ok(openKb);
    assert.strictEqual(openKb.key, 'ctrl+f5');
    assert.strictEqual(openKb.mac, 'cmd+f5');

    const stopKb = keybindings.find(k => k.command === 'ginga.stopPlayer');
    assert.ok(stopKb);
    assert.strictEqual(stopKb.key, 'shift+f5');

    const restartKb = keybindings.find(k => k.command === 'ginga.restartPlayer');
    assert.ok(restartKb);
    assert.strictEqual(restartKb.key, 'ctrl+shift+f5');
    assert.strictEqual(restartKb.mac, 'cmd+shift+f5');

    const debugKb = keybindings.find(k => k.command === 'ginga.debugPlayer');
    assert.ok(debugKb);
    assert.strictEqual(debugKb.key, 'f5');
});

test('openPlayer, debugPlayer, and restartPlayer accept targetUri from explorer context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-explorer-'));
    const origSpawn = cp.spawn;
    const origStartDebugging = extension.vscode.debug.startDebugging;

    let spawnedWith = undefined;
    cp.spawn = (cmd, args) => {
        spawnedWith = args;
        return {
            pid: 9901,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    let debuggedProgram = undefined;
    extension.vscode.debug.startDebugging = async (folder, config) => {
        debuggedProgram = config.program;
        return true;
    };

    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const explorerFile = path.join(tmpDir, 'explorer_test.ncl');
        fs.writeFileSync(explorerFile, '<ncl></ncl>');

        const targetUri = { fsPath: explorerFile };
        const context = { globalStorageUri: { fsPath: tmpDir }, subscriptions: [] };

        await extension.openPlayer(context, targetUri);
        assert.ok(spawnedWith);
        assert.strictEqual(spawnedWith[spawnedWith.length - 1], explorerFile);
        extension.stopPlayer();

        await extension.restartPlayer(context, targetUri);
        assert.ok(spawnedWith);
        assert.strictEqual(spawnedWith[spawnedWith.length - 1], explorerFile);
        extension.stopPlayer();

        await extension.debugPlayer(context, targetUri);
        assert.strictEqual(debuggedProgram, explorerFile);
    } finally {
        cp.spawn = origSpawn;
        extension.vscode.debug.startDebugging = origStartDebugging;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('package.json contributes vscode.gingafWorkingDirectory configuration schema', () => {
    const props = packageJson.contributes.configuration.properties;
    assert.ok(props['vscode.gingafWorkingDirectory']);
    assert.strictEqual(props['vscode.gingafWorkingDirectory'].type, 'string');
    assert.deepStrictEqual(props['vscode.gingafWorkingDirectory'].enum, ['appDirectory', 'workspaceRoot']);
    assert.strictEqual(props['vscode.gingafWorkingDirectory'].default, 'appDirectory');
});

test('openPlayer logs process exit code and duration on clean termination', async () => {
    const channel = extension.getOutputChannel();
    channel.content = '';

    const origSpawn = cp.spawn;
    let exitHandler = undefined;
    cp.spawn = () => ({
        pid: 7701,
        on: (event, cb) => {
            if (event === 'exit') exitHandler = cb;
        },
        unref: () => { },
        kill: () => { }
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-exit-log-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });
        assert.ok(exitHandler);

        exitHandler(0, null);
        assert.ok(channel.content.includes('[Ginga Player] Process exited with code 0'));
        assert.ok(channel.content.includes('(duration:'));
        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('openPlayer logs termination signal and surfaces warning on non-zero exit code', async () => {
    const channel = extension.getOutputChannel();
    channel.content = '';

    let warningShown = undefined;
    const origWarn = extension.vscode.window.showWarningMessage;
    extension.vscode.window.showWarningMessage = (msg) => { warningShown = msg; };

    const origSpawn = cp.spawn;
    let exitHandler = undefined;
    cp.spawn = () => ({
        pid: 7702,
        on: (event, cb) => {
            if (event === 'exit') exitHandler = cb;
        },
        unref: () => { },
        kill: () => { }
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-exit-err-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });
        assert.ok(exitHandler);

        exitHandler(1, null);
        assert.ok(channel.content.includes('[Ginga Player] Process exited with code 1'));
        assert.strictEqual(warningShown, 'Ginga player process exited with code 1.');

        exitHandler(null, 'SIGTERM');
        assert.ok(channel.content.includes('[Ginga Player] Process terminated by signal SIGTERM'));
        extension.stopPlayer();
    } finally {
        extension.vscode.window.showWarningMessage = origWarn;
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('openPlayer respects vscode.gingafWorkingDirectory configuration options', async () => {
    const config = extension.vscode.workspace.getConfiguration();
    const origSpawn = cp.spawn;
    let capturedOptions = undefined;

    cp.spawn = (cmd, args, options) => {
        capturedOptions = options;
        return {
            pid: 7703,
            on: () => { },
            unref: () => { },
            kill: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-cwd-'));
    const docDir = path.join(tmpDir, 'apps');
    fs.mkdirSync(docDir, { recursive: true });

    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(docDir, 'main.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');
        const context = { globalStorageUri: { fsPath: tmpDir }, subscriptions: [] };

        config.update('vscode.gingafWorkingDirectory', 'appDirectory');
        await extension.openPlayer(context, { fsPath: samplePath });
        assert.strictEqual(capturedOptions.cwd, docDir);
        extension.stopPlayer();

        config.update('vscode.gingafWorkingDirectory', 'workspaceRoot');
        const mockWorkspaceFolder = path.join(tmpDir, 'mock-root');
        fs.mkdirSync(mockWorkspaceFolder, { recursive: true });
        extension.vscode.workspace.workspaceFolders = [{ uri: { fsPath: mockWorkspaceFolder } }];

        await extension.openPlayer(context, { fsPath: samplePath });
        assert.strictEqual(capturedOptions.cwd, mockWorkspaceFolder);
        extension.stopPlayer();

        extension.vscode.workspace.workspaceFolders = undefined;
        await extension.openPlayer(context, { fsPath: samplePath });
        assert.strictEqual(capturedOptions.cwd, docDir);
        extension.stopPlayer();
    } finally {
        config.update('vscode.gingafWorkingDirectory', 'appDirectory');
        extension.vscode.workspace.workspaceFolders = undefined;
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('GingaDebugSession with video.ncl: pauses at initial breakpoint and introspects video element', async () => {
    const videoNclPath = path.join(__dirname, '..', 'examples', 'video.ncl');
    assert.ok(fs.existsSync(videoNclPath));

    const session = new GingaDebugSession();
    const events = [];
    session.on('message', (msg) => {
        if (msg.type === 'event') events.push(msg);
    });

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: videoNclPath } });

    const setBpResp = session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: videoNclPath },
            breakpoints: [{ line: 4 }, { line: 7 }, { line: 16 }]
        }
    });

    assert.strictEqual(setBpResp.success, true);
    assert.strictEqual(setBpResp.body.breakpoints.length, 3);
    assert.strictEqual(setBpResp.body.breakpoints[0].verified, true);
    assert.strictEqual(setBpResp.body.breakpoints[0].line, 4);

    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });

    assert.strictEqual(session.currentLine, 4);
    const stoppedEvent = events.find(e => e.event === 'stopped' && e.body.reason === 'breakpoint');
    assert.ok(stoppedEvent);

    const stackResp = session.handleMessage({ seq: 5, command: 'stackTrace', arguments: {} });
    assert.strictEqual(stackResp.success, true);
    const frames = stackResp.body.stackFrames;
    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].line, 4);
    assert.ok(frames[0].name.includes('video'));

    const scopesResp = session.handleMessage({ seq: 6, command: 'scopes', arguments: { frameId: 1 } });
    assert.strictEqual(scopesResp.success, true);
    assert.strictEqual(scopesResp.body.scopes.length, 1);
    assert.strictEqual(scopesResp.body.scopes[0].name, 'Active NCL Context');

    const varsResp = session.handleMessage({ seq: 7, command: 'variables', arguments: { variablesReference: 1000 } });
    assert.strictEqual(varsResp.success, true);
    const vars = varsResp.body.variables;
    assert.ok(vars.some(v => v.name === 'elementId' && v.value === 'video'));
    assert.ok(vars.some(v => v.name === 'elementTag' && v.value === 'media'));
    assert.ok(vars.some(v => v.name === 'currentCode' && v.value.includes('butterfly.mp4')));
    assert.ok(vars.some(v => v.name === 'state' && v.value === 'PAUSED'));
});

test('GingaDebugSession with video.ncl: continue advances execution sequentially through breakpoints', () => {
    const videoNclPath = path.join(__dirname, '..', 'examples', 'video.ncl');
    const session = new GingaDebugSession();
    const stoppedLines = [];

    session.on('message', (msg) => {
        if (msg.type === 'event' && msg.event === 'stopped') {
            stoppedLines.push(session.currentLine);
        }
    });

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: videoNclPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: videoNclPath },
            breakpoints: [{ line: 4 }, { line: 7 }, { line: 16 }]
        }
    });

    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 4);

    const contResp1 = session.handleMessage({ seq: 5, command: 'continue', arguments: {} });
    assert.strictEqual(contResp1.success, true);
    assert.strictEqual(session.currentLine, 7);

    const varsResp1 = session.handleMessage({ seq: 6, command: 'variables', arguments: { variablesReference: 1000 } });
    assert.ok(varsResp1.body.variables.some(v => v.name === 'elementId' && v.value === 'green_bg'));

    const contResp2 = session.handleMessage({ seq: 7, command: 'continue', arguments: {} });
    assert.strictEqual(contResp2.success, true);
    assert.strictEqual(session.currentLine, 16);

    const stackResp2 = session.handleMessage({ seq: 8, command: 'stackTrace', arguments: {} });
    assert.ok(stackResp2.body.stackFrames[0].name.includes('l1'));

    let terminated = false;
    session.on('message', (msg) => {
        if (msg.type === 'event' && msg.event === 'terminated') terminated = true;
    });

    const contResp3 = session.handleMessage({ seq: 9, command: 'continue', arguments: {} });
    assert.strictEqual(contResp3.success, true);
    assert.strictEqual(terminated, true);
    assert.deepStrictEqual(stoppedLines, [4, 7, 16]);
});

test('GingaDebugSession with video.ncl: step over (next) and step in across lines', () => {
    const videoNclPath = path.join(__dirname, '..', 'examples', 'video.ncl');
    const session = new GingaDebugSession();

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: videoNclPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: videoNclPath },
            breakpoints: [{ line: 4 }]
        }
    });
    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 4);

    let lastStoppedReason = undefined;
    session.on('message', (msg) => {
        if (msg.type === 'event' && msg.event === 'stopped') {
            lastStoppedReason = msg.body.reason;
        }
    });

    const nextResp = session.handleMessage({ seq: 5, command: 'next', arguments: {} });
    assert.strictEqual(nextResp.success, true);
    assert.strictEqual(session.currentLine, 5);
    assert.strictEqual(lastStoppedReason, 'step');

    const stepInResp = session.handleMessage({ seq: 6, command: 'stepIn', arguments: {} });
    assert.strictEqual(stepInResp.success, true);
    assert.strictEqual(session.currentLine, 6);
    assert.strictEqual(lastStoppedReason, 'step');

    const stepOutResp = session.handleMessage({ seq: 7, command: 'stepOut', arguments: {} });
    assert.strictEqual(stepOutResp.success, true);
    assert.strictEqual(session.currentLine, 8);
});

test('GingaDebugSession with video.ncl: restart, evaluate expressions, and source retrieval', () => {
    const videoNclPath = path.join(__dirname, '..', 'examples', 'video.ncl');
    const session = new GingaDebugSession();

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: videoNclPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: videoNclPath },
            breakpoints: [{ line: 7 }]
        }
    });
    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 7);

    session.handleMessage({ seq: 5, command: 'next', arguments: {} });
    assert.strictEqual(session.currentLine, 8);

    const restartResp = session.handleMessage({ seq: 6, command: 'restart', arguments: {} });
    assert.strictEqual(restartResp.success, true);
    assert.strictEqual(session.currentLine, 7);

    const evalVideo = session.handleMessage({ seq: 7, command: 'evaluate', arguments: { expression: 'video' } });
    assert.strictEqual(evalVideo.success, true);
    assert.ok(evalVideo.body.result.includes('butterfly.mp4'));

    const evalCtx = session.handleMessage({ seq: 8, command: 'evaluate', arguments: { expression: 'activeContext' } });
    assert.strictEqual(evalCtx.body.result, 'body');

    const evalState = session.handleMessage({ seq: 9, command: 'evaluate', arguments: { expression: 'state' } });
    assert.strictEqual(evalState.body.result, 'PAUSED');

    const evalCustom = session.handleMessage({ seq: 10, command: 'evaluate', arguments: { expression: 'green_bg' } });
    assert.strictEqual(evalCustom.body.result, '"green_bg"');

    const sourceResp = session.handleMessage({ seq: 11, command: 'source', arguments: { source: { path: videoNclPath } } });
    assert.strictEqual(sourceResp.success, true);
    assert.ok(sourceResp.body.content.includes('<port id="init" component="video"/>'));

    const excResp = session.handleMessage({ seq: 12, command: 'setExceptionBreakpoints', arguments: {} });
    assert.strictEqual(excResp.success, true);

    const pauseResp = session.handleMessage({ seq: 13, command: 'pause', arguments: {} });
    assert.strictEqual(pauseResp.success, true);

    const unsuppResp = session.handleMessage({ seq: 14, command: 'unknownCustomCommand', arguments: {} });
    assert.strictEqual(unsuppResp.success, false);
    assert.ok(unsuppResp.message.includes('Unsupported DAP command'));

    const discResp = session.handleMessage({ seq: 15, command: 'disconnect', arguments: {} });
    assert.strictEqual(discResp.success, true);
    assert.strictEqual(session.isRunning, false);
});

test('GingaDebugSession: handles unsorted breakpoints and clearing breakpoints dynamically', () => {
    const session = new GingaDebugSession();
    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: '/test/video.ncl' } });

    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: '/test/video.ncl' },
            breakpoints: [{ line: 20 }, { line: 5 }, { line: 12 }]
        }
    });

    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 5);

    session.handleMessage({ seq: 5, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 12);

    session.handleMessage({
        seq: 6,
        command: 'setBreakpoints',
        arguments: {
            source: { path: '/test/video.ncl' },
            breakpoints: []
        }
    });

    let terminated = false;
    session.on('message', (msg) => {
        if (msg.type === 'event' && msg.event === 'terminated') terminated = true;
    });

    session.handleMessage({ seq: 7, command: 'continue', arguments: {} });
    assert.strictEqual(terminated, true);
});

test('GingaDebugSession: inspects active scopes and thread information', () => {
    const session = new GingaDebugSession();
    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: '/test/app.ncl' } });

    const threadsResp = session.handleMessage({ seq: 3, command: 'threads', arguments: {} });
    assert.strictEqual(threadsResp.success, true);
    assert.strictEqual(threadsResp.body.threads.length, 1);
    assert.strictEqual(threadsResp.body.threads[0].name, 'Ginga Presentation Engine');

    const scopesResp = session.handleMessage({ seq: 4, command: 'scopes', arguments: {} });
    assert.strictEqual(scopesResp.success, true);
    assert.strictEqual(scopesResp.body.scopes.length, 1);
    assert.strictEqual(scopesResp.body.scopes[0].name, 'Active NCL Context');
});

test('GingaDebugSession: handles non-existent source file gracefully', () => {
    const session = new GingaDebugSession();
    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: '/nonexistent/dummy.ncl' } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: '/nonexistent/dummy.ncl' },
            breakpoints: [{ line: 2 }]
        }
    });
    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 2);

    const stackResp = session.handleMessage({ seq: 5, command: 'stackTrace', arguments: {} });
    assert.strictEqual(stackResp.success, true);
    assert.strictEqual(stackResp.body.stackFrames[0].line, 2);

    const sourceResp = session.handleMessage({ seq: 6, command: 'source', arguments: { source: { path: '/nonexistent/dummy.ncl' } } });
    assert.strictEqual(sourceResp.success, true);
    assert.strictEqual(sourceResp.body.content, '');
});

test('GingaConfigurationProvider resolves custom and partial debug configurations', () => {
    const provider = new extension.GingaConfigurationProvider();

    const emptyResolved = provider.resolveDebugConfiguration(undefined, {});
    assert.strictEqual(emptyResolved.type, 'ginga');
    assert.strictEqual(emptyResolved.request, 'launch');
    assert.strictEqual(emptyResolved.name, 'Debug Ginga Application');

    const customConfig = {
        type: 'ginga',
        request: 'attach',
        name: 'Attach to Ginga Engine',
        program: 'main.ncl'
    };
    const preserved = provider.resolveDebugConfiguration(undefined, customConfig);
    assert.strictEqual(preserved.request, 'attach');
    assert.strictEqual(preserved.name, 'Attach to Ginga Engine');
    assert.strictEqual(preserved.program, 'main.ncl');
});

test('parseArgs handles complex quote combinations, empty arguments, and escaped values', () => {
    assert.deepStrictEqual(extension.parseArgs(''), []);
    assert.deepStrictEqual(extension.parseArgs(null), []);
    assert.deepStrictEqual(extension.parseArgs(undefined), []);
    assert.deepStrictEqual(extension.parseArgs(['--a', '', '--b']), ['--a', '--b']);
    assert.deepStrictEqual(extension.parseArgs('   --foo   "bar baz"   \'1 2 3\'  '), ['--foo', 'bar baz', '1 2 3']);
    assert.deepStrictEqual(extension.parseArgs('"unterminated quote'), ['unterminated', 'quote']);
});

test('stopPlayer behaves safely when called repeatedly or without active player process', () => {
    assert.doesNotThrow(() => {
        extension.stopPlayer();
        extension.stopPlayer();
    });
});

test('GingaDebugSession with primeiro_joao/00syncProp.ncl: pauses at initial breakpoint on entry port and introspects animation media', () => {
    const joaoPath = path.join(__dirname, '..', 'examples', 'primeiro_joao', '00syncProp.ncl');
    assert.ok(fs.existsSync(joaoPath));

    const session = new GingaDebugSession();
    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: joaoPath } });

    const bpResp = session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: joaoPath },
            breakpoints: [{ line: 20 }, { line: 21 }, { line: 25 }, { line: 28 }]
        }
    });
    assert.strictEqual(bpResp.success, true);
    assert.strictEqual(bpResp.body.breakpoints.length, 4);

    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 20);

    const stackResp = session.handleMessage({ seq: 5, command: 'stackTrace', arguments: {} });
    assert.strictEqual(stackResp.success, true);
    assert.ok(stackResp.body.stackFrames[0].name.includes('entry'));

    const varsResp = session.handleMessage({ seq: 6, command: 'variables', arguments: { variablesReference: 1000 } });
    assert.strictEqual(varsResp.success, true);
    const vars = varsResp.body.variables;
    assert.ok(vars.some(v => v.name === 'elementId' && v.value === 'entry'));
    assert.ok(vars.some(v => v.name === 'elementTag' && v.value === 'port'));

    session.handleMessage({ seq: 7, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 21);

    const animVarsResp = session.handleMessage({ seq: 8, command: 'variables', arguments: { variablesReference: 1000 } });
    const animVars = animVarsResp.body.variables;
    assert.ok(animVars.some(v => v.name === 'elementId' && v.value === 'animation'));
    assert.ok(animVars.some(v => v.name === 'currentCode' && v.value.includes('animGar.mp4')));
});

test('GingaDebugSession with primeiro_joao/00syncProp.ncl: stepping and continuing through media and link synchronization', () => {
    const joaoPath = path.join(__dirname, '..', 'examples', 'primeiro_joao', '00syncProp.ncl');
    const session = new GingaDebugSession();

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: joaoPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: joaoPath },
            breakpoints: [{ line: 21 }, { line: 25 }, { line: 28 }]
        }
    });
    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 21);

    session.handleMessage({ seq: 5, command: 'stepIn', arguments: {} });
    assert.strictEqual(session.currentLine, 22);

    const stepVarsResp = session.handleMessage({ seq: 6, command: 'variables', arguments: { variablesReference: 1000 } });
    assert.ok(stepVarsResp.body.variables.some(v => v.name === 'elementId' && v.value === 'segDrible'));

    session.handleMessage({ seq: 7, command: 'next', arguments: {} });
    assert.strictEqual(session.currentLine, 23);

    session.handleMessage({ seq: 8, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 25);

    const choroStack = session.handleMessage({ seq: 9, command: 'stackTrace', arguments: {} });
    assert.ok(choroStack.body.stackFrames[0].name.includes('choro'));

    session.handleMessage({ seq: 10, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 28);

    const musicStack = session.handleMessage({ seq: 11, command: 'stackTrace', arguments: {} });
    assert.ok(musicStack.body.stackFrames[0].name.includes('lMusic'));

    const evalState = session.handleMessage({ seq: 12, command: 'evaluate', arguments: { expression: 'state' } });
    assert.strictEqual(evalState.body.result, 'PAUSED');

    let terminated = false;
    session.on('message', (msg) => {
        if (msg.type === 'event' && msg.event === 'terminated') terminated = true;
    });

    session.handleMessage({ seq: 13, command: 'continue', arguments: {} });
    assert.strictEqual(terminated, true);
});

test('GingaDebugSession with primeiro_joao/00syncProp.ncl: dynamic breakpoint addition and restart', () => {
    const joaoPath = path.join(__dirname, '..', 'examples', 'primeiro_joao', '00syncProp.ncl');
    const session = new GingaDebugSession();

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: joaoPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: joaoPath },
            breakpoints: [{ line: 28 }]
        }
    });
    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 28);

    session.handleMessage({
        seq: 5,
        command: 'setBreakpoints',
        arguments: {
            source: { path: joaoPath },
            breakpoints: [{ line: 28 }, { line: 34 }, { line: 38 }]
        }
    });

    session.handleMessage({ seq: 6, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 34);

    session.handleMessage({ seq: 7, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 38);

    session.handleMessage({ seq: 8, command: 'restart', arguments: {} });
    assert.strictEqual(session.currentLine, 28);
});

test('GingaDebugSession with primeiro_joao/00syncProp.ncl: inspecting all synchronization links, bind roles, and media components', () => {
    const joaoPath = path.join(__dirname, '..', 'examples', 'primeiro_joao', '00syncProp.ncl');
    const session = new GingaDebugSession();

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: joaoPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: joaoPath },
            breakpoints: [{ line: 28 }, { line: 34 }, { line: 38 }, { line: 42 }]
        }
    });

    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 28);

    const frame1 = session.handleMessage({ seq: 5, command: 'stackTrace', arguments: {} });
    assert.ok(frame1.body.stackFrames[0].name.includes('lMusic'));

    const vars1 = session.handleMessage({ seq: 6, command: 'variables', arguments: { variablesReference: 1000 } });
    assert.ok(vars1.body.variables.some(v => v.name === 'elementId' && v.value === 'lMusic'));
    assert.ok(vars1.body.variables.some(v => v.name === 'elementTag' && v.value === 'link'));

    session.handleMessage({ seq: 7, command: 'stepIn', arguments: {} });
    assert.strictEqual(session.currentLine, 29);
    const bindVars = session.handleMessage({ seq: 8, command: 'variables', arguments: { variablesReference: 1000 } });
    assert.ok(bindVars.body.variables.some(v => v.name === 'elementTag' && v.value === 'bind'));

    session.handleMessage({ seq: 9, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 34);
    const frame2 = session.handleMessage({ seq: 10, command: 'stackTrace', arguments: {} });
    assert.ok(frame2.body.stackFrames[0].name.includes('lDrible'));

    session.handleMessage({ seq: 11, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 38);
    const frame3 = session.handleMessage({ seq: 12, command: 'stackTrace', arguments: {} });
    assert.ok(frame3.body.stackFrames[0].name.includes('lPhoto'));

    session.handleMessage({ seq: 13, command: 'continue', arguments: {} });
    assert.strictEqual(session.currentLine, 42);
    const frame4 = session.handleMessage({ seq: 14, command: 'stackTrace', arguments: {} });
    assert.ok(frame4.body.stackFrames[0].name.includes('lEnd'));

    let terminated = false;
    session.on('message', (msg) => {
        if (msg.type === 'event' && msg.event === 'terminated') terminated = true;
    });

    session.handleMessage({ seq: 15, command: 'continue', arguments: {} });
    assert.strictEqual(terminated, true);
});

test('GingaDebugSession with primeiro_joao/00syncProp.ncl: stepOut across nested elements, source command, and evaluate', () => {
    const joaoPath = path.join(__dirname, '..', 'examples', 'primeiro_joao', '00syncProp.ncl');
    const session = new GingaDebugSession();

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: joaoPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: joaoPath },
            breakpoints: [{ line: 21 }, { line: 26 }]
        }
    });

    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    assert.strictEqual(session.currentLine, 21);

    session.handleMessage({ seq: 5, command: 'stepIn', arguments: {} });
    assert.strictEqual(session.currentLine, 22);

    session.handleMessage({ seq: 6, command: 'stepOut', arguments: {} });
    assert.strictEqual(session.currentLine, 24);

    const srcResp = session.handleMessage({
        seq: 7,
        command: 'source',
        arguments: { source: { path: joaoPath } }
    });
    assert.strictEqual(srcResp.success, true);
    assert.ok(srcResp.body.content.includes('<ncl id="primeiro_joao">'));
    assert.ok(!srcResp.body.content.includes('syncEx'));
    assert.ok(!srcResp.body.content.includes('EDTVProfile'));

    const evalCtx = session.handleMessage({ seq: 8, command: 'evaluate', arguments: { expression: 'activeContext' } });
    assert.strictEqual(evalCtx.body.result, 'body');

    const evalLine = session.handleMessage({ seq: 9, command: 'evaluate', arguments: { expression: 'currentLine' } });
    assert.strictEqual(evalLine.body.result, '24');
});

test('GingaDebugSession with primeiro_joao/00syncProp.ncl: pause event and setExceptionBreakpoints during active playback', () => {
    const joaoPath = path.join(__dirname, '..', 'examples', 'primeiro_joao', '00syncProp.ncl');
    const session = new GingaDebugSession();
    const events = [];
    session.on('message', (msg) => {
        if (msg.type === 'event') events.push(msg);
    });

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: joaoPath } });

    const excResp = session.handleMessage({ seq: 3, command: 'setExceptionBreakpoints', arguments: { filters: [] } });
    assert.strictEqual(excResp.success, true);

    const pauseResp = session.handleMessage({ seq: 4, command: 'pause', arguments: {} });
    assert.strictEqual(pauseResp.success, true);
    assert.ok(events.some(e => e.event === 'stopped' && e.body.reason === 'pause'));

    const threadsResp = session.handleMessage({ seq: 5, command: 'threads', arguments: {} });
    assert.strictEqual(threadsResp.success, true);
    assert.strictEqual(threadsResp.body.threads[0].name, 'Ginga Presentation Engine');

    const discResp = session.handleMessage({ seq: 6, command: 'disconnect', arguments: {} });
    assert.strictEqual(discResp.success, true);
    assert.strictEqual(session.isRunning, false);
});

test('package.json contributes ginga.executablePath configuration schema', () => {
    const props = packageJson.contributes.configuration.properties;
    assert.strictEqual(props['vscode.gingafExePath'], undefined);
    assert.strictEqual(props['vscode.gingafExecutable'], undefined);
    assert.ok(props['ginga.executablePath']);
    assert.strictEqual(props['ginga.executablePath'].type, 'string');
});

test('resolveOrDownloadExecutable prefers ginga.executablePath if configured and present', async () => {
    const config = extension.vscode.workspace.getConfiguration('ginga');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-custom-exe-'));
    const customExe = path.join(tmpDir, process.platform === 'win32' ? 'gingaf.exe' : 'gingaf');
    fs.writeFileSync(customExe, '#!/bin/sh\n');
    if (process.platform !== 'win32') fs.chmodSync(customExe, 0o755);

    try {
        config.update('executablePath', customExe);
        const resolved = await extension.resolveOrDownloadExecutable({ subscriptions: [] }, 'main.ncl');
        assert.strictEqual(resolved, customExe);
    } finally {
        config.update('executablePath', '');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Makefile specifies GINGA_CODE_GINGAF parameter and examples startup folder and configures gingafexecutable', () => {
    const makefilePath = path.join(__dirname, '..', 'Makefile');
    assert.ok(fs.existsSync(makefilePath));
    const content = fs.readFileSync(makefilePath, 'utf8');

    assert.ok(content.includes('GINGA_CODE_GINGAF ?= ../gingaf'));
    assert.ok(!content.includes('GINGA_CODE_STARTUP_FOLDER'));
    assert.ok(content.includes('examples/ folder'));
    assert.ok(content.includes('build-gingaf:'));
    assert.ok(!content.includes('install-vscode:'));
    assert.ok(content.includes('BUILD_VSIX_DEP :='));
    assert.ok(!content.includes('build-gingaf-support'));
    assert.ok(content.includes('release'));
    assert.ok(content.includes('scripts/setup-vscode-test.js'));
    assert.ok(!content.includes('GINGAF_FOLDER :='));
    assert.ok(!content.includes('GINGAF_DIR :='));

    const buildMdPath = path.join(__dirname, '..', 'BUILD.md');
    assert.ok(fs.existsSync(buildMdPath));
    const buildMdContent = fs.readFileSync(buildMdPath, 'utf8');
    assert.ok(buildMdContent.includes('install-host-deps-windows.ps1'));
    assert.ok(buildMdContent.includes('install-host-deps-ubuntu.sh'));
    assert.ok(buildMdContent.includes('install-host-deps-macos.sh'));

    const setupScriptPath = path.join(__dirname, '..', 'scripts', 'setup-vscode-test.js');
    assert.ok(fs.existsSync(setupScriptPath));
    const setupContent = fs.readFileSync(setupScriptPath, 'utf8');
    assert.ok(setupContent.includes("settings['ginga.executablePath'] = effectiveExe;"));
    assert.ok(setupContent.includes("settings['window.newWindowDimensions'] = 'maximized';"));
    assert.ok(setupContent.includes("path.join(userDir, 'globalStorage', 'state.vscdb')"));
    assert.ok(setupContent.includes('resolveCodeExecutable'));
    assert.ok(setupContent.includes('supportsCliOption'));
    assert.ok(setupContent.includes('--new-window'));
});

test('scripts folder contains install-host-deps-windows.ps1, install-host-deps-ubuntu.sh, install-host-deps-macos.sh, and setup-vscode-test.js', () => {
    const scriptsDir = path.join(__dirname, '..', 'scripts');
    assert.ok(fs.existsSync(scriptsDir));
    assert.ok(fs.existsSync(path.join(scriptsDir, 'install-host-deps-windows.ps1')));
    assert.ok(fs.existsSync(path.join(scriptsDir, 'install-host-deps-ubuntu.sh')));
    assert.ok(fs.existsSync(path.join(scriptsDir, 'install-host-deps-macos.sh')));
    assert.ok(fs.existsSync(path.join(scriptsDir, 'setup-vscode-test.js')));

    const ubuntuScript = fs.readFileSync(path.join(scriptsDir, 'install-host-deps-ubuntu.sh'), 'utf8');
    assert.ok(ubuntuScript.includes('code/add-microsoft-repo boolean true'));
    assert.ok(ubuntuScript.includes('https://go.microsoft.com/fwlink/?LinkID=760868'));
    assert.ok(ubuntuScript.includes('vscode.sources'));
    assert.ok(ubuntuScript.includes('resolve_code_bin'));

    const macosScript = fs.readFileSync(path.join(scriptsDir, 'install-host-deps-macos.sh'), 'utf8');
    assert.ok(macosScript.includes('resolve_code_bin'));
    assert.ok(macosScript.includes('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'));

    const windowsScript = fs.readFileSync(path.join(scriptsDir, 'install-host-deps-windows.ps1'), 'utf8');
    assert.ok(windowsScript.includes('Resolve-CodePath'));
    assert.ok(windowsScript.includes('LOCALAPPDATA'));

    const setupScript = fs.readFileSync(path.join(scriptsDir, 'setup-vscode-test.js'), 'utf8');
    assert.ok(setupScript.includes('resolveCodeExecutable'));
    assert.ok(setupScript.includes('candidates'));
});

test('GingaDebugSession terminate emits exited and terminated events and marks session terminated', () => {
    const session = new extension.GingaDebugSession();
    const events = [];
    session.on('message', msg => {
        if (msg.type === 'event') events.push(msg);
    });

    session.terminate(42);
    assert.strictEqual(session.isRunning, false);
    assert.strictEqual(session.isTerminated, true);

    const exited = events.find(e => e.event === 'exited');
    assert.ok(exited);
    assert.strictEqual(exited.body.exitCode, 42);

    const terminated = events.find(e => e.event === 'terminated');
    assert.ok(terminated);

    session.terminate(0);
    assert.strictEqual(events.filter(e => e.event === 'terminated').length, 1);
});

test('stopPlayer terminates active debug sessions and invokes vscode.debug.stopDebugging', async () => {
    let stopDebuggingCalled = false;
    extension.vscode.debug.stopDebugging = async () => {
        stopDebuggingCalled = true;
        return true;
    };

    const session = new extension.GingaDebugSession();
    const registered = [];
    extension.activate({
        subscriptions: [],
        extensionPath: path.resolve('.'),
        globalStorageUri: { fsPath: path.resolve('.vscode-test/storage') }
    });

    const descriptor = extension.vscode.debug._factory.createDebugAdapterDescriptor();
    assert.ok(descriptor.session);

    const activeSessions = extension.getActiveDebugSessions();
    assert.ok(activeSessions.length > 0);

    const events = [];
    activeSessions[0].on('message', m => events.push(m));

    extension.stopPlayer();
    assert.strictEqual(stopDebuggingCalled, true);
    assert.ok(events.some(e => e.event === 'terminated'));
    assert.strictEqual(extension.getActiveDebugSessions().length, 0);
});

test('openPlayer process exit terminates active debug sessions and invokes vscode.debug.stopDebugging', async () => {
    let stopDebuggingCalled = false;
    extension.vscode.debug.stopDebugging = async () => {
        stopDebuggingCalled = true;
        return true;
    };

    extension.activate({
        subscriptions: [],
        extensionPath: path.resolve('.'),
        globalStorageUri: { fsPath: path.resolve('.vscode-test/storage') }
    });

    const descriptor = extension.vscode.debug._factory.createDebugAdapterDescriptor();
    assert.ok(descriptor.session);

    const activeSessions = extension.getActiveDebugSessions();
    assert.ok(activeSessions.length > 0);

    const events = [];
    activeSessions[0].on('message', m => events.push(m));

    const child = await extension.openPlayer({
        subscriptions: [],
        extensionPath: path.resolve('.')
    }, path.resolve('examples/video.ncl'));

    assert.ok(child);
    if (child) {
        if (child.pid) {
            if (process.platform === 'win32') {
                try {
                    cp.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
                } catch (_) {
                    try { child.kill(); } catch (_) {}
                }
            } else {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch (_) {
                    try { child.kill('SIGKILL'); } catch (_) {}
                }
            }
        } else if (typeof child.kill === 'function') {
            try { child.kill('SIGKILL'); } catch (_) {}
        }
    }
    child.emit('exit', 0, null);

    assert.strictEqual(stopDebuggingCalled, true);
    assert.ok(events.some(e => e.event === 'terminated'));
    assert.strictEqual(extension.getActiveDebugSessions().length, 0);
});

test('openPlayer forwards breakpoints to Ginga player via --breakpoints argument and GINGA_BREAKPOINTS environment variable', async () => {
    let capturedArgs = undefined;
    let capturedEnv = undefined;
    const origSpawn = cp.spawn;
    cp.spawn = (cmd, args, opts) => {
        capturedArgs = args;
        capturedEnv = opts ? opts.env : {};
        return {
            pid: 4005,
            on: () => { },
            unref: () => { },
            kill: () => { },
            emit: () => { }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-bp-test-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'sample.ncl');
        fs.writeFileSync(samplePath, '<ncl></ncl>');

        extension.vscode.debug.breakpoints = [
            {
                location: {
                    uri: { fsPath: samplePath },
                    range: { start: { line: 6 } }
                }
            },
            {
                location: {
                    uri: { fsPath: samplePath },
                    range: { start: { line: 11 } }
                }
            }
        ];

        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });

        assert.ok(capturedArgs);
        assert.ok(capturedArgs.includes('--breakpoints=7,12'));
        assert.ok(capturedEnv);
        assert.strictEqual(capturedEnv.GINGA_BREAKPOINTS, '7,12');
        extension.stopPlayer();
    } finally {
        extension.vscode.debug.breakpoints = [];
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('GingaDebugSession with hasPlayer: configurationDone waits for player events and continue sends player resume', () => {
    const videoNclPath = path.join(__dirname, '..', 'examples', 'video.ncl');
    const session = new GingaDebugSession();
    session.hasPlayer = true;

    const events = [];
    session.on('message', (msg) => {
        if (msg.type === 'event') events.push(msg);
    });

    let continueCalled = 0;
    session.onContinue = () => {
        continueCalled++;
    };

    session.handleMessage({ seq: 1, command: 'initialize', arguments: {} });
    session.handleMessage({ seq: 2, command: 'launch', arguments: { program: videoNclPath } });
    session.handleMessage({
        seq: 3,
        command: 'setBreakpoints',
        arguments: {
            source: { path: videoNclPath },
            breakpoints: [{ line: 7 }, { line: 11 }]
        }
    });

    // 1) configurationDone should NOT trigger synthetic stopped event when hasPlayer is true
    session.handleMessage({ seq: 4, command: 'configurationDone', arguments: {} });
    const stoppedEventsBeforePlayer = events.filter(e => e.event === 'stopped');
    assert.strictEqual(stoppedEventsBeforePlayer.length, 0);

    // 2) Player reaches 2s and reports breakpoint at line 7
    session.notifyStopped(7, 'breakpoint');
    assert.strictEqual(session.currentLine, 7);
    assert.strictEqual(session.isRunning, false);
    const firstStopped = events.find(e => e.event === 'stopped' && e.body.reason === 'breakpoint');
    assert.ok(firstStopped);

    // 3) User clicks Continue: onContinue is invoked, session remains running without immediately jumping to line 11
    const contResp1 = session.handleMessage({ seq: 5, command: 'continue', arguments: {} });
    assert.strictEqual(contResp1.success, true);
    assert.strictEqual(continueCalled, 1);
    assert.strictEqual(session.isRunning, true);
    assert.strictEqual(session.isTerminated, false);
    // Should NOT have jumped immediately to line 11
    assert.strictEqual(session.currentLine, 7);

    // 4) Player reaches 4s and reports breakpoint at line 11
    session.notifyStopped(11, 'breakpoint');
    assert.strictEqual(session.currentLine, 11);
    assert.strictEqual(session.isRunning, false);

    // 5) User clicks Continue again: onContinue invoked, session does NOT terminate
    const contResp2 = session.handleMessage({ seq: 6, command: 'continue', arguments: {} });
    assert.strictEqual(contResp2.success, true);
    assert.strictEqual(continueCalled, 2);
    assert.strictEqual(session.isRunning, true);
    assert.strictEqual(session.isTerminated, false);
});

test('GingaDebugSession connected to active player process: streams [Breakpoint] events and sends stdin continue and pause', async () => {
    const { EventEmitter } = require('node:events');
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    mockStdout.unref = () => { };
    mockStderr.unref = () => { };

    const writtenStdin = [];
    const mockStdin = {
        destroyed: false,
        write: (str) => { writtenStdin.push(str); return true; },
        end: () => { mockStdin.destroyed = true; },
        on: () => { }
    };

    const origSpawn = cp.spawn;
    cp.spawn = (cmd, args, options) => {
        return {
            pid: 8888,
            stdin: mockStdin,
            stdout: mockStdout,
            stderr: mockStderr,
            on: () => { },
            unref: () => { },
            kill: () => { mockStdin.destroyed = true; }
        };
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginga-debug-interactive-'));
    try {
        const binaryName = process.platform === 'win32' ? 'gingaf.exe' : 'gingaf';
        const fakeExe = path.join(tmpDir, binaryName);
        fs.writeFileSync(fakeExe, '');
        if (process.platform !== 'win32') {
            fs.chmodSync(fakeExe, 0o755);
        }
        const samplePath = path.join(tmpDir, 'video.ncl');
        fs.writeFileSync(samplePath, '<ncl><body><media id="video"/><media id="green_bg"/><media id="red_bg"/></body></ncl>');

        const session = new GingaDebugSession();
        const events = [];
        session.on('message', (msg) => {
            if (msg.type === 'event') events.push(msg);
        });

        // Start player and wire session
        await extension.openPlayer({ globalStorageUri: { fsPath: tmpDir }, subscriptions: [] }, { fsPath: samplePath });
        extension.wireDebugSession(session);

        assert.strictEqual(session.hasPlayer, true);

        // Player hits line 7 at 2s
        mockStdout.emit('data', Buffer.from('[ncl_doc] INFO: [Breakpoint] Pausing on media "green_bg" start at line 7\n'));
        assert.strictEqual(session.currentLine, 7);
        assert.strictEqual(session.isRunning, false);
        const bp7Event = events.find(e => e.event === 'stopped' && e.body.reason === 'breakpoint');
        assert.ok(bp7Event);

        // Press Continue: writes continue\n to player stdin
        session.handleMessage({ seq: 10, command: 'continue', arguments: {} });
        assert.ok(writtenStdin.includes('continue\n'));
        assert.strictEqual(session.isRunning, true);
        assert.strictEqual(session.isTerminated, false);

        // Player hits line 11 at 4s
        mockStdout.emit('data', Buffer.from('[ncl_doc] INFO: [Breakpoint] Pausing on media "red_bg" start at line 11\n'));
        assert.strictEqual(session.currentLine, 11);
        assert.strictEqual(session.isRunning, false);

        // Press Continue again: writes continue\n to player stdin and does not terminate
        writtenStdin.length = 0;
        session.handleMessage({ seq: 11, command: 'continue', arguments: {} });
        assert.ok(writtenStdin.includes('continue\n'));
        assert.strictEqual(session.isTerminated, false);

        // Press Pause: writes pause\n to player stdin
        writtenStdin.length = 0;
        session.handleMessage({ seq: 12, command: 'pause', arguments: {} });
        assert.ok(writtenStdin.includes('pause\n'));

        // Update breakpoints dynamically
        writtenStdin.length = 0;
        session.handleMessage({
            seq: 13,
            command: 'setBreakpoints',
            arguments: {
                source: { path: samplePath },
                breakpoints: [{ line: 7 }, { line: 11 }, { line: 20 }]
            }
        });
        assert.ok(writtenStdin.some(line => line.startsWith('bp 7 11 20')));

        extension.stopPlayer();
    } finally {
        cp.spawn = origSpawn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

