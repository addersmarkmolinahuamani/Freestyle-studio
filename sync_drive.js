const fs = require('fs');

async function syncDriveFolder(folderId = '19t6ICr4GJ1WWJhEb36AT5jcpi2f24Nqh') {
  const url = `https://drive.google.com/drive/folders/${folderId}?usp=sharing`;
  console.log(`Fetching Drive folder: ${url}`);
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  const html = await res.text();
  
  // Extract files from _DRIVE_ivd or data structures
  // Pattern in HTML:
  // x22(FILE_ID)x22,x5bx22(FOLDER_ID)x22x5d,x22(FILE_NAME)x22,x22(MIME)x22,...,(SIZE)
  // Or general regex to match file items:
  const files = [];
  
  // Regex 1: hex-escaped format (e.g. x22IDx22,x5bx22FOLDERIDx22x5d,x22NAMEx22,x22audio/...)
  const regexHex = /x22([a-zA-Z0-9_-]{25,})x22,x5bx22(?:[a-zA-Z0-9_-]+)x22x5d,x22([^"]+?\.(?:mp3|wav|m4a|ogg|aac))x22,x22(audio\/[^"]+)x22,[\d\w,null]*,(\d+)/gi;
  let m;
  while ((m = regexHex.exec(html)) !== null) {
    const id = m[1];
    let name = m[2];
    // unescape hex like x5b, x5d, u0026
    name = name.replace(/x5b/g, '[').replace(/x5d/g, ']').replace(/x22/g, '').replace(/u0026/g, '&');
    const size = parseInt(m[4], 10) || 0;
    if (!files.some(f => f.id === id)) {
      files.push({ id, filename: name, size });
    }
  }

  // Regex 2: normal unescaped format if present
  const regexNorm = /\["([a-zA-Z0-9_-]{25,})",\["(?:[a-zA-Z0-9_-]+)"\],"([^"]+?\.(?:mp3|wav|m4a|ogg|aac))","(audio\/[^"]+)",[\d\w,null]*,(\d+)/gi;
  while ((m = regexNorm.exec(html)) !== null) {
    const id = m[1];
    let name = m[2];
    const size = parseInt(m[4], 10) || 0;
    if (!files.some(f => f.id === id)) {
      files.push({ id, filename: name, size });
    }
  }

  // Regex 3: fallback by looking at data-id and data-tooltip
  const regexFallback = /data-id="([a-zA-Z0-9_-]{25,})"[^>]*data-tooltip="([^"]+?\.(?:mp3|wav|m4a|ogg|aac))\s+Audio"/gi;
  while ((m = regexFallback.exec(html)) !== null) {
    const id = m[1];
    const name = m[2].replace(/&amp;/g, '&');
    if (!files.some(f => f.id === id)) {
      files.push({ id, filename: name, size: 0 });
    }
  }

  console.log(`Found ${files.length} audio tracks in Drive:`, files);
  
  const beats = files.map(f => {
    const cleanTitle = f.filename.replace(/\.[^/.]+$/, '').replace(/\s+/g, ' ').trim();
    return {
      id: f.id,
      filename: f.filename,
      title: cleanTitle,
      source: 'Google Drive',
      driveUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
      url: `https://drive.google.com/uc?export=download&id=${f.id}`,
      size: f.size
    };
  });

  fs.writeFileSync('beats.json', JSON.stringify(beats, null, 2), 'utf8');
  console.log('Saved beats.json successfully!');
  return beats;
}

syncDriveFolder();
