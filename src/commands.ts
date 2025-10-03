import * as vscode from 'vscode';
import { apiFetch, ensureApiKey } from './api';
import { getEphemeralProject } from './project-manager';
import { uploadWorkspaceFiles } from './file-manager';

export async function compileCurrentFile(
    context: vscode.ExtensionContext, 
    outputChannel: vscode.OutputChannel
): Promise<void> {
    // Check workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
            'Please open a folder in your workspace. Compiled files will be saved there.',
            'Open Folder'
        ).then(selection => {
            if (selection === 'Open Folder') {
                vscode.commands.executeCommand('vscode.openFolder');
            }
        });
        return;
    }
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) { 
        vscode.window.showErrorMessage('No active editor'); 
        return; 
    }
    const doc = editor.document;
    if (!doc.fileName.endsWith('.rfx')) { 
        vscode.window.showErrorMessage('Select a .rfx file'); 
        return; 
    }
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Compiling RFX file...',
        cancellable: false
    }, async (progress) => {
        try {
            // Get or create ephemeral project
            progress.report({ message: 'Creating project...' });
            const projectId = await getEphemeralProject(context);
            
            // Compile
            progress.report({ message: 'Compiling...' });
            const content = doc.getText();
            const body = { filePath: vscode.workspace.asRelativePath(doc.uri), content };
            const res = await apiFetch(context, `/api/v1/projects/${projectId}/rfx/compile`, { 
                method: 'POST', 
                body: JSON.stringify(body) 
            });
            const data = await res.json() as any;
            
            outputChannel.appendLine('='.repeat(60));
            outputChannel.appendLine('COMPILATION RESULT:');
            outputChannel.appendLine(data?.result?.output || 'Compilation completed');
            if (data?.result?.warnings && data.result.warnings.length > 0) {
                outputChannel.appendLine('\nWarnings:');
                data.result.warnings.forEach((w: string) => outputChannel.appendLine(`  - ${w}`));
            }
            if (data?.errors && data.errors.length > 0) {
                outputChannel.appendLine('\nErrors:');
                data.errors.forEach((e: string) => outputChannel.appendLine(`  ❌ ${e}`));
            }
            outputChannel.appendLine('='.repeat(60));
            outputChannel.show();
            
            if (data.success) {
                vscode.window.showInformationMessage('✅ Compilation successful!', 'View Output')
                    .then(choice => {
                        if (choice === 'View Output') outputChannel.show();
                    });
            } else {
                vscode.window.showErrorMessage('❌ Compilation failed - see Output for details', 'View Output')
                    .then(choice => {
                        if (choice === 'View Output') outputChannel.show();
                    });
            }
        } catch (error: any) {
            outputChannel.appendLine('ERROR: ' + error.message);
            vscode.window.showErrorMessage('Compilation failed: ' + error.message);
        }
    });
}

export async function verifyCurrentFile(
    context: vscode.ExtensionContext, 
    outputChannel: vscode.OutputChannel
): Promise<void> {
    // Check workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
            'Please open a folder in your workspace. Verification results will be saved there.',
            'Open Folder'
        ).then(selection => {
            if (selection === 'Open Folder') {
                vscode.commands.executeCommand('vscode.openFolder');
            }
        });
        return;
    }
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) { 
        vscode.window.showErrorMessage('No active editor'); 
        return; 
    }
    const doc = editor.document;
    if (!doc.fileName.endsWith('.rfx')) { 
        vscode.window.showErrorMessage('Select a .rfx file'); 
        return; 
    }
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Verifying RFX file...',
        cancellable: false
    }, async (progress) => {
        try {
            // Get or create ephemeral project
            progress.report({ message: 'Creating project...' });
            const projectId = await getEphemeralProject(context);
            
            // Verify
            progress.report({ message: 'Verifying...' });
            const content = doc.getText();
            const body = { 
                filePath: vscode.workspace.asRelativePath(doc.uri), 
                content, 
                checkLevel: 'standard' 
            };
            const res = await apiFetch(context, `/api/v1/projects/${projectId}/rfx/verify`, { 
                method: 'POST', 
                body: JSON.stringify(body) 
            });
            const data = await res.json() as any;
            
            outputChannel.appendLine('='.repeat(60));
            outputChannel.appendLine('VERIFICATION RESULT:');
            outputChannel.appendLine(`Status: ${data?.result?.status || 'Unknown'}`);
            if (data?.result?.issues && data.result.issues.length > 0) {
                outputChannel.appendLine('\nIssues:');
                data.result.issues.forEach((issue: any) => {
                    outputChannel.appendLine(`  [${issue.severity}] Line ${issue.line}: ${issue.message}`);
                });
            }
            if (data?.result?.warnings && data.result.warnings.length > 0) {
                outputChannel.appendLine('\nWarnings:');
                data.result.warnings.forEach((w: string) => outputChannel.appendLine(`  - ${w}`));
            }
            outputChannel.appendLine('='.repeat(60));
            outputChannel.show();
            
            if (data.success && data.result.status === 'passed') {
                vscode.window.showInformationMessage('✅ Verification passed!', 'View Details')
                    .then(choice => {
                        if (choice === 'View Details') outputChannel.show();
                    });
            } else {
                vscode.window.showWarningMessage('⚠️ Verification found issues - see Output', 'View Details')
                    .then(choice => {
                        if (choice === 'View Details') outputChannel.show();
                    });
            }
        } catch (error: any) {
            outputChannel.appendLine('ERROR: ' + error.message);
            vscode.window.showErrorMessage('Verification failed: ' + error.message);
        }
    });
}

export async function authenticateCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine('Authenticate command triggered');
    await ensureApiKey(context).then(() => vscode.window.showInformationMessage('✅ Authenticated with Reflexible'));
}

export async function reconfigureApiKeyCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine('Reconfigure API key command triggered');
    
    // Clear existing API key
    await context.secrets.delete('reflexible.apiKey');
    outputChannel.appendLine('Existing API key cleared');
    
    // Prompt for new API key
    await ensureApiKey(context).then(() => {
        vscode.window.showInformationMessage('✅ API key reconfigured successfully');
        outputChannel.appendLine('New API key configured');
    });
}

export async function newSessionCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine('New session command triggered');
    await context.workspaceState.update('ephemeralProjectId', undefined);
    await context.workspaceState.update('currentSessionId', undefined);
    vscode.window.showInformationMessage('🔄 New session started - previous context cleared');
}

