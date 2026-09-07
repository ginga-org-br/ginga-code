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

function getDownloadUrl() {
    const version = '0.1.1';
    let platformName = 'windows-x64';
    if (process.platform === 'darwin') {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        platformName = `macos-${arch}`;
    } else if (process.platform === 'linux') {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        platformName = `linux-${arch}`;
    }

    const zipName = `gingaf-v${version}-${platformName}.zip`;
    return `https://github.com/ginga-org-br/gingaf/releases/download/v${version}/${zipName}`;
}

function downloadFile(url, destPath) {
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

async function downloadAndExtract(zipPath, storageDir) {
    const downloadUrl = getDownloadUrl();
    logToOutput(`[Ginga Player] Downloading release from: ${downloadUrl}`);
    await downloadFile(downloadUrl, zipPath);
    extractZip(zipPath, storageDir);
    const downloadedExec = getExecutableInStorage(storageDir);
    if (downloadedExec && fs.existsSync(downloadedExec)) {
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(downloadedExec, 0o755);
            } catch (e) { }
        }
        logToOutput(`[Ginga Player] Successfully downloaded and extracted release executable: ${downloadedExec}`);
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

    const storageExec = getExecutableInStorage(storageDir);
    if (storageExec && fs.existsSync(storageExec)) {
        logToOutput(`[Ginga Player] Using downloaded release executable from storage: ${storageExec}`);
        return storageExec;
    }

    const downloadUrl = getDownloadUrl();
    logToOutput(`[Ginga Player] Release executable not found locally. Downloading release from: ${downloadUrl}`);

    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    const zipPath = path.join(storageDir, 'release.zip');

    let downloadedExec = undefined;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading Ginga player release...',
        cancellable: false
    }, async () => {
        downloadedExec = await downloadAndExtract(zipPath, storageDir);
        if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }
    });

    if (!downloadedExec) {
        downloadedExec = getExecutableInStorage(storageDir);
    }

    if (downloadedExec && fs.existsSync(downloadedExec)) {
        return downloadedExec;
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

    context.subscriptions.push(changeEditorSub, openPlayerCmd);
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
    getDownloadUrl,
    downloadFile,
    extractZip,
    downloadAndExtract
};
