# Reflexible VSCode/Cursor Extension

Official IDE extension for Reflexible - bringing AI-powered safety-critical code generation to your editor.

## Features

### 🔐 Authentication
- Secure API key authentication
- Automatic expiration detection
- Easy setup flow via web interface

### 📝 RFX File Operations
- **Compile**: Compile `.rfx` files and download generated `.c`/`.h` files
- **Verify**: Run safety verification checks on your code
- Automatic workspace context upload
- Detailed output in dedicated channel

### 🤖 AI Chat Assistant
- Natural language coding assistance
- Real-time progress tracking with todo lists
- Multiple compute configurations (Basic/Pro)
- Session management with context preservation
- Automatic artifact download to `output/` folder

## Setup

1. **Install the Extension**
   - Install the `.vsix` file via `Extensions: Install from VSIX` command
   - Or drag and drop the `.vsix` file into the Extensions panel

2. **Authenticate**
   - Click the Reflexible icon in the Activity Bar
   - Click "🔐 Authenticate with Reflexible"
   - Log in to your Reflexible account in the browser
   - Click "Generate API Key"
   - Copy and paste the API key back into VSCode/Cursor

3. **Start Using**
   - Open any `.rfx` file
   - Use commands from the Command Palette (`Ctrl+Shift+P`)
   - Or use the chat interface in the sidebar

## Commands

- `Reflexible: Authenticate` - Set up or refresh your API key
- `Reflexible: Compile RFX File` - Compile the current `.rfx` file
- `Reflexible: Verify RFX File` - Run safety verification
- `Reflexible: Start New Session` - Clear context and start fresh
- `Reflexible: Open Chat Panel` - Open chat in an editor tab (alternative view)

## Configuration

Settings are available in VSCode/Cursor settings (search for "Reflexible"):

- `reflexible.baseUrl` - Reflexible API base URL (default: https://reflexible-web-dev.fly.dev)
- `reflexible.projectId` - Default project ID (optional, auto-created if not set)

## Workflows

### Compile a File
1. Open a `.rfx` file
2. Press `Ctrl+Shift+P` → "Reflexible: Compile RFX File"
3. View compilation results in the Output panel
4. Generated files appear in `output/` folder

### AI Assistant
1. Open the Reflexible sidebar
2. Enter your request (e.g., "Create a traffic light controller")
3. Select compute config (Basic or Pro)
4. Click "▶️ Start Session"
5. Watch progress in the todo list
6. Click "⬇️ Download Artifacts" when complete
7. Generated code appears in `output/` folder

### Session Management
- Sessions automatically include all `.rfx` files in your workspace for context
- Use "🔄 New Session" to clear context and start fresh
- Previous session artifacts remain available for download

## Output

All extension activity is logged to the "Reflexible" output channel:
- View → Output → Select "Reflexible" from dropdown
- See detailed logs of API calls, file uploads, and errors

## Security

- API keys are stored securely in VSCode's secret storage
- Keys expire after 30 days (configurable)
- Extension detects expired keys and prompts re-authentication
- Revoke keys anytime from the Reflexible web dashboard

## Support

- Documentation: https://reflexible.ai/docs
- Issues: File via the Reflexible dashboard
- API Docs: https://reflexible.ai/api-docs

## License

See LICENSE file in the extension directory.
