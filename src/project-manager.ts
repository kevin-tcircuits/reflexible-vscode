import * as vscode from 'vscode';
import { apiFetch } from './api';

export async function getEphemeralProject(context: vscode.ExtensionContext): Promise<string> {
    let projectId = context.workspaceState.get<string>('ephemeralProjectId');
    if (!projectId) {
        const res = await apiFetch(context, '/api/v1/projects/ephemeral', { 
            method: 'POST', 
            body: JSON.stringify({ name: 'VSCode Session' }) 
        });
        const data = await res.json() as any;
        projectId = data.project.id;
        await context.workspaceState.update('ephemeralProjectId', projectId);
    }
    return projectId!;
}

export async function cleanupEphemeralProject(
    context: vscode.ExtensionContext, 
    projectId: string,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    try {
        outputChannel.appendLine('Cleaning up ephemeral project: ' + projectId);
        await apiFetch(context, `/api/v1/projects/${projectId}/cleanup`, { 
            method: 'DELETE' 
        });
        await context.workspaceState.update('ephemeralProjectId', undefined);
        outputChannel.appendLine('Ephemeral project cleaned up');
    } catch (e) {
        outputChannel.appendLine('Failed to cleanup project: ' + e);
    }
}

