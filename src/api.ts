import * as vscode from 'vscode';
import { fetch } from './fetch-polyfill';
import { Config } from './config';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    const secret = await context.secrets.get('reflexible.apiKey');
    return secret || undefined;
}

export async function setApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
    await context.secrets.store('reflexible.apiKey', apiKey);
}

export async function ensureApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
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

export async function apiFetch(context: vscode.ExtensionContext, path: string, init?: RequestInit): Promise<Response> {
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
    
    // Handle errors with detailed logging
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const errorDetails = `API Error [${res.status}]:\nEndpoint: ${path}\nResponse: ${text}`;
        
        if (res.status === 401 || res.status === 403) {
            // Log detailed 403/401 error
            console.error('[Reflexible API]', errorDetails);
            
            if (text.toLowerCase().includes('expired') || 
                text.toLowerCase().includes('invalid') || 
                text.toLowerCase().includes('unauthorized') ||
                text.toLowerCase().includes('access denied')) {
                // Clear the stored API key
                await context.secrets.delete('reflexible.apiKey');
                vscode.window.showErrorMessage(
                    `Authentication failed (${res.status}): ${text.substring(0, 100)}`,
                    'Authenticate Now',
                    'Details'
                ).then(selection => {
                    if (selection === 'Authenticate Now') {
                        vscode.commands.executeCommand('reflexible.authenticate');
                    } else if (selection === 'Details') {
                        vscode.window.showErrorMessage(errorDetails);
                    }
                });
                throw new Error(`Authentication failed (${res.status}): ${text}`);
            }
        }
        
        // Show detailed error for all other errors
        vscode.window.showErrorMessage(
            `Reflexible API Error (${res.status}): ${text.substring(0, 200)}`,
            'View Details'
        ).then(selection => {
            if (selection === 'View Details') {
                vscode.window.showErrorMessage(errorDetails);
            }
        });
        
        throw new Error(`${res.status} ${text}`);
    }
    return res;
}

