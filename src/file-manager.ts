import * as vscode from 'vscode';
import { apiFetch } from './api';

export async function findWorkspaceRfxFiles(): Promise<vscode.Uri[]> {
    return await vscode.workspace.findFiles('**/*.rfx', '**/node_modules/**');
}

export async function uploadWorkspaceFiles(
    context: vscode.ExtensionContext, 
    projectId: string
): Promise<number> {
    const rfxFiles = await findWorkspaceRfxFiles();
    if (rfxFiles.length === 0) return 0;

    const files = await Promise.all(rfxFiles.map(async (uri) => {
        const content = await vscode.workspace.fs.readFile(uri);
        const relativePath = vscode.workspace.asRelativePath(uri);
        return {
            path: relativePath,
            content: Buffer.from(content).toString('utf-8')
        };
    }));

    const res = await apiFetch(context, `/api/v1/projects/${projectId}/files/upload-batch`, {
        method: 'POST',
        body: JSON.stringify({ files })
    });
    const data = await res.json() as any;
    return data.filesUploaded || 0;
}

export async function downloadArtifacts(
    context: vscode.ExtensionContext, 
    sessionId: string, 
    outputChannel: vscode.OutputChannel
): Promise<number> {
    // Verify workspace folder exists
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open - cannot download artifacts');
        return 0;
    }
    
    const res = await apiFetch(context, `/api/v1/sessions/${sessionId}/artifacts`, { method: 'GET' });
    const data = await res.json() as any;
    
    if (!data.artifacts || data.artifacts.length === 0) {
        outputChannel.appendLine('No artifacts to download');
        return 0;
    }

    const outputDir = vscode.Uri.joinPath(workspaceFolders[0].uri, 'output');
    await vscode.workspace.fs.createDirectory(outputDir);

    for (const artifact of data.artifacts) {
        const filePath = vscode.Uri.joinPath(outputDir, artifact.path.replace(/^output\//, ''));
        const dirPath = vscode.Uri.joinPath(filePath, '..');
        await vscode.workspace.fs.createDirectory(dirPath);
        await vscode.workspace.fs.writeFile(filePath, Buffer.from(artifact.content, 'utf-8'));
        outputChannel.appendLine(`Downloaded: ${artifact.path}`);
    }

    vscode.window.showInformationMessage(`Downloaded ${data.artifacts.length} artifact(s) to output/`);
    return data.artifacts.length;
}

