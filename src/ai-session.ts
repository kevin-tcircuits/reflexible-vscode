import * as vscode from 'vscode';
import { apiFetch } from './api';
import { getEphemeralProject, cleanupEphemeralProject } from './project-manager';
import { uploadWorkspaceFiles, downloadArtifacts } from './file-manager';
import { ChatTreeProvider } from './chat-tree-provider';

export async function startAISession(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    chatProvider: ChatTreeProvider
): Promise<void> {
    // Get user input
    const message = await vscode.window.showInputBox({
        prompt: 'What would you like the AI to do?',
        placeHolder: 'e.g., Create a traffic light controller',
        ignoreFocusOut: true
    });

    if (!message) return;

    // Get compute mode
    const modeItems: vscode.QuickPickItem[] = [
        { label: '💬 Chat', description: 'Interactive, fast responses', detail: 'Free' },
        { label: '⚡ Basic', description: 'Full code generation', detail: '5 credits' },
    ];

    // Add Pro if available (we'll get this from config)
    // For now, just add it
    modeItems.push({ 
        label: '🚀 Pro', 
        description: 'Advanced reasoning', 
        detail: '20 credits' 
    });

    const selectedMode = await vscode.window.showQuickPick(modeItems, {
        placeHolder: 'Select compute mode',
        ignoreFocusOut: true
    });

    if (!selectedMode) return;

    const computeConfig = selectedMode.label.includes('Chat') ? 'chat' 
        : selectedMode.label.includes('Basic') ? 'basic' 
        : 'pro';

    // Add user message to chat
    chatProvider.addMessage('user', message);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running AI Session...',
        cancellable: true
    }, async (progress, token) => {
        try {
            // Get or create ephemeral project
            progress.report({ message: 'Creating project...' });
            const projectId = await getEphemeralProject(context);
            
            // Upload workspace context
            progress.report({ message: 'Uploading workspace files...' });
            const filesUploaded = await uploadWorkspaceFiles(context, projectId);
            outputChannel.appendLine(`Uploaded ${filesUploaded} workspace file(s)`);
            
            // Start agent session
            progress.report({ message: `Starting ${computeConfig} mode...` });
            const res = await apiFetch(context, '/api/v1/agent/dispatch', { 
                method: 'POST', 
                body: JSON.stringify({ 
                    projectId, 
                    message,
                    computeConfig 
                }) 
            });
            const data = await res.json() as any;
            const sessionId = data.sessionId as string;
            
            if (!sessionId) {
                throw new Error('No session ID returned from server');
            }
            
            chatProvider.setSession(sessionId);
            await context.workspaceState.update('currentSessionId', sessionId);
            outputChannel.appendLine('Session ID: ' + sessionId);
            
            // Monitor progress via SSE
            progress.report({ message: 'Processing...' });
            await monitorSession(context, sessionId, progress, token, outputChannel, chatProvider);
            
            // Auto-download artifacts
            progress.report({ message: 'Downloading artifacts...' });
            const artifactCount = await downloadArtifacts(context, sessionId, outputChannel);
            
            if (artifactCount > 0) {
                vscode.window.showInformationMessage(`✅ Session complete! Downloaded ${artifactCount} artifacts to output/`);
                // Cleanup ephemeral project
                await cleanupEphemeralProject(context, projectId, outputChannel);
            }
        } catch (error: any) {
            if (error.message !== 'User cancelled') {
                outputChannel.appendLine('ERROR: ' + error.message);
                vscode.window.showErrorMessage('Session failed: ' + error.message);
                chatProvider.addMessage('assistant', `Error: ${error.message}`);
            }
        }
    });
}

async function monitorSession(
    context: vscode.ExtensionContext,
    sessionId: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
    outputChannel: vscode.OutputChannel,
    chatProvider: ChatTreeProvider
): Promise<void> {
    const { getApiKey } = await import('./api');
    const { Config } = await import('./config');
    const { fetch } = await import('./fetch-polyfill');
    
    const apiKey = await getApiKey(context);
    if (!apiKey) throw new Error('Not authenticated');
    
    const url = `${Config.baseUrl}/api/v1/sse?session_id=${encodeURIComponent(sessionId)}`;
    const resp = await fetch(url, { headers: { 'x-api-key': apiKey } });
    
    if (!resp.ok || !resp.body) {
        throw new Error('Failed to connect to SSE stream');
    }
    
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantResponse = '';
    
    const pump = async (): Promise<void> => {
        if (token.isCancellationRequested) {
            // Stop the session
            await apiFetch(context, '/api/v1/agent/stop', {
                method: 'POST',
                body: JSON.stringify({ sessionId })
            });
            throw new Error('User cancelled');
        }
        
        const { value, done } = await reader.read();
        if (done) return;
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        
        for (const part of parts) {
            const lines = part.split('\n');
            let event = 'message';
            let data = '';
            for (const line of lines) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            
            try {
                const parsed = JSON.parse(data);
                
                if (parsed.type === 'progress') {
                    progress.report({ message: parsed.message });
                    outputChannel.appendLine('Progress: ' + parsed.message);
                } else if (parsed.type === 'complete') {
                    if (assistantResponse) {
                        chatProvider.addMessage('assistant', assistantResponse);
                    }
                    return; // Session complete
                } else if (parsed.type === 'content') {
                    assistantResponse += parsed.message || '';
                } else if (parsed.type === 'error') {
                    throw new Error(parsed.message);
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
        return pump();
    };
    
    await pump();
}

