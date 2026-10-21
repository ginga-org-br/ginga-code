# BUILD

Run `make help` to inspect available development targets.

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

Run `make run-vscode-with-extension-only` to launch an isolated VS Code instance targeting the `examples/` directory with only this extension loaded. This target automatically compiles the local Ginga player binary from `GINGA_CODE_GINGAF` (default: `../gingaf`), packages and installs the `ginga-code` extension into an isolated profile (`.vscode-test`), configures `ginga.executablePath` in test settings, and opens VS Code so clicking the **Run Ginga Application** play button in the editor toolbar for an example document (such as `video.ncl` or `image.html`) opens the Ginga player desktop application window running the selected document.

## Build and Verification Workflow

1. Fork or branch from `main`.
2. Install development dependencies (`make deps`).
3. Run extension unit tests (`make test`).
4. Build the extension package (`make build`) and local Ginga player engine (`make build-gingaf`).
5. Launch the extension in an isolated VS Code instance (`make run-vscode-with-extension-only`).
6. Open an example document (such as `video.ncl`) and trigger **Run Ginga Application** to verify that the Ginga player application window opens and renders the document properly.
