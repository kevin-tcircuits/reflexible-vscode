# Reflexible VS Code Extension

- Sidebar chat to dispatch workflows and stream status
- Browser-based auth: opens /api/ext/token then paste issued token
- Compile/Verify .rfx files via /api/v1/projects/{projectId}/rfx/*
- Auto-download artifacts can be added next using /api/v1/projects/{projectId}/files

## Settings
- reflexible.baseUrl: SaaS base URL (default: https://reflexible-web.fly.dev)
- reflexible.projectId: Target project id

## Commands
- Reflexible: Authenticate
- Reflexible: Compile RFX File
- Reflexible: Verify RFX File

## Dev
- npm install
- npm run watch
- F5 to launch Extension Development Host

