MAKEFLAGS += -s --no-print-directory
.DEFAULT_GOAL := help

.PHONY: help deps build test clean run-vscode-with-extension-only

help:
	@printf "%s\n" \
		"Usage: make [target]" \
		"" \
		"Targets:" \
		"  deps                             Install npm dependencies" \
		"  build                            Build the VS Code extension package" \
		"  test                             Run extension tests" \
		"  clean                            Clean up temporary test and package files" \
		"  run-vscode-with-extension-only   Run VS Code with only this extension loaded"

deps:
	npm install --no-audit --no-fund

build:
	npx @vscode/vsce package


test:
	node test/extension.test.js

clean:
	rm -rf .vscode-test
	rm -f *.vsix

CODE_CMD ?= code

run-vscode-with-extension-only: build
	rm -rf .vscode-test/exts
	rm -rf .vscode-test/user/User/globalStorage/ginga-org-br.ginga-code
	node -e "const cp = require('child_process'); const fs = require('fs'); const vsix = fs.readdirSync('.').find(f => f.endsWith('.vsix')); cp.spawnSync('$(CODE_CMD)', ['--extensions-dir=.vscode-test/exts', '--install-extension', vsix], { stdio: 'inherit', shell: true });"
	$(CODE_CMD) --new-window --user-data-dir=.vscode-test/user --extensions-dir=.vscode-test/exts



