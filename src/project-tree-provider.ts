import * as vscode from 'vscode';
import { apiFetch, getApiKey } from './api';

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private projects: any[] = [];
    private activeProjectId: string | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly onProjectActivated: (projectId: string, projectName: string) => void
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async loadProjects(): Promise<void> {
        try {
            const res = await apiFetch(this.context, '/api/projects', { method: 'GET' });
            const data = await res.json() as any;
            this.projects = data.projects || [];
            this.refresh();
        } catch (e: any) {
            this.outputChannel.appendLine('Failed to load projects: ' + e.message);
            this.projects = [];
            this.refresh();
        }
    }

    setActiveProject(projectId: string | null): void {
        this.activeProjectId = projectId;
        this.refresh();
    }

    getActiveProjectId(): string | null {
        return this.activeProjectId;
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        // Check authentication first
        const apiKey = await getApiKey(this.context);
        if (!apiKey) {
            return [new TreeNode(
                '🔐 Click to Authenticate',
                vscode.TreeItemCollapsibleState.None,
                'authenticate',
                { command: 'reflexible.authenticate', title: 'Authenticate' }
            )];
        }

        if (!element) {
            // Root level - show projects
            const projectNodes = this.projects.map(project => {
                const isActive = project.id === this.activeProjectId;
                const label = isActive ? `📂 ${project.name} (active)` : `📁 ${project.name}`;
                const node = new TreeNode(
                    label,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'project',
                    undefined,
                    project
                );
                // Add context menu commands via contextValue
                node.contextValue = 'project';
                return node;
            });

            projectNodes.push(new TreeNode(
                '➕ New Project',
                vscode.TreeItemCollapsibleState.None,
                'newProject',
                { command: 'reflexible.createProject', title: 'Create Project' }
            ));

            return projectNodes;
        }

        if (element.contextValue === 'project') {
            // Project selected - show categories and activate button
            const nodes: TreeNode[] = [];

            if (element.project.id !== this.activeProjectId) {
                nodes.push(new TreeNode(
                    '▶️ Activate Project',
                    vscode.TreeItemCollapsibleState.None,
                    'activateProject',
                    {
                        command: 'reflexible.activateProject',
                        title: 'Activate Project',
                        arguments: [element.project.id, element.project.name]
                    }
                ));
            }

            // Load files and categorize
            try {
                const res = await apiFetch(this.context, `/api/v1/projects/${element.project.id}/files`, { method: 'GET' });
                const data = await res.json() as any;
                const files = data.files || [];

                // Categorize files
                const categories = this.categorizeFiles(files);

                if (categories.reflex.length > 0) {
                    nodes.push(new TreeNode(
                        '📝 Reflex Files',
                        vscode.TreeItemCollapsibleState.Expanded,
                        'category',
                        undefined,
                        undefined,
                        categories.reflex.map(f => new TreeNode(
                            f.path,
                            vscode.TreeItemCollapsibleState.None,
                            'file',
                            {
                                command: 'reflexible.openFile',
                                title: 'Open File',
                                arguments: [element.project.id, f]
                            },
                            f
                        ))
                    ));
                }

                if (categories.config.length > 0) {
                    nodes.push(new TreeNode(
                        '📋 Configuration',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'category',
                        undefined,
                        undefined,
                        categories.config.map(f => new TreeNode(
                            f.path,
                            vscode.TreeItemCollapsibleState.None,
                            'file',
                            {
                                command: 'reflexible.openFile',
                                title: 'Open File',
                                arguments: [element.project.id, f]
                            },
                            f
                        ))
                    ));
                }

                if (categories.output.length > 0) {
                    nodes.push(new TreeNode(
                        '📦 Output',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'category',
                        undefined,
                        undefined,
                        categories.output.map(f => new TreeNode(
                            f.path,
                            vscode.TreeItemCollapsibleState.None,
                            'file',
                            {
                                command: 'reflexible.openFile',
                                title: 'Open File',
                                arguments: [element.project.id, f]
                            },
                            f
                        ))
                    ));
                }

                if (categories.binary.length > 0) {
                    nodes.push(new TreeNode(
                        '💾 Binaries',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        'category',
                        undefined,
                        undefined,
                        categories.binary.map(f => new TreeNode(
                            f.path,
                            vscode.TreeItemCollapsibleState.None,
                            'binary',
                            {
                                command: 'reflexible.downloadBinary',
                                title: 'Download Binary',
                                arguments: [element.project.id, f]
                            },
                            f
                        ))
                    ));
                }

            } catch (e: any) {
                this.outputChannel.appendLine('Failed to load files: ' + e.message);
            }

            return nodes;
        }

        if (element.contextValue === 'category' && element.children) {
            return element.children;
        }

        return [];
    }

    private categorizeFiles(files: any[]): { reflex: any[], config: any[], output: any[], binary: any[] } {
        return {
            reflex: files.filter(f => f.path.endsWith('.rfx')),
            config: files.filter(f => 
                f.path.endsWith('.json') || 
                f.path.endsWith('.yaml') || 
                f.path.endsWith('.toml')
            ),
            output: files.filter(f => 
                (f.path.endsWith('.c') || 
                f.path.endsWith('.h') || 
                f.path.includes('output/') ||
                f.path.includes('report')) &&
                !f.path.endsWith('.uf2') &&
                !f.path.endsWith('.bin') &&
                !f.path.endsWith('.hex')
            ),
            binary: files.filter(f =>
                f.path.endsWith('.uf2') ||
                f.path.endsWith('.bin') ||
                f.path.endsWith('.hex') ||
                f.path.endsWith('.elf')
            )
        };
    }
}

class TreeNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        contextValue: string,
        command?: vscode.Command,
        public readonly project?: any,
        public readonly children?: TreeNode[]
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        if (command) {
            this.command = command;
        }
        
        // Add command arguments for context menu items
        if (contextValue === 'project' && project) {
            this.tooltip = `Right-click for options`;
        }
    }
}

