MAKEFLAGS += -s --no-print-directory
.DEFAULT_GOAL := help
$(if $(filter Windows_NT,$(OS)),$(if $(shell where printf 2>nul),,$(error coreutils is not installed. Please run: winget install coreutils)))

.PHONY: help deps deps-host build build-gingaf test clean run-vscode-with-extension-only

GINGA_CODE_GINGAF ?= ../gingaf

ifeq ($(OS),Windows_NT)
CURRENT_OS := windows
GINGAF_BIN := $(strip $(GINGA_CODE_GINGAF))/build/windows/x64/runner/Release/gingaf.exe
else ifneq ($(wildcard /System/Library),)
CURRENT_OS := macos
GINGAF_BIN := $(strip $(GINGA_CODE_GINGAF))/build/macos/Build/Products/Release/gingaf.app/Contents/MacOS/gingaf
else
CURRENT_OS := linux
GINGAF_BIN := $(strip $(GINGA_CODE_GINGAF))/build/linux/x64/release/bundle/gingaf
endif

help:
	@printf "%s\n" \
		"Usage: make [target]" \
		"" \
		"Targets:" \
		"  deps                             Install npm dependencies" \
		"  deps-host                        Install host OS dependencies" \
		"  build                            Build the VS Code extension package" \
		"  test                             Run extension tests" \
		"  clean                            Clean up temporary test and package files" \
		"  run-vscode-with-extension-only   Run VS Code in examples/ folder with extension loaded (default: GINGA_CODE_GINGAF=../gingaf)"

deps:
	npm install --no-audit --no-fund

ifeq ($(CURRENT_OS),windows)
deps-host:
	powershell -ExecutionPolicy Bypass -File scripts/install-host-deps-windows.ps1
else ifeq ($(CURRENT_OS),macos)
deps-host:
	bash scripts/install-host-deps-macos.sh
else
deps-host:
	bash scripts/install-host-deps-ubuntu.sh
endif

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
	$(if $(wildcard $(GINGAF_BIN)),,$(if $(wildcard $(strip $(GINGA_CODE_GINGAF))/Makefile),$(MAKE) -C $(strip $(GINGA_CODE_GINGAF)) release))
	$(if $(wildcard *.vsix),,$(MAKE) build)
	node scripts/setup-vscode-test.js examples
