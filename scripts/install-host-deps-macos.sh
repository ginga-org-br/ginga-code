#!/usr/bin/env bash
set -euo pipefail

resolve_code_bin() {
    for candidate in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" /usr/local/bin/code /opt/homebrew/bin/code; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done
    if command -v code >/dev/null 2>&1; then
        command -v code
        return 0
    fi
    return 1
}

if installed_code="$(resolve_code_bin 2>/dev/null)"; then
    printf "VS Code is already installed: %s\n" "$installed_code"
    exit 0
fi

printf "Installing VS Code...\n"

if command -v brew >/dev/null 2>&1; then
    brew install --cask visual-studio-code
    if installed_code="$(resolve_code_bin 2>/dev/null)"; then
        printf "VS Code installed: %s\n" "$installed_code"
    fi
    exit 0
fi

printf "Homebrew not detected. Please install VS Code from https://code.visualstudio.com/Download\n"
exit 1
