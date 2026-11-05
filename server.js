const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = __dirname;
const RECORDINGS_DIR = path.join(ROOT_DIR, 'grabaciones');

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// Sincronizar bases desde Google Drive
async function syncDriveBeats(folderId = '19t6ICr4GJ1WWJhEb36AT5jcpi2f24Nqh') {
  try {
    const url = `https://drive.google.com/drive/folders/${folderId}?usp=sharing`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    const files = [];

    const regexHex = /x22([a-zA-Z0-9_-]{25,})x22,x5bx22(?:[a-zA-Z0-9_-]+)x22x5d,x22([^"]+?\.(?:mp3|wav|m4a|ogg|aac))x22,x22(audio\/[^"]+)x22,[\d\w,null]*,(\d+)/gi;
    let m;
    while ((m = regexHex.exec(html)) !== null) {
      const id = m[1];
      let name = m[2].replace(/x5b/g, '[').replace(/x5d/g, ']').replace(/x22/g, '').replace(/u0026/g, '&');
      const size = parseInt(m[4], 10) || 0;
      if (!files.some(f => f.id === id)) {
        files.push({ id, filename: name, size });
      }
    }

    const regexNorm = /\["([a-zA-Z0-9_-]{25,})",\["(?:[a-zA-Z0-9_-]+)"\],"([^"]+?\.(?:mp3|wav|m4a|ogg|aac))","(audio\/[^"]+)",[\d\w,null]*,(\d+)/gi;
    while ((m = regexNorm.exec(html)) !== null) {
      const id = m[1];
      const name = m[2];
      const size = parseInt(m[4], 10) || 0;
      if (!files.some(f => f.id === id)) {
        files.push({ id, filename: name, size });
      }
    }

    const regexFallback = /data-id="([a-zA-Z0-9_-]{25,})"[^>]*data-tooltip="([^"]+?\.(?:mp3|wav|m4a|ogg|aac))\s+Audio"/gi;
    while ((m = regexFallback.exec(html)) !== null) {
      const id = m[1];
      const name = m[2].replace(/&amp;/g, '&');
      if (!files.some(f => f.id === id)) {
        files.push({ id, filename: name, size: 0 });
      }
    }

    if (files.length > 0) {
      const beats = files.map(f => {
        const streamUrl = `https://drive.usercontent.google.com/download?id=${f.id}&export=download`;
        return {
          id: f.id,
          filename: f.filename,
          title: f.filename.replace(/\.[^/.]+$/, '').replace(/\s+/g, ' ').trim(),
          source: 'Google Drive',
          driveUrl: streamUrl,
          url: streamUrl,
          size: f.size
        };
      });
      fs.writeFileSync(path.join(ROOT_DIR, 'beats.json'), JSON.stringify(beats, null, 2), 'utf8');
      console.log(`[Google Drive] ${beats.length} bases sincronizadas.`);
      return beats;
    }
  } catch (err) {
    console.error('[Google Drive] Error sincronizando:', err.message);
  }
  return null;
}

function getBeats() {
  const jsonPath = path.join(ROOT_DIR, 'beats.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const beats = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(beats) && beats.length > 0) {
        return beats;
      }
    } catch (e) {}
  }
  const files = fs.readdirSync(ROOT_DIR);
  const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.webm'];
  return files
    .filter(f => audioExts.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const stats = fs.statSync(path.join(ROOT_DIR, f));
      return {
        filename: f,
        title: path.basename(f, path.extname(f)).replace(/\s+/g, ' ').trim(),
        url: './' + encodeURIComponent(f),
        size: stats.size
      };
    });
}

function getRecordings() {
  if (!fs.existsSync(RECORDINGS_DIR)) return [];
  const files = fs.readdirSync(RECORDINGS_DIR);
  const metaFiles = files.filter(f => f.endsWith('.json'));
  const list = [];
  for (const mf of metaFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RECORDINGS_DIR, mf), 'utf8'));
      list.push(data);
    } catch (e) {
      // ignore invalid json
    }
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

function serveFileWithRange(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // API: List Beats
  if (pathname === '/api/beats' && req.method === 'GET') {
    const beats = getBeats();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(beats));
    return;
  }

  // API: Refresh Google Drive Beats
  if (pathname === '/api/sync-drive' && req.method === 'POST') {
    syncDriveBeats().then((updated) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, beats: updated || getBeats() }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // API: List Saved Recordings
  if (pathname === '/api/recordings' && req.method === 'GET') {
    const recs = getRecordings();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(recs));
    return;
  }

  // API: Upload a new Beat
  if (pathname === '/api/upload-beat' && req.method === 'POST') {
    const filenameHeader = req.headers['x-filename'];
    if (!filenameHeader) {
      res.writeHead(400);
      res.end('Missing X-Filename header');
      return;
    }
    const safeName = path.basename(decodeURIComponent(filenameHeader));
    const targetPath = path.join(ROOT_DIR, safeName);
    const writeStream = fs.createWriteStream(targetPath);
    req.pipe(writeStream);
    writeStream.on('finish', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, filename: safeName }));
    });
    return;
  }

  // API: Save Recording (Vocal Blob + Metadata)
  if (pathname === '/api/save-recording' && req.method === 'POST') {
    const id = 'rec_' + Date.now();
    const ext = req.headers['x-ext'] || '.webm';
    const metaRaw = req.headers['x-meta'] ? decodeURIComponent(req.headers['x-meta']) : '{}';
    const vocalFilename = `${id}${ext}`;
    const vocalPath = path.join(RECORDINGS_DIR, vocalFilename);
    const writeStream = fs.createWriteStream(vocalPath);
    req.pipe(writeStream);
    writeStream.on('finish', () => {
      let meta = {};
      try { meta = JSON.parse(metaRaw); } catch (e) {}
      const recordData = {
        id,
        title: meta.title || `Sesión Freestyle`,
        beatFilename: meta.beatFilename,
        beatTitle: meta.beatTitle,
        beatUrl: meta.beatUrl,
        beatStartOffset: meta.beatStartOffset || 0,
        duration: meta.duration || 0,
        vocalUrl: `/recordings/${encodeURIComponent(vocalFilename)}`,
        vocalFilename,
        createdAt: Date.now()
      };
      fs.writeFileSync(path.join(RECORDINGS_DIR, `${id}.json`), JSON.stringify(recordData, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recordData));
    });
    return;
  }

  // API: Delete Recording
  if (pathname.startsWith('/api/recordings/') && req.method === 'DELETE') {
    const id = path.basename(pathname);
    const jsonPath = path.join(RECORDINGS_DIR, `${id}.json`);
    if (fs.existsSync(jsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (meta.vocalFilename) {
          const vPath = path.join(RECORDINGS_DIR, path.basename(meta.vocalFilename));
          if (fs.existsSync(vPath)) fs.unlinkSync(vPath);
        }
      } catch (e) {}
      fs.unlinkSync(jsonPath);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Media serving for beats in ROOT_DIR
  if (pathname.startsWith('/media/')) {
    const rawName = decodeURIComponent(pathname.slice('/media/'.length));
    const safeName = path.basename(rawName);
    const filePath = path.join(ROOT_DIR, safeName);
    serveFileWithRange(req, res, filePath);
    return;
  }

  // Media serving for saved vocal tracks
  if (pathname.startsWith('/recordings/')) {
    const rawName = decodeURIComponent(pathname.slice('/recordings/'.length));
    const safeName = path.basename(rawName);
    const filePath = path.join(RECORDINGS_DIR, safeName);
    serveFileWithRange(req, res, filePath);
    return;
  }

  // Static files
  let staticFile = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safeStatic = path.basename(staticFile);
  if (['index.html', 'styles.css', 'app.js', 'manifest.json', 'sw.js', 'icon.svg', 'beats.json'].includes(safeStatic)) {
    serveFileWithRange(req, res, path.join(ROOT_DIR, safeStatic));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎤 FREESTYLE RAP STUDIO ejecutándose en:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
  syncDriveBeats();
});

