import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DB_PATH = path.resolve(__dirname, 'data', 'ggr_database.json');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Ensure data folder exists
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

interface ServerDB {
  version: number;
  lastClearedAt: string | null;
  appState: any;
  logData: any[];
}

function loadDB(): ServerDB {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        version: parsed.version || 1,
        lastClearedAt: parsed.lastClearedAt || null,
        appState: parsed.appState || defaultAppState(),
        logData: Array.isArray(parsed.logData) ? parsed.logData : []
      };
    }
  } catch (err) {
    console.error('[SERVER] Error reading DB:', err);
  }

  const initial: ServerDB = {
    version: 1,
    lastClearedAt: null,
    appState: defaultAppState(),
    logData: []
  };
  saveDB(initial);
  return initial;
}

function defaultAppState() {
  return {
    pin: '1234',
    currentPhaseIndex: 0,
    completedToday: {
      pretest: [],
      session1: [],
      session2: [],
      session3: [],
      session4: [],
      posttest: []
    },
    groups: [0, 1, 2, 3].map((i) => ({
      name: `Team ${i + 1}`,
      members: [1, 2, 3, 4, 5].map((n) => `Runner ${n}`)
    })),
    surveyResponses: []
  };
}

function saveDB(data: ServerDB) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[SERVER] Error writing DB:', err);
  }
}

let db = loadDB();

// CORS & No-Cache Headers for instant multi-phone synchronicity
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.path.startsWith('/api/')) {
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Basic health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    app: 'Gamified Grammar Relay',
    version: db.version,
    logCount: db.logData.length,
    lastClearedAt: db.lastClearedAt
  });
});

// Full state & logs sync endpoint for all devices
app.get('/api/sync', (_req: Request, res: Response) => {
  res.json({
    version: db.version,
    lastClearedAt: db.lastClearedAt,
    appState: db.appState,
    logData: db.logData
  });
});

// Lightweight heartbeat polling
app.get('/api/sync/version', (_req: Request, res: Response) => {
  res.json({
    version: db.version,
    lastClearedAt: db.lastClearedAt,
    logCount: db.logData.length
  });
});

// Submit an attempt log from any device runner
app.post('/api/logs/submit', (req: Request, res: Response) => {
  const { newLog, updatedCompleted } = req.body;
  if (!newLog) {
    res.status(400).json({ error: 'Missing log data' });
    return;
  }

  // Avoid duplicate IDs
  const exists = db.logData.some((l) => l.id === newLog.id);
  if (!exists) {
    db.logData.push(newLog);
  }

  if (updatedCompleted) {
    db.appState.completedToday = updatedCompleted;
  }

  db.version += 1;
  saveDB(db);

  res.json({
    success: true,
    version: db.version,
    logCount: db.logData.length,
    completedToday: db.appState.completedToday
  });
});

// CLEAR LOGS: Global reset across all connected phones
app.post('/api/logs/clear', (req: Request, res: Response) => {
  const { teamName, phaseKey, clearAll } = req.body;
  const now = new Date().toISOString();

  if (clearAll) {
    // Wipe all attempt logs completely
    db.logData = [];
    db.appState.completedToday = {
      pretest: [],
      session1: [],
      session2: [],
      session3: [],
      session4: [],
      posttest: []
    };
    db.lastClearedAt = now;
  } else if (teamName && phaseKey) {
    // Clear specific phase for team
    db.logData = db.logData.filter((l) => !(l.team === teamName && l.phase === phaseKey));
    db.lastClearedAt = now;
    const teamIndex = db.appState.groups.findIndex((g: any) => g.name === teamName);
    if (teamIndex !== -1 && db.appState.completedToday[phaseKey]) {
      db.appState.completedToday[phaseKey] = db.appState.completedToday[phaseKey].filter(
        (idx: number) => idx !== teamIndex
      );
    }
  } else if (teamName) {
    // Clear all logs for team
    db.logData = db.logData.filter((l) => l.team !== teamName);
    db.lastClearedAt = now;
    const teamIndex = db.appState.groups.findIndex((g: any) => g.name === teamName);
    if (teamIndex !== -1) {
      Object.keys(db.appState.completedToday).forEach((ph) => {
        db.appState.completedToday[ph] = (db.appState.completedToday[ph] || []).filter(
          (idx: number) => idx !== teamIndex
        );
      });
    }
  }

  db.version += 1;
  saveDB(db);

  res.json({
    success: true,
    version: db.version,
    lastClearedAt: db.lastClearedAt,
    logData: db.logData,
    appState: db.appState
  });
});

// Update app state (e.g. active station, rosters, surveys)
app.post('/api/state/update', (req: Request, res: Response) => {
  const { appState } = req.body;
  if (appState) {
    db.appState = { ...db.appState, ...appState };
    db.version += 1;
    saveDB(db);
  }
  res.json({ success: true, version: db.version, appState: db.appState });
});

// Bulk sync from CSV import
app.post('/api/sync/bulk', (req: Request, res: Response) => {
  const { logs, completedToday, surveys } = req.body;
  if (Array.isArray(logs)) {
    db.logData = logs;
  }
  if (completedToday) {
    db.appState.completedToday = completedToday;
  }
  if (Array.isArray(surveys)) {
    db.appState.surveyResponses = surveys;
  }
  db.version += 1;
  saveDB(db);
  res.json({ success: true, version: db.version, logCount: db.logData.length });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(__dirname, 'dist');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

  if (isProd && hasDist) {
    console.log('[SERVER] Serving production static files from dist/');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.log('[SERVER] Starting Vite middleware in dev mode...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true'
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        if (vite.ssrFixStacktrace) {
          vite.ssrFixStacktrace(e);
        }
        next(e);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Gamified Grammar Relay running on http://0.0.0.0:${PORT} with multi-phone sync`);
  });
}

startServer().catch((err) => {
  console.error('[SERVER] Startup failure:', err);
  process.exit(1);
});
