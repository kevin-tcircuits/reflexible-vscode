import * as vscode from 'vscode';
import { StatusBarManager } from './status-bar';
import { compileCurrentFile, verifyCurrentFile, authenticateCommand, newSessionCommand } from './commands';
import { ChatPanelManager } from './chat-panel';
import { ProjectTreeProvider } from './project-tree-provider';
import { registerFileSyncProvider, openFile } from './file-sync';
import { apiFetch } from './api';

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Reflexible');
    outputChannel.appendLine('========================================');
    outputChannel.appendLine('Reflexible Extension Activating');
    outputChannel.appendLine('========================================');
    
    // Create status bar items
    const statusBar = new StatusBarManager(context);
    
    // Create chat panel manager
    const chatManager = new ChatPanelManager(context, outputChannel);
    
    // Create project tree
    const projectTree = new ProjectTreeProvider(
        context,
        outputChannel,
        (projectId, projectName) => {
            chatManager.showForProject(projectId, projectName);
            projectTree.setActiveProject(projectId);
        }
    );
    
    const treeView = vscode.window.createTreeView('reflexible.projectTree', {
        treeDataProvider: projectTree,
        showCollapseAll: true,
        canSelectMany: true // Enable multi-select
    });
    context.subscriptions.push(treeView);
    
    // Register file sync provider
    registerFileSyncProvider(context, outputChannel);
    
    // State management
    let currentComputeMode: 'chat' | 'basic' | 'pro' = 'chat';
    
    // Fetch and update config
    async function refreshConfig() {
        try {
            const res = await apiFetch(context, '/api/ext/config', { method: 'GET' });
            const config = await res.json() as any;
            
            if (config.credits) {
                statusBar.updateCredits(config.credits.total, config.credits.promo);
            }
            
            if (config.computeModes && config.computeModes[currentComputeMode]) {
                statusBar.updateMode(currentComputeMode, config.computeModes[currentComputeMode].creditsPerRun);
            }
        } catch (e) {
            outputChannel.appendLine('Failed to fetch config: ' + e);
        }
    }
    
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('reflexible.authenticate', async () => {
            await authenticateCommand(context, outputChannel);
            await refreshConfig();
            await projectTree.loadProjects();
        }),
        vscode.commands.registerCommand('reflexible.reconfigureApiKey', async () => {
            const { reconfigureApiKeyCommand } = await import('./commands');
            await reconfigureApiKeyCommand(context, outputChannel);
            await refreshConfig();
        }),
        vscode.commands.registerCommand('reflexible.compileFile', async () => {
            return compileCurrentFile(context, outputChannel);
        }),
        vscode.commands.registerCommand('reflexible.verifyFile', async () => {
            return verifyCurrentFile(context, outputChannel);
        }),
        vscode.commands.registerCommand('reflexible.newSession', async () => {
            await newSessionCommand(context, outputChannel);
        }),
        vscode.commands.registerCommand('reflexible.createProject', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter project name',
                placeHolder: 'My Reflexible Project'
            });
            if (name) {
                try {
                    await apiFetch(context, '/api/projects', {
                        method: 'POST',
                        body: JSON.stringify({ name })
                    });
                    vscode.window.showInformationMessage(`✅ Project "${name}" created`);
                    await projectTree.loadProjects();
                } catch (e: any) {
                    vscode.window.showErrorMessage('Failed to create project: ' + e.message);
                }
            }
        }),
        vscode.commands.registerCommand('reflexible.activateProject', async (projectId: string, projectName: string) => {
            projectTree.setActiveProject(projectId);
            await chatManager.showForProject(projectId, projectName);
        }),
        vscode.commands.registerCommand('reflexible.openFile', async (projectId: string, file: any) => {
            await openFile(context, outputChannel, projectId, file);
        }),
        vscode.commands.registerCommand('reflexible.downloadBinary', async (projectId: string, file: any) => {
            // Download binary to workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('Please open a workspace folder first');
                return;
            }
            
            try {
                const res = await apiFetch(context, `/api/projects/${projectId}/files/download?path=${encodeURIComponent(file.path)}`, {
                    method: 'GET'
                });
                
                // Follow redirect to S3
                const downloadUrl = res.url;
                const { fetch } = await import('./fetch-polyfill');
                const contentRes = await fetch(downloadUrl);
                const arrayBuffer = await contentRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                // Save to workspace
                const outputDir = vscode.Uri.joinPath(workspaceFolders[0].uri, 'output');
                await vscode.workspace.fs.createDirectory(outputDir);
                const filePath = vscode.Uri.joinPath(outputDir, file.path.split('/').pop());
                await vscode.workspace.fs.writeFile(filePath, buffer);
                
                vscode.window.showInformationMessage(`✅ Downloaded ${file.path} to output/`);
                outputChannel.appendLine(`Downloaded binary: ${file.path}`);
            } catch (e: any) {
                vscode.window.showErrorMessage('Failed to download binary: ' + e.message);
            }
        }),
        vscode.commands.registerCommand('reflexible.renameProject', async (treeItem: any) => {
            const projectId = treeItem.project?.id;
            if (!projectId) return;
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new project name',
                placeHolder: 'New project name'
            });
            if (newName && newName.trim()) {
                try {
                    await apiFetch(context, `/api/projects/${projectId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ name: newName.trim() })
                    });
                    vscode.window.showInformationMessage(`✅ Project renamed to "${newName}"`);
                    await projectTree.loadProjects();
                } catch (e: any) {
                    vscode.window.showErrorMessage('Failed to rename project: ' + e.message);
                }
            }
        }),
        vscode.commands.registerCommand('reflexible.deleteProject', async (treeItem: any) => {
            const projectId = treeItem.project?.id;
            const projectName = treeItem.project?.name;
            if (!projectId || !projectName) return;
            const confirm = await vscode.window.showWarningMessage(
                `Delete project "${projectName}"? This cannot be undone.`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                try {
                    await apiFetch(context, `/api/projects/${projectId}`, {
                        method: 'DELETE'
                    });
                    vscode.window.showInformationMessage(`✅ Project "${projectName}" deleted`);
                    await projectTree.loadProjects();
                } catch (e: any) {
                    vscode.window.showErrorMessage('Failed to delete project: ' + e.message);
                }
            }
        }),
        vscode.commands.registerCommand('reflexible.renameFile', async (treeItem: any) => {
            const file = treeItem.project;
            if (!file || !file.id) return;
            
            const projectId = projectTree.getActiveProjectId();
            if (!projectId) {
                vscode.window.showErrorMessage('No active project');
                return;
            }
            
            const newPath = await vscode.window.showInputBox({
                prompt: 'Enter new file path',
                value: file.path,
                valueSelection: [0, file.path.lastIndexOf('.')] // Select name, not extension
            });
            
            if (newPath && newPath.trim() && newPath !== file.path) {
                try {
                    await apiFetch(context, `/api/v1/projects/${projectId}/files/${file.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ newPath: newPath.trim() })
                    });
                    vscode.window.showInformationMessage(`✅ File renamed to "${newPath}"`);
                    projectTree.refresh();
                } catch (e: any) {
                    vscode.window.showErrorMessage('Failed to rename file: ' + e.message);
                }
            }
        }),
        vscode.commands.registerCommand('reflexible.deleteFile', async (treeItem: any, selectedItems?: any[]) => {
            const projectId = projectTree.getActiveProjectId();
            if (!projectId) {
                vscode.window.showErrorMessage('No active project');
                return;
            }
            
            // Handle multi-select
            const items = selectedItems && selectedItems.length > 0 ? selectedItems : [treeItem];
            const files = items
                .map(item => item.project)
                .filter(f => f && f.id);
            
            if (files.length === 0) return;
            
            const fileNames = files.map(f => f.path).join(', ');
            const confirmMessage = files.length === 1 
                ? `Delete file "${files[0].path}"? This cannot be undone.`
                : `Delete ${files.length} files? This cannot be undone.\n\nFiles: ${fileNames}`;
            
            const confirm = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                'Delete'
            );
            
            if (confirm === 'Delete') {
                let successCount = 0;
                let errorCount = 0;
                
                for (const file of files) {
                    try {
                        await apiFetch(context, `/api/v1/projects/${projectId}/files/${file.id}`, {
                            method: 'DELETE'
                        });
                        successCount++;
                    } catch (e: any) {
                        errorCount++;
                        outputChannel.appendLine(`Failed to delete ${file.path}: ${e.message}`);
                    }
                }
                
                if (successCount > 0) {
                    vscode.window.showInformationMessage(`✅ Deleted ${successCount} file(s)`);
                }
                if (errorCount > 0) {
                    vscode.window.showErrorMessage(`Failed to delete ${errorCount} file(s) - see Output`);
                }
                
                projectTree.refresh();
            }
        }),
        vscode.commands.registerCommand('reflexible.saveFileToLocal', async (treeItem: any, selectedItems?: any[]) => {
            const projectId = projectTree.getActiveProjectId();
            if (!projectId) {
                vscode.window.showErrorMessage('No active project');
                return;
            }
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('Please open a workspace folder first');
                return;
            }
            
            // Handle multi-select
            const items = selectedItems && selectedItems.length > 0 ? selectedItems : [treeItem];
            const files = items
                .map(item => item.project)
                .filter(f => f && f.path);
            
            if (files.length === 0) return;
            
            // For single file, show save dialog
            if (files.length === 1) {
                const file = files[0];
                try {
                    const res = await apiFetch(context, `/api/projects/${projectId}/files/download?path=${encodeURIComponent(file.path)}`, {
                        method: 'GET'
                    });
                    
                    const downloadUrl = res.url;
                    const { fetch } = await import('./fetch-polyfill');
                    const contentRes = await fetch(downloadUrl);
                    
                    const isBinary = file.path.endsWith('.uf2') || file.path.endsWith('.bin') || file.path.endsWith('.hex') || file.path.endsWith('.elf');
                    
                    let buffer: Uint8Array;
                    if (isBinary) {
                        const arrayBuffer = await contentRes.arrayBuffer();
                        buffer = new Uint8Array(arrayBuffer);
                    } else {
                        const text = await contentRes.text();
                        buffer = Buffer.from(text, 'utf-8');
                    }
                    
                    const defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, file.path.split('/').pop());
                    const saveUri = await vscode.window.showSaveDialog({
                        defaultUri,
                        filters: isBinary ? { 'Binary Files': ['uf2', 'bin', 'hex', 'elf'] } : { 'All Files': ['*'] }
                    });
                    
                    if (saveUri) {
                        await vscode.workspace.fs.writeFile(saveUri, buffer);
                        vscode.window.showInformationMessage(`✅ Saved to ${saveUri.fsPath}`);
                        outputChannel.appendLine(`Saved file locally: ${saveUri.fsPath}`);
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage('Failed to save file: ' + e.message);
                }
            } else {
                // For multiple files, save to output folder
                const outputDir = vscode.Uri.joinPath(workspaceFolders[0].uri, 'output');
                await vscode.workspace.fs.createDirectory(outputDir);
                
                let successCount = 0;
                let errorCount = 0;
                
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading ${files.length} files...`,
                    cancellable: false
                }, async (progress) => {
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        progress.report({ 
                            message: `${i + 1}/${files.length}: ${file.path}`,
                            increment: (100 / files.length)
                        });
                        
                        try {
                            const res = await apiFetch(context, `/api/projects/${projectId}/files/download?path=${encodeURIComponent(file.path)}`, {
                                method: 'GET'
                            });
                            
                            const downloadUrl = res.url;
                            const { fetch } = await import('./fetch-polyfill');
                            const contentRes = await fetch(downloadUrl);
                            
                            const isBinary = file.path.endsWith('.uf2') || file.path.endsWith('.bin') || file.path.endsWith('.hex') || file.path.endsWith('.elf');
                            
                            let buffer: Uint8Array;
                            if (isBinary) {
                                const arrayBuffer = await contentRes.arrayBuffer();
                                buffer = new Uint8Array(arrayBuffer);
                            } else {
                                const text = await contentRes.text();
                                buffer = Buffer.from(text, 'utf-8');
                            }
                            
                            const filePath = vscode.Uri.joinPath(outputDir, file.path.split('/').pop());
                            await vscode.workspace.fs.writeFile(filePath, buffer);
                            successCount++;
                        } catch (e: any) {
                            errorCount++;
                            outputChannel.appendLine(`Failed to download ${file.path}: ${e.message}`);
                        }
                    }
                });
                
                if (successCount > 0) {
                    vscode.window.showInformationMessage(`✅ Downloaded ${successCount} file(s) to output/`);
                }
                if (errorCount > 0) {
                    vscode.window.showErrorMessage(`Failed to download ${errorCount} file(s) - see Output`);
                }
            }
        }),
        vscode.commands.registerCommand('reflexible.selectComputeMode', async () => {
            const modes: vscode.QuickPickItem[] = [
                { label: '💬 Chat', description: 'Free', detail: 'Interactive responses' },
                { label: '⚡ Basic', description: '5 credits', detail: 'Full code generation' },
                { label: '🚀 Pro', description: '20 credits', detail: 'Advanced reasoning' }
            ];
            const selected = await vscode.window.showQuickPick(modes, {
                placeHolder: 'Select compute mode'
            });
            if (selected) {
                currentComputeMode = selected.label.includes('Chat') ? 'chat'
                    : selected.label.includes('Basic') ? 'basic'
                    : 'pro';
                await refreshConfig();
            }
        }),
        vscode.commands.registerCommand('reflexible.openSubscription', async () => {
            const { Config } = await import('./config');
            vscode.env.openExternal(vscode.Uri.parse(`${Config.baseUrl}/subscription`));
        })
    );
    
    // Load projects on activation
    projectTree.loadProjects();
    
    // Refresh config on activation and periodically
    refreshConfig();
    setInterval(refreshConfig, 30000); // Every 30 seconds
    
    outputChannel.appendLine('Extension activated successfully!');
}


export function deactivate() {}

