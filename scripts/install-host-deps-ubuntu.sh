#!/usr/bin/env bash
set -euo pipefail

resolve_code_bin() {
    for candidate in /usr/bin/code /usr/share/code/bin/code /usr/local/bin/code /snap/bin/code; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done
    if command -v code >/dev/null 2>&1; then
        local found
        found="$(command -v code)"
        case "$found" in
            /mnt/*)
                ;;
            *)
                if [ -x "$found" ]; then
                    echo "$found"
                    return 0
                fi
                ;;
        esac
    fi
    return 1
}

if installed_code="$(resolve_code_bin 2>/dev/null)"; then
    printf "VS Code is already installed: %s\n" "$installed_code"
    exit 0
fi

printf "Installing VS Code...\n"

if command -v apt-get >/dev/null 2>&1 || command -v apt >/dev/null 2>&1; then
    if command -v debconf-set-selections >/dev/null 2>&1; then
        echo "code code/add-microsoft-repo boolean true" | sudo debconf-set-selections
    fi
    tmp_deb="$(mktemp /tmp/vscode_XXXXXX.deb)"
    if curl -sSL "https://go.microsoft.com/fwlink/?LinkID=760868" -o "$tmp_deb"; then
        sudo apt update || sudo apt-get update
        if command -v apt >/dev/null 2>&1; then
            sudo apt install -y "$tmp_deb" || {
                sudo dpkg -i "$tmp_deb"
                sudo apt-get install -f -y
            }
        else
            sudo apt-get install -y "$tmp_deb" || {
                sudo dpkg -i "$tmp_deb"
                sudo apt-get install -f -y
            }
        fi
        rm -f "$tmp_deb"
        exit 0
    fi
    rm -f "$tmp_deb"

    if command -v wget >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1; then
        wget -qO- https://packages.microsoft.com/keys/microsoft.asc | sudo gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
        sudo tee /etc/apt/sources.list.d/vscode.sources > /dev/null << 'EOF'
Types: deb
URIs: https://packages.microsoft.com/repos/code
Suites: stable
Components: main
Architectures: amd64,arm64,armhf
Signed-By: /usr/share/keyrings/microsoft.gpg
EOF
        sudo apt update || sudo apt-get update
        sudo apt install -y code || sudo apt-get install -y code
        exit 0
    fi
fi

printf "Package manager not detected. Please install VS Code from https://code.visualstudio.com/Download\n"
exit 1
