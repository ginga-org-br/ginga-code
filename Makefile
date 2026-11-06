MAKEFLAGS += -s --no-print-directory
.DEFAULT_GOAL := help
$(if $(filter Windows_NT,$(OS)),$(if $(shell where printf 2>nul),,$(error coreutils is not installed. Please run: winget install coreutils)))

.PHONY: help deps build build-gingaf test clean run-vscode-with-extension-only

GINGA_CODE_GINGAF ?= ../gingaf

help:
	@printf "%s\n" \
		"Usage: make [target]" \
		"" \
		"Targets:" \
		"  deps                             Install npm dependencies" \
		"  build                            Build the VS Code extension package" \
		"  test                             Run extension tests" \
		"  clean                            Clean up temporary test and package files" \
		"  run-vscode-with-extension-only   Run VS Code in examples/ folder with extension loaded (default: GINGA_CODE_GINGAF=../gingaf)"

deps:
	npm install --no-audit --no-fund

build:
	rm -f *.vsix
	npx --yes @vscode/vsce package

build-gingaf:
	$(MAKE) -C $(GINGA_CODE_GINGAF) release

test:
	node test/extension.test.js

clean:
	rm -rf .vscode-test
	rm -f *.vsix

BUILD_VSIX_DEP := build

run-vscode-with-extension-only: $(BUILD_VSIX_DEP)
	$(if $(wildcard $(strip $(GINGA_CODE_GINGAF))/Makefile),$(MAKE) -C $(strip $(GINGA_CODE_GINGAF)) release)
	$(if $(wildcard *.vsix),,$(MAKE) build)
	node scripts/setup-vscode-test.js examples
