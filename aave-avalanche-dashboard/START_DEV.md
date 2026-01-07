# Starting Development Server

## Quick Start

Open a terminal and run:

```bash
cd frontend
npm run dev
```

## Expected Output

You should see something like:

```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

## Troubleshooting

### Port Already in Use

If port 5173 is in use, Vite will automatically use the next available port (5174, 5175, etc.)

### Connection Refused

1. **Check if server is running:**
   ```bash
   # Windows PowerShell
   netstat -ano | findstr :5173
   
   # Or check if node is running
   Get-Process -Name node
   ```

2. **Kill existing processes:**
   ```bash
   # Find the process ID (PID) from netstat
   taskkill /PID <PID> /F
   ```

3. **Reinstall dependencies:**
   ```bash
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   npm run dev
   ```

### Dependencies Not Installed

```bash
cd frontend
npm install
npm run dev
```

### Node Version Issues

The project requires Node.js 20.x. Check your version:

```bash
node --version
```

If you need to switch versions, use nvm:
```bash
nvm install 20
nvm use 20
```

## Running in Background

If you want to run it in the background (Windows PowerShell):

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"
```

This opens a new terminal window with the dev server running.

## Access the App

Once running, open your browser to:
- http://localhost:5173
- Or the port shown in the terminal output

