const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const cp = require('child_process');

let vscode;
try {
    vscode = require('vscode');
} catch (e) {
    vscode = {
        ProgressLocation: {
            Notification: 15
        },
        window: {
            activeTextEditor: {
                document: {
                    fileName: 'sample.ncl',
                    getText: () => '<ncl></ncl>'
                }
            },
            onDidChangeActiveTextEditor: () => ({ dispose: () => { } }),
            showInformationMessage: () => { },
            showWarningMessage: () => { },
            showErrorMessage: () => { },
            createOutputChannel: () => ({
                appendLine: () => { },
                show: () => { },
                dispose: () => { }
            }),
            withProgress: async (options, task) => {
                return await task();
            }
        },
        workspace: {
            getConfiguration: () => ({
                get: () => ''
            })
        },
        commands: {
            registerCommand: (name, cb) => ({ name, cb })
        }
    };
}

let lastActiveEditor = undefined;
let extensionContext = undefined;
let outputChannel = undefined;
let activePlayerProcess = undefined;

function stopPlayer() {
    if (activePlayerProcess) {
        try {
            activePlayerProcess.kill();
        } catch (e) { }
        activePlayerProcess = undefined;
    }
}

function getOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Ginga Player');
    }
    return outputChannel;
}

function logToOutput(message) {
    const channel = getOutputChannel();
    channel.appendLine(message);
    channel.show(true);
}

function getExecutableInStorage(storageDir) {
    if (!storageDir) return undefined;
    if (process.platform === 'win32') {
        const exe = path.join(storageDir, 'gingaf.exe');
        if (fs.existsSync(exe)) return exe;
    } else if (process.platform === 'darwin') {
        const macApp = path.join(storageDir, 'gingaf.app', 'Contents', 'MacOS', 'gingaf');
        if (fs.existsSync(macApp)) return macApp;
        const bin = path.join(storageDir, 'gingaf');
        if (fs.existsSync(bin)) return bin;
    } else {
        const bin = path.join(storageDir, 'gingaf');
        if (fs.existsSync(bin)) return bin;
    }
    return undefined;
}

function getSystemExecutable() {
    if (process.platform === 'linux') {
        if (fs.existsSync('/usr/bin/gingaf')) return '/usr/bin/gingaf';
        if (fs.existsSync('/usr/local/bin/gingaf')) return '/usr/local/bin/gingaf';
        try {
            const whichGingaf = cp.execSync('which gingaf 2>/dev/null', { encoding: 'utf8' }).trim();
            if (whichGingaf && fs.existsSync(whichGingaf)) return whichGingaf;
        } catch (e) { }
    }
    return undefined;
}

function getExecutable(storageDir) {
    const storageExec = getExecutableInStorage(storageDir);
    if (storageExec) return storageExec;
    return getSystemExecutable();
}

function getSystemInstalledVersion() {
    if (process.platform === 'linux') {
        try {
            const out = cp.execSync("dpkg-query -W -f='${Version}' gingaf 2>/dev/null", { encoding: 'utf8' }).trim();
            if (out) {
                const match = out.match(/\d+(\.\d+)+/);
                return match ? match[0] : out;
            }
        } catch (e) { }
    }
    return undefined;
}

function getInstalledVersion(storageDir, checkSystem = false) {
    if (storageDir) {
        const versionFile = path.join(storageDir, 'version.txt');
        if (fs.existsSync(versionFile)) {
            try {
                const ver = fs.readFileSync(versionFile, 'utf8').trim();
                if (ver) return ver;
            } catch (e) { }
        }
    }
    if (checkSystem) {
        const sysVer = getSystemInstalledVersion();
        if (sysVer) return sysVer;
    }
    if (extensionContext && extensionContext.globalState) {
        return extensionContext.globalState.get('installedGingafVersion');
    }
    return undefined;
}

function setInstalledVersion(storageDir, version) {
    if (!version) return;
    if (storageDir) {
        try {
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            fs.writeFileSync(path.join(storageDir, 'version.txt'), version, 'utf8');
        } catch (e) { }
    }
    if (extensionContext && extensionContext.globalState) {
        try {
            extensionContext.globalState.update('installedGingafVersion', version);
        } catch (e) { }
    }
}

function isDifferentVersion(serverVersion, installedVersion) {
    if (!installedVersion || installedVersion === 'unknown') return true;
    if (!serverVersion) return false;
    const cleanServer = serverVersion.replace(/^v/, '').trim();
    const cleanInstalled = installedVersion.replace(/^v/, '').trim();
    return cleanServer !== cleanInstalled;
}

function isNewerVersion(latest, current) {
    if (!current || current === 'unknown') return true;
    if (!latest) return false;
    const parse = (v) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const l = parse(latest);
    const c = parse(current);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const lp = l[i] || 0;
        const cp = c[i] || 0;
        if (lp > cp) return true;
        if (lp < cp) return false;
    }
    return false;
}

function getPlatformName() {
    let platformName = 'windows-x64';
    if (process.platform === 'darwin') {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        platformName = `macos-${arch}`;
    } else if (process.platform === 'linux') {
        const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
        platformName = `linux-${arch}`;
    }
    return platformName;
}

let releaseCache = new Map();

function clearReleaseCache() {
    releaseCache.clear();
}

function checkUrlExists(url) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const client = parsed.protocol === 'https:' ? https : http;
            const req = client.request(url, {
                method: 'HEAD',
                agent: false,
                headers: { 'User-Agent': 'VSCode-Ginga' }
            }, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
            req.on('error', () => resolve(false));
            req.setTimeout(4000, () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        } catch (e) {
            resolve(false);
        }
    });
}

function matchesPlatform(assetName, platform, arch) {
    const name = assetName.toLowerCase();
    if (platform === 'win32' || platform === 'windows') {
        if (!name.endsWith('.zip')) return false;
        if (!name.includes('win')) return false;
        if (arch === 'arm64') {
            return name.includes('arm64');
        }
        return name.includes('x64') || name.includes('amd64') || (!name.includes('arm') && !name.includes('x86') && !name.includes('ia32'));
    }
    if (platform === 'linux') {
        if (!name.endsWith('.deb') && !name.includes('linux')) return false;
        const targetArch = (arch === 'arm64') ? 'arm64' : 'amd64';
        return name.includes(targetArch) || (!name.includes('arm64') && !name.includes('amd64'));
    }
    if (platform === 'darwin' || platform === 'macos') {
        if (!name.includes('mac') && !name.includes('darwin') && !name.includes('osx')) return false;
        if (arch === 'arm64' && name.includes('arm64')) return true;
        if (arch === 'x64' && (name.includes('x64') || name.includes('amd64'))) return true;
        return !name.includes('x64') && !name.includes('arm64');
    }
    return false;
}

function fetchGithubReleasesApi() {
    return new Promise((resolve) => {
        const req = https.get('https://api.github.com/repos/ginga-org-br/gingaf/releases', {
            agent: false,
            headers: {
                'User-Agent': 'VSCode-Ginga',
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) {
                        return resolve(parsed);
                    }
                } catch (e) { }
                resolve(null);
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

function fetchExpandedAssets(tag) {
    return new Promise((resolve) => {
        const cleanTag = tag.startsWith('v') ? tag : `v${tag}`;
        const url = `https://github.com/ginga-org-br/gingaf/releases/expanded_assets/${cleanTag}`;
        const req = https.get(url, {
            agent: false,
            headers: { 'User-Agent': 'VSCode-Ginga' }
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve([]);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const re = /\/ginga-org-br\/gingaf\/releases\/download\/[^"'\s>]+/g;
                const matches = [...new Set(data.match(re) || [])];
                const assets = matches.map(href => {
                    const fullUrl = `https://github.com${href}`;
                    const name = href.split('/').pop();
                    return { name, browser_download_url: fullUrl };
                });
                resolve(assets);
            });
        });
        req.on('error', () => resolve([]));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve([]);
        });
    });
}

function fetchReleaseTagsFallback() {
    return new Promise((resolve) => {
        const urls = [
            'https://github.com/ginga-org-br/gingaf/releases.atom',
            'https://github.com/ginga-org-br/gingaf/releases',
            'https://github.com/ginga-org-br/gingaf/tags'
        ];
        function tryNext(index) {
            if (index >= urls.length) return resolve([]);
            const req = https.get(urls[index], {
                agent: false,
                headers: { 'User-Agent': 'VSCode-Ginga' }
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return tryNext(index + 1);
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const tags = [...data.matchAll(/\/releases\/tag\/v?([^"'\s<]+)/g)].map(m => m[1]);
                    const unique = [...new Set(tags)];
                    if (unique.length > 0) {
                        return resolve(unique);
                    }
                    tryNext(index + 1);
                });
            });
            req.on('error', () => tryNext(index + 1));
            req.setTimeout(5000, () => {
                req.destroy();
                tryNext(index + 1);
            });
        }
        tryNext(0);
    });
}

async function getLatestRelease(platform = process.platform, arch = process.arch) {
    const cacheKey = `${platform}_${arch}`;
    if (releaseCache.has(cacheKey)) {
        return releaseCache.get(cacheKey);
    }

    let result = null;
    const releases = await fetchGithubReleasesApi();
    if (releases && releases.length > 0) {
        for (const rel of releases) {
            const version = rel.tag_name ? rel.tag_name.replace(/^v/, '').trim() : '';
            if (!version || !rel.assets || !Array.isArray(rel.assets)) continue;
            const matchingAsset = rel.assets.find(a => matchesPlatform(a.name, platform, arch));
            if (matchingAsset && matchingAsset.browser_download_url) {
                result = {
                    version,
                    downloadUrl: matchingAsset.browser_download_url,
                    assetName: matchingAsset.name
                };
                break;
            }
        }
    }

    if (!result) {
        const tags = await fetchReleaseTagsFallback();
        for (const v of tags) {
            const assets = await fetchExpandedAssets(v);
            const matchingAsset = assets.find(a => matchesPlatform(a.name, platform, arch));
            if (matchingAsset && matchingAsset.browser_download_url) {
                result = {
                    version: v,
                    downloadUrl: matchingAsset.browser_download_url,
                    assetName: matchingAsset.name
                };
                break;
            }

            let candidateUrl;
            let candidateAsset;
            if (platform === 'win32' || platform === 'windows') {
                candidateAsset = `gingaf-v${v}-windows-x64.zip`;
                candidateUrl = `https://github.com/ginga-org-br/gingaf/releases/download/v${v}/${candidateAsset}`;
            } else if (platform === 'linux') {
                const targetArch = arch === 'arm64' ? 'arm64' : 'amd64';
                candidateAsset = `gingaf-v${v}-linux-${targetArch}.deb`;
                candidateUrl = `https://github.com/ginga-org-br/gingaf/releases/download/v${v}/${candidateAsset}`;
            } else {
                candidateAsset = `gingaf-v${v}-macos.zip`;
                candidateUrl = `https://github.com/ginga-org-br/gingaf/releases/download/v${v}/${candidateAsset}`;
            }

            if (await checkUrlExists(candidateUrl)) {
                result = {
                    version: v,
                    downloadUrl: candidateUrl,
                    assetName: candidateAsset
                };
                break;
            }
        }
    }

    if (result) {
        releaseCache.set(cacheKey, result);
    }
    return result;
}

async function getLatestVersion(platform = process.platform, arch = process.arch) {
    const rel = await getLatestRelease(platform, arch);
    return rel ? rel.version : undefined;
}

async function getDownloadUrl(platform = process.platform, arch = process.arch) {
    const rel = await getLatestRelease(platform, arch);
    return rel ? rel.downloadUrl : undefined;
}

function downloadFile(url, destPath) {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
        function fetchUrl(currentUrl, redirects = 0) {
            if (redirects > 5) return reject(new Error('Too many redirects'));
            const client = currentUrl.startsWith('https') ? https : http;
            client.get(currentUrl, { agent: false, headers: { 'User-Agent': 'VSCode-Ginga' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return fetchUrl(res.headers.location, redirects + 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
                }
                const fileStream = fs.createWriteStream(destPath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(resolve);
                });
                fileStream.on('error', (err) => {
                    fs.unlink(destPath, () => reject(err));
                });
            }).on('error', reject);
        }
        fetchUrl(url);
    });
}

function extractZip(zipPath, storageDir) {
    logToOutput(`[Ginga Player] Extracting release zip to: ${storageDir}`);
    if (process.platform === 'win32') {
        cp.execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${storageDir}' -Force"`);
    } else {
        cp.execSync(`unzip -o "${zipPath}" -d "${storageDir}"`);
    }
}

function runDebInstaller(debPath) {
    const installCmd = `sudo apt install -y "${debPath}"`;
    logToOutput(`[Ginga Player] Debian package downloaded to: ${debPath}`);
    logToOutput(`[Ginga Player] To install it, run: ${installCmd}`);

    if (vscode && vscode.window && vscode.window.showInformationMessage) {
        const res = vscode.window.showInformationMessage(
            `Ginga player downloaded to ${debPath}. Install it with: ${installCmd}`,
            'Copy Command',
            'Open Terminal'
        );
        if (res && typeof res.then === 'function') {
            res.then((selection) => {
                if (selection === 'Copy Command') {
                    if (vscode.env && vscode.env.clipboard) {
                        vscode.env.clipboard.writeText(installCmd);
                    }
                } else if (selection === 'Open Terminal') {
                    if (vscode.window.createTerminal) {
                        const terminal = vscode.window.createTerminal('Ginga Installer');
                        terminal.show();
                        terminal.sendText(installCmd, false);
                    }
                }
            });
        }
    }
    return installCmd;
}

async function downloadAndExtract(packagePath, storageDir, url) {
    if (storageDir && !fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }
    const downloadUrl = url || await getDownloadUrl();
    const versionMatch = downloadUrl.match(/\/download\/v?([^/]+)\//);
    const downloadedVersion = versionMatch ? versionMatch[1] : undefined;
    logToOutput(`[Ginga Player] Downloading release from: ${downloadUrl}`);
    await downloadFile(downloadUrl, packagePath);

    const isDeb = (downloadUrl && downloadUrl.endsWith('.deb')) ||
        (packagePath && packagePath.endsWith('.deb')) ||
        process.platform === 'linux';

    if (isDeb) {
        runDebInstaller(packagePath);
    } else {
        extractZip(packagePath, storageDir);
    }

    if (process.platform === 'linux' && storageDir) {
        const binInStorage = path.join(storageDir, 'gingaf');
        if (!fs.existsSync(binInStorage) && fs.existsSync('/usr/bin/gingaf')) {
            try {
                fs.symlinkSync('/usr/bin/gingaf', binInStorage);
            } catch (e) { }
        }
    }

    const downloadedExec = getExecutable(storageDir);
    if (downloadedExec && fs.existsSync(downloadedExec)) {
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(downloadedExec, 0o755);
            } catch (e) { }
        }
        if (downloadedVersion) {
            setInstalledVersion(storageDir, downloadedVersion);
        }
        logToOutput(`[Ginga Player] Successfully downloaded and installed release executable: ${downloadedExec}`);
    }
    return downloadedExec;
}

async function resolveOrDownloadExecutable(context, documentPath) {
    logToOutput(`[Ginga Player] Resolving executable for document: ${documentPath}`);

    const userConfig = vscode.workspace.getConfiguration('vscode');
    const configuredPath = (userConfig.get('gingafExePath') || userConfig.get('gingafExecutable') || '').trim();
    if (configuredPath && fs.existsSync(configuredPath)) {
        logToOutput(`[Ginga Player] Using configured executable path: ${configuredPath}`);
        return configuredPath;
    }

    const storageDir = context && context.globalStorageUri
        ? context.globalStorageUri.fsPath
        : (context && context.extensionPath ? path.join(context.extensionPath, 'bin') : path.join(__dirname, '..', 'bin'));

    const storageExec = getExecutable(storageDir);
    const installedVersion = getInstalledVersion(storageDir, true);
    let serverVersion = undefined;
    try {
        serverVersion = await getLatestVersion();
    } catch (e) { }

    const hasInstalledVersion = Boolean(installedVersion && installedVersion !== 'unknown');
    const isDifferent = hasInstalledVersion
        ? (serverVersion ? isDifferentVersion(serverVersion, installedVersion) : false)
        : !storageExec;

    if (storageExec && fs.existsSync(storageExec) && !isDifferent) {
        logToOutput(`[Ginga Player] Using installed executable (${installedVersion ? `v${installedVersion}` : 'current'}): ${storageExec}`);
        return storageExec;
    }

    const downloadUrl = await getDownloadUrl();
    logToOutput(`[Ginga Player] Installed executable is ${storageExec ? 'different from server version' : 'not found'}. Downloading release from: ${downloadUrl}`);

    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    const isDeb = process.platform === 'linux' || downloadUrl.endsWith('.deb');
    const packageFile = isDeb ? 'release.deb' : 'release.zip';
    const packagePath = path.join(storageDir, packageFile);

    let downloadedExec = undefined;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading Ginga player release...',
        cancellable: false
    }, async () => {
        downloadedExec = await module.exports.downloadAndExtract(packagePath, storageDir, downloadUrl);
        if (!isDeb && fs.existsSync(packagePath)) {
            fs.unlinkSync(packagePath);
        }
    });

    if (!downloadedExec) {
        downloadedExec = getExecutable(storageDir);
    }

    if (downloadedExec && fs.existsSync(downloadedExec)) {
        return downloadedExec;
    }

    if (isDeb) {
        logToOutput(`[Ginga Player] Ginga player is not installed yet. Please run: sudo apt install -y "${packagePath}"`);
        throw new Error(`Ginga player is not installed yet. Please run: sudo apt install -y "${packagePath}"`);
    }

    logToOutput(`[Ginga Player] ERROR: Release executable was not found after downloading from ${downloadUrl}`);
    throw new Error(`Ginga player release executable was not found after downloading from ${downloadUrl}`);
}

async function openPlayer(context, targetUri) {
    extensionContext = context;

    let documentPath = undefined;
    if (targetUri && typeof targetUri === 'string') {
        documentPath = targetUri;
    } else if (targetUri && targetUri.fsPath) {
        documentPath = targetUri.fsPath;
    } else {
        const activeEditor = vscode.window.activeTextEditor || lastActiveEditor;
        if (activeEditor && activeEditor.document) {
            documentPath = activeEditor.document.fileName;
        }
    }

    if (!documentPath) {
        vscode.window.showWarningMessage('No active editor open or document path found.');
        return;
    }

    let executable;
    try {
        executable = await resolveOrDownloadExecutable(context, documentPath);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to resolve Ginga player executable: ${err.message}`);
        return;
    }

    if (activePlayerProcess) {
        stopPlayer();
    }

    try {
        const spawnEnv = Object.assign({}, process.env, { APP: documentPath });
        const child = cp.spawn(executable, [documentPath], {
            detached: true,
            stdio: 'ignore',
            cwd: path.dirname(executable),
            env: spawnEnv
        });
        activePlayerProcess = child;
        child.on('exit', () => {
            if (activePlayerProcess === child) {
                activePlayerProcess = undefined;
            }
        });
        child.on('error', (err) => {
            vscode.window.showErrorMessage(`Ginga player process error: ${err.message}`);
        });
        child.unref();
        vscode.window.showInformationMessage(`Started Ginga player for: ${path.basename(documentPath)}`);
        return child;
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to start Ginga player: ${err.message}`);
    }
}

async function checkForUpdate(context) {
    const ctx = context || extensionContext;
    const storageDir = ctx && ctx.globalStorageUri
        ? ctx.globalStorageUri.fsPath
        : (ctx && ctx.extensionPath ? path.join(ctx.extensionPath, 'bin') : path.join(__dirname, '..', 'bin'));

    const installedVersion = getInstalledVersion(storageDir, true);
    const latestVersion = await getLatestVersion();
    const updateAvailable = isDifferentVersion(latestVersion, installedVersion);

    if (updateAvailable) {
        const msg = installedVersion
            ? `A newer version of Ginga player is available: v${latestVersion} (installed: v${installedVersion}).`
            : `Ginga player is not installed. Latest version is v${latestVersion}.`;
        const action = installedVersion ? 'Update Now' : 'Download';
        const selection = await vscode.window.showInformationMessage(msg, action);
        if (selection === action) {
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            const downloadUrl = await getDownloadUrl();
            const isDeb = process.platform === 'linux' || downloadUrl.endsWith('.deb');
            const packageFile = isDeb ? 'release.deb' : 'release.zip';
            const packagePath = path.join(storageDir, packageFile);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Downloading Ginga player v${latestVersion}...`,
                cancellable: false
            }, async () => {
                await module.exports.downloadAndExtract(packagePath, storageDir, downloadUrl);
                if (!isDeb && fs.existsSync(packagePath)) {
                    fs.unlinkSync(packagePath);
                }
            });
            if (isDeb) {
                vscode.window.showInformationMessage(`Ginga player downloaded. Install it with: sudo apt install -y "${packagePath}"`);
            } else {
                vscode.window.showInformationMessage(`Ginga player updated to v${latestVersion}.`);
            }
        }
    } else {
        vscode.window.showInformationMessage(`Ginga player is up to date (version v${installedVersion}).`);
    }

    return {
        updateAvailable,
        installedVersion,
        latestVersion
    };
}

function activate(context) {
    extensionContext = context;
    const initialEditor = vscode.window.activeTextEditor;
    if (initialEditor && (initialEditor.document.languageId === 'xml' || initialEditor.document.fileName.endsWith('.ncl') || initialEditor.document.fileName.endsWith('.html'))) {
        lastActiveEditor = initialEditor;
    }

    const changeEditorSub = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && (editor.document.languageId === 'xml' || editor.document.fileName.endsWith('.ncl') || editor.document.fileName.endsWith('.html'))) {
            lastActiveEditor = editor;
        }
    });

    const openPlayerCmd = vscode.commands.registerCommand('ginga.openPlayer', (uri) => openPlayer(context, uri));
    const checkUpdateCmd = vscode.commands.registerCommand('ginga.checkForUpdate', () => checkForUpdate(context));

    context.subscriptions.push(changeEditorSub, openPlayerCmd, checkUpdateCmd);
}

function deactivate() {
    stopPlayer();
    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = undefined;
    }
}

module.exports = {
    activate,
    deactivate,
    openPlayer,
    stopPlayer,
    resolveOrDownloadExecutable,
    getExecutableInStorage,
    getSystemExecutable,
    getExecutable,
    getSystemInstalledVersion,
    getInstalledVersion,
    setInstalledVersion,
    isDifferentVersion,
    isNewerVersion,
    checkForUpdate,
    getLatestVersion,
    getDownloadUrl,
    getLatestRelease,
    clearReleaseCache,
    fetchExpandedAssets,
    fetchReleaseTagsFallback,
    downloadFile,
    extractZip,
    runDebInstaller,
    downloadAndExtract
};
