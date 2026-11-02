const { EventEmitter } = require('node:events');
const fs = require('node:fs');

let vscode;
try {
    vscode = require('vscode');
} catch (_) {}

function setVsCode(customVsCode) {
    vscode = customVsCode;
}

class GingaDebugSession extends EventEmitter {
    constructor() {
        super();
        this._breakpointsBySource = new Map();
        this._currentFile = undefined;
        this._currentLine = 1;
        this._isRunning = false;
        this._seq = 1;
        this._terminated = false;
        this.hasPlayer = false;
        this.onLaunch = undefined;
        this.onDisconnect = undefined;
        this.onContinue = undefined;
        this.onPause = undefined;
        this.onStep = undefined;
        this.onRestart = undefined;
        this.onSetBreakpoints = undefined;
    }

    notifyStopped(line, reason = 'breakpoint') {
        this._currentLine = line;
        this._isRunning = false;
        this._sendEvent('stopped', {
            reason: reason,
            threadId: 1,
            allThreadsStopped: true
        });
    }

    get currentLine() {
        return this._currentLine;
    }

    get currentFile() {
        return this._currentFile;
    }

    get isRunning() {
        return this._isRunning;
    }

    get isTerminated() {
        return this._terminated;
    }

    terminate(exitCode = 0) {
        if (this._terminated) {
            return;
        }
        this._isRunning = false;
        this._terminated = true;
        this._sendEvent('exited', { exitCode });
        this._sendEvent('terminated', {});
    }

    handleMessage(message) {
        const command = message.command;
        const seq = message.seq || 0;
        const args = message.arguments || {};

        switch (command) {
            case 'initialize':
                return this._sendResponse(seq, command, {
                    supportsConfigurationDoneRequest: true,
                    supportsFunctionBreakpoints: false,
                    supportsConditionalBreakpoints: false,
                    supportsEvaluateForHovers: true,
                    supportsStepBack: false,
                    supportsRestartRequest: true
                });

            case 'launch':
                this._currentFile = args.program;
                this._isRunning = true;
                this._currentLine = 1;
                this._sendEvent('initialized', {});
                if (typeof this.onLaunch === 'function') {
                    try {
                        this.onLaunch(args.program, args);
                    } catch (_) {}
                }
                return this._sendResponse(seq, command, {});

            case 'attach':
                this._isRunning = true;
                this._sendEvent('initialized', {});
                return this._sendResponse(seq, command, {});

            case 'setBreakpoints':
                return this._handleSetBreakpoints(seq, command, args);

            case 'setExceptionBreakpoints':
                return this._sendResponse(seq, command, {});

            case 'configurationDone': {
                if (!this.hasPlayer) {
                    const firstBp = this._findNextBreakpoint(this._currentFile, 0);
                    if (firstBp !== undefined) {
                        this._currentLine = firstBp;
                        this._sendEvent('stopped', {
                            reason: 'breakpoint',
                            threadId: 1,
                            allThreadsStopped: true
                        });
                    }
                }
                return this._sendResponse(seq, command, {});
            }

            case 'threads':
                return this._sendResponse(seq, command, {
                    threads: [
                        { id: 1, name: 'Ginga Presentation Engine' }
                    ]
                });

            case 'stackTrace':
                return this._handleStackTrace(seq, command);

            case 'scopes':
                return this._sendResponse(seq, command, {
                    scopes: [
                        { name: 'Active NCL Context', variablesReference: 1000, expensive: false }
                    ]
                });

            case 'variables':
                return this._handleVariables(seq, command, args);

            case 'continue': {
                this._isRunning = true;
                if (typeof this.onContinue === 'function') {
                    try {
                        this.onContinue();
                    } catch (_) {}
                }
                if (!this.hasPlayer) {
                    const nextBp = this._findNextBreakpoint(this._currentFile, this._currentLine);
                    if (nextBp !== undefined) {
                        this._currentLine = nextBp;
                        this._sendEvent('stopped', {
                            reason: 'breakpoint',
                            threadId: 1,
                            allThreadsStopped: true
                        });
                    } else {
                        this.terminate(0);
                    }
                }
                return this._sendResponse(seq, command, { allThreadsContinued: true });
            }

            case 'next':
            case 'stepIn': {
                if (typeof this.onStep === 'function') {
                    try {
                        this.onStep();
                    } catch (_) {}
                }
                if (!this.hasPlayer) {
                    this._currentLine++;
                    const isBp = this._hasBreakpointAt(this._currentFile, this._currentLine);
                    this._sendEvent('stopped', {
                        reason: isBp ? 'breakpoint' : 'step',
                        threadId: 1,
                        allThreadsStopped: true
                    });
                }
                return this._sendResponse(seq, command, {});
            }

            case 'stepOut': {
                if (typeof this.onStep === 'function') {
                    try {
                        this.onStep();
                    } catch (_) {}
                }
                if (!this.hasPlayer) {
                    this._currentLine += 2;
                    const isBp = this._hasBreakpointAt(this._currentFile, this._currentLine);
                    this._sendEvent('stopped', {
                        reason: isBp ? 'breakpoint' : 'step',
                        threadId: 1,
                        allThreadsStopped: true
                    });
                }
                return this._sendResponse(seq, command, {});
            }

            case 'pause':
                this._isRunning = false;
                if (typeof this.onPause === 'function') {
                    try {
                        this.onPause();
                    } catch (_) {}
                }
                this._sendEvent('stopped', {
                    reason: 'pause',
                    threadId: 1,
                    allThreadsStopped: true
                });
                return this._sendResponse(seq, command, {});

            case 'restart': {
                this._currentLine = 1;
                this._isRunning = true;
                this._terminated = false;
                if (typeof this.onRestart === 'function') {
                    try {
                        this.onRestart();
                    } catch (_) {}
                }
                if (!this.hasPlayer) {
                    const firstBp = this._findNextBreakpoint(this._currentFile, 0);
                    if (firstBp !== undefined) {
                        this._currentLine = firstBp;
                        this._sendEvent('stopped', {
                            reason: 'breakpoint',
                            threadId: 1,
                            allThreadsStopped: true
                        });
                    }
                }
                return this._sendResponse(seq, command, {});
            }

            case 'evaluate': {
                const expr = args.expression || '';
                let result = 'nil';
                if (expr === 'activeContext') {
                    result = 'body';
                } else if (expr === 'currentLine') {
                    result = String(this._currentLine);
                } else if (expr === 'state') {
                    result = 'PAUSED';
                } else if (expr.includes('video')) {
                    result = '{id="video", src="butterfly.mp4", status="PLAYING"}';
                } else {
                    result = `"${expr}"`;
                }
                return this._sendResponse(seq, command, {
                    result,
                    variablesReference: 0
                });
            }

            case 'source': {
                const filePath = args.source && args.source.path ? args.source.path : this._currentFile;
                let content = '';
                if (filePath && fs.existsSync(filePath)) {
                    try {
                        content = fs.readFileSync(filePath, 'utf8');
                    } catch (e) { }
                }
                return this._sendResponse(seq, command, { content });
            }

            case 'disconnect':
            case 'terminate':
                this.terminate(0);
                if (typeof this.onDisconnect === 'function') {
                    try {
                        this.onDisconnect();
                    } catch (_) {}
                }
                return this._sendResponse(seq, command, {});

            default:
                return this._sendResponse(seq, command, {}, false, `Unsupported DAP command: ${command}`);
        }
    }

    _handleSetBreakpoints(seq, command, args) {
        const sourcePath = args.source && args.source.path ? args.source.path : 'unknown';
        if (!this._currentFile && sourcePath !== 'unknown') {
            this._currentFile = sourcePath;
        }
        const rawBps = args.breakpoints || [];
        const lines = [];
        const resultBreakpoints = [];

        for (const bp of rawBps) {
            const line = bp.line || 1;
            lines.push(line);
            resultBreakpoints.push({ verified: true, line });
        }

        this._breakpointsBySource.set(sourcePath, lines);
        if (typeof this.onSetBreakpoints === 'function') {
            try {
                this.onSetBreakpoints(lines, sourcePath);
            } catch (_) {}
        }
        return this._sendResponse(seq, command, {
            breakpoints: resultBreakpoints
        });
    }

    _handleStackTrace(seq, command) {
        let frameName = 'NCL Presentation Frame';
        if (this._currentFile && fs.existsSync(this._currentFile)) {
            try {
                const content = fs.readFileSync(this._currentFile, 'utf8');
                const lines = content.split('\n');
                if (this._currentLine >= 1 && this._currentLine <= lines.length) {
                    const lineText = lines[this._currentLine - 1].trim();
                    const idMatch = lineText.match(/id=["']([^"']+)["']/);
                    const tagMatch = lineText.match(/<([a-zA-Z0-9_-]+)/);
                    if (tagMatch && idMatch) {
                        frameName = `NCL Frame: <${tagMatch[1]} id="${idMatch[1]}">`;
                    } else if (tagMatch) {
                        frameName = `NCL Frame: <${tagMatch[1]}>`;
                    }
                }
            } catch (e) { }
        }
        const frames = [
            {
                id: 1,
                name: frameName,
                source: this._currentFile ? { path: this._currentFile, name: this._currentFile.split('/').pop() } : undefined,
                line: this._currentLine,
                column: 1
            }
        ];
        return this._sendResponse(seq, command, {
            stackFrames: frames,
            totalFrames: 1
        });
    }

    _handleVariables(seq, command, args) {
        const ref = args.variablesReference || 0;
        const vars = [];

        if (ref === 1000) {
            vars.push(
                { name: 'activeContext', value: 'body', type: 'Context', variablesReference: 0 },
                { name: 'currentLine', value: String(this._currentLine), type: 'int', variablesReference: 0 },
                { name: 'state', value: 'PAUSED', type: 'EngineState', variablesReference: 0 }
            );
            if (this._currentFile && fs.existsSync(this._currentFile)) {
                try {
                    const content = fs.readFileSync(this._currentFile, 'utf8');
                    const lines = content.split('\n');
                    if (this._currentLine >= 1 && this._currentLine <= lines.length) {
                        const lineText = lines[this._currentLine - 1].trim();
                        vars.push({ name: 'currentCode', value: lineText, type: 'string', variablesReference: 0 });
                        const idMatch = lineText.match(/id=["']([^"']+)["']/);
                        if (idMatch) {
                            vars.push({ name: 'elementId', value: idMatch[1], type: 'string', variablesReference: 0 });
                        }
                        const tagMatch = lineText.match(/<([a-zA-Z0-9_-]+)/);
                        if (tagMatch) {
                            vars.push({ name: 'elementTag', value: tagMatch[1], type: 'string', variablesReference: 0 });
                        }
                    }
                } catch (e) { }
            }
        }

        return this._sendResponse(seq, command, { variables: vars });
    }

    _findNextBreakpoint(source, afterLine) {
        if (!source) return undefined;
        const list = this._breakpointsBySource.get(source);
        if (!list || list.length === 0) return undefined;
        const sorted = [...list].sort((a, b) => a - b);
        return sorted.find(line => line > afterLine);
    }

    _hasBreakpointAt(source, line) {
        if (!source) return false;
        const list = this._breakpointsBySource.get(source);
        return Boolean(list && list.includes(line));
    }

    getBreakpoints(source) {
        if (!source) return [];
        return this._breakpointsBySource.get(source) || [];
    }

    _sendResponse(requestSeq, command, body, success = true, message = undefined) {
        const response = {
            seq: this._seq++,
            type: 'response',
            request_seq: requestSeq,
            command,
            success,
            body
        };
        if (message) {
            response.message = message;
        }
        this.emit('message', response);
        return response;
    }

    _sendEvent(event, body) {
        const eventMsg = {
            seq: this._seq++,
            type: 'event',
            event,
            body
        };
        this.emit('message', eventMsg);
        return eventMsg;
    }
}

class GingaDebugAdapter {
    constructor(session) {
        this.session = session || new GingaDebugSession();
        if (vscode && typeof vscode.EventEmitter === 'function') {
            this._sendMessageEmitter = new vscode.EventEmitter();
            this.onDidSendMessage = this._sendMessageEmitter.event;
            this.session.on('message', (msg) => {
                this._sendMessageEmitter.fire(msg);
            });
        } else {
            this._listeners = [];
            this.onDidSendMessage = (listener) => {
                this._listeners.push(listener);
                this.session.on('message', listener);
                return {
                    dispose: () => {
                        const idx = this._listeners.indexOf(listener);
                        if (idx !== -1) this._listeners.splice(idx, 1);
                        this.session.removeListener('message', listener);
                    }
                };
            };
        }
    }

    handleMessage(message) {
        return this.session.handleMessage(message);
    }

    dispose() {
        if (this.session && typeof this.session.removeAllListeners === 'function') {
            this.session.removeAllListeners();
        }
        if (this._sendMessageEmitter && typeof this._sendMessageEmitter.dispose === 'function') {
            this._sendMessageEmitter.dispose();
        }
    }
}

class GingaConfigurationProvider {
    provideDebugConfigurations(folder, token) {
        return [
            {
                type: 'ginga',
                request: 'launch',
                name: 'Debug Ginga Application',
                program: '${file}'
            }
        ];
    }

    resolveDebugConfiguration(folder, config, token) {
        if (!config || (!config.type && !config.request && !config.name)) {
            config = {
                type: 'ginga',
                request: 'launch',
                name: 'Debug Ginga Application'
            };
        }
        if (!config.type) {
            config.type = 'ginga';
        }
        if (!config.request) {
            config.request = 'launch';
        }
        if (!config.name) {
            config.name = 'Debug Ginga Application';
        }
        if (!config.program) {
            const editor = vscode && vscode.window && vscode.window.activeTextEditor;
            if (editor && editor.document) {
                config.program = editor.document.fileName;
            } else {
                config.program = '${file}';
            }
        }
        return config;
    }

    resolveDebugConfigurationWithSubstitutedVariables(folder, config, token) {
        if (!config.program || config.program === '${file}') {
            const editor = vscode && vscode.window && vscode.window.activeTextEditor;
            if (editor && editor.document) {
                config.program = editor.document.fileName;
            }
        }
        return config;
    }
}

class GingaDebugAdapterDescriptorFactory {
    constructor(createSession = () => new GingaDebugSession()) {
        this._createSession = createSession;
    }

    createDebugAdapterDescriptor(session, executable) {
        const debugSession = this._createSession();
        const adapter = new GingaDebugAdapter(debugSession);
        if (vscode && typeof vscode.DebugAdapterInlineImplementation === 'function') {
            const descriptor = new vscode.DebugAdapterInlineImplementation(adapter);
            descriptor.session = debugSession;
            descriptor.adapter = adapter;
            return descriptor;
        }
        return {
            session: debugSession,
            adapter
        };
    }
}

module.exports = {
    GingaDebugSession,
    GingaDebugAdapter,
    GingaConfigurationProvider,
    GingaDebugAdapterDescriptorFactory,
    setVsCode
};

