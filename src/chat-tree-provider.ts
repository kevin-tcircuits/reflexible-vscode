import * as vscode from 'vscode';
import { getApiKey } from './api';

export class ChatTreeProvider implements vscode.TreeDataProvider<ChatItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ChatItem | undefined | null | void> = new vscode.EventEmitter<ChatItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ChatItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private messages: Array<{ role: 'user' | 'assistant', content: string, timestamp: Date }> = [];
    private currentSession: string | null = null;
    private credits: { total: number, promo: number, regular: number } | null = null;
    private computeModes: Record<string, any> | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    addMessage(role: 'user' | 'assistant', content: string): void {
        this.messages.push({ role, content, timestamp: new Date() });
        this.refresh();
    }

    clearMessages(): void {
        this.messages = [];
        this.currentSession = null;
        this.refresh();
    }

    setSession(sessionId: string): void {
        this.currentSession = sessionId;
        this.refresh();
    }

    setConfig(credits: any, computeModes: any): void {
        this.credits = credits;
        this.computeModes = computeModes;
        this.refresh();
    }

    getTreeItem(element: ChatItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ChatItem): Promise<ChatItem[]> {
        if (!element) {
            // Root level items
            const items: ChatItem[] = [];
            
            // Check authentication
            const apiKey = await getApiKey(this.context);
            if (!apiKey) {
                items.push(new ChatItem(
                    '🔐 Click here to authenticate',
                    vscode.TreeItemCollapsibleState.None,
                    'authenticate'
                ));
                return items;
            }

            // Show credits
            if (this.credits) {
                const creditText = `💰 Credits: ${this.credits.total.toFixed(2)}${this.credits.promo > 0 ? ` (${this.credits.promo.toFixed(2)} promo)` : ''}`;
                const creditItem = new ChatItem(creditText, vscode.TreeItemCollapsibleState.None);
                creditItem.command = {
                    command: 'reflexible.openSubscription',
                    title: 'Subscribe'
                };
                items.push(creditItem);
            }

            // Show session status
            if (this.currentSession) {
                items.push(new ChatItem(
                    `📡 Session: ${this.currentSession.substring(0, 8)}...`,
                    vscode.TreeItemCollapsibleState.None
                ));
            }

            // Action buttons
            items.push(new ChatItem(
                '▶️ Start AI Session',
                vscode.TreeItemCollapsibleState.None,
                'startSession'
            ));
            
            items.push(new ChatItem(
                '🔄 New Session',
                vscode.TreeItemCollapsibleState.None,
                'newSession'
            ));

            // Messages
            if (this.messages.length > 0) {
                items.push(new ChatItem(
                    `💬 Messages (${this.messages.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'messagesHeader'
                ));
            }

            return items;
        } else if (element.contextValue === 'messagesHeader') {
            // Show message children
            return this.messages.map(msg => {
                const icon = msg.role === 'user' ? '👤' : '🤖';
                const preview = msg.content.length > 50 
                    ? msg.content.substring(0, 50) + '...'
                    : msg.content;
                return new ChatItem(
                    `${icon} ${preview}`,
                    vscode.TreeItemCollapsibleState.None,
                    'message',
                    msg.content
                );
            });
        }

        return [];
    }
}

class ChatItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue?: string,
        public readonly fullContent?: string
    ) {
        super(label, collapsibleState);
        
        if (contextValue === 'authenticate') {
            this.command = {
                command: 'reflexible.authenticate',
                title: 'Authenticate'
            };
        } else if (contextValue === 'startSession') {
            this.command = {
                command: 'reflexible.startAISession',
                title: 'Start AI Session'
            };
        } else if (contextValue === 'newSession') {
            this.command = {
                command: 'reflexible.newSession',
                title: 'New Session'
            };
        } else if (contextValue === 'message' && fullContent) {
            this.tooltip = fullContent;
        }
    }
}

