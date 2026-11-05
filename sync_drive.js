const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const FOLDER_ID = '19t6ICr4GJ1WWJhEb36AT5jcpi2f24Nqh';

async function syncDriveTracks() {
  console.log(`\n🔍 Verificando carpeta de Google Drive (${FOLDER_ID})...`);
  const url = `https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`;
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    console.error(`Error consultando Google Drive: HTTP ${res.status}`);
    return;
  }

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

  console.log(`✨ Encontradas ${files.length} bases en tu Google Drive.`);
  let newDownloads = 0;

  for (const f of files) {
    const localPath = path.join(ROOT_DIR, f.filename);
    if (!fs.existsSync(localPath)) {
      console.log(`⬇️ Descargando nueva base: "${f.filename}"...`);
      try {
        const downloadUrl = `https://drive.usercontent.google.com/download?id=${f.id}&export=download`;
        const fileRes = await fetch(downloadUrl);
        if (fileRes.ok) {
          const buf = Buffer.from(await fileRes.arrayBuffer());
          fs.writeFileSync(localPath, buf);
          console.log(`✅ Guardada localmente: ${f.filename} (${(buf.length / (1024 * 1024)).toFixed(1)} MB)`);
          newDownloads++;
        } else {
          console.error(`❌ Falló la descarga de ${f.filename}: HTTP ${fileRes.status}`);
        }
      } catch (err) {
        console.error(`❌ Error descargando ${f.filename}:`, err.message);
      }
    } else {
      console.log(`✔️ Ya existe: "${f.filename}"`);
    }
  }

  // Actualizar beats.json
  const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.webm'];
  const allLocal = fs.readdirSync(ROOT_DIR)
    .filter(f => audioExts.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const stats = fs.statSync(path.join(ROOT_DIR, f));
      return {
        filename: f,
        title: path.basename(f, path.extname(f)).replace(/\s+/g, ' ').trim(),
        source: 'Hosting Directo',
        url: './' + encodeURIComponent(f),
        size: stats.size
      };
    });

  fs.writeFileSync(path.join(ROOT_DIR, 'beats.json'), JSON.stringify(allLocal, null, 2), 'utf8');
  console.log(`\n🎉 Lista de bases actualizada en beats.json (${allLocal.length} pistas en total).`);

  if (newDownloads > 0) {
    console.log(`\n💡 Se descargaron ${newDownloads} nuevas pistas.`);
    console.log(`Para que se reflejen en tu celular (GitHub Pages), ejecuta: git add -A; git commit -m "Nuevas bases"; git push`);
  }
}

syncDriveTracks();
