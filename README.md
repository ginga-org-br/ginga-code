# ginga-code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

`ginga-code` is a Visual Studio Code extension that enable run [Ginga Applications](http://ginga.org.br/) using the `gingaf` [engine](https://github.com/ginga-org-br/gingaf).

The extension is available to users at the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ginga-org-br.ginga-code).

## Usage

- **Run Ginga Application** (`Ctrl+F5` / `Cmd+F5` | `ginga.openPlayer`): Run playback for the active Ginga document.
- **Debug Ginga Application** (`F5` | `ginga.debugPlayer`): Launch active document in VS Code Run & Debug mode with Breakpoints in `.ncl` and `.html` files.
- **Check for Ginga Player Updates** (`ginga.checkForUpdate`): Check upstream for new `gingaf` engine releases.

## Configuration

The extension automatically downloads and manages the latest compatible `gingaf` player executable on first run. You can also specify a custom or local build manually:

- `ginga.executablePath`: Absolute path to a custom Ginga player (`gingaf`) executable. If not specified, the extension automatically downloads and uses the latest release.
- `vscode.gingafArgs`: Additional command-line arguments (array of strings or string) to pass to `gingaf`.
- `vscode.gingafWorkingDirectory`: Working directory used when launching the player process (`appDirectory` or `workspaceRoot`).
