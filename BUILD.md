# BUILD

Run `make help` to inspect available development targets defined in `Makefile`.

## Development Environment Setup

Run the below for host dependencies (e.g., VSCode):

- **Windows (PowerShell)**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/install-host-deps-windows.ps1
  ```
- **macOS**:
  ```bash
  bash scripts/install-host-deps-macos.sh
  ```
- **Linux (Ubuntu / Debian)**:
  ```bash
  bash scripts/install-host-deps-ubuntu.sh
  ```

Run `make deps` to install npm dependencies.

## Build

Run `make build` to package the VS Code extension (`.vsix`).

## Running Tests

Run `make test` to execute extension unit tests.

## Running Examples and Local Application

Run `make run-vscode-with-extension-only` to launch an isolated VS Code instance targeting the examples workspace (`../gingaf-lsp/examples` by default) with only this extension loaded:

This target performs the following actions:

- Automatically compiles the local Ginga player binary from `GINGA_CODE_GINGAF` if `GINGA_CODE_GINGAF` is passed.
- Packages and installs the `ginga-code` extension into an isolated profile (`.vscode-test`).
- Configures `ginga.executablePath` in test settings to point to the compiled Ginga player executable.
- Launches VS Code in the examples directory.
- Opening an example document (such as `video.ncl` or `image.html`) and clicking the **Run Ginga Application** play button in the editor toolbar (or pressing `F5`) opens the Ginga player desktop application window running the selected document.

You can customize the workspace folder using `GINGA_CODE_STARTUP_FOLDER` (or `FOLDER`):

```bash
make run-vscode-with-extension-only GINGA_CODE_STARTUP_FOLDER=../gingaf-lsp/examples
```

## Build and Verification Workflow

1. Fork or branch from `main`.
2. Install development dependencies (`make deps`).
3. Run extension unit tests (`make test`).
4. Build the extension package (`make build`) and local Ginga player engine (`make build-gingaf`).
5. Launch the extension in an isolated VS Code instance (`make run-vscode-with-extension-only`).
6. Open an example document (such as `video.ncl`) and trigger **Run Ginga Application** to verify that the Ginga player application window opens and renders the document properly.
