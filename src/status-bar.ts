import * as vscode from 'vscode';

export class StatusBarManager {
    private creditsItem: vscode.StatusBarItem;
    private modeItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        // Credits display (left side)
        this.creditsItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.creditsItem.command = 'reflexible.openSubscription';
        this.creditsItem.tooltip = 'Click to manage subscription';
        context.subscriptions.push(this.creditsItem);

        // Mode selector (left side)
        this.modeItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        this.modeItem.command = 'reflexible.selectComputeMode';
        this.modeItem.tooltip = 'Click to change compute mode';
        context.subscriptions.push(this.modeItem);
    }

    updateCredits(total: number, promo: number): void {
        const promoText = promo > 0 ? ` (${promo.toFixed(2)} promo)` : '';
        this.creditsItem.text = `$(credit-card) ${total.toFixed(2)}${promoText}`;
        this.creditsItem.show();
    }

    updateMode(mode: string, credits: number): void {
        const icon = mode === 'chat' ? '$(comment)' 
            : mode === 'basic' ? '$(zap)' 
            : '$(rocket)';
        const costText = credits > 0 ? ` (${credits} cr)` : ' (Free)';
        this.modeItem.text = `${icon} ${mode.charAt(0).toUpperCase() + mode.slice(1)}${costText}`;
        this.modeItem.show();
    }

    hide(): void {
        this.creditsItem.hide();
        this.modeItem.hide();
    }
}

