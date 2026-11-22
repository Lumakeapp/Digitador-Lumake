/* ============================================================
   LUMAKÊ — PROCESSO PRINCIPAL (Electron)

   1. Configurações
   2. Modo crédito
   3. Janela / plano de fundo
   4. Biblioteca de karaokê
      - reconhece VÁRIAS pastas ao mesmo tempo
      - lê TODO o Bloco de Notas (.txt .lst .ini .csv ...)
      - mostra tudo o que está escrito na linha do código
      - funciona mesmo quando o ficheiro de vídeo não existe
   5. Deteção automática de pastas (discos, pastas do sistema e
      programas de karaokê instalados)
   6. Leitor de média (vídeo/áudio interno + leitor do Windows)
   7. IPC / ciclo de vida
   ============================================================ */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let mainWindow = null;

/* ============================================================
   1. CONFIGURAÇÕES
   ============================================================ */

const DEFAULT_SETTINGS = {
  mode: 'free',             // 'free' | 'credits'
  creditCost: 2,            // créditos por música (modo crédito)
  credits: 10,              // saldo actual
  creditsMax: 10,           // limite máximo
  creditPeriodHours: 24,    // renovação automática
  creditRenewAt: null,      // próxima renovação

  backgroundImage: null,    // caminho absoluto da imagem escolhida

  autoStart: false,         // iniciar com o Windows
  fullscreen: true,         // ecrã inteiro
  showScore: true,          // pontuação no fim
  autoPlay: true,           // tocar automaticamente ao registar
  autoNext: true,           // avançar para a próxima da fila
  openUnsupported: true,    // abrir no leitor do Windows
  playerVolume: 0.9,        // volume do leitor interno

  windowWidth: 1280,
  windowHeight: 800,

  libraryPath: null,        // pasta principal (compatibilidade)
  libraryPaths: [],         // TODAS as pastas do karaokê reconhecidas

  adminPin: '1234'
};

const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;
const MAX_WINDOW_SIZE = 2080;

const userDataDir = app.getPath('userData');
const settingsFile = path.join(userDataDir, 'settings.json');
const backgroundsDir = path.join(userDataDir, 'backgrounds');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function ensureDirs() {
  try {
    if (!fs.existsSync(backgroundsDir)) {
      fs.mkdirSync(backgroundsDir, { recursive: true });
    }
  } catch (err) {
    console.error('Não foi possível criar a pasta de imagens:', err);
  }
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = Object.assign({}, DEFAULT_SETTINGS, parsed);

    // compatibilidade: garante sempre um array de pastas
    if (!Array.isArray(merged.libraryPaths)) {
      merged.libraryPaths = merged.libraryPath ? [merged.libraryPath] : [];
    }

    return merged;
  } catch (err) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Não foi possível guardar as configurações:', err);
  }
}

function toPublicSettings(settings) {
  const pub = Object.assign({}, settings);

  if (settings.backgroundImage && fs.existsSync(settings.backgroundImage)) {
    pub.backgroundUrl = pathToFileURL(settings.backgroundImage).href;
  } else {
    pub.backgroundUrl = null;
  }

  pub.libraryPaths = (settings.libraryPaths || []).slice();
  delete pub.backgroundImage;
  delete pub.adminPin;
  return pub;
}

/* ============================================================
   2. MODO CRÉDITO
   ============================================================ */

function creditsMax(settings) {
  return Math.max(1, parseInt(settings.creditsMax, 10) || 10);
}

function creditPeriodMs(settings) {
  const hours = Math.max(1, parseInt(settings.creditPeriodHours, 10) || 24);
  return hours * 60 * 60 * 1000;
}

function applyCreditRenewal(settings) {
  const max = creditsMax(settings);
  const now = Date.now();

  if (settings.mode !== 'credits') {
    if (settings.creditRenewAt) {
      settings.creditRenewAt = null;
      return true;
    }
    return false;
  }

  const renewAt = parseInt(settings.creditRenewAt, 10) || 0;

  if (!renewAt || now >= renewAt) {
    settings.credits = max;
    settings.creditRenewAt = now + creditPeriodMs(settings);
    return true;
  }

  if ((settings.credits || 0) > max) {
    settings.credits = max;
    return true;
  }

  return false;
}

function loadSettingsWithRenewal() {
  const settings = loadSettings();
  if (applyCreditRenewal(settings)) saveSettings(settings);
  return settings;
}

/* ============================================================
   3. JANELA / PLANO DE FUNDO
   ============================================================ */

function applyAutoStart(enabled) {
  try {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;

    const loginSettings = { openAtLogin: !!enabled };

    if (!app.isPackaged) {
      loginSettings.path = process.execPath;
      loginSettings.args = [path.resolve(__dirname)];
    }

    app.setLoginItemSettings(loginSettings);
  } catch (err) {
    console.error('Falha ao configurar a inicialização automática:', err);
  }
}

function removeOldBackgrounds(keepFile) {
  try {
    if (!fs.existsSync(backgroundsDir)) return;

    for (const file of fs.readdirSync(backgroundsDir)) {
      const full = path.join(backgroundsDir, file);
      if (full !== keepFile) {
        try { fs.unlinkSync(full); } catch (e) { /* ignora */ }
      }
    }
  } catch (err) {
    console.error('Falha ao limpar imagens antigas:', err);
  }
}

function createWindow() {
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: clamp(settings.windowWidth, MIN_WINDOW_WIDTH, MAX_WINDOW_SIZE),
    height: clamp(settings.windowHeight, MIN_WINDOW_HEIGHT, MAX_WINDOW_SIZE),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#0a0618',
    fullscreen: !!settings.fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (settings.fullscreen) mainWindow.setFullScreen(true);
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ============================================================
   4. BIBLIOTECA DE KARAOKÊ
   ============================================================ */

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.ogv', '.mkv', '.avi', '.mov', '.wmv',
  '.mpg', '.mpeg', '.flv', '.vob', '.ts', '.m2ts', '.3gp', '.divx',
  '.asf', '.rm', '.rmvb', '.f4v', '.mts'
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus',
  '.wma', '.aif', '.aiff', '.ape', '.ac3', '.mka', '.mp2', '.mpga'
]);

// Karaokê que não é vídeo/áudio directo (abre no leitor do Windows)
const KARAOKE_EXTENSIONS = new Set([
  '.kar', '.mid', '.midi', '.cdg', '.kfn', '.kma', '.kv', '.bmk',
  '.ultrastar', '.txt.kar'
]);

// Pacotes de karaokê
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.kgp']);

// Listas do Bloco de Notas e derivados
const INDEX_EXTENSIONS = new Set([
  '.txt', '.lst', '.list', '.ini', '.csv', '.tsv', '.dat', '.idx',
  '.log', '.nfo', '.md', '.tab', '.inf', '.cfg'
]);

// O que o motor interno (Chromium) consegue tocar
const PLAYABLE_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.ogv', '.mov',
  '.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac'
]);

const MAX_LIBRARY_FILES = 80000;
const MAX_SCAN_DEPTH = 10;
const MAX_INDEX_BYTES = 24 * 1024 * 1024;
const MAX_INDEX_ROWS = 60000;

const SKIP_SCAN_DIRS = new Set([
  'node_modules', '.git', '.svn', '$recycle.bin',
  'system volume information', 'windows', 'winsxs'
]);

const library = {
  folders: [],
  entries: [],         // ficheiros reais (vídeo, áudio, karaokê, pacotes)
  indexEntries: [],    // códigos que só existem no Bloco de Notas
  notepadFiles: [],    // listas lidas
  byCode: new Map(),
  byCodeLoose: new Map(),
  byName: new Map(),
  indexByCode: new Map(),
  indexByCodeLoose: new Map(),
  scannedAt: null,
  stats: {
    media: 0,
    playable: 0,
    unplayable: 0,
    labeled: 0,
    indexFiles: 0,
    indexRows: 0,
    indexOnly: 0,
    others: 0,
    karaoke: 0,
    archives: 0,
    skipped: 0,
    vsBankFiles: 0,
    vsRecords: 0,
    vsAdded: 0,
    vsMerged: 0,
    vsMissing: 0
  }
};

let libraryPromise = null;
let detectionPromise = null;

/* ---------------------- Utilidades de texto ---------------------- */

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Lê Notepad em UTF-8, UTF-16 (LE/BE) e ANSI (cp1252)
function readTextSafe(file) {
  const buffer = fs.readFileSync(file);

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/, '');
  }

  let text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) text = buffer.toString('latin1');

  return text.replace(/^\uFEFF/, '');
}

function cleanWords(text) {
  return String(text || '')
    .replace(/^[\s\-–—=:|;,._~]+/, '')
    .replace(/[\s\-–—=:|;,._~]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isFolder(folder) {
  try {
    return !!folder && fs.statSync(folder).isDirectory();
  } catch (err) {
    return false;
  }
}

function shouldSkipDir(name) {
  const lower = String(name || '').toLowerCase();
  if (!lower || lower.startsWith('.')) return true;
  return SKIP_SCAN_DIRS.has(lower);
}

/* ---------------------- Leitura de códigos ---------------------- */

// "1234" | "[1234]" | "1234." | "1234 -" | "1234)" | "1234:"
const CODE_ALONE = /^[\[\(\{\s#]*(\d{1,8})[\]\)\}\s.\-–—:_#]*$/;
const CODE_HEAD = /^[\[\(\{\s#]*(\d{1,8})[\s\]\)\}\.\-–—:_]+([\s\S]+)$/;

function splitIndexFields(raw) {
  if (/\t/.test(raw)) return raw.split('\t');
  if (raw.includes('|')) return raw.split('|');
  if (raw.includes(';')) return raw.split(';');
  if (/[a-z0-9_ ]+\s*=/.test(raw)) return raw.split('=');
  return [raw];
}

/**
 * Lê uma linha do Bloco de Notas e devolve TUDO o que lá está escrito.
 * Suporta: "1234 - Artista - Título", "1234|Artista|Título|Álbum",
 * "1234 ; Artista ; Título", "1234=Título=Artista", "[1234] ..." etc.
 */


/* ------------------------------------------------------------
   BANCO DO VS KARAOKÊ — PASTAS E ÍNDICE DE VÍDEOS
   ------------------------------------------------------------ */

const VS_BD_INI_PATH = 'C:\\Videoke\\BD.ini';
const VS_BD_MEDIA_ROOT = 'C:\\Videoke\\musicas';

let vsMediaIndexCache = { root: null, at: 0, byName: new Map() };

// Índice "nome do ficheiro" → caminho real dentro da pasta dos vídeos.
function vsMediaIndexOf(mediaRoot) {
    const root = path.resolve(String(mediaRoot || ''));
    const now = Date.now();

    if (vsMediaIndexCache.root === root && now - vsMediaIndexCache.at < 20000) {
        return vsMediaIndexCache.byName;
    }

    const byName = new Map();

    const add = (name, file) => {
        const key = String(name || '').trim().toLowerCase();
        if (!key) return;
        if (!byName.has(key)) byName.set(key, file);
    };

    const queue = [{ dir: root, depth: 0 }];

    while (queue.length) {
        const item = queue.shift();

        let children = [];

        try {
            children = fs.readdirSync(item.dir, { withFileTypes: true });
        } catch (err) {
            continue;
        }

        for (const child of children) {
            const full = path.join(item.dir, child.name);

            if (child.isDirectory()) {
                if (item.depth < 3 && !shouldSkipDir(child.name)) {
                    queue.push({ dir: full, depth: item.depth + 1 });
                }
                continue;
            }

            if (!child.isFile()) continue;

            const ext = path.extname(child.name).toLowerCase();

            add(child.name, full);
            add(child.name.slice(0, child.name.length - ext.length), full);
        }
    }

    vsMediaIndexCache = { root, at: now, byName };

    return byName;
}

// Descobre o vídeo indicado pelo campo "arquivo" do BD.ini.
function vsMediaPathOf(mediaRoot, value, code, byName) {
    const root = path.resolve(String(mediaRoot || ''));

    const inside = (candidate) => {
        const full = path.resolve(candidate);
        const relative = path.relative(root, full);
        const ok = relative === '' ||
            (!relative.startsWith('..') && !path.isAbsolute(relative));

        return ok ? full : null;
    };

    const wanted = String(value == null ? '' : value)
        .trim()
        .replace(/^["']+|["']+$/g, '');

    if (wanted && path.isAbsolute(wanted)) {
        const full = inside(wanted);
        if (full && fs.existsSync(full)) return full;
    }

    const names = [];

    if (wanted) names.push(wanted, path.basename(wanted));

    if (code) {
        names.push(code + '.mp4');
        names.push(String(parseInt(code, 10)) + '.mp4');
    }

    for (const name of names) {
        const key = String(name || '').trim().toLowerCase();
        if (!key) continue;

        if (byName.has(key)) return byName.get(key);

        const bare = key.replace(/\.[a-z0-9]{1,6}$/i, '');
        if (bare !== key && byName.has(bare)) return byName.get(bare);

        const direct = inside(path.join(root, name));
        if (direct && fs.existsSync(direct)) return direct;
    }

    return null;
}

// BD.ini do VS Karaokê + qualquer BD.ini dentro das pastas da biblioteca.
function vsBankCandidates(files, folders) {
    const banks = [];
    const seen = new Set();

    const add = (file, mediaRoot) => {
        const full = path.resolve(file); if (!fs.existsSync(full)) return;
        const key = process.platform === 'win32' ? full.toLowerCase() : full;

        if (seen.has(key)) return;
        seen.add(key);

        banks.push({
            file: full,
            mediaRoot: path.resolve(mediaRoot || path.dirname(full))
        });
    };

    const standardRoot = isFolder(VS_BD_MEDIA_ROOT)
        ? VS_BD_MEDIA_ROOT
        : path.dirname(VS_BD_INI_PATH);

    add(VS_BD_INI_PATH, standardRoot);

    for (const folder of folders || []) {
        const dir = path.resolve(folder);
        const musicas = path.join(dir, 'musicas');
        const mediaRoot = isFolder(musicas) ? musicas : dir;

        add(path.join(dir, 'BD.ini'), mediaRoot);
        add(path.join(dir, 'bd.ini'), mediaRoot);
    }

    return banks;
}

/* ============================================================
   LEITOR ESPECIAL DO BANCO VS KARAOKE - BD.ini
   Preserva os códigos originais e relaciona os MP4.
   ============================================================ */

function parseVsBdIni(bdIniPath, mediaRoot) {
    if (!fs.existsSync(bdIniPath)) {
        return [];
    }

    let content;

    try {
        content = readTextSafe(bdIniPath);
    } catch (err) {
        console.error('Erro ao ler BD.ini:', err);
        return [];
    }

    if (!content) return [];

    const byName = vsMediaIndexOf(mediaRoot);
    const records = [];
    let current = null;

    function saveCurrent() {
        if (!current || !current.code) return;

        const filename = current.arquivo || (current.code + '.mp4');
        const root = path.resolve(mediaRoot);

        const mediaPath = vsMediaPathOf(root, filename, current.code, byName) || '';
        const exists = !!mediaPath && fs.existsSync(mediaPath);

        const ext = exists
            ? path.extname(mediaPath).toLowerCase()
            : path.extname(filename).toLowerCase();

        const artist = current.artista || '';
        const title = current.musica || '';

        records.push({
            code: current.code,
            title: title || current.code,
            artist,
            label: artist && title
                ? artist + ' - ' + title
                : title || artist || current.code,
            file: exists ? mediaPath : null,
            relative: exists ? path.relative(root, mediaPath) : filename,
            ext,
            kind: exists ? mediaKindOf(mediaPath) : 'video',
            playable: exists && PLAYABLE_EXTENSIONS.has(ext),
            playHint: exists
                ? (PLAYABLE_EXTENSIONS.has(ext) ? 'leitor interno' : 'leitor do Windows')
                : 'vídeo não encontrado',
            missing: !exists,
            fields: [
                current.code,
                artist,
                title,
                filename,
                current.inicio || ''
            ].filter(Boolean),
            raw: current.raw || '',
            vsBank: true,
            labeled: true,
            startAt: cleanWords(current.inicio || ''), bdIni: bdIniPath,
            source: bdIniPath,
            search: normalizeText(current.code + ' ' + artist + ' ' + title)
        });
    }

    for (const line of content.split(/\r?\n/)) {
        const text = line.trim();

        const section = text.match(/^\[\s*([0-9A-Za-z][0-9A-Za-z_\-]{0,31})\s*\]$/);

        if (section) {
            saveCurrent();

            current = {
                code: section[1],
                arquivo: '',
                artista: '',
                musica: '',
                inicio: '',
                raw: ''
            };

            continue;
        }

        if (!current) continue;

        current.raw += line + '\n';

        const separator = text.indexOf('=');
        if (separator < 0) continue;

        const key = text.slice(0, separator)
            .trim()
            .toLowerCase();

        const value = text.slice(separator + 1).trim();

        if (Object.prototype.hasOwnProperty.call(current, key)) {
            current[key] = value;
        }
    }

    saveCurrent();

    // Evita músicas repetidas dentro do próprio banco
    const unique = [];
    const seenCodes = new Set();
    const seenFiles = new Set();

    for (const record of records) {
        const codeKey = String(record.code || '');
        const fileKey = record.file ? record.file.toLowerCase() : '';

        if (fileKey && seenFiles.has(fileKey)) continue;
        if (!fileKey && seenCodes.has(codeKey)) continue;

        if (fileKey) seenFiles.add(fileKey);
        seenCodes.add(codeKey);

        unique.push(record);
    }

    return unique;
}
function parseIndexLine(line) {
  const original = String(line == null ? '' : line).replace(/\r/g, '').replace(/\u0000/g, '');
  const raw = original.trim();

  if (!raw || raw.length < 2) return null;
  if (/^[\s\-=_*~#.\/\\|+:;,]+$/.test(raw)) return null;
  if (!/[0-9a-z\u00c0-\u024f]/i.test(raw)) return null;

  let fields = splitIndexFields(raw)
    .map((field) => cleanWords(field))
    .filter((field) => field.length > 0 && !/^[-–—_=]+$/.test(field));

  if (!fields.length) return null;

  let code = null;
  const first = fields[0];
  const alone = first.match(CODE_ALONE);

  if (alone) {
    code = alone[1];
    fields = fields.slice(1);
  } else {
    const head = first.match(CODE_HEAD);
    if (head) {
      code = head[1];
      const rest = cleanWords(head[2]);
      fields = rest ? [rest].concat(fields.slice(1)) : fields.slice(1);
    }
  }

  fields = fields
    .map((field) => cleanWords(field))
    .filter((field) => field.length > 0 && !/^[-–—_=]+$/.test(field));

  if (!code && !fields.length) return null;
  if (!code && fields.length < 1) return null;

  let title = fields[0] || '';
  let artist = fields[1] || '';
  let extra = fields.slice(2);

  // "Título - Artista" escrito num único campo
  if (!artist && title) {
    const parts = title
      .split(/\s+[-–—]\s+|\s*\/\s*|\s+–\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      title = parts[0];
      artist = parts[1];
      extra = parts.slice(2).concat(extra);
    }
  }

  if (!title && artist) {
    title = artist;
    artist = '';
  }

  const label = [title, artist].filter(Boolean).join(' — ');

  if (!code && !label) return null;

  return {
    code: code ? String(parseInt(code, 10)) : null,
    title: String(title || '').slice(0, 220),
    artist: String(artist || '').slice(0, 180),
    fields: fields.slice(0, 12).map((field) => field.slice(0, 220)),
    extra: extra.slice(0, 8).map((field) => field.slice(0, 220)),
    raw: raw.slice(0, 400),
    label: label.slice(0, 280)
  };
}

function splitCode(text) {
  let rest = String(text || '').trim();
  let code = null;

  if (/^\d{1,8}$/.test(rest)) {
    return { code: String(parseInt(rest, 10)), rest: '' };
  }

  const head =
    rest.match(/^[\[\(\{\s#]*(\d{1,8})\s*[\]\)\}]?\s*[-–—._:)\]]\s+/) ||
    rest.match(/^[\[\(\{\s#]*(\d{1,8})\s*[\]\)\}\]]\s*/) ||
    rest.match(/^(\d{1,8})\s*[-–—._:)\]]\s*/);

  if (head) {
    code = head[1];
    rest = rest.slice(head[0].length);
  } else {
    const tail = rest.match(/(?:[\s\-_\[\(]+)(\d{1,6})\s*[\]\)]?\s*$/);
    if (tail && tail.index > 0) {
      code = tail[1];
      rest = rest.slice(0, tail.index);
    }
  }

  return {
    code: code ? String(parseInt(code, 10)) : null,
    rest: rest.trim()
  };
}

function parseMediaFile(filePath, root) {
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const base = name.slice(0, name.length - ext.length);

  const split = splitCode(base);
  let code = split.code;
  let rest = split.rest;

  // Código na pasta acima: "1234 - Artista - Título\faixa.mp4"
  if (!code) {
    const parent = splitCode(path.basename(path.dirname(filePath)));
    if (parent.code) {
      code = parent.code;
      if (!rest) rest = parent.rest;
    }
  }

  rest = cleanWords(rest.replace(/^[\[\(\{]\s*/, ''));

  let title = rest || base;
  let artist = '';

  const parts = rest.split(/\s+[-–—]\s+|\s*[-–—]\s+/).map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 3) {
    artist = parts[0];
    title = parts.slice(1).join(' - ');
  } else if (parts.length === 2) {
    artist = parts[0];
    title = parts[1];
  }

  const isAudio = AUDIO_EXTENSIONS.has(ext);
  const isKaraoke = KARAOKE_EXTENSIONS.has(ext);
  const isArchive = ARCHIVE_EXTENSIONS.has(ext);
  const playable = PLAYABLE_EXTENSIONS.has(ext);

  const kind = isAudio ? 'audio' : isKaraoke ? 'karaoke' : isArchive ? 'archive' : 'video';

  const label = [title, artist].filter(Boolean).join(' — ') || base;

  return {
    code,
    title: title || base,
    artist,
    label,
    file: filePath,
    relative: path.relative(root, filePath),
    ext,
    kind,
    playable,
    playHint: playable ? 'leitor interno' : 'leitor do Windows',
    labeled: false,
    missing: false,
    fields: [],
    raw: '',
    source: null,
    search: normalizeText([code, title, artist, base, path.relative(root, filePath)].filter(Boolean).join(' '))
  };
}

/* ---------------------- Varredura ---------------------- */

async function scanFolder(root) {
  const media = [];
  const karaoke = [];
  const archives = [];
  const indexFiles = [];

  let others = 0;
  let skipped = 0;
  let total = 0;

  const queue = [{ dir: root, depth: 0 }];

  while (queue.length && total < MAX_LIBRARY_FILES) {
    const item = queue.shift();

    let children = [];

    try {
      children = await fs.promises.readdir(item.dir, { withFileTypes: true });
    } catch (err) {
      skipped += 1;
      continue;
    }

    for (const child of children) {
      const full = path.join(item.dir, child.name);

      if (child.isDirectory()) {
        if (item.depth < MAX_SCAN_DEPTH && !shouldSkipDir(child.name)) {
          queue.push({ dir: full, depth: item.depth + 1 });
        }
        continue;
      }

      if (!child.isFile()) continue;

      total += 1;

      const ext = path.extname(child.name).toLowerCase();

      if (VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext)) {
        media.push(full);
      } else if (KARAOKE_EXTENSIONS.has(ext)) {
        karaoke.push(full);
      } else if (ARCHIVE_EXTENSIONS.has(ext)) {
        archives.push(full);
      } else if (INDEX_EXTENSIONS.has(ext)) {
        indexFiles.push(full);
      } else {
        others += 1;
      }
    }
  }

  return { media, karaoke, archives, indexFiles, others, skipped, total };
}

function pushTo(map, key, entry) {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    if (!list.includes(entry)) list.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

async function buildLibrary(folders) {
  const entries = [];
  const indexEntries = [];
  const notepadFiles = [];
  const seenFiles = new Set();
  const seenIndexOnly = new Set();

  const byCode = new Map();
  const byCodeLoose = new Map();
  const byName = new Map();
  const indexByCode = new Map();
  const indexByCodeLoose = new Map();

  let others = 0;
  let skipped = 0;
  let karaoke = 0;
  let archives = 0;

  const indexFileList = [];

  const fileKey = (file) => (process.platform === 'win32'
    ? String(file || '').toLowerCase()
    : String(file || ''));

  const addFile = (file, root) => {
    const key = fileKey(file);
    if (seenFiles.has(key)) return;
    seenFiles.add(key);
    entries.push(parseMediaFile(file, root));
  };

  for (const root of folders) {
    const scanned = await scanFolder(root);

    for (const file of scanned.media) addFile(file, root);
    for (const file of scanned.karaoke) addFile(file, root);
    for (const file of scanned.archives) addFile(file, root);

    for (const file of scanned.indexFiles) indexFileList.push({ file, root });

    others += scanned.others;
    skipped += scanned.skipped;
    karaoke += scanned.karaoke.length;
    archives += scanned.archives.length;
  }

  const registerEntry = (entry) => {
    if (!entry.code) return;
    pushTo(byCode, entry.code, entry);
    pushTo(byCodeLoose, String(parseInt(entry.code, 10)), entry);
  };

  for (const entry of entries) {
    registerEntry(entry);

    pushTo(byName, normalizeText(entry.title), entry);
    pushTo(byName, normalizeText(entry.label), entry);

    if (entry.artist) {
      pushTo(byName, normalizeText(`${entry.artist} ${entry.title}`), entry);
      pushTo(byName, normalizeText(`${entry.title} ${entry.artist}`), entry);
    }
  }
  /* ------------------------------------------------------------
     BANCO DE DADOS DO VS KARAOKÊ (BD.ini)

     Cada secção "[01001]" passa a ser uma música do catálogo. O
     código é guardado como texto (zeros à esquerda intactos) e o
     campo "arquivo" indica o vídeo dentro de "...\musicas".

     Se a música já existir (mesmo ficheiro ou mesmo código), a
     informação do BD.ini é juntada em vez de duplicar a entrada.
     ------------------------------------------------------------ */

  const byFile = new Map();

  for (const entry of entries) {
    if (entry.file) pushTo(byFile, fileKey(entry.file), entry);
  }

  const vsBanks = vsBankCandidates(indexFileList.map((item) => item.file), folders);
  const vsBankKeys = new Set(vsBanks.map((bank) => fileKey(bank.file)));

  let vsRecords = 0;
  let vsAdded = 0;
  let vsMerged = 0;
  let vsMissing = 0;
  const vsMissingCodes = new Set();
  const pushEntryNames = (entry) => {
    pushTo(byName, normalizeText(entry.title), entry);
    pushTo(byName, normalizeText(entry.label), entry);

    if (entry.artist) {
      pushTo(byName, normalizeText(entry.artist + ' ' + entry.title), entry);
      pushTo(byName, normalizeText(entry.title + ' ' + entry.artist), entry);
    }
  };

  for (const bank of vsBanks) {
    const records = parseVsBdIni(bank.file, bank.mediaRoot);

    for (const record of records) {
      vsRecords += 1;

      const fileMatches = record.file
        ? (byFile.get(fileKey(record.file)) || [])
        : [];

      const codeMatches = byCodeLoose.get(String(parseInt(record.code, 10))) || [];

      const target = fileMatches[0] || codeMatches[0] || null;

      // Sem vídeo: entra no catálogo como "não encontrado" se a pasta existir
      if (!target && !record.file) {
        vsMissing += 1;
        if (!isFolder(bank.mediaRoot) || vsMissingCodes.has(String(record.code))) continue;
        vsMissingCodes.add(String(record.code));
      } else if (target) {
        if (record.code) target.code = record.code;

        target.code = String(target.code);

        if (record.artist) target.artist = record.artist;
        if (record.title) target.title = record.title;

        target.label =
          [record.artist, record.title].filter(Boolean).join(' — ') || target.label;

        target.labeled = true;
        target.vsBank = true;
        target.startAt = record.startAt || target.startAt || '';
        target.bdIni = record.bdIni || target.bdIni || '';

        if (!target.fields || !target.fields.length) target.fields = record.fields;
        if (!target.raw) target.raw = record.raw;

        target.search = normalizeText(
          [target.code, target.title, target.artist, target.relative, target.raw]
            .filter(Boolean)
            .join(' ')
        );

        if (target.file) pushTo(byFile, fileKey(target.file), target);

        registerEntry(target);
        pushEntryNames(target);

        vsMerged += 1;
        continue;
      }

      entries.push(record);
      registerEntry(record);
      pushEntryNames(record);

      if (record.file) pushTo(byFile, fileKey(record.file), record);

      vsAdded += 1;
    }
  }
  let labeled = 0;
  let indexRows = 0;

  for (const item of indexFileList) {
    // O BD.ini do VS Karaokê é lido pelo leitor próprio, nunca como Bloco de Notas
    if (vsBankKeys.has(fileKey(item.file))) continue;
    let text;

    try {
      const stat = await fs.promises.stat(item.file);
      if (stat.size > MAX_INDEX_BYTES) continue;
      text = readTextSafe(item.file);
    } catch (err) {
      continue;
    }

    const lines = text.split(/\r?\n/);
    const rows = [];

    for (let i = 0; i < lines.length && rows.length < MAX_INDEX_ROWS; i += 1) {
      const row = parseIndexLine(lines[i]);
      if (!row) continue;

      row.file = item.file;
      row.name = path.basename(item.file);
      row.line = i + 1;
      row.root = item.root;
      row.relative = path.relative(item.root, item.file);
      rows.push(row);
    }

    if (!rows.length) continue;

    // Descarta listas que não tenham códigos nem conteúdo suficiente
    if (!rows.some((row) => row.code) && rows.length < 3) continue;

    notepadFiles.push({ path: item.file, name: path.basename(item.file), rows: rows.length });
    indexRows += rows.length;

    for (const row of rows) {
      const targets = new Set();

      if (row.code) {
        for (const entry of byCode.get(row.code) || []) targets.add(entry);
        for (const entry of byCodeLoose.get(String(parseInt(row.code, 10))) || []) targets.add(entry);
      }

      if (!targets.size) {
        const keys = [
          row.title && normalizeText(row.title),
          row.artist && row.title && normalizeText(`${row.artist} ${row.title}`),
          row.artist && row.title && normalizeText(`${row.title} ${row.artist}`),
          row.label && normalizeText(row.label)
        ].filter(Boolean);

        for (const key of keys) {
          const found = byName.get(key);
          if (found && found.length) {
            for (const entry of found) targets.add(entry);
            break;
          }
        }
      }

      const source = { file: row.file, name: row.name, line: row.line };

      if (targets.size) {
        for (const entry of targets) {
          if (!entry.labeled) {
            if (row.title) entry.title = row.title;
            if (row.artist) entry.artist = row.artist;

            entry.label = [entry.title, entry.artist].filter(Boolean).join(' — ') || entry.label;
            entry.labeled = true;
            labeled += 1;
          }

          if (!entry.fields || !entry.fields.length) entry.fields = row.fields;
          if (!entry.raw) entry.raw = row.raw;
          if (!entry.source) entry.source = source;

          entry.search = normalizeText(
            [entry.code, entry.title, entry.artist, entry.relative, entry.raw].filter(Boolean).join(' ')
          );

          pushTo(byName, normalizeText(entry.title), entry);
          if (entry.artist) pushTo(byName, normalizeText(`${entry.artist} ${entry.title}`), entry);
        }
        continue;
      }

      // Código que só existe no Bloco de Notas
      if (!row.code && !row.label) continue;

      const key = row.code ? 'c' + row.code : 'n' + normalizeText(row.label);
      if (seenIndexOnly.has(key)) continue;
      seenIndexOnly.add(key);

      const entry = {
        code: row.code,
        title: row.title || row.label,
        artist: row.artist || '',
        label: row.label || row.raw,
        file: null,
        relative: row.relative,
        ext: '',
        kind: 'notepad',
        playable: false,
        playHint: 'só informação do Bloco de Notas',
        labeled: true,
        missing: true,
        fields: row.fields,
        raw: row.raw,
        source,
        search: normalizeText([row.code, row.title, row.artist, row.raw].filter(Boolean).join(' '))
      };

      indexEntries.push(entry);

      if (entry.code) {
        pushTo(indexByCode, entry.code, entry);
        pushTo(indexByCodeLoose, String(parseInt(entry.code, 10)), entry);
      }

      pushTo(byName, normalizeText(entry.title), entry);
      if (entry.artist) pushTo(byName, normalizeText(`${entry.artist} ${entry.title}`), entry);
    }
  }

  entries.sort((a, b) => {
    const ca = a.code ? parseInt(a.code, 10) : Number.MAX_SAFE_INTEGER;
    const cb = b.code ? parseInt(b.code, 10) : Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return a.title.localeCompare(b.title, 'pt');
  });

  const playable = entries.filter((entry) => entry.playable).length;

  return {
    entries,
    indexEntries,
    notepadFiles,
    byCode,
    byCodeLoose,
    byName,
    indexByCode,
    indexByCodeLoose,
    stats: {
      media: entries.length,
      playable,
      unplayable: entries.length - playable,
      labeled,
      indexFiles: notepadFiles.length,
      indexRows,
      indexOnly: indexEntries.length,
      others,
      karaoke,
      archives,
      skipped,
      vsBankFiles: vsBanks.length,
      vsRecords,
      vsAdded,
      vsMerged,
      vsMissing
    }
  };
}

/* ---------------------- Resumo / notificações ---------------------- */

function librarySummary() {
  return {
    folders: (library.folders || []).slice(),
    folder: (library.folders || [])[0] || null,
    total: library.entries.length,
    notepadOnly: (library.indexEntries || []).length,
    playable: library.stats.playable || 0,
    unplayable: library.stats.unplayable || 0,
    labeled: library.stats.labeled || 0,
    indexFiles: library.stats.indexFiles || 0,
    indexRows: library.stats.indexRows || 0,
    others: library.stats.others || 0,
    karaoke: library.stats.karaoke || 0,
    archives: library.stats.archives || 0,
    skipped: library.stats.skipped || 0,
    notepads: (library.notepadFiles || []).slice(0, 300),
    vsBank: {
      bdIni: VS_BD_INI_PATH,
      mediaRoot: VS_BD_MEDIA_ROOT,
      files: library.stats.vsBankFiles || 0,
      records: library.stats.vsRecords || 0,
      added: library.stats.vsAdded || 0,
      merged: library.stats.vsMerged || 0,
      missing: library.stats.vsMissing || 0
    },
    scannedAt: library.scannedAt,
    ready: !!library.scannedAt,
    scanning: false
  };
}

function notifyLibrary(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:updated', payload);
  }
}

/* ---------------------- Carregamento ---------------------- */

function dedupeFolders(list) {
  const clean = [];
  const seen = new Set();

  for (const item of list || []) {
    if (!isFolder(item)) continue;

    const full = path.resolve(item);
    const key = process.platform === 'win32' ? full.toLowerCase() : full;
    if (seen.has(key)) continue;

    seen.add(key);
    clean.push(full);
  }

  // remove pastas que estão dentro de outra já adicionada
  const result = [];

  for (const item of clean) {
    const nested = result.some((parent) => {
      const rel = path.relative(parent, item);
      return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    });

    if (!nested) result.push(item);
  }

  return result;
}

function getFolders(settings) {
  const list = [];

  if (Array.isArray(settings.libraryPaths)) list.push(...settings.libraryPaths);
  if (settings.libraryPath) list.push(settings.libraryPath);

  return dedupeFolders(list);
}

function persistFolders(folders) {
  const settings = loadSettings();
  const list = dedupeFolders(folders);

  settings.libraryPaths = list;
  settings.libraryPath = list[0] || null;
  saveSettings(settings);

  return list;
}

async function loadLibrary(folders) {
  const list = dedupeFolders(Array.isArray(folders) ? folders : [folders]);

  if (!list.length) return library;

  notifyLibrary(Object.assign(librarySummary(), { folders: list, scanning: true }));

  const built = await buildLibrary(list);

  library.folders = list;
  library.entries = built.entries;
  library.indexEntries = built.indexEntries;
  library.notepadFiles = built.notepadFiles;
  library.byCode = built.byCode;
  library.byCodeLoose = built.byCodeLoose;
  library.byName = built.byName;
  library.indexByCode = built.indexByCode;
  library.indexByCodeLoose = built.indexByCodeLoose;
  library.stats = built.stats;
  library.scannedAt = Date.now();

  notifyLibrary(librarySummary());

  return library;
}

function ensureLibrary() {
  if (library.scannedAt && (library.folders || []).length) {
    return Promise.resolve(library);
  }

  if (libraryPromise) return libraryPromise;

  libraryPromise = (async () => {
    const settings = loadSettings();

    let folders = getFolders(settings);

    if (!folders.length) {
      folders = dedupeFolders(quickFindFolders());
      if (folders.length) persistFolders(folders);
    }

    if (folders.length) {
      await loadLibrary(folders);
    } else {
      notifyLibrary(Object.assign(librarySummary(), { scanning: false, ready: false }));
    }

    return library;
  })()
    .catch((err) => {
      console.error('Falha ao carregar a biblioteca:', err);
      return library;
    })
    .finally(() => {
      libraryPromise = null;
    });

  return libraryPromise;
}

/* ============================================================
   5. DETEÇÃO AUTOMÁTICA DE PASTAS
   ============================================================ */

const KARAOKE_NAME_HINTS = [
  'karaoke', 'karaokê', 'karaoké', 'karaok', 'karafun', 'vskaraoke',
  'vs karaoke', 'vs karaokes', 'vskaraokes', 'karaokes', 'ultrastar',
  'singstar', 'karaoke box', 'karaoke machine', 'karaoke player',
  'playback', 'playbacks', 'pasta de karaoke', 'musicas karaoke',
  'músicas karaoke', 'maquina de karaoke', 'máquina de karaokê',
  'cdg', 'repertorio', 'repertório', 'cantor', 'cantores'
];

function hasKaraokeHint(name) {
  const lower = String(name || '').toLowerCase();
  return KARAOKE_NAME_HINTS.some((hint) => lower.includes(hint));
}

/* ------------------------------------------------------------
   PASTAS INTERNAS DO VS KARAOKES (e de outros programas)

   Um programa de karaokê normalmente guarda tudo assim:

     D:\VSKaraoke\
        Media\            → vídeos / áudios
        Bloco de Notas\   → listas de códigos (.txt, .lst, .csv…)
        Pontuação\        → pontuações da sessão
        Capas\            → imagens

   Estas pastas são reconhecidas em qualquer disco do Windows e a
   pasta-mãe passa a ser a raiz da biblioteca.
   ------------------------------------------------------------ */

const KARAOKE_FOLDER_KINDS = {
  media: [
    'media', 'medias', 'mídia', 'mídias', 'midia', 'midias',
    'video', 'videos', 'vídeo', 'vídeos', 'movie', 'movies',
    'filme', 'filmes', 'musica', 'musicas', 'música', 'músicas',
    'music', 'songs', 'song', 'audio', 'audios', 'áudio', 'áudios',
    'playback', 'playbacks', 'videos karaoke', 'vídeos karaokê',
    'clipes', 'clips', 'faixas'
  ],
  notes: [
    'bloco de notas', 'blocos de notas', 'bloco nota', 'bloco de nota',
    'blocos de nota', 'notas', 'nota', 'notepad', 'notepad songs',
    'listas', 'lista', 'listas de musicas', 'listas de músicas',
    'letras', 'lyrics', 'textos', 'texto', 'txt', 'indice', 'índice',
    'index', 'catalogo', 'catálogo', 'codigos', 'códigos',
    'repertorio', 'repertório', 'listagem'
  ],
  score: [
    'pontuacao', 'pontuação', 'pontos', 'score', 'scores', 'ranking',
    'rankings', 'historico', 'histórico', 'resultados', 'placar'
  ],
  covers: [
    'capa', 'capas', 'cover', 'covers', 'imagem', 'imagens',
    'image', 'images', 'foto', 'fotos', 'photo', 'photos',
    'banner', 'banners', 'thumb', 'thumbs', 'thumbnail', 'thumbnails',
    'icone', 'ícone', 'icons'
  ],
  data: [
    'dados', 'data', 'config', 'configuracao', 'configuração',
    'configuracoes', 'configurações', 'cfg', 'settings', 'banco',
    'database', 'db', 'backup', 'backups', 'bak', 'temp', 'cache',
    'log', 'logs'
  ]
};

const KARAOKE_FOLDER_LOOKUP = (() => {
  const map = new Map();

  for (const kind of Object.keys(KARAOKE_FOLDER_KINDS)) {
    for (const name of KARAOKE_FOLDER_KINDS[kind]) {
      map.set(name, kind);
      map.set(normalizeText(name), kind);
    }
  }

  return map;
})();

function folderKindOf(name) {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean) return null;

  return KARAOKE_FOLDER_LOOKUP.get(clean) || KARAOKE_FOLDER_LOOKUP.get(normalizeText(clean)) || null;
}

// Pastas que, por si só, são uma parte do karaokê (a raiz é a pasta-mãe)
const KARAOKE_ROOT_PARTS = new Set(['media', 'notes', 'score', 'covers']);

// "D:\VSKaraoke\Media" → "D:\VSKaraoke"
function karaokeRootOf(dir) {
  const parent = path.dirname(dir);

  if (!parent || parent === dir) return dir;
  if (!path.basename(parent)) return dir; // raiz do disco (D:\)

  return parent;
}

// Pastas do próprio Windows — nunca são a raiz do karaokê
const WINDOWS_SPECIAL_NAMES = new Set([
  'users', 'usuários', 'usuarios', 'public', 'público', 'publico',
  'music', 'musicas', 'músicas', 'minhas músicas', 'my music',
  'videos', 'vídeos', 'meus vídeos', 'my videos',
  'documents', 'documentos', 'meus documentos', 'my documents',
  'desktop', 'área de trabalho', 'area de trabalho',
  'downloads', 'transferências', 'transferencias',
  'pictures', 'imagens', 'minhas imagens', 'my pictures',
  'onedrive', 'appdata', 'local', 'roaming', 'programdata',
  'program files', 'program files (x86)', 'temp', 'tmp', 'cache',
  'cookies', 'favorites', 'favoritos', 'links', 'saved games',
  'searches', 'contacts', 'contatos', '3d objects', 'objetos 3d',
  'menu iniciar', 'start menu', 'windows', 'winsxs', 'system32',
  'syswow64', 'system volume information', '$recycle.bin'
]);

function isWindowsSpecialFolder(dir) {
  const name = String(path.basename(dir) || '').toLowerCase();

  if (WINDOWS_SPECIAL_NAMES.has(name) || WINDOWS_SPECIAL_NAMES.has(normalizeText(name))) {
    return true;
  }

  // Perfil de utilizador: C:\Users\Nome
  const parent = String(path.basename(path.dirname(dir)) || '').toLowerCase();

  return parent === 'users' || parent === 'usuários' || parent === 'usuarios';
}

function isScorePath(file) {
  const parts = String(file || '').split(/[\\/]+/).filter(Boolean);

  return parts.some((part) => folderKindOf(part) === 'score');
}

async function countFolderTree(dir, depth, budget) {
  const totals = { media: 0, notes: 0, karaoke: 0, archives: 0, kinds: new Set() };

  if (depth < 0) return totals;

  let children = [];

  try {
    children = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return totals;
  }

  for (const child of children) {
    if (child.isDirectory()) {
      const kind = folderKindOf(child.name);

      if (kind) totals.kinds.add(kind);

      // pontuação / capas / dados não contam como músicas
      if (kind === 'score' || kind === 'covers' || kind === 'data') continue;
      if (shouldSkipDir(child.name)) continue;
      if (SKIP_DETECT_DIRS.has(child.name.toLowerCase())) continue;
      if (budget.left <= 0) continue;

      budget.left -= 1;

      const nested = await countFolderTree(path.join(dir, child.name), depth - 1, budget);

      totals.media += nested.media;
      totals.notes += nested.notes;
      totals.karaoke += nested.karaoke;
      totals.archives += nested.archives;

      for (const value of nested.kinds) totals.kinds.add(value);

      continue;
    }

    if (!child.isFile()) continue;

    const ext = path.extname(child.name).toLowerCase();

    if (VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext)) totals.media += 1;
    else if (KARAOKE_EXTENSIONS.has(ext)) totals.karaoke += 1;
    else if (ARCHIVE_EXTENSIONS.has(ext)) totals.archives += 1;
    else if (INDEX_EXTENSIONS.has(ext)) totals.notes += 1;
  }

  return totals;
}

async function inspectFolder(dir) {
  const counts = await countFolderTree(dir, 2, { left: 60 });

  const ownKind = folderKindOf(path.basename(dir));
  const hinted = hasKaraokeHint(path.basename(dir));
  const isDriveRoot = !path.basename(path.resolve(dir));

  // Estrutura do VS Karaokes: pasta com "Media", "Bloco de Notas"…
  const hasKaraokeLayout =
    counts.kinds.has('media') || counts.kinds.has('notes') || counts.kinds.has('score');

  let strong =
    counts.karaoke > 0 ||
    (counts.notes >= 1 && counts.media >= 1) ||
    (hinted && counts.media >= 1) ||
    (hinted && counts.notes >= 1) ||
    (hasKaraokeLayout && counts.media >= 1 && counts.notes >= 1) ||
    (ownKind === 'media' && counts.media >= 1) ||
    (ownKind === 'notes' && counts.notes >= 1) ||
    (counts.media >= 15 && counts.notes >= 1);

  // Um disco inteiro (D:\) só é aceite com provas fortes
  if (isDriveRoot) {
    strong = counts.karaoke > 0 || (hinted && (counts.media >= 1 || counts.notes >= 1));
  }

  const weakButLikely =
    hinted && counts.media === 0 && counts.notes === 0 && counts.archives >= 1;

  return {
    karaoke: strong || weakButLikely,
    media: counts.media,
    notes: counts.notes,
    karaokeFiles: counts.karaoke,
    score: counts.media + counts.notes * 3 + counts.karaoke * 5 + (hinted ? 10 : 0)
  };
}

function defaultScanRoots() {
  const roots = [];
  const push = (candidate) => {
    if (!candidate) return;
    if (!roots.includes(candidate) && isFolder(candidate)) roots.push(candidate);
  };

  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = letter + ':\\';
      try {
        if (fs.existsSync(drive)) roots.push(drive);
      } catch (err) { /* ignora */ }
    }
  } else if (process.platform === 'darwin') {
    push('/Volumes');
  }

  for (const key of ['home', 'videos', 'music', 'documents', 'desktop', 'downloads']) {
    try {
      push(app.getPath(key));
    } catch (err) { /* ignora */ }
  }

  return roots;
}

// Pastas de programas de karaokê instalados (VSKaraoke, Karafun, ...)
function installedKaraokeRoots() {
  const found = [];
  const bases = [];

  if (process.platform === 'win32') {
    bases.push('C:\\Program Files', 'C:\\Program Files (x86)');

    try { bases.push(path.join(app.getPath('appData'))); } catch (err) { /* ignora */ }
    try { bases.push(path.join(app.getPath('userData'), '..')); } catch (err) { /* ignora */ }
    try { bases.push(app.getPath('userData')); } catch (err) { /* ignora */ }
  } else if (process.platform === 'darwin') {
    bases.push('/Applications');
  }

  for (const base of bases) {
    let children = [];

    try {
      if (!isFolder(base)) continue;
      children = fs.readdirSync(base, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (!hasKaraokeHint(child.name)) continue;

      const full = path.join(base, child.name);
      found.push(full);

      for (const sub of ['Songs', 'Song Library', 'Library', 'Karaoke', 'Musicas', 'Músicas', 'Playlist', 'Songs Library', 'data']) {
        const candidate = path.join(full, sub);
        if (isFolder(candidate)) found.push(candidate);
      }
    }
  }

  return found;
}

// Detecção rápida (sem varrer discos): programas instalados + caminhos comuns
function quickFindFolders() {
  const candidates = [];

  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = letter + ':\\';

      try {
        if (!fs.existsSync(drive)) continue;
      } catch (err) {
        continue;
      }

      for (const name of ['Karaoke', 'Karaokê', 'VSKaraoke', 'KaraFun', 'Ultrastar', 'Playback']) {
        candidates.push(path.join(drive, name));
      }

      for (const parent of ['Vídeos', 'Videos', 'Músicas', 'Musicas', 'Music', 'Users\\Public\\Videos']) {
        for (const name of ['Karaoke', 'Karaokê', 'VSKaraoke', 'KaraFun']) {
          candidates.push(path.join(drive, parent, name));
        }
      }
    }
  }

  candidates.push(...installedKaraokeRoots());

  try {
    const home = app.getPath('home');
    for (const name of ['Karaoke', 'Karaokê', 'VSKaraoke']) {
      candidates.push(path.join(home, name));
      candidates.push(path.join(home, 'Music', name));
      candidates.push(path.join(home, 'Videos', name));
      candidates.push(path.join(home, 'Documents', name));
      candidates.push(path.join(home, 'Downloads', name));
    }
  } catch (err) { /* ignora */ }

  try {
    const videos = app.getPath('videos');
    candidates.push(path.join(videos, 'Karaoke'));
  } catch (err) { /* ignora */ }

  return dedupeFolders(candidates.filter(isFolder));
}

const SKIP_DETECT_DIRS = new Set([
  ...SKIP_SCAN_DIRS,
  'windows', 'winsxs', 'system32', 'syswow64', 'program files',
  'program files (x86)', 'programdata', '$recycle.bin', 'recovery',
  'msocache', 'perflogs', 'intel', 'temp', 'tmp', 'cache', 'drivers',
  'installer', 'windows.old', 'boot', 'efi', 'appdata', 'logs',
  'onedrive', 'dropbox', 'google drive'
]);

async function detectKaraokeFolders(options = {}) {
  const roots = (options.roots && options.roots.length ? options.roots : defaultScanRoots());

  const maxDepth = options.maxDepth ?? (process.platform === 'win32' ? 4 : 6);
  const limit = options.limit ?? 7000;
  const maxFound = options.maxFound ?? 40;
  const deadline = Date.now() + (options.timeoutMs ?? 20000);

  const found = [];
  const queue = roots.map((dir) => ({ dir, depth: 0 }));
  let visited = 0;

  while (queue.length && visited < limit && Date.now() < deadline && found.length < maxFound) {
    const item = queue.shift();
    visited += 1;

    const verdict = await inspectFolder(item.dir);

    if (verdict.karaoke) {
      found.push({ path: item.dir, media: verdict.media || 0, notes: verdict.notes || 0, score: verdict.score || 0 });
      continue;
    }

    if (item.depth >= maxDepth) continue;

    let children = [];

    try {
      children = await fs.promises.readdir(item.dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const child of children) {
      if (!child.isDirectory()) continue;

      const lower = child.name.toLowerCase();
      if (!lower || lower.startsWith('.')) continue;
      if (SKIP_DETECT_DIRS.has(lower)) continue;

      queue.push({ dir: path.join(item.dir, child.name), depth: item.depth + 1 });
    }
  }

  found.sort((a, b) => b.score - a.score);

  return dedupeFolders(found.map((item) => item.path));
}

async function detectAndMerge() {
  if (detectionPromise) return detectionPromise;

  detectionPromise = (async () => {
    const settings = loadSettings();
    const existing = getFolders(settings);

    const detected = await detectKaraokeFolders();
    const merged = dedupeFolders(existing.concat(detected));

    const added = merged.length - existing.length;

    if (added > 0 || (!library.scannedAt && merged.length)) {
      persistFolders(merged);
      await loadLibrary(merged);
    } else if (!existing.length) {
      notifyLibrary(Object.assign(librarySummary(), { scanning: false, ready: false }));
    }

    return { ok: true, added, detected, folders: merged, library: librarySummary() };
  })()
    .catch((err) => {
      console.error('Falha na deteção automática:', err);
      return { ok: false, added: 0, detected: [], folders: [], library: librarySummary() };
    })
    .finally(() => {
      detectionPromise = null;
    });

  return detectionPromise;
}

/* ---------------------- Consultas ---------------------- */

function toPublicEntry(entry) {
  if (!entry) return null;

  return {
    code: entry.code || null,
    title: entry.title,
    artist: entry.artist || '',
    label: entry.label,
    url: entry.file ? pathToFileURL(entry.file).href : null,
    path: entry.file || null,
    relative: entry.relative || '',
    ext: entry.ext || '',
    kind: entry.kind,
    playable: !!entry.playable,
    playHint: entry.playHint || '',
    missing: !!entry.missing,
    fields: Array.isArray(entry.fields) ? entry.fields.slice(0, 12) : [],
    raw: entry.raw || '',
    source: entry.source || null
  };
}

function findEntryByCode(code) {
  const raw = String(code || '').trim();
  if (!/^\d{1,8}$/.test(raw)) return null;

  const key = String(parseInt(raw, 10));

  const media = (library.byCode.get(raw) || []).concat(library.byCodeLoose.get(key) || []);
  if (media.length) {
    const withFile = media.filter((entry) => entry.file);
    return withFile.find((entry) => entry.playable) || withFile[0] || media[0];
  }

  const notes = (library.indexByCode.get(raw) || []).concat(library.indexByCodeLoose.get(key) || []);
  return notes[0] || null;
}

function searchEntries(query, limit) {
  const text = String(query || '').trim();
  if (!text) return [];

  if (/^\d{1,8}$/.test(text)) {
    const entry = findEntryByCode(text);
    return entry ? [entry] : [];
  }

  const norm = normalizeText(text);
  if (!norm) return [];

  const results = [];
  const seen = new Set();

  const push = (entry) => {
    const key = entry.file || 'n:' + (entry.code || entry.label);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(entry);
  };

  for (const entry of library.byName.get(norm) || []) {
    if (results.length >= limit) return results;
    push(entry);
  }

  for (const pool of [library.entries, library.indexEntries]) {
    for (const entry of pool) {
      if (results.length >= limit) break;
      if (entry.search && entry.search.includes(norm)) push(entry);
    }
  }

  return results;
}

function isInsideLibrary(filePath) {
  const target = path.resolve(String(filePath || ''));
  const roots = library.folders || [];

  for (const root of roots) {
    const rel = path.relative(path.resolve(root), target);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }

  return false;
}

/* ============================================================
   6. LEITOR DE MÉDIA
   ------------------------------------------------------------
   O renderer toca o vídeo/áudio no motor interno (Chromium).
   Quando o formato não é suportado, o ficheiro é aberto no
   leitor do Windows (media player) automaticamente.
   ============================================================ */

function mediaKindOf(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();

  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (PLAYABLE_EXTENSIONS.has(ext)) return 'video';
  if (KARAOKE_EXTENSIONS.has(ext)) return 'karaoke';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';

  return 'unknown';
}

/* ============================================================
   7. IPC HANDLERS
   ============================================================ */

/* ---------------------- Configurações ---------------------- */

ipcMain.handle('settings:get', () => toPublicSettings(loadSettingsWithRenewal()));

ipcMain.handle('settings:update', (event, partial) => {
  const settings = loadSettingsWithRenewal();

  if (partial && typeof partial === 'object') {
    if (partial.mode === 'free' || partial.mode === 'credits') {
      const changed = settings.mode !== partial.mode;
      settings.mode = partial.mode;

      if (changed && partial.mode === 'credits') {
        settings.credits = creditsMax(settings);
        settings.creditRenewAt = Date.now() + creditPeriodMs(settings);
      }

      if (changed && partial.mode === 'free') {
        settings.creditRenewAt = null;
      }
    }

    if (partial.creditCost !== undefined) {
      settings.creditCost = clamp(parseInt(partial.creditCost, 10) || 2, 1, 10);
    }

    if (partial.creditsMax !== undefined) {
      settings.creditsMax = clamp(parseInt(partial.creditsMax, 10) || 10, 1, 100);
    }

    if (partial.credits !== undefined) {
      settings.credits = clamp(parseInt(partial.credits, 10) || 0, 0, creditsMax(settings));
    }

    if (partial.creditPeriodHours !== undefined) {
      settings.creditPeriodHours = clamp(parseInt(partial.creditPeriodHours, 10) || 24, 1, 720);
    }

    if (partial.fullscreen !== undefined) {
      settings.fullscreen = !!partial.fullscreen;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFullScreen(settings.fullscreen);
        mainWindow.webContents.send('fullscreen:changed', settings.fullscreen);
      }
    }

    if (partial.autoStart !== undefined) {
      settings.autoStart = !!partial.autoStart;
      applyAutoStart(settings.autoStart);
    }

    if (partial.showScore !== undefined) settings.showScore = !!partial.showScore;
    if (partial.autoPlay !== undefined) settings.autoPlay = !!partial.autoPlay;
    if (partial.autoNext !== undefined) settings.autoNext = !!partial.autoNext;
    if (partial.openUnsupported !== undefined) settings.openUnsupported = !!partial.openUnsupported;

    if (partial.playerVolume !== undefined) {
      const volume = Number(partial.playerVolume);
      settings.playerVolume = Number.isFinite(volume) ? clamp(volume, 0, 1) : 0.9;
    }

    if (partial.windowWidth !== undefined) {
      settings.windowWidth = clamp(parseInt(partial.windowWidth, 10) || 1280, MIN_WINDOW_WIDTH, MAX_WINDOW_SIZE);
    }

    if (partial.windowHeight !== undefined) {
      settings.windowHeight = clamp(parseInt(partial.windowHeight, 10) || 800, MIN_WINDOW_HEIGHT, MAX_WINDOW_SIZE);
    }

    if (partial.libraryPath !== undefined) {
      settings.libraryPath = partial.libraryPath ? String(partial.libraryPath) : null;
      if (settings.libraryPath) {
        settings.libraryPaths = dedupeFolders((settings.libraryPaths || []).concat(settings.libraryPath));
      }
    }

    if (Array.isArray(partial.libraryPaths)) {
      settings.libraryPaths = dedupeFolders(partial.libraryPaths);
      settings.libraryPath = settings.libraryPaths[0] || null;
    }
  }

  saveSettings(settings);
  return toPublicSettings(settings);
});

/* ---------------------- Janela ---------------------- */

ipcMain.handle('window:size', (event, size) => {
  const settings = loadSettings();

  const width = clamp(
    parseInt(size && size.width, 10) || settings.windowWidth,
    MIN_WINDOW_WIDTH,
    MAX_WINDOW_SIZE
  );

  const height = clamp(
    parseInt(size && size.height, 10) || settings.windowHeight,
    MIN_WINDOW_HEIGHT,
    MAX_WINDOW_SIZE
  );

  settings.windowWidth = width;
  settings.windowHeight = height;
  settings.fullscreen = false;
  saveSettings(settings);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    mainWindow.setSize(width, height);
    mainWindow.center();
    mainWindow.webContents.send('fullscreen:changed', false);
  }

  return toPublicSettings(settings);
});

/* ---------------------- Plano de fundo (galeria) ---------------------- */

// Formatos aceites na galeria (Windows e telemóvel)
const BACKGROUND_IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'bmp', 'webp', 'avif', 'ico'
];

const MAX_BACKGROUND_BYTES = 40 * 1024 * 1024;

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/apng': '.png',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/x-ms-bmp': '.bmp',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico'
};

function safeImageExtension(ext) {
  const clean = String(ext || '').toLowerCase();
  const bare = clean.replace(/^\./, '');

  if (BACKGROUND_IMAGE_EXTENSIONS.includes(bare)) return '.' + bare;
  return '.jpg';
}

/**
 * Guarda a imagem na pasta de imagens do aplicativo, apaga as antigas
 * e devolve o URL file:// pronto a usar no plano de fundo.
 */
function storeBackgroundBuffer(buffer, ext) {
  ensureDirs();

  const dest = path.join(backgroundsDir, 'background_' + Date.now() + safeImageExtension(ext));

  fs.writeFileSync(dest, buffer);
  removeOldBackgrounds(dest);

  const settings = loadSettings();
  settings.backgroundImage = dest;
  saveSettings(settings);

  return { path: dest, url: pathToFileURL(dest).href };
}

// Abre a galeria / Explorador do Windows
ipcMain.handle('background:choose', async () => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;

  const options = {
    title: 'Escolher foto da galeria',
    buttonLabel: 'Usar esta foto',
    properties: ['openFile'],
    filters: [
      { name: 'Imagens', extensions: BACKGROUND_IMAGE_EXTENSIONS },
      { name: 'Todos os ficheiros', extensions: ['*'] }
    ]
  };

  let result;

  try {
    result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
  } catch (err) {
    console.error('Falha ao abrir a galeria do Windows:', err);

    // A interface usa o seletor de ficheiros (galeria do celular / navegador)
    return {
      ok: false,
      canceled: false,
      backgroundUrl: null,
      message: 'Janela da galeria indisponível — a abrir a galeria do dispositivo.'
    };
  }

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return { ok: true, canceled: true, backgroundUrl: null };
  }

  const source = result.filePaths[0];

  try {
    const stat = fs.statSync(source);

    if (stat.size > MAX_BACKGROUND_BYTES) {
      return {
        ok: false,
        canceled: false,
        backgroundUrl: null,
        message: 'Imagem demasiado grande (máximo 40 MB).'
      };
    }

    const buffer = fs.readFileSync(source);
    const stored = storeBackgroundBuffer(buffer, path.extname(source));

    return { ok: true, canceled: false, backgroundUrl: stored.url, path: stored.path };
  } catch (err) {
    console.error('Falha ao copiar a imagem:', err);

    return {
      ok: false,
      canceled: false,
      backgroundUrl: null,
      message: 'Não foi possível usar essa imagem.'
    };
  }
});

// Recebe a imagem já lida na interface (galeria do celular, arrastar-e-soltar)
ipcMain.handle('background:set-data', async (event, payload) => {
  try {
    const dataUrl = String((payload && payload.dataUrl) || '');
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl);

    if (!match) {
      return { ok: false, backgroundUrl: null, message: 'Ficheiro de imagem inválido.' };
    }

    const mime = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');

    if (!buffer.length) {
      return { ok: false, backgroundUrl: null, message: 'Imagem vazia.' };
    }

    if (buffer.length > MAX_BACKGROUND_BYTES) {
      return { ok: false, backgroundUrl: null, message: 'Imagem demasiado grande (máximo 40 MB).' };
    }

    const stored = storeBackgroundBuffer(buffer, MIME_TO_EXT[mime] || '.jpg');

    return { ok: true, backgroundUrl: stored.url, path: stored.path };
  } catch (err) {
    console.error('Falha ao guardar a imagem escolhida:', err);
    return { ok: false, backgroundUrl: null, message: 'Não foi possível guardar a imagem.' };
  }
});

ipcMain.handle('background:remove', () => {
  const settings = loadSettings();
  settings.backgroundImage = null;
  saveSettings(settings);
  removeOldBackgrounds(null);
  return { ok: true, backgroundUrl: null };
});

/* ---------------------- Créditos ---------------------- */

ipcMain.handle('credits:add', (event, amount) => {
  const add = Math.max(0, parseInt(amount, 10) || 0);
  const settings = loadSettingsWithRenewal();
  const max = creditsMax(settings);

  settings.credits = clamp((settings.credits || 0) + add, 0, max);
  saveSettings(settings);

  return { credits: settings.credits, max };
});

ipcMain.handle('credits:info', () => {
  const settings = loadSettingsWithRenewal();
  const max = creditsMax(settings);

  return {
    mode: settings.mode,
    credits: settings.credits || 0,
    max,
    cost: clamp(parseInt(settings.creditCost, 10) || 2, 1, max),
    periodHours: Math.max(1, parseInt(settings.creditPeriodHours, 10) || 24),
    renewAt: settings.creditRenewAt || null
  };
});

ipcMain.handle('credits:consume', () => {
  const settings = loadSettingsWithRenewal();
  const max = creditsMax(settings);

  if (settings.mode !== 'credits') {
    return { ok: true, mode: 'free', credits: settings.credits, max, renewAt: null };
  }

  const cost = clamp(parseInt(settings.creditCost, 10) || 2, 1, max);

  if ((settings.credits || 0) >= cost) {
    settings.credits -= cost;
    saveSettings(settings);

    return {
      ok: true,
      mode: 'credits',
      credits: settings.credits,
      cost,
      max,
      renewAt: settings.creditRenewAt
    };
  }

  return {
    ok: false,
    mode: 'credits',
    credits: settings.credits || 0,
    cost,
    max,
    renewAt: settings.creditRenewAt
  };
});

/* ---------------------- Administração ---------------------- */

ipcMain.handle('admin:verify', (event, pin) => {
  const settings = loadSettings();
  return String(pin) === String(settings.adminPin);
});

ipcMain.handle('admin:setPin', (event, pin) => {
  const p = String(pin || '').trim();

  if (!/^\d{4}$/.test(p)) {
    return { ok: false, message: 'O PIN deve ter exatamente 4 dígitos.' };
  }

  const settings = loadSettings();
  settings.adminPin = p;
  saveSettings(settings);

  return { ok: true };
});

/* ---------------------- Biblioteca ---------------------- */

ipcMain.handle('library:get', () => {
  const settings = loadSettings();

  if (!library.scannedAt) {
    ensureLibrary();

    return Object.assign(librarySummary(), {
      folders: getFolders(settings),
      scanning: true
    });
  }

  return librarySummary();
});

ipcMain.handle('library:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolher a pasta do karaokê',
    buttonLabel: 'Usar esta pasta',
    properties: ['openDirectory'],
    defaultPath: library.folders[0] || loadSettings().libraryPath || app.getPath('home')
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, library: librarySummary() };
  }

  const folder = result.filePaths[0];
  const settings = loadSettings();
  const folders = persistFolders((settings.libraryPaths || []).concat(folder));

  await loadLibrary(folders);

  return { ok: true, library: librarySummary() };
});

ipcMain.handle('library:remove-folder', async (event, folder) => {
  const settings = loadSettings();
  const target = path.resolve(String(folder || ''));
  const key = process.platform === 'win32' ? target.toLowerCase() : target;

  const folders = (settings.libraryPaths || []).filter((item) => {
    const full = path.resolve(item);
    const itemKey = process.platform === 'win32' ? full.toLowerCase() : full;
    return itemKey !== key;
  });

  persistFolders(folders);

  if (folders.length) {
    await loadLibrary(folders);
  } else {
    library.folders = [];
    library.entries = [];
    library.indexEntries = [];
    library.notepadFiles = [];
    library.byCode = new Map();
    library.byCodeLoose = new Map();
    library.byName = new Map();
    library.indexByCode = new Map();
    library.indexByCodeLoose = new Map();
    library.stats = Object.assign({}, library.stats, { media: 0, labeled: 0, indexFiles: 0, indexRows: 0, indexOnly: 0 });
    library.scannedAt = null;
    notifyLibrary(Object.assign(librarySummary(), { scanning: false, ready: false }));
  }

  return { ok: true, library: librarySummary() };
});

ipcMain.handle('library:detect', async () => {
  const result = await detectAndMerge();
  return Object.assign({ library: librarySummary() }, result);
});

ipcMain.handle('library:rescan', async () => {
  const settings = loadSettings();
  let folders = getFolders(settings);

  if (!folders.length) {
    const detected = await detectKaraokeFolders();
    folders = persistFolders(detected);
  }

  if (!folders.length) {
    return { ok: false, message: 'Nenhuma pasta de karaokê encontrada.', library: librarySummary() };
  }

  library.scannedAt = null;

  await loadLibrary(folders);

  return { ok: true, library: librarySummary() };
});

ipcMain.handle('library:reveal', async (event, folder) => {
  const target = folder && isFolder(folder) ? folder : library.folders[0];

  if (!target) return { ok: false };

  try {
    await shell.openPath(target);
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
});

ipcMain.handle('library:open-notepad', async (event, filePath) => {
  const target = path.resolve(String(filePath || ''));
  const known = (library.notepadFiles || []).some((item) => path.resolve(item.path) === target);

  if (!known && !isInsideLibrary(target)) {
    return { ok: false, message: 'Ficheiro fora da pasta do karaokê.' };
  }

  try {
    const error = await shell.openPath(target);
    if (error) return { ok: false, message: error };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: 'Não foi possível abrir o ficheiro.' };
  }
});

/* ---------------------- Músicas ---------------------- */

ipcMain.handle('song:resolve', async (event, query) => {
  if (!library.scannedAt) {
    ensureLibrary();
    return { found: false, matches: [], scanning: true };
  }

  const text = String(query || '').trim();
  if (!text) return { found: false, matches: [] };

  if (/^\d{1,8}$/.test(text)) {
    const entry = findEntryByCode(text);

    return entry
      ? { found: true, entry: toPublicEntry(entry) }
      : { found: false, matches: [] };
  }

  const matches = searchEntries(text, 12).map(toPublicEntry);

  if (matches.length === 1) {
    return { found: true, entry: matches[0], matches };
  }

  return { found: false, matches };
});

ipcMain.handle('song:search', async (event, query) => {
  await ensureLibrary();
  return searchEntries(query, 20).map(toPublicEntry);
});

ipcMain.handle('song:media-info', async (event, filePath) => {
  const target = String(filePath || '');

  if (!isInsideLibrary(target)) {
    return { ok: false, message: 'Ficheiro fora da pasta do karaokê.' };
  }

  const exists = fs.existsSync(target);

  return {
    ok: exists,
    url: exists ? pathToFileURL(target).href : null,
    kind: mediaKindOf(target),
    playable: PLAYABLE_EXTENSIONS.has(path.extname(target).toLowerCase())
  };
});

ipcMain.handle('song:open-system', async (event, filePath) => {
  const target = String(filePath || '');

  if (!isInsideLibrary(target)) {
    return { ok: false, message: 'Ficheiro fora da pasta do karaokê.' };
  }

  try {
    const error = await shell.openPath(target);
    if (error) return { ok: false, message: error };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: 'Não foi possível abrir o ficheiro.' };
  }
});

/* ---------------------- Janela (controlo) ---------------------- */

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:toggle-fullscreen', () => {
  if (!mainWindow) return;

  const settings = loadSettings();
  settings.fullscreen = !mainWindow.isFullScreen();
  saveSettings(settings);

  mainWindow.setFullScreen(settings.fullscreen);
  mainWindow.webContents.send('fullscreen:changed', settings.fullscreen);
});

/* ---------------------- Ciclo de vida ---------------------- */

async function bootstrapLibrary() {
  const settings = loadSettings();
  let folders = getFolders(settings);

  if (!folders.length) {
    folders = dedupeFolders(quickFindFolders());
    if (folders.length) persistFolders(folders);
  }

  if (folders.length) {
    await loadLibrary(folders);
  } else {
    notifyLibrary(Object.assign(librarySummary(), { scanning: false, ready: false }));
  }

  // Varredura completa dos discos em segundo plano
  setTimeout(() => {
    detectAndMerge().catch((err) => console.error('Deteção automática:', err));
  }, 1200);
}

app.whenReady().then(() => {
  ensureDirs();
  applyAutoStart(loadSettings().autoStart);
  createWindow();

  bootstrapLibrary().catch((err) => console.error('Biblioteca inicial:', err));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
