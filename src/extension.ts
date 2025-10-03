import * as vscode from 'vscode';
import { ChatTreeProvider } from './chat-tree-provider';
import { StatusBarManager } from './status-bar';
import { compileCurrentFile, verifyCurrentFile, authenticateCommand, newSessionCommand } from './commands';
import { startAISession } from './ai-session';
import { apiFetch } from './api';
import { Config } from './config';

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Reflexible');
    outputChannel.appendLine('========================================');
    outputChannel.appendLine('Reflexible Extension Activating (Native UI)');
    outputChannel.appendLine('========================================');
    
    // Create TreeView provider for chat
    const chatProvider = new ChatTreeProvider(context, outputChannel);
    const treeView = vscode.window.createTreeView('reflexible.chatView', {
        treeDataProvider: chatProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);
    
    // Create status bar items
    const statusBar = new StatusBarManager(context);
    
    // State management
    let currentComputeMode: 'chat' | 'basic' | 'pro' = 'chat';
    
    // Fetch and update config
    async function refreshConfig() {
        try {
            const res = await apiFetch(context, '/api/ext/config', { method: 'GET' });
            const config = await res.json() as any;
            
            if (config.credits) {
                statusBar.updateCredits(config.credits.total, config.credits.promo);
                chatProvider.setConfig(config.credits, config.computeModes);
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
            chatProvider.refresh();
        }),
        vscode.commands.registerCommand('reflexible.compileFile', async () => {
            return compileCurrentFile(context, outputChannel);
        }),
        vscode.commands.registerCommand('reflexible.verifyFile', async () => {
            return verifyCurrentFile(context, outputChannel);
        }),
        vscode.commands.registerCommand('reflexible.newSession', async () => {
            await newSessionCommand(context, outputChannel);
            chatProvider.clearMessages();
        }),
        vscode.commands.registerCommand('reflexible.startAISession', async () => {
            await startAISession(context, outputChannel, chatProvider);
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
        vscode.commands.registerCommand('reflexible.openSubscription', () => {
            vscode.env.openExternal(vscode.Uri.parse(`${Config.baseUrl}/subscription`));
        })
    );
    
    // Refresh config on activation and periodically
    refreshConfig();
    setInterval(refreshConfig, 30000); // Every 30 seconds
    
    outputChannel.appendLine('Extension activated successfully!');
    vscode.window.showInformationMessage('🚀 Reflexible extension activated!');
}

export function deactivate() {}

