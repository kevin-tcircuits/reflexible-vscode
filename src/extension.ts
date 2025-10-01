import * as vscode from 'vscode';

// Polyfill fetch for older Node.js versions
const fetch = globalThis.fetch || (async (...args: any[]) => {
    const https = await import('https');
    const http = await import('http');
    const url = new URL(args[0]);
    const options = {
        method: args[1]?.method || 'GET',
        headers: args[1]?.headers || {},
        ...args[1]
    };
    
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, options, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    headers: res.headers,
                    text: async () => data,
                    json: async () => JSON.parse(data),
                    body: res
                } as any);
            });
        });
        req.on('error', reject);
        if (args[1]?.body) req.write(args[1].body);
        req.end();
    });
});

class Config {
    static get baseUrl(): string {
        return vscode.workspace.getConfiguration('reflexible').get<string>('baseUrl', 'https://reflexible-web.fly.dev');
    }
    static get projectId(): string | undefined {
        return vscode.workspace.getConfiguration('reflexible').get<string>('projectId');
    }
}

async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const secret = await context.secrets.get('reflexible.apiKey');
    return secret || undefined;
}

async function setApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
    await context.secrets.store('reflexible.apiKey', apiKey);
}

async function ensureApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const existing = await getApiKey(context);
    if (existing) return existing;
    // Open the extension setup page that creates API keys with proper defaults
    const authUrl = `${Config.baseUrl}/ext/setup`;
    await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Log in to Reflexible, generate an API key, then paste it here',
        ignoreFocusOut: true,
        password: true,
        placeHolder: 'Paste your API key (starts with rfx_...)...',
    });
    if (apiKey) {
        await setApiKey(context, apiKey);
        return apiKey;
    }
    return undefined;
}

async function apiFetch(context: vscode.ExtensionContext, path: string, init?: RequestInit) {
    const apiKey = await ensureApiKey(context);
    if (!apiKey) throw new Error('Not authenticated');
    const url = `${Config.baseUrl}${path}`;
    const res = await fetch(url, {
        ...(init || {}),
        headers: {
            'x-api-key': apiKey,
            'content-type': 'application/json',
            ...(init?.headers || {}),
        },
    });
    
    // Handle expired or invalid API key
    if (res.status === 401 || res.status === 403) {
        const text = await res.text().catch(() => '');
        if (text.toLowerCase().includes('expired') || text.toLowerCase().includes('invalid') || text.toLowerCase().includes('unauthorized')) {
            // Clear the stored API key
            await context.secrets.delete('reflexible.apiKey');
            vscode.window.showWarningMessage('Your Reflexible API key has expired or is invalid. Please re-authenticate.', 'Authenticate Now')
                .then(selection => {
                    if (selection === 'Authenticate Now') {
                        vscode.commands.executeCommand('reflexible.authenticate');
                    }
                });
            throw new Error('API key expired or invalid - please re-authenticate');
        }
    }
    
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text}`);
    }
    return res;
}

async function compileCurrentFile(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No active editor'); return; }
    const doc = editor.document;
    if (!doc.fileName.endsWith('.rfx')) { vscode.window.showErrorMessage('Select a .rfx file'); return; }
    const content = doc.getText();
    const projectId = Config.projectId;
    if (!projectId) { vscode.window.showErrorMessage('Configure reflexible.projectId in settings'); return; }
    const body = { filePath: vscode.workspace.asRelativePath(doc.uri), content };
    const res = await apiFetch(context, `/api/v1/projects/${projectId}/rfx/compile`, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json() as any;
    vscode.window.showInformationMessage(data?.result?.output || 'Compilation completed');
}

async function verifyCurrentFile(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('No active editor'); return; }
    const doc = editor.document;
    if (!doc.fileName.endsWith('.rfx')) { vscode.window.showErrorMessage('Select a .rfx file'); return; }
    const content = doc.getText();
    const projectId = Config.projectId;
    if (!projectId) { vscode.window.showErrorMessage('Configure reflexible.projectId in settings'); return; }
    const body = { filePath: vscode.workspace.asRelativePath(doc.uri), content, checkLevel: 'standard' };
    const res = await apiFetch(context, `/api/v1/projects/${projectId}/rfx/verify`, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json() as any;
    vscode.window.showInformationMessage(`Verify: ${data?.result?.status}`);
}

class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'reflexible.chatView';
    private outputChannel: vscode.OutputChannel;
    
    constructor(private readonly context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.outputChannel.appendLine('ChatViewProvider constructor called');
        this.outputChannel.appendLine('Provider has resolveWebviewView: ' + (typeof this.resolveWebviewView));
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        // FIRST LINE - log immediately before anything else
        try {
            this.outputChannel.appendLine('==========================================');
            this.outputChannel.appendLine('resolveWebviewView CALLED!');
            this.outputChannel.appendLine('webviewView object: ' + (webviewView ? 'exists' : 'null'));
            this.outputChannel.appendLine('==========================================');
            vscode.window.showInformationMessage('🎉 Reflexible webview resolving!');
        } catch (e) {
            vscode.window.showErrorMessage('Error in resolveWebviewView start: ' + e);
            return;
        }
        
        try {
            this.outputChannel.appendLine('Setting webview options...');
            webviewView.webview.options = { enableScripts: true };
            this.outputChannel.appendLine('Webview options set');
            
            // Load the full chat interface HTML
            this.outputChannel.appendLine('Generating full chat HTML...');
            const html = this.getHtml();
            
            this.outputChannel.appendLine('Setting HTML, length: ' + html.length);
            webviewView.webview.html = html;
            this.outputChannel.appendLine('HTML set successfully');
            
            vscode.window.showInformationMessage('✅ Reflexible chat loaded!');
            this.outputChannel.appendLine('resolveWebviewView completed successfully');
        } catch (error) {
            this.outputChannel.appendLine('ERROR in resolveWebviewView body: ' + error);
            vscode.window.showErrorMessage('Reflexible webview error: ' + error);
            try {
                webviewView.webview.html = `<html><body><h1>Error</h1><pre>${error}</pre></body></html>`;
            } catch (e2) {
                this.outputChannel.appendLine('Failed to set error HTML: ' + e2);
            }
            return;
        }
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            this.outputChannel.appendLine('Received message from webview: ' + msg.type);
            if (msg.type === 'checkAuthStatus') {
                this.outputChannel.appendLine('Checking auth status...');
                const apiKey = await getApiKey(this.context);
                this.outputChannel.appendLine('API Key exists: ' + !!apiKey);
                webviewView.webview.postMessage({ 
                    type: 'checkAuth', 
                    authenticated: !!apiKey 
                });
                this.outputChannel.appendLine('Sent checkAuth response, authenticated: ' + !!apiKey);
            }
            
            if (msg.type === 'authenticate') {
                this.outputChannel.appendLine('Starting authentication...');
                try {
                    const apiKey = await ensureApiKey(this.context);
                    this.outputChannel.appendLine('Authentication completed, API key: ' + !!apiKey);
                    if (apiKey) {
                        webviewView.webview.postMessage({ type: 'authed' });
                        vscode.window.showInformationMessage('✅ Successfully authenticated with Reflexible');
                        this.outputChannel.appendLine('Sent authed message to webview');
                    } else {
                        throw new Error('Authentication cancelled');
                    }
                } catch (err: any) {
                    const errorMsg = err?.message || String(err);
                    this.outputChannel.appendLine('Authentication error: ' + errorMsg);
                    vscode.window.showErrorMessage(`Authentication failed: ${errorMsg}`);
                    webviewView.webview.postMessage({ 
                        type: 'authError', 
                        error: errorMsg 
                    });
                }
            }
            
            if (msg.type === 'startSession') {
                this.outputChannel.appendLine('Starting session with message: ' + msg.message);
                try {
                    const projectId = Config.projectId;
                    this.outputChannel.appendLine('Project ID: ' + projectId);
                    if (!projectId) {
                        throw new Error('Please configure reflexible.projectId in settings');
                    }
                    
                    this.outputChannel.appendLine('Calling API to dispatch agent...');
                    const res = await apiFetch(this.context, '/api/v1/agent/dispatch', { 
                        method: 'POST', 
                        body: JSON.stringify({ projectId, message: msg.message }) 
                    });
                    const data = await res.json() as any;
                    const sessionId = data.sessionId as string;
                    this.outputChannel.appendLine('Received session ID: ' + sessionId);
                    
                    if (!sessionId) {
                        throw new Error('No session ID returned from server');
                    }
                    
                    webviewView.webview.postMessage({ type: 'session', sessionId });
                    this.outputChannel.appendLine('Starting SSE stream...');
                    this.streamSse(webviewView, sessionId).catch((e: any) => {
                        this.outputChannel.appendLine('SSE stream error: ' + e);
                    });
                } catch (e: any) {
                    const errorMsg = e?.message || String(e);
                    this.outputChannel.appendLine('Session start error: ' + errorMsg);
                    vscode.window.showErrorMessage(`Failed to start session: ${errorMsg}`);
                    webviewView.webview.postMessage({ 
                        type: 'sessionError', 
                        error: errorMsg 
                    });
                }
            }
            
            if (msg.type === 'stopSession') {
                try {
                    await apiFetch(this.context, '/api/v1/agent/stop', { 
                        method: 'POST', 
                        body: JSON.stringify({ sessionId: msg.sessionId }) 
                    });
                    vscode.window.showInformationMessage('Session stopped');
                } catch (e: any) {
                    this.outputChannel.appendLine('Failed to stop session: ' + e);
                }
            }
        });
    }
    private async streamSse(webviewView: vscode.WebviewView, sessionId: string) {
        const apiKey = await getApiKey(this.context);
        if (!apiKey) return;
        const url = `${Config.baseUrl}/api/v1/sse?session_id=${encodeURIComponent(sessionId)}`;
        const resp = await fetch(url, { headers: { 'x-api-key': apiKey } });
        if (!resp.ok || !resp.body) return;
        const reader = resp.body.getReader();
        if (!reader) return;
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
                let event = 'message';
                let data = '';
                for (const line of lines) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    if (line.startsWith('data:')) data += line.slice(5).trim();
                }
                try { webviewView.webview.postMessage({ type: 'sse', event, data: JSON.parse(data) }); } catch {}
            }
            return pump();
        };
        await pump();
    }
    private getHtml(): string {
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      padding: 16px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      border-radius: 2px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px 8px;
      border-radius: 2px;
      width: 100%;
      box-sizing: border-box;
    }
    .status {
      padding: 12px;
      margin-bottom: 12px;
      border-radius: 4px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
    .success {
      background: var(--vscode-terminal-ansiGreen);
      color: var(--vscode-terminal-ansiBrightBlack);
    }
    .section {
      margin-bottom: 16px;
    }
    #log {
      margin-top: 16px;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      max-height: 400px;
      overflow-y: auto;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div id="loginSection" class="section">
    <div class="status">
      <p><strong>⚠️ Not Authenticated</strong></p>
      <p>Please authenticate to use Reflexible AI agent features.</p>
    </div>
    <button id="authBtn">🔐 Authenticate with Reflexible</button>
  </div>

  <div id="chatSection" class="section hidden">
    <div id="statusMsg" class="status success hidden"></div>
    <div id="errorMsg" class="status error hidden"></div>
    
    <div style="margin-bottom: 12px;">
      <label for="msg" style="display: block; margin-bottom: 4px; font-weight: bold;">Message:</label>
      <input id="msg" placeholder="Describe your goal (e.g., 'compile my RFX file')..." />
    </div>
    
    <div style="display: flex; gap: 8px; margin-bottom: 8px;">
      <button id="startBtn">▶️ Start Session</button>
      <button id="stopBtn" disabled>⏹️ Stop Session</button>
      <button id="reAuthBtn" style="margin-left: auto;">🔄 Re-authenticate</button>
    </div>
    
    <div id="log"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let sessionId = null;
    let isAuthenticated = false;

    // UI Elements
    const loginSection = document.getElementById('loginSection');
    const chatSection = document.getElementById('chatSection');
    const authBtn = document.getElementById('authBtn');
    const reAuthBtn = document.getElementById('reAuthBtn');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const msgInput = document.getElementById('msg');
    const log = document.getElementById('log');
    const statusMsg = document.getElementById('statusMsg');
    const errorMsg = document.getElementById('errorMsg');

    function showError(msg) {
      errorMsg.textContent = msg;
      errorMsg.classList.remove('hidden');
      statusMsg.classList.add('hidden');
    }

    function showStatus(msg) {
      statusMsg.textContent = msg;
      statusMsg.classList.remove('hidden');
      errorMsg.classList.add('hidden');
    }

    function hideMessages() {
      statusMsg.classList.add('hidden');
      errorMsg.classList.add('hidden');
    }

    function appendLog(text, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
      log.textContent += \`[\${timestamp}] \${prefix} \${text}\\n\`;
      log.scrollTop = log.scrollHeight;
    }

    function switchToChat() {
      isAuthenticated = true;
      loginSection.classList.add('hidden');
      chatSection.classList.remove('hidden');
      showStatus('✅ Authenticated successfully!');
      setTimeout(hideMessages, 3000);
    }

    function switchToLogin() {
      isAuthenticated = false;
      chatSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
    }

    authBtn.onclick = reAuthBtn.onclick = () => {
      appendLog('Initiating authentication...', 'info');
      vscode.postMessage({ type: 'authenticate' });
    };

    startBtn.onclick = () => {
      const message = msgInput.value.trim();
      if (!message) {
        showError('Please enter a message');
        return;
      }
      hideMessages();
      appendLog('Starting session: ' + message, 'info');
      startBtn.disabled = true;
      stopBtn.disabled = false;
      msgInput.disabled = true;
      vscode.postMessage({ type: 'startSession', message });
    };

    stopBtn.onclick = () => {
      if (sessionId) {
        appendLog('Stopping session...', 'info');
        vscode.postMessage({ type: 'stopSession', sessionId });
      }
      resetUI();
    };

    function resetUI() {
      startBtn.disabled = false;
      stopBtn.disabled = true;
      msgInput.disabled = false;
      sessionId = null;
    }

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const m = event.data;
      
      if (m.type === 'authed') {
        switchToChat();
        appendLog('Authentication successful', 'success');
      }
      
      if (m.type === 'authError') {
        showError('Authentication failed: ' + (m.error || 'Unknown error'));
        appendLog('Authentication failed: ' + m.error, 'error');
        switchToLogin();
      }
      
      if (m.type === 'session') {
        sessionId = m.sessionId;
        showStatus('Session started: ' + sessionId);
        appendLog('Session ID: ' + sessionId, 'success');
      }
      
      if (m.type === 'sessionError') {
        showError('Failed to start session: ' + (m.error || 'Unknown error'));
        appendLog('Session error: ' + m.error, 'error');
        resetUI();
      }
      
      if (m.type === 'sse') {
        appendLog(JSON.stringify(m.data, null, 2), 'info');
      }

      if (m.type === 'checkAuth') {
        if (m.authenticated) {
          switchToChat();
        } else {
          switchToLogin();
        }
      }
    });

    // Check auth status on load
    console.log('[Reflexible WebView] Sending checkAuthStatus message');
    vscode.postMessage({ type: 'checkAuthStatus' });
    console.log('[Reflexible WebView] Script initialized and ready');
  </script>
</body>
</html>`;
        this.outputChannel.appendLine('HTML generation complete');
        return html;
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Use OutputChannel for logging since console.log isn't working
    const outputChannel = vscode.window.createOutputChannel('Reflexible');
    outputChannel.appendLine('========================================');
    outputChannel.appendLine('Extension is activating...');
    outputChannel.show();
    vscode.window.showInformationMessage('🚀 Reflexible extension activated! KEVIN');
    outputChannel.appendLine('Extension ID: reflexible-vscode');
    outputChannel.appendLine('VSCode version: ' + vscode.version);
    outputChannel.appendLine('========================================');
    
    // Register webview provider FIRST before commands
    outputChannel.appendLine('Creating ChatViewProvider...');
    const provider = new ChatViewProvider(context, outputChannel);
    outputChannel.appendLine('Registering webview view provider for: ' + ChatViewProvider.viewType);
    outputChannel.appendLine('Provider instance: ' + (provider ? 'exists' : 'null'));
    outputChannel.appendLine('ViewType value: "' + ChatViewProvider.viewType + '"');
    
    try {
        const registration = vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType, 
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        );
        context.subscriptions.push(registration);
        outputChannel.appendLine('Webview provider registered successfully');
        outputChannel.appendLine('Registration object: ' + (registration ? 'exists' : 'null'));
    } catch (error) {
        outputChannel.appendLine('ERROR registering provider: ' + error);
        vscode.window.showErrorMessage('Failed to register Reflexible view provider: ' + error);
    }
    
    outputChannel.appendLine('Registering commands...');
    
    // WORKAROUND: Create a WebviewPanel instead since WebviewView isn't working
    let currentPanel: vscode.WebviewPanel | undefined;
    
    context.subscriptions.push(
        vscode.commands.registerCommand('reflexible.authenticate', async () => {
            outputChannel.appendLine('Authenticate command triggered');
            await ensureApiKey(context).then(() => vscode.window.showInformationMessage('Authenticated'));
        }),
        vscode.commands.registerCommand('reflexible.compileFile', async () => {
            outputChannel.appendLine('CompileFile command triggered');
            return compileCurrentFile(context);
        }),
        vscode.commands.registerCommand('reflexible.verifyFile', async () => {
            outputChannel.appendLine('VerifyFile command triggered');
            return verifyCurrentFile(context);
        }),
        vscode.commands.registerCommand('reflexible.openPanel', () => {
            outputChannel.appendLine('Open Panel command triggered');
            if (currentPanel) {
                currentPanel.reveal();
            } else {
                currentPanel = vscode.window.createWebviewPanel(
                    'reflexibleChat',
                    'Reflexible Chat',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );
                currentPanel.webview.html = '<html><body><h1 style="color:green;">✅ Reflexible Panel Works!</h1><p>This is a WebviewPanel workaround</p></body></html>';
                currentPanel.onDidDispose(() => {
                    currentPanel = undefined;
                });
                outputChannel.appendLine('WebviewPanel created and shown');
            }
        }),
    );
    outputChannel.appendLine('Commands registered: authenticate, compileFile, verifyFile');
    
    outputChannel.appendLine('========================================');
    outputChannel.appendLine('Extension activated successfully!');
    outputChannel.appendLine('View ID: ' + ChatViewProvider.viewType);
    outputChannel.appendLine('========================================');
    
    // Try to manually focus the view to trigger it
    outputChannel.appendLine('Attempting to focus view...');
    vscode.commands.executeCommand('reflexible.chatView.focus').then(
        () => {
            outputChannel.appendLine('View focus command succeeded');
            // Check if resolveWebviewView was called after focus
            setTimeout(() => {
                outputChannel.appendLine('500ms after focus - was resolveWebviewView called? Check logs above.');
            }, 500);
        },
        (err) => outputChannel.appendLine('View focus command failed: ' + err)
    );
    
    // Also try opening the sidebar
    outputChannel.appendLine('Attempting to open reflexible viewlet...');
    vscode.commands.executeCommand('workbench.view.extension.reflexible').then(
        () => outputChannel.appendLine('Viewlet open command succeeded'),
        (err) => outputChannel.appendLine('Viewlet open command failed: ' + err)
    );
}

export function deactivate() {}



