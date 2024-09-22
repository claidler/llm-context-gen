// extension.ts
import * as vscode from "vscode";
import * as fs from "fs";
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
          const files = await this.getProjectFiles();
          const orderedFiles = this.orderFilesByRecency(files);
          webviewView.webview.postMessage({
            command: "fileList",
            files: orderedFiles,
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
            <p>Provide a prompt and select files to include in the context for the LLM.</p>
            
            <!-- Prompt Input (Changed to Textarea) -->
            <div class="prompt-container">
                <textarea id="promptInput" placeholder="Enter your prompt here" autocomplete="off"></textarea>
            </div>

            <!-- File Selection Input -->
            <div class="input-container">
                <input type="text" id="pathInput" placeholder="Type @ to select a file" autocomplete="off" />
                <div id="dropdown" class="dropdown hidden"></div>
            </div>

            <!-- Selected Files Display -->
            <div id="selectedFiles" class="selected-files"></div>

            <!-- Copy Context Button -->
            <button id="copyButton">Copy Context</button>
            
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

  private orderFilesByRecency(files: string[]): string[] {
    // Files in recentlyOpenedFiles are placed first
    const recent = this.recentlyOpenedFiles.filter((file) =>
      files.includes(file)
    );
    const others = files.filter((file) => !recent.includes(file));
    return [...recent, ...others];
  }

  private async getProjectFiles(): Promise<string[]> {
    const files: string[] = [];

    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const relativeInclude = new vscode.RelativePattern(
          folder,
          "**/*.{ts,dart,js,jsx,tsx,html,css,scss,java,py,go,rb,php,swift,kt,json,yaml,yml,xml}"
        );
        const relativeExclude = new vscode.RelativePattern(
          folder,
          "**/{node_modules,dist,out,build}/**"
        );

        const uris = await vscode.workspace.findFiles(
          relativeInclude,
          relativeExclude,
          10000
        );
        for (const uri of uris) {
          // Exclude the workspace folder name
          files.push(vscode.workspace.asRelativePath(uri, false));
        }
      }
    }
    return files;
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

      for (const relativePath of filesToCopy) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          throw new Error("No workspace folders found.");
        }

        let fileFound = false;
        let absolutePath = "";

        // Search for the file in all workspace folders
        for (const folder of workspaceFolders) {
          absolutePath = path.join(folder.uri.fsPath, relativePath);

          // Check if the file exists
          if (fs.existsSync(absolutePath)) {
            fileFound = true;
            break; // Stop searching once the file is found
          }
        }

        if (!fileFound) {
          throw new Error(
            `File not found in any workspace folders: ${relativePath}`
          );
        }

        // Read file content
        const content = await this.readFileContent(absolutePath);
        contextText += `File: ${relativePath}\nContent:\n${content}\n\n`;
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

  private readFileContent(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }
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
