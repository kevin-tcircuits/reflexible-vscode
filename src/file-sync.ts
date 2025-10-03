import * as vscode from 'vscode';
import { apiFetch } from './api';

const TEMP_SCHEME = 'reflexible';
const fileCache = new Map<string, { projectId: string, fileId: string, originalContent: string }>();

export class FileSyncProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const key = uri.toString();
        const cached = fileCache.get(key);
        
        if (cached) {
            return cached.originalContent;
        }

        // Parse URI to get project and file info
        const [projectId, fileId] = uri.path.split('/').filter(Boolean);
        
        try {
            // Note: files are stored in S3, need to download via path not fileId
            // This is a placeholder - actual implementation needs file path
            return '// File content loading...';
        } catch (e: any) {
            this.outputChannel.appendLine('Failed to load file: ' + e.message);
            return `// Error loading file: ${e.message}`;
        }
    }

    update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }
}

export async function openFile(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    projectId: string,
    file: any
): Promise<void> {
    try {
        // Download file from S3 via API
        const res = await apiFetch(context, `/api/projects/${projectId}/files/download?path=${encodeURIComponent(file.path)}`, {
            method: 'GET'
        });
        
        // The API returns a redirect to S3, we need to follow it
        const downloadUrl = res.url;
        const contentRes = await fetch(downloadUrl);
        const content = await contentRes.text();

        // Create virtual document
        const uri = vscode.Uri.parse(`${TEMP_SCHEME}:///${projectId}/${file.id}/${file.path}`);
        fileCache.set(uri.toString(), { projectId, fileId: file.id, originalContent: content });

        // Open in editor
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

    } catch (e: any) {
        outputChannel.appendLine('Failed to open file: ' + e.message);
        vscode.window.showErrorMessage('Failed to open file: ' + e.message);
    }
}

export async function saveFile(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    document: vscode.TextDocument
): Promise<void> {
    if (document.uri.scheme !== TEMP_SCHEME) return;

    const key = document.uri.toString();
    const cached = fileCache.get(key);
    
    if (!cached) {
        outputChannel.appendLine('File not in cache, cannot save');
        return;
    }

    const content = document.getText();
    
    // Check if content actually changed
    if (content === cached.originalContent) {
        return;
    }

    try {
        // Extract file path from URI
        const pathParts = document.uri.path.split('/').filter(Boolean);
        const filePath = pathParts.slice(2).join('/'); // Skip projectId and fileId
        
        // Upload to S3 via existing files endpoint
        await apiFetch(context, `/api/projects/${cached.projectId}/files`, {
            method: 'POST',
            body: JSON.stringify({
                path: filePath,
                content
            })
        });

        // Update cache with new content
        cached.originalContent = content;
        fileCache.set(key, cached);
        
        outputChannel.appendLine(`Saved file: ${filePath}`);
        vscode.window.showInformationMessage(`✅ File saved to Reflexible`);

    } catch (e: any) {
        outputChannel.appendLine('Failed to save file: ' + e.message);
        vscode.window.showErrorMessage('Failed to save file: ' + e.message);
    }
}

export function registerFileSyncProvider(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): void {
    const provider = new FileSyncProvider(context, outputChannel);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(TEMP_SCHEME, provider)
    );

    // Auto-save on document save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            await saveFile(context, outputChannel, document);
        })
    );
}

