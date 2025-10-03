import * as vscode from 'vscode';
import { apiFetch, ensureApiKey, getApiKey } from './api';
import { getEphemeralProject, cleanupEphemeralProject } from './project-manager';
import { uploadWorkspaceFiles, downloadArtifacts } from './file-manager';
import { Config } from './config';

export class ChatPanelManager {
    private static panels: Map<string, vscode.WebviewPanel> = new Map();
    private currentMode: 'chat' | 'basic' | 'pro' = 'chat';
    private config: any = null;
    private currentProjectId: string | null = null;
    private currentProjectName: string | null = null;
    
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public async showForProject(projectId: string, projectName: string) {
        this.currentProjectId = projectId;
        this.currentProjectName = projectName;
        const column = vscode.ViewColumn.Two; // Always open in second column

        // Check if panel already exists for this project
        const existingPanel = ChatPanelManager.panels.get(projectId);
        if (existingPanel) {
            existingPanel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'reflexibleChat',
            `Reflexible: ${projectName}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.iconPath = vscode.Uri.joinPath(
            this.context.extensionUri,
            'media',
            'logo.svg'
        );

        ChatPanelManager.panels.set(projectId, panel);

        await this.updateContent(panel, projectId);
        this.setupMessageHandlers(panel, projectId);

        panel.onDidDispose(() => {
            ChatPanelManager.panels.delete(projectId);
        }, null, this.context.subscriptions);
        
        // Load chat history
        await this.loadChatHistory(panel, projectId);
    }

    private async loadChatHistory(panel: vscode.WebviewPanel, projectId: string) {
        try {
            const res = await apiFetch(this.context, `/api/projects/${projectId}/chat-history`, { method: 'GET' });
            const data = await res.json() as any;
            
            if (data.messages && data.messages.length > 0) {
                panel.webview.postMessage({ 
                    type: 'loadHistory', 
                    messages: data.messages 
                });
                this.outputChannel.appendLine(`Loaded ${data.messages.length} chat messages`);
            }
        } catch (e: any) {
            this.outputChannel.appendLine('Failed to load chat history: ' + e.message);
        }
    }

    private async updateContent(panel: vscode.WebviewPanel, projectId: string) {
        // Fetch config
        try {
            const apiKey = await getApiKey(this.context);
            if (apiKey) {
                const res = await apiFetch(this.context, '/api/ext/config', { method: 'GET' });
                this.config = await res.json();
            }
        } catch (e) {
            this.outputChannel.appendLine('Failed to fetch config: ' + e);
        }

        panel.webview.html = this.getHtml();
        
        // Send config to webview
        if (this.config) {
            panel.webview.postMessage({ type: 'config', config: this.config });
        }
    }

    private setupMessageHandlers(panel: vscode.WebviewPanel, projectId: string) {
        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'authenticate':
                        await this.handleAuthenticate(panel, projectId);
                        break;
                    case 'send':
                        await this.handleSendMessage(panel, projectId, message.text, message.mode);
                        break;
                    case 'stop':
                        await this.handleStop(message.sessionId);
                        break;
                    case 'changeMode':
                        this.currentMode = message.mode;
                        panel.webview.postMessage({ type: 'modeChanged', mode: this.currentMode });
                        break;
                    case 'newSession':
                        await this.handleNewSession(panel, projectId);
                        break;
                }
            },
            null,
            this.context.subscriptions
        );
    }

    private async handleAuthenticate(panel: vscode.WebviewPanel, projectId: string) {
        try {
            const apiKey = await ensureApiKey(this.context);
            if (apiKey) {
                await this.updateContent(panel, projectId);
                panel.webview.postMessage({ type: 'authenticated' });
                vscode.window.showInformationMessage('✅ Authenticated with Reflexible');
            }
        } catch (e: any) {
            this.outputChannel.appendLine('Auth error: ' + e.message);
            panel.webview.postMessage({ type: 'error', message: e.message });
        }
    }

    private async handleNewSession(panel: vscode.WebviewPanel, projectId: string) {
        // Clear chat context on client
        panel.webview.postMessage({ type: 'clearChat' });
        this.outputChannel.appendLine('Started new chat session for project: ' + projectId);
    }

    private async handleSendMessage(panel: vscode.WebviewPanel, projectId: string, text: string, mode: string) {
        if (!text.trim()) return;

        // Check workspace
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            panel.webview.postMessage({ 
                type: 'error', 
                message: 'Please open a folder in your workspace first' 
            });
            return;
        }

        panel.webview.postMessage({ type: 'userMessage', text });

        try {
            // Start session directly without uploading files
            panel.webview.postMessage({ type: 'status', message: `Starting ${mode} session...` });
            const res = await apiFetch(this.context, '/api/v1/agent/dispatch', {
                method: 'POST',
                body: JSON.stringify({
                    projectId,
                    message: text,
                    computeConfig: mode
                })
            });
            const data = await res.json() as any;
            const sessionId = data.sessionId;

            if (!sessionId) {
                throw new Error('No session ID returned');
            }

            panel.webview.postMessage({ type: 'sessionStarted', sessionId });

            // Stream SSE
            await this.streamSSE(panel, sessionId, projectId);

        } catch (e: any) {
            this.outputChannel.appendLine('Send message error: ' + e.message);
            this.outputChannel.appendLine('Stack: ' + e.stack);
            panel.webview.postMessage({ type: 'error', message: e.message });
            vscode.window.showErrorMessage('Reflexible: ' + e.message, 'View Logs').then(selection => {
                if (selection === 'View Logs') {
                    this.outputChannel.show();
                }
            });
        }
    }

    private async handleStop(sessionId: string) {
        try {
            await apiFetch(this.context, '/api/v1/agent/stop', {
                method: 'POST',
                body: JSON.stringify({ sessionId })
            });
            // Note: panel reference not available here, would need to track it
        } catch (e: any) {
            this.outputChannel.appendLine('Failed to stop: ' + e);
        }
    }

    private async streamSSE(panel: vscode.WebviewPanel, sessionId: string, projectId: string) {
        const apiKey = await getApiKey(this.context);
        if (!apiKey) return;

        const { fetch } = await import('./fetch-polyfill');
        const url = `${Config.baseUrl}/api/v1/sse?session_id=${encodeURIComponent(sessionId)}`;
        const resp = await fetch(url, { headers: { 'x-api-key': apiKey } });

        if (!resp.ok || !resp.body) return;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const pump = async (): Promise<void> => {
            const { value, done } = await reader.read();
            if (done) return;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
                const lines = part.split('\n');
                let data = '';
                for (const line of lines) {
                    if (line.startsWith('data:')) data += line.slice(5).trim();
                }

                try {
                    const parsed = JSON.parse(data);
                    panel.webview.postMessage({ type: 'sse', data: parsed });

                    if (parsed.type === 'complete') {
                        // Auto-download artifacts
                        const artifactCount = await downloadArtifacts(
                            this.context,
                            sessionId,
                            this.outputChannel
                        );
                        if (artifactCount > 0) {
                            panel.webview.postMessage({ 
                                type: 'artifactsDownloaded', 
                                count: artifactCount 
                            });
                        }
                        return;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
            return pump();
        };

        await pump();
    }


    private getHtml(): string {
        const apiKey = this.context.secrets.get('reflexible.apiKey');
        const isAuthenticated = !!apiKey;
        
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reflexible AI</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--vscode-sideBar-background);
        }
        .credits {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .message {
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 6px;
        }
        .user-message {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
        }
        .assistant-message {
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .status-message {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .todos {
            margin: 8px 0;
            padding: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 12px;
        }
        .todo-item {
            padding: 4px 0;
        }
        .input-area {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 12px 16px;
            background: var(--vscode-sideBar-background);
        }
        .input-row {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .mode-selector {
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        .input-box {
            flex: 1;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            resize: none;
            min-height: 40px;
            max-height: 120px;
        }
        .send-button {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
        }
        .send-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .auth-prompt {
            text-align: center;
            padding: 40px 20px;
        }
        .auth-button {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div id="authPrompt" class="auth-prompt ${isAuthenticated ? 'hidden' : ''}">
        <h2>🔐 Authentication Required</h2>
        <p style="margin: 16px 0; color: var(--vscode-descriptionForeground);">
            Please authenticate to use Reflexible AI
        </p>
        <button class="auth-button" onclick="authenticate()">Authenticate</button>
    </div>

    <div id="chatInterface" class="${isAuthenticated ? '' : 'hidden'}" style="display: flex; flex-direction: column; height: 100%;">
        <div class="header">
            <div class="credits" id="credits">Credits: Loading...</div>
            <select class="mode-selector" id="modeSelector">
                <option value="chat">💬 Chat (Free)</option>
                <option value="basic">⚡ Basic (5 cr)</option>
                <option value="pro">🚀 Pro (20 cr)</option>
            </select>
        </div>

        <div class="messages" id="messages"></div>

        <div class="input-area">
            <div class="input-row">
                <textarea 
                    id="inputBox" 
                    class="input-box" 
                    placeholder="Ask Reflexible AI..."
                    rows="1"
                ></textarea>
                <button id="sendButton" class="send-button" disabled>→</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messages = document.getElementById('messages');
        const inputBox = document.getElementById('inputBox');
        const sendButton = document.getElementById('sendButton');
        const modeSelector = document.getElementById('modeSelector');
        const creditsEl = document.getElementById('credits');
        const authPrompt = document.getElementById('authPrompt');
        const chatInterface = document.getElementById('chatInterface');
        
        let currentSessionId = null;
        let currentTodos = [];

        // Auto-resize textarea
        inputBox.addEventListener('input', () => {
            inputBox.style.height = 'auto';
            inputBox.style.height = Math.min(inputBox.scrollHeight, 120) + 'px';
            sendButton.disabled = !inputBox.value.trim();
        });

        // Send on Enter (Shift+Enter for new line)
        inputBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        sendButton.onclick = sendMessage;

        modeSelector.onchange = () => {
            vscode.postMessage({ type: 'changeMode', mode: modeSelector.value });
        };

        function authenticate() {
            vscode.postMessage({ type: 'authenticate' });
        }

        function sendMessage() {
            const text = inputBox.value.trim();
            if (!text) return;

            const mode = modeSelector.value;
            vscode.postMessage({ type: 'send', text, mode });
            
            inputBox.value = '';
            inputBox.style.height = 'auto';
            sendButton.disabled = true;
            inputBox.disabled = true;
            sendButton.disabled = true;
        }

        function addMessage(role, content, isStatus = false) {
            const msg = document.createElement('div');
            msg.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');
            if (isStatus) msg.className += ' status-message';
            
            if (role === 'user') {
                msg.innerHTML = '<strong>You:</strong><br>' + escapeHtml(content);
            } else {
                msg.innerHTML = content; // Can contain HTML for formatting
            }
            
            messages.appendChild(msg);
            messages.scrollTop = messages.scrollHeight;
        }

        function updateTodos(todos) {
            const existing = document.querySelector('.todos');
            if (existing) existing.remove();

            if (!todos || todos.length === 0) return;

            const todosDiv = document.createElement('div');
            todosDiv.className = 'todos';
            todosDiv.innerHTML = '<strong>Progress:</strong><br>';
            
            todos.forEach(todo => {
                const icon = todo.status === 'completed' ? '✅'
                    : todo.status === 'in_progress' ? '⏳'
                    : todo.status === 'cancelled' ? '❌'
                    : '⬜';
                const item = document.createElement('div');
                item.className = 'todo-item';
                item.textContent = icon + ' ' + todo.content;
                if (todo.status === 'completed') item.style.opacity = '0.6';
                todosDiv.appendChild(item);
            });

            messages.appendChild(todosDiv);
            messages.scrollTop = messages.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const msg = event.data;

            switch (msg.type) {
                case 'authenticated':
                    authPrompt.classList.add('hidden');
                    chatInterface.classList.remove('hidden');
                    break;

                case 'config':
                    if (msg.config && msg.config.credits) {
                        const c = msg.config.credits;
                        creditsEl.textContent = \`Credits: \${c.total.toFixed(2)}\${c.promo > 0 ? ' (' + c.promo.toFixed(2) + ' promo)' : ''}\`;
                    }
                    break;

                case 'userMessage':
                    addMessage('user', msg.text);
                    break;

                case 'status':
                    addMessage('assistant', msg.message, true);
                    break;

                case 'sessionStarted':
                    currentSessionId = msg.sessionId;
                    addMessage('assistant', '<strong>Session started</strong>', true);
                    break;

                case 'sse':
                    const data = msg.data;
                    if (data.type === 'progress') {
                        addMessage('assistant', data.message, true);
                    } else if (data.type === 'todo_update' && data.todos) {
                        currentTodos = data.todos;
                        updateTodos(currentTodos);
                    } else if (data.type === 'content' || data.type === 'message') {
                        addMessage('assistant', data.message || data.content);
                    } else if (data.type === 'complete') {
                        addMessage('assistant', '<strong>✅ Session completed!</strong>', true);
                        inputBox.disabled = false;
                        currentSessionId = null;
                    } else if (data.type === 'error') {
                        addMessage('assistant', '<strong>❌ Error:</strong> ' + data.message);
                    }
                    break;

                case 'artifactsDownloaded':
                    addMessage('assistant', \`<strong>📥 Downloaded \${msg.count} artifacts</strong> to output/ folder\`, true);
                    break;

                case 'sessionStopped':
                    addMessage('assistant', '<strong>⏹️ Session stopped</strong>', true);
                    inputBox.disabled = false;
                    currentSessionId = null;
                    break;

                case 'error':
                    addMessage('assistant', '<strong>❌ Error:</strong> ' + escapeHtml(msg.message));
                    inputBox.disabled = false;
                    break;
            }
        });

        // Initial state
        sendButton.disabled = true;
    </script>
</body>
</html>`;
    }
}


