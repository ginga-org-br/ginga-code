# Build

`ginga-code` is a VS Code extension for Ginga applications. Follow the workflow below to set up host dependencies, build, test, and run examples.

```bash
make deps-host
make deps
make build
make test
make run-vscode-with-extension-only
```

`make deps-host` installs host OS dependencies (such as VS Code), and `make deps` installs npm dependencies.

## Running Examples

Example NCL, Lua, and HTML documents are located in `examples/`. Run `make run-vscode-with-extension-only` to compile the local Ginga player binary from `GINGA_CODE_GINGAF` (default: `../gingaf`), package and install the `ginga-code` extension into an isolated profile (`.vscode-test`), configure `ginga.executablePath` in test settings, and launch VS Code targeting `examples/` so clicking the **Run Ginga Application** play button in the editor toolbar for an example document (such as `video.ncl` or `image.html`) opens the Ginga player desktop application running the selected document:

```bash
make run-vscode-with-extension-only
make run-vscode-with-extension-only GINGA_CODE_GINGAF=../gingaf
```
