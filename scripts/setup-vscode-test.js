const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function expandHome(p) {
    if (!p) return p;
    if (p === '~') return os.homedir();
    if (p.startsWith('~/') || p.startsWith('~\\')) {
        return path.join(os.homedir(), p.slice(2));
    }
    return p;
}

function resolveCodeExecutable() {
    const raw = process.env.CODE_CMD;
    if (raw && raw !== 'code' && fs.existsSync(raw) && !raw.toLowerCase().includes('antigravity') && !raw.startsWith('/mnt/')) {
        try {
            if (fs.statSync(raw).isFile()) return raw;
        } catch (_) {}
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    const candidates = [];
    if (isWin) {
        const localAppData = process.env.LOCALAPPDATA;
        const progFiles = process.env.ProgramFiles;
        const progFilesX86 = process.env['ProgramFiles(x86)'];
        if (localAppData) {
            candidates.push(path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'));
            candidates.push(path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'));
        }
        if (progFiles) {
            candidates.push(path.join(progFiles, 'Microsoft VS Code', 'bin', 'code.cmd'));
            candidates.push(path.join(progFiles, 'Microsoft VS Code', 'Code.exe'));
        }
        if (progFilesX86) {
            candidates.push(path.join(progFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'));
            candidates.push(path.join(progFilesX86, 'Microsoft VS Code', 'Code.exe'));
        }
    } else if (isMac) {
        candidates.push('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
        candidates.push('/usr/local/bin/code');
        candidates.push('/opt/homebrew/bin/code');
    } else {
        candidates.push('/usr/bin/code');
        candidates.push('/usr/share/code/bin/code');
        candidates.push('/usr/local/bin/code');
        candidates.push('/snap/bin/code');
    }

    for (const c of candidates) {
        if (fs.existsSync(c) && !c.toLowerCase().includes('antigravity') && !c.startsWith('/mnt/')) {
            return c;
        }
    }

    const whichCmd = isWin ? 'where' : 'which';
    try {
        const whichRes = cp.spawnSync(whichCmd, [isWin ? 'code.cmd' : 'code'], { encoding: 'utf8' });
        if (whichRes.status === 0 && whichRes.stdout) {
            const lines = whichRes.stdout.trim().split(/\r?\n/);
            const found = lines.map(l => l.trim()).find(l => fs.existsSync(l) && !l.toLowerCase().includes('antigravity') && !l.startsWith('/mnt/'));
            if (found) {
                return found;
            }
        }
    } catch (_) {}

    if (process.env.CODE_EXECUTABLE && fs.existsSync(process.env.CODE_EXECUTABLE) && !process.env.CODE_EXECUTABLE.toLowerCase().includes('antigravity') && !process.env.CODE_EXECUTABLE.startsWith('/mnt/')) {
        return process.env.CODE_EXECUTABLE;
    }

    return (raw && !raw.toLowerCase().includes('antigravity') && !raw.startsWith('/mnt/')) ? raw : 'code';
}

function quoteWinArg(arg) {
    if (process.platform !== 'win32') return arg;
    if (!arg || !arg.includes(' ')) return arg;
    if (arg.startsWith('"') && arg.endsWith('"')) return arg;
    return `"${arg}"`;
}

function spawnCodeSync(cmd, args, options) {
    const isWin = process.platform === 'win32';
    if (isWin) {
        const commandLine = [quoteWinArg(cmd), ...(args || []).map(quoteWinArg)].join(' ');
        return cp.spawnSync(commandLine, {
            ...options,
            shell: true
        });
    }
    return cp.spawnSync(cmd, args || [], options);
}

function supportsCliOption(cmd, optionName) {
    try {
        const cleanEnv = { ...process.env };
        delete cleanEnv.VSCODE_IPC_HOOK_CLI;
        const res = spawnCodeSync(cmd, ['--help'], { encoding: 'utf8', timeout: 3000, env: cleanEnv });
        const text = (res.stdout || '') + (res.stderr || '');
        return text.includes(optionName);
    } catch (_) {
        return false;
    }
}

function deployExtensionTo(destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const items = ['package.json', 'src', 'languages', 'bin', 'ginga-logo.png', 'README.md', 'LICENSE'];
    for (const item of items) {
        const src = path.resolve(item);
        if (fs.existsSync(src)) {
            const dest = path.join(destDir, item);
            fs.cpSync(src, dest, { recursive: true, force: true });
        }
    }
}

const codeCmd = resolveCodeExecutable();
const vsix = fs.readdirSync('.').find(f => f.endsWith('.vsix'));
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const extId = `${pkg.publisher}.${pkg.name}-${pkg.version}`;

function terminateStaleTestInstances() {
    if (process.platform !== 'win32') {
        try {
            const out = cp.spawnSync('pgrep', ['-f', '.vscode-test/user'], { encoding: 'utf8' }).stdout || '';
            const pids = out.trim().split(/\s+/).filter(Boolean);
            for (const pidStr of pids) {
                const pid = Number(pidStr);
                if (pid && pid !== process.pid) {
                    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
                }
            }
        } catch (_) {}
    }
}
terminateStaleTestInstances();

const testExtDir = path.resolve('.vscode-test', 'exts');
try {
    fs.rmSync(testExtDir, { recursive: true, force: true });
} catch (_) {}
deployExtensionTo(path.join(testExtDir, extId));

const serverExtDir = path.join(os.homedir(), '.vscode-server', 'extensions', extId);
if (fs.existsSync(path.dirname(serverExtDir))) {
    deployExtensionTo(serverExtDir);
}

const localExtDir = path.join(os.homedir(), '.vscode', 'extensions', extId);
if (fs.existsSync(path.dirname(localExtDir))) {
    deployExtensionTo(localExtDir);
}

if (vsix) {
    const cleanEnv = { ...process.env };
    delete cleanEnv.VSCODE_IPC_HOOK_CLI;
    const canUseExtDir = supportsCliOption(codeCmd, '--extensions-dir');
    try {
        if (canUseExtDir) {
            spawnCodeSync(codeCmd, ['--extensions-dir=' + testExtDir, '--install-extension', vsix, '--force'], {
                stdio: 'inherit',
                env: cleanEnv
            });
        }
        spawnCodeSync(codeCmd, ['--install-extension', vsix, '--force'], {
            stdio: 'ignore',
            env: cleanEnv
        });
    } catch (_) {}
}

const rawGingafDir = process.env.GINGA_CODE_GINGAF || '../gingaf';
const gingafDir = path.resolve(expandHome(rawGingafDir));
const isWin = process.platform === 'win32';
const exeName = isWin ? 'gingaf.exe' : 'gingaf';

const candidates = isWin
    ? [
        path.join(gingafDir, 'build', 'windows', 'x64', 'runner', 'Release', 'gingaf.exe'),
        path.join(gingafDir, 'build', exeName),
        path.join(gingafDir, 'bin', exeName),
        path.join(gingafDir, exeName)
    ]
    : [
        path.join(gingafDir, 'build', 'linux', 'x64', 'release', 'bundle', 'gingaf'),
        path.join(gingafDir, 'build', 'macos', 'Build', 'Products', 'Release', 'gingaf.app', 'Contents', 'MacOS', 'gingaf'),
        path.join(gingafDir, 'build', 'windows', 'x64', 'runner', 'Release', 'gingaf.exe'),
        path.join(gingafDir, 'build', exeName),
        path.join(gingafDir, 'build', 'ginga-lsp'),
        path.join(gingafDir, 'bin', exeName),
        path.join(gingafDir, exeName)
    ];

let foundExe = candidates.find(p => fs.existsSync(p));
if (!foundExe && fs.existsSync(gingafDir)) {
    const searchDirs = [path.join(gingafDir, 'build'), path.join(gingafDir, 'bin'), gingafDir];
    for (const d of searchDirs) {
        if (fs.existsSync(d)) {
            const files = fs.readdirSync(d);
            const match = files.find(f => f === 'gingaf' || f === 'gingaf.exe' || f === 'ginga-lsp');
            if (match) {
                foundExe = path.join(d, match);
                break;
            }
        }
    }
}

function updateSettingsFile(targetPath, effectiveExe) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    let settings = {};
    if (fs.existsSync(targetPath)) {
        try {
            settings = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        } catch (_) {}
    }
    settings['ginga.executablePath'] = effectiveExe;
    settings['security.workspace.trust.enabled'] = false;
    settings['security.workspace.trust.startupPrompt'] = 'never';
    settings['security.workspace.trust.emptyWindow'] = 'open';
    settings['window.newWindowDimensions'] = 'maximized';
    settings['git.openRepositoryInParentFolders'] = 'never';
    fs.writeFileSync(targetPath, JSON.stringify(settings, null, 2));
}

const userDir = path.resolve('.vscode-test', 'user', 'User');
const effectiveExe = foundExe || path.join(gingafDir, exeName);
updateSettingsFile(path.join(userDir, 'settings.json'), effectiveExe);

const storageDir = path.join(userDir, 'globalStorage', 'ginga-org-br.ginga-code');
try {
    fs.rmSync(storageDir, { recursive: true, force: true });
} catch (_) {}

try {
    fs.rmSync(path.join(userDir, 'globalStorage', 'state.vscdb'), { force: true });
} catch (_) {}
try {
    fs.rmSync(path.join(userDir, 'globalStorage', 'state.vscdb.backup'), { force: true });
} catch (_) {}

if (foundExe) {
    fs.mkdirSync(storageDir, { recursive: true });
    const parentDir = path.dirname(foundExe);
    const parentBase = path.basename(parentDir);
    const dest = path.join(storageDir, exeName);
    try {
        if (parentBase === 'Release' || parentBase === 'bundle') {
            fs.cpSync(parentDir, storageDir, { recursive: true, force: true });
        } else {
            fs.copyFileSync(foundExe, dest);
        }
        if (!isWin && fs.existsSync(dest)) {
            fs.chmodSync(dest, 0o755);
        }
    } catch (_) {}
}

const rawTargetFolder = process.env.GINGA_CODE_STARTUP_FOLDER || (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'examples');
const targetFolder = expandHome(rawTargetFolder);
const resolvedTarget = path.resolve(targetFolder);

console.log('Configured ginga.executablePath to: ' + effectiveExe);

if (!process.argv.includes('--no-launch') && !process.env.GINGA_SETUP_ONLY) {
    const canUseExtDir = supportsCliOption(codeCmd, '--extensions-dir');
    const canUseUserData = supportsCliOption(codeCmd, '--user-data-dir');

    const launchArgs = ['--new-window'];
    if (canUseUserData) {
        launchArgs.push('--user-data-dir=' + path.resolve('.vscode-test', 'user'));
    }
    if (canUseExtDir) {
        launchArgs.push('--extensions-dir=' + testExtDir);
    }
    launchArgs.push(resolvedTarget);

    const cleanEnv = { ...process.env, DONT_PROMPT_WSL_INSTALL: '1' };
    delete cleanEnv.VSCODE_IPC_HOOK_CLI;

    const res = spawnCodeSync(codeCmd, launchArgs, {
        stdio: 'inherit',
        env: cleanEnv
    });
    if (res.error) {
        console.error('Failed to launch VS Code:', res.error.message || res.error);
        if (res.error.code === 'ENOENT') {
            console.error('Hint: VS Code is not installed or not in PATH.');
            console.error('Run the host dependencies installation script for your platform:');
            console.error('  - Linux:   bash scripts/install-host-deps-ubuntu.sh');
            console.error('  - macOS:   bash scripts/install-host-deps-macos.sh');
            console.error('  - Windows: powershell -ExecutionPolicy Bypass -File scripts/install-host-deps-windows.ps1');
        }
        process.exit(1);
    }
    process.exit(res.status || 0);
}
