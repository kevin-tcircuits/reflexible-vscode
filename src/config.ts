import * as vscode from 'vscode';

export class Config {
    static get baseUrl(): string {
        return vscode.workspace.getConfiguration('reflexible').get<string>(
            'baseUrl', 
            'https://reflexible-web-dev.fly.dev'
        );
    }
    
    static get projectId(): string | undefined {
        return vscode.workspace.getConfiguration('reflexible').get<string>('projectId');
    }
}

