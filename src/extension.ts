// extension.ts
import * as vscode from "vscode";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "llm-context-gen" is now active!'
  );

  // Register the command (optional if you still want the command functionality)
  const disposable = vscode.commands.registerCommand(
    "llm-context-gen.helloWorld",
    () => {
      vscode.window.showInformationMessage("Hello World from llm-context-gen!");
    }
  );

  context.subscriptions.push(disposable);

  // Register the Webview View Provider
  const provider = new HelloWorldViewProvider(context.extensionUri);
  const viewDisposable = vscode.window.registerWebviewViewProvider(
    HelloWorldViewProvider.viewType,
    provider
  );

  context.subscriptions.push(viewDisposable);
}

export function deactivate() {}

// Define the View Provider
class HelloWorldViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "llmContextGenSidebar";

  private recentlyOpenedFiles: string[] = [];
  private readonly maxRecentFiles: number = 10;

  constructor(private readonly extensionUri: vscode.Uri) {
    // Listen to file open events to track recently opened files
    vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    // Allow scripts in the webview
    webviewView.webview.options = {
      enableScripts: true,

      // Restrict the webview to only load resources from the extension's `media` directory
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    // Set the HTML content for the webview
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "requestFileList":
          const entries = await this.getProjectFilesAndFolders();
          const orderedEntries = this.orderFilesByRecency(entries);
          webviewView.webview.postMessage({
            command: "fileList",
            files: orderedEntries,
          });
          break;
        case "copyContext":
          await this.handleCopyContext(
            webviewView.webview,
            message.files,
            message.prompt
          );
          break;
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    // Path to the script and stylesheet
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "script.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "styles.css")
    );

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="${styleUri}">
            <title>LLM Context Gen</title>
        </head>
        <body>
            <h1>LLM Context Gen</h1>
            <p>Provide a prompt and select files or folders to include in the context for the LLM.</p>
            
            <!-- Prompt Input (Changed to Textarea) -->
            <div class="prompt-container">
                <textarea id="promptInput" placeholder="Enter your prompt here" autocomplete="off"></textarea>
            </div>

            <!-- File Selection Input -->
            <div class="input-container">
                <input type="text" id="pathInput" placeholder="Type @ to select a file or folder" autocomplete="off" />
                <div id="dropdown" class="dropdown hidden"></div>
            </div>

            <!-- Selected Files Display -->
            <div id="selectedFiles" class="selected-files"></div>

            <!-- Action Buttons -->
            <div class="button-container">
                <button id="copyButton">Copy Context</button>
                <button id="clearButton">Clear All</button>
            </div>
            
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>
    `;
  }

  private onDidOpenTextDocument(document: vscode.TextDocument) {
    const filePath = vscode.workspace.asRelativePath(document.uri, false);
    this.addToRecentlyOpened(filePath);
  }

  private addToRecentlyOpened(filePath: string) {
    // Remove if already exists
    this.recentlyOpenedFiles = this.recentlyOpenedFiles.filter(
      (file) => file !== filePath
    );
    // Add to the beginning
    this.recentlyOpenedFiles.unshift(filePath);
    // Trim the list to the maximum allowed
    if (this.recentlyOpenedFiles.length > this.maxRecentFiles) {
      this.recentlyOpenedFiles.pop();
    }
  }

  private orderFilesByRecency(entries: FileEntry[]): FileEntry[] {
    // Entries in recentlyOpenedFiles are placed first
    const recent = entries.filter((entry) =>
      this.recentlyOpenedFiles.includes(entry.path)
    );
    const others = entries.filter(
      (entry) => !this.recentlyOpenedFiles.includes(entry.path)
    );
    return [...recent, ...others];
  }

  private async getProjectFilesAndFolders(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    const excludedFolders = ["node_modules", "dist", "out", "build"];

    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        await this.traverseUri(folder.uri, "", entries, excludedFolders);
      }
    }

    return entries;
  }

  private async traverseUri(
    uri: vscode.Uri,
    relativePath: string,
    entries: FileEntry[],
    excludedFolders: string[]
  ) {
    const dirEntries = await vscode.workspace.fs.readDirectory(uri);

    for (const [name, type] of dirEntries) {
      if (
        type === vscode.FileType.Directory &&
        excludedFolders.includes(name)
      ) {
        continue;
      }

      const entryRelativePath = path.posix.join(relativePath, name);
      const entryUri = uri.with({ path: path.posix.join(uri.path, name) });

      entries.push({ path: entryRelativePath, type });

      if (type === vscode.FileType.Directory) {
        // Recursively traverse subfolder
        await this.traverseUri(
          entryUri,
          entryRelativePath,
          entries,
          excludedFolders
        );
      }
    }
  }

  private async handleCopyContext(
    webview: vscode.Webview,
    filesToCopy: string[],
    prompt: string
  ) {
    try {
      let contextText = "";

      if (prompt && prompt.trim() !== "") {
        contextText += `${prompt}\n\n`;
      }

      const excludedFolders = ["node_modules", "dist", "out", "build"];

      for (const relativePath of filesToCopy) {
        const absoluteUri = await this.resolveAbsolutePath(relativePath);

        if (!absoluteUri) {
          throw new Error(
            `File or folder not found in any workspace folders: ${relativePath}`
          );
        }

        const fileStat = await vscode.workspace.fs.stat(absoluteUri);

        if (fileStat.type === vscode.FileType.File) {
          // Read file content
          const content = await this.readFileContent(absoluteUri);
          contextText += `File: ${relativePath}\nContent:\n${content}\n\n`;
        } else if (fileStat.type === vscode.FileType.Directory) {
          // Process folder
          contextText += await this.processFolder(
            absoluteUri,
            relativePath,
            excludedFolders
          );
        }
      }

      // Write to clipboard
      await vscode.env.clipboard.writeText(contextText);

      // Notify the Webview of success
      webview.postMessage({ command: "copySuccess" });
    } catch (error) {
      console.error(error);
      // Notify the Webview of the error
      webview.postMessage({
        command: "copyError",
        message: (error as { message: string }).message,
      });
    }
  }

  private async processFolder(
    folderUri: vscode.Uri,
    relativePath: string,
    excludedFolders: string[]
  ): Promise<string> {
    let contextText = "";
    const dirEntries = await vscode.workspace.fs.readDirectory(folderUri);

    for (const [name, type] of dirEntries) {
      if (
        type === vscode.FileType.Directory &&
        excludedFolders.includes(name)
      ) {
        continue;
      }

      const entryUri = folderUri.with({
        path: path.posix.join(folderUri.path, name),
      });
      const entryRelativePath = path.posix.join(relativePath, name);

      if (type === vscode.FileType.File) {
        // Read file content
        const content = await this.readFileContent(entryUri);
        contextText += `File: ${entryRelativePath}\nContent:\n${content}\n\n`;
      } else if (type === vscode.FileType.Directory) {
        // Recursively process subfolder
        contextText += await this.processFolder(
          entryUri,
          entryRelativePath,
          excludedFolders
        );
      }
    }

    return contextText;
  }

  private async resolveAbsolutePath(
    relativePath: string
  ): Promise<vscode.Uri | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    for (const folder of workspaceFolders) {
      const absolutePath = path.posix.join(folder.uri.fsPath, relativePath);
      const uri = vscode.Uri.file(absolutePath);
      try {
        await vscode.workspace.fs.stat(uri);
        return uri;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async readFileContent(fileUri: vscode.Uri): Promise<string> {
    const fileData = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(fileData).toString("utf8");
  }
}

// Helper interface for file entries
interface FileEntry {
  path: string;
  type: vscode.FileType;
}

// Helper function to generate a nonce
function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
