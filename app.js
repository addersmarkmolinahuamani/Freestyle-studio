// ============================================================================
// FREESTYLE RAP STUDIO - MOTOR DE AUDIO MULTIPISTA Y MEZCLADOR EN TIEMPO REAL
// ============================================================================

const FMS_WORDS = [
  'IMPROVISACIÓN', 'CORONA', 'ASFALTO', 'DESTINO', 'RELÁMPAGO', 'ESPEJO',
  'GRAVEDAD', 'ALQUIMIA', 'FRONTERA', 'SILENCIO', 'CICATRIZ', 'HORIZONTE',
  'LABERINTO', 'TORMENTA', 'LEALTAD', 'INSTINTO', 'CENIZAS', 'MEMORIA',
  'REVOLUCIÓN', 'UNIVERSO', 'METÁFORA', 'ADRENALINA', 'CÓDIGO', 'VICTORIA',
  'RESILIENCIA', 'SOMBRA', 'FUEGO', 'LIBERTAD', 'IMPACTO', 'LEYENDA'
];

// Estado global
const state = {
  beats: [],
  activeBeat: null,
  recordings: [],
  activeRecording: null,

  // Web Audio Context
  audioCtx: null,

  // Reproductor de pista en vivo
  beatAudioEl: new Audio(),
  beatMediaNode: null,
  beatLiveGain: null,
  beatAnalyser: null,

  // Micrófono
  micStream: null,
  micSourceNode: null,
  micAnalyser: null,
  micMonitorGain: null,
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  recStartTime: 0,
  recBeatStartOffset: 0,
  recTimerInterval: null,

  // Mezclador de Grabación (Beat + Voz por separado)
  mixIsPlaying: false,
  mixStartTimeCtx: 0,
  mixPauseOffset: 0,
  mixDuration: 0,
  mixBeatBuffer: null,
  mixVocalBuffer: null,
  mixBeatSource: null,
  mixVocalSource: null,
  mixBeatGainNode: null,
  mixVocalGainNode: null,
  mixVocalCompNode: null,
  mixVocalPresenceNode: null,
  mixAnimFrame: null,

  // Generador de palabras
  stimulusActive: false,
  stimulusTimer: null,
  stimulusProgress: 0
};

state.beatAudioEl.crossOrigin = 'anonymous';

// Elementos del DOM
const dom = {
  beatsList: document.getElementById('beatsList'),
  recordingsList: document.getElementById('recordingsList'),
  recordingsCount: document.getElementById('recordingsCount'),
  activeBeatTitle: document.getElementById('activeBeatTitle'),
  fileUploadBeat: document.getElementById('fileUploadBeat'),

  micDot: document.getElementById('micDot'),
  micStatusText: document.getElementById('micStatusText'),
  btnEnableMic: document.getElementById('btnEnableMic'),
  micDeviceSelect: document.getElementById('micDeviceSelect'),
  chkMonitorMic: document.getElementById('chkMonitorMic'),

  audioCanvas: document.getElementById('audioCanvas'),
  recIndicator: document.getElementById('recIndicator'),
  recTimer: document.getElementById('recTimer'),
  vuBeat: document.getElementById('vuBeat'),
  vuMic: document.getElementById('vuMic'),

  beatCurrentTime: document.getElementById('beatCurrentTime'),
  beatDuration: document.getElementById('beatDuration'),
  beatSeek: document.getElementById('beatSeek'),
  btnRestartBeat: document.getElementById('btnRestartBeat'),
  btnPlayBeat: document.getElementById('btnPlayBeat'),
  btnRecordSession: document.getElementById('btnRecordSession'),
  btnStopSession: document.getElementById('btnStopSession'),
  liveBeatVol: document.getElementById('liveBeatVol'),
  liveBeatVolVal: document.getElementById('liveBeatVolVal'),

  mixerBody: document.getElementById('mixerBody'),
  activeRecordingSubtitle: document.getElementById('activeRecordingSubtitle'),
  activeTakeBadge: document.getElementById('activeTakeBadge'),
  mixCurrentTime: document.getElementById('mixCurrentTime'),
  mixDuration: document.getElementById('mixDuration'),
  mixSeek: document.getElementById('mixSeek'),
  mixBeatGain: document.getElementById('mixBeatGain'),
  mixBeatGainVal: document.getElementById('mixBeatGainVal'),
  mixVocalGain: document.getElementById('mixVocalGain'),
  mixVocalGainVal: document.getElementById('mixVocalGainVal'),
  vocalOffsetMs: document.getElementById('vocalOffsetMs'),
  vocalOffsetVal: document.getElementById('vocalOffsetVal'),
  chkStudioVoice: document.getElementById('chkStudioVoice'),
  btnPlayMix: document.getElementById('btnPlayMix'),
  btnExportWav: document.getElementById('btnExportWav'),

  stimulusMode: document.getElementById('stimulusMode'),
  btnToggleStimulus: document.getElementById('btnToggleStimulus'),
  stimulusWord: document.getElementById('stimulusWord'),
  stimulusBar: document.getElementById('stimulusBar')
};

// Utilidad para formatear segundos a MM:SS
function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Inicializar AudioContext bajo demanda
function ensureAudioContext() {
  if (!state.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContextClass();

    // Configurar grafo para el reproductor de pista en vivo
    state.beatMediaNode = state.audioCtx.createMediaElementSource(state.beatAudioEl);
    state.beatLiveGain = state.audioCtx.createGain();
    state.beatLiveGain.gain.value = parseFloat(dom.liveBeatVol.value);

    state.beatAnalyser = state.audioCtx.createAnalyser();
    state.beatAnalyser.fftSize = 256;

    state.beatMediaNode.connect(state.beatLiveGain);
    state.beatLiveGain.connect(state.beatAnalyser);
    state.beatAnalyser.connect(state.audioCtx.destination);
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
}

// ============================================================================
// 1. CARGA DE PISTAS (BASES) Y GRABACIONES GUARDADAS (SERVIDOR + INDEXEDDB MÓVIL)
// ============================================================================
const IDB_NAME = 'FreestyleStudioDB';
const IDB_VERSION = 1;

function openLocalDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('customBeats')) {
        db.createObjectStore('customBeats', { keyPath: 'filename' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  try {
    const db = await openLocalDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function idbPut(storeName, value) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadBeats() {
  let loadedBeats = [];
  try {
    const res = await fetch('/api/beats');
    if (!res.ok) throw new Error('No local API');
    loadedBeats = await res.json();
  } catch (err) {
    try {
      const res = await fetch('./beats.json');
      loadedBeats = await res.json();
    } catch (e2) {
      loadedBeats = [];
    }
  }

  // Combinar con pistas personalizadas subidas desde el celular (IndexedDB)
  const customBeats = await idbGetAll('customBeats');
  for (const cb of customBeats) {
    if (cb.blob && !loadedBeats.some(b => b.filename === cb.filename)) {
      loadedBeats.push({
        filename: cb.filename,
        title: cb.title,
        url: URL.createObjectURL(cb.blob),
        size: cb.size,
        isLocalBlob: true
      });
    }
  }

  state.beats = loadedBeats;
  renderBeats();
  if (state.beats.length > 0 && !state.activeBeat) {
    selectBeat(state.beats[0], false);
  }
}

function renderBeats() {
  if (state.beats.length === 0) {
    dom.beatsList.innerHTML = `<div class="empty-state">No hay archivos .mp3 o .wav en la carpeta. Sube uno con "+ Añadir Pista".</div>`;
    return;
  }
  dom.beatsList.innerHTML = '';
  state.beats.forEach((beat, idx) => {
    const item = document.createElement('div');
    const isActive = state.activeBeat && state.activeBeat.filename === beat.filename;
    item.className = `beat-item ${isActive ? 'active' : ''}`;
    const sizeMB = (beat.size / (1024 * 1024)).toFixed(1);
    item.innerHTML = `
      <div class="beat-item-icon">${idx + 1}</div>
      <div class="beat-item-info">
        <div class="beat-item-title" title="${beat.title}">${beat.title}</div>
        <div class="beat-item-sub">Base de Rap • ${sizeMB} MB</div>
      </div>
    `;
    item.addEventListener('click', () => selectBeat(beat, true));
    dom.beatsList.appendChild(item);
  });
}

function selectBeat(beat, autoPlay = false) {
  if (state.isRecording) {
    alert('Detén la grabación actual antes de cambiar de pista.');
    return;
  }
  stopMixPlayback();
  state.activeBeat = beat;
  dom.activeBeatTitle.textContent = beat.title;
  state.beatAudioEl.src = beat.url;
  state.beatAudioEl.load();
  renderBeats();

  if (autoPlay) {
    ensureAudioContext();
    state.beatAudioEl.play();
    updatePlayButtonUI();
  }
}

// Subir nueva pista (al servidor en PC o a IndexedDB en el celular)
dom.fileUploadBeat.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const res = await fetch('/api/upload-beat', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(file.name) },
      body: file
    });
    if (!res.ok) throw new Error('Static host');
    await loadBeats();
  } catch (err) {
    // Guardar en IndexedDB del celular/navegador
    const title = file.name.replace(/\.[^/.]+$/, '');
    await idbPut('customBeats', {
      filename: file.name,
      title,
      size: file.size,
      blob: file
    });
    await loadBeats();
  }
});

// ============================================================================
// 2. MICRÓFONO Y MONITOREO
// ============================================================================
async function populateMicDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const currentVal = dom.micDeviceSelect.value;
    dom.micDeviceSelect.innerHTML = '';
    audioInputs.forEach((dev, i) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Micrófono ${i + 1}`;
      dom.micDeviceSelect.appendChild(opt);
    });
    if (currentVal) dom.micDeviceSelect.value = currentVal;
  } catch (e) {}
}

async function initMicrophone(deviceId = '') {
  ensureAudioContext();
  if (state.micStream) {
    state.micStream.getTracks().forEach(t => t.stop());
  }

  // Importante: Desactivar autoGainControl, noiseSuppression y echoCancellation
  // para que la voz del rapero no se corte ni baje de volumen cuando suena la base.
  const constraints = {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  };

  try {
    state.micStream = await navigator.mediaDevices.getUserMedia(constraints);
    await populateMicDevices();

    if (state.micSourceNode) {
      try { state.micSourceNode.disconnect(); } catch (e) {}
    }

    state.micSourceNode = state.audioCtx.createMediaStreamSource(state.micStream);
    state.micAnalyser = state.audioCtx.createAnalyser();
    state.micAnalyser.fftSize = 256;

    state.micMonitorGain = state.audioCtx.createGain();
    state.micMonitorGain.gain.value = dom.chkMonitorMic.checked ? 1.0 : 0.0;

    state.micSourceNode.connect(state.micAnalyser);
    state.micAnalyser.connect(state.micMonitorGain);
    state.micMonitorGain.connect(state.audioCtx.destination);

    dom.micDot.classList.add('online');
    dom.micStatusText.textContent = 'Micrófono Listo';
    dom.btnEnableMic.textContent = '🎙️ Micrófono Conectado';
    return true;
  } catch (err) {
    alert('No se pudo acceder al micrófono. Verifica los permisos del navegador.');
    return false;
  }
}

dom.btnEnableMic.addEventListener('click', () => initMicrophone(dom.micDeviceSelect.value));
dom.micDeviceSelect.addEventListener('change', () => {
  if (state.micStream) initMicrophone(dom.micDeviceSelect.value);
});
dom.chkMonitorMic.addEventListener('change', () => {
  if (state.micMonitorGain && state.audioCtx) {
    state.micMonitorGain.gain.setTargetAtTime(
      dom.chkMonitorMic.checked ? 1.0 : 0.0,
      state.audioCtx.currentTime,
      0.02
    );
  }
});

// ============================================================================
// 3. REPRODUCTOR DE LA BASE Y GRABACIÓN DE FREESTYLE EN VIVO
// ============================================================================
function updatePlayButtonUI() {
  if (state.beatAudioEl.paused) {
    dom.btnPlayBeat.innerHTML = '▶ Reproducir Pista';
  } else {
    dom.btnPlayBeat.innerHTML = '⏸ Pausar Pista';
  }
}

dom.btnPlayBeat.addEventListener('click', () => {
  if (!state.activeBeat) return;
  ensureAudioContext();
  stopMixPlayback();

  if (state.beatAudioEl.paused) {
    state.beatAudioEl.play();
  } else {
    state.beatAudioEl.pause();
  }
  updatePlayButtonUI();
});

dom.btnRestartBeat.addEventListener('click', () => {
  state.beatAudioEl.currentTime = 0;
});

dom.liveBeatVol.addEventListener('input', () => {
  const v = parseFloat(dom.liveBeatVol.value);
  dom.liveBeatVolVal.textContent = `${Math.round(v * 100)}%`;
  if (state.beatLiveGain && state.audioCtx) {
    state.beatLiveGain.gain.setTargetAtTime(v, state.audioCtx.currentTime, 0.02);
  } else {
    state.beatAudioEl.volume = Math.min(1, v);
  }
});

state.beatAudioEl.addEventListener('timeupdate', () => {
  dom.beatCurrentTime.textContent = formatTime(state.beatAudioEl.currentTime);
  if (state.beatAudioEl.duration) {
    dom.beatSeek.max = state.beatAudioEl.duration;
    dom.beatSeek.value = state.beatAudioEl.currentTime;
  }
});

state.beatAudioEl.addEventListener('loadedmetadata', () => {
  dom.beatDuration.textContent = formatTime(state.beatAudioEl.duration);
  dom.beatSeek.max = state.beatAudioEl.duration || 100;
});

state.beatAudioEl.addEventListener('ended', () => {
  updatePlayButtonUI();
  if (state.isRecording) {
    stopRecordingSession();
  }
});

dom.beatSeek.addEventListener('input', () => {
  state.beatAudioEl.currentTime = parseFloat(dom.beatSeek.value);
});

// GRABAR SESIÓN DE FREESTYLE
dom.btnRecordSession.addEventListener('click', async () => {
  if (state.isRecording) return;
  if (!state.activeBeat) {
    alert('Primero selecciona una pista de rap.');
    return;
  }

  stopMixPlayback();

  if (!state.micStream) {
    const ok = await initMicrophone(dom.micDeviceSelect.value);
    if (!ok) return;
  }

  ensureAudioContext();

  // Si la pista estaba al final, reiniciarla
  if (state.beatAudioEl.ended || state.beatAudioEl.currentTime >= (state.beatAudioEl.duration - 1)) {
    state.beatAudioEl.currentTime = 0;
  }

  state.recordedChunks = [];
  let mimeType = '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
      mimeType = c;
      break;
    }
  }

  state.mediaRecorder = mimeType
    ? new MediaRecorder(state.micStream, { mimeType })
    : new MediaRecorder(state.micStream);
  state.mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      state.recordedChunks.push(ev.data);
    }
  };

  state.mediaRecorder.onstop = onRecordingComplete;

  // Guardamos en qué segundo exacto de la pista empezó el rapero a grabar
  state.recBeatStartOffset = state.beatAudioEl.currentTime;
  state.recStartTime = performance.now();
  state.isRecording = true;

  state.mediaRecorder.start(100);
  await state.beatAudioEl.play();
  updatePlayButtonUI();

  // UI de grabación activa
  dom.btnRecordSession.classList.add('recording');
  dom.btnRecordSession.textContent = '🔴 Grabando...';
  dom.btnRecordSession.disabled = true;
  dom.btnStopSession.disabled = false;
  dom.recIndicator.hidden = false;

  state.recTimerInterval = setInterval(() => {
    const elapsed = (performance.now() - state.recStartTime) / 1000;
    dom.recTimer.textContent = formatTime(elapsed);
  }, 200);
});

function stopRecordingSession() {
  if (!state.isRecording) return;
  state.isRecording = false;
  clearInterval(state.recTimerInterval);

  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.beatAudioEl.pause();
  updatePlayButtonUI();

  dom.btnRecordSession.classList.remove('recording');
  dom.btnRecordSession.textContent = '🔴 Grabar Freestyle';
  dom.btnRecordSession.disabled = false;
  dom.btnStopSession.disabled = true;
  dom.recIndicator.hidden = true;
}

dom.btnStopSession.addEventListener('click', stopRecordingSession);

async function onRecordingComplete() {
  const durationSec = (performance.now() - state.recStartTime) / 1000;
  const vocalBlob = new Blob(state.recordedChunks, { type: 'audio/webm' });

  const takeNumber = state.recordings.length + 1;
  const meta = {
    title: `Freestyle #${takeNumber} — ${state.activeBeat.title.slice(0, 28)}`,
    beatFilename: state.activeBeat.filename,
    beatTitle: state.activeBeat.title,
    beatUrl: state.activeBeat.url,
    beatStartOffset: state.recBeatStartOffset,
    duration: durationSec
  };

  let savedRec = null;
  try {
    const res = await fetch('/api/save-recording', {
      method: 'POST',
      headers: {
        'X-Ext': '.webm',
        'X-Meta': encodeURIComponent(JSON.stringify(meta))
      },
      body: vocalBlob
    });
    if (!res.ok) throw new Error('Static host');
    savedRec = await res.json();
  } catch (err) {
    // Guardar en IndexedDB del celular/navegador
    const id = 'rec_' + Date.now();
    savedRec = {
      id,
      ...meta,
      vocalBlob,
      vocalUrl: URL.createObjectURL(vocalBlob),
      createdAt: Date.now()
    };
    await idbPut('recordings', savedRec);
  }

  await loadRecordings();
  if (savedRec) {
    await loadRecordingIntoMixer(savedRec);
  }
}

// ============================================================================
// 4. GESTIÓN Y MEZCLA DE GRABACIONES (VOZ + PISTA CON VOLUMEN INDEPENDIENTE)
// ============================================================================
async function loadRecordings() {
  let list = [];
  try {
    const res = await fetch('/api/recordings');
    if (!res.ok) throw new Error('No local API');
    list = await res.json();
  } catch (e) {
    const localRecs = await idbGetAll('recordings');
    list = localRecs.map(r => ({
      ...r,
      vocalUrl: r.vocalBlob ? URL.createObjectURL(r.vocalBlob) : r.vocalUrl
    })).sort((a, b) => b.createdAt - a.createdAt);
  }
  state.recordings = list;
  dom.recordingsCount.textContent = state.recordings.length;
  renderRecordings();
}

function renderRecordings() {
  if (state.recordings.length === 0) {
    dom.recordingsList.innerHTML = `<div class="empty-state">Aún no has grabado ninguna sesión. ¡Elige una base y dale a Grabar!</div>`;
    return;
  }
  dom.recordingsList.innerHTML = '';
  state.recordings.forEach((rec) => {
    const card = document.createElement('div');
    const isActive = state.activeRecording && state.activeRecording.id === rec.id;
    card.className = `rec-card ${isActive ? 'active' : ''}`;
    const dateStr = new Date(rec.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    card.innerHTML = `
      <div class="rec-card-top">
        <div>
          <div class="rec-title">${rec.title}</div>
          <div class="rec-meta">🎵 ${rec.beatTitle}</div>
          <div class="rec-meta">⏱️ ${formatTime(rec.duration)} • Hoy ${dateStr}</div>
        </div>
      </div>
      <div class="rec-card-actions">
        <button class="btn btn-xs btn-outline btn-load-rec">🎚️ Cargar en Mezclador</button>
        <button class="btn btn-xs btn-del-rec" title="Eliminar grabación">🗑️</button>
      </div>
    `;
    card.querySelector('.btn-load-rec').addEventListener('click', () => loadRecordingIntoMixer(rec));
    card.querySelector('.btn-del-rec').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const res = await fetch(`/api/recordings/${rec.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Static');
      } catch (err) {
        await idbDelete('recordings', rec.id);
      }
      if (state.activeRecording && state.activeRecording.id === rec.id) {
        stopMixPlayback();
        state.activeRecording = null;
        dom.mixerBody.dataset.disabled = 'true';
        dom.activeTakeBadge.hidden = true;
      }
      await loadRecordings();
    });
    dom.recordingsList.appendChild(card);
  });
}

// Decodificar tanto la pista como la grabación de voz en AudioBuffers para mezcla precisa
async function loadRecordingIntoMixer(rec) {
  ensureAudioContext();
  stopMixPlayback();
  state.beatAudioEl.pause();
  updatePlayButtonUI();

  state.activeRecording = rec;
  renderRecordings();

  dom.activeRecordingSubtitle.textContent = `Cargando canales de "${rec.title}"...`;
  dom.mixerBody.dataset.disabled = 'true';

  try {
    const [beatRes, vocalRes] = await Promise.all([
      fetch(rec.beatUrl),
      fetch(rec.vocalUrl)
    ]);

    const [beatArrayBuf, vocalArrayBuf] = await Promise.all([
      beatRes.arrayBuffer(),
      vocalRes.arrayBuffer()
    ]);

    const [beatBuffer, vocalBuffer] = await Promise.all([
      state.audioCtx.decodeAudioData(beatArrayBuf),
      state.audioCtx.decodeAudioData(vocalArrayBuf)
    ]);

    state.mixBeatBuffer = beatBuffer;
    state.mixVocalBuffer = vocalBuffer;
    state.mixDuration = vocalBuffer.duration;
    state.mixPauseOffset = 0;

    dom.mixDuration.textContent = formatTime(state.mixDuration);
    dom.mixCurrentTime.textContent = '00:00';
    dom.mixSeek.max = state.mixDuration;
    dom.mixSeek.value = 0;

    dom.activeRecordingSubtitle.textContent = `Mezclando: ${rec.title} (Ajusta el volumen de tu voz o de la pista en tiempo real)`;
    dom.activeTakeBadge.hidden = false;
    dom.mixerBody.dataset.disabled = 'false';
  } catch (err) {
    console.error('Error decodificando pistas para el mezclador:', err);
    dom.activeRecordingSubtitle.textContent = 'No se pudo cargar la grabación.';
  }
}

function startMixPlayback(offsetSec = state.mixPauseOffset) {
  if (!state.mixBeatBuffer || !state.mixVocalBuffer) return;
  ensureAudioContext();
  stopMixNodesOnly();

  // Pausar reproductor en vivo si estaba sonando
  state.beatAudioEl.pause();
  updatePlayButtonUI();

  const now = state.audioCtx.currentTime;
  const clampedOffset = Math.max(0, Math.min(offsetSec, state.mixDuration - 0.05));

  // Crear nodos fuente para Pista y Voz
  const beatSource = state.audioCtx.createBufferSource();
  beatSource.buffer = state.mixBeatBuffer;

  const vocalSource = state.audioCtx.createBufferSource();
  vocalSource.buffer = state.mixVocalBuffer;

  // Ganancia independiente para la Pista
  const beatGain = state.audioCtx.createGain();
  beatGain.gain.value = parseFloat(dom.mixBeatGain.value);

  // Ganancia independiente para tu Rapeo (hasta 300%)
  const vocalGain = state.audioCtx.createGain();
  vocalGain.gain.value = parseFloat(dom.mixVocalGain.value);

  // Cadena de estudio para la voz (Filtro paso-alto + Realce de presencia + Compresor)
  const highpass = state.audioCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 85;

  const presence = state.audioCtx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3200;
  presence.Q.value = 1.1;
  presence.gain.value = dom.chkStudioVoice.checked ? 4.5 : 0;

  const compressor = state.audioCtx.createDynamicsCompressor();
  compressor.threshold.value = dom.chkStudioVoice.checked ? -20 : 0;
  compressor.knee.value = 18;
  compressor.ratio.value = dom.chkStudioVoice.checked ? 4 : 1;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;

  // Conectar Pista
  beatSource.connect(beatGain);
  beatGain.connect(state.beatAnalyser); // para ver en el visualizador
  beatGain.connect(state.audioCtx.destination);

  // Conectar Voz
  vocalSource.connect(highpass);
  highpass.connect(presence);
  presence.connect(compressor);
  compressor.connect(vocalGain);
  vocalGain.connect(state.audioCtx.destination);

  // Compensación de latencia de grabación (en segundos)
  const latencySec = parseFloat(dom.vocalOffsetMs.value) / 1000;
  const beatStartPos = (state.activeRecording.beatStartOffset || 0) + clampedOffset;

  // Sincronizar inicio de ambos canales
  let vocalOffset = clampedOffset;
  if (latencySec < 0) {
    // Adelanta ligeramente el buffer de voz para compensar el retraso de grabación
    vocalOffset = Math.min( state.mixVocalBuffer.duration - 0.01, Math.max(0, clampedOffset - latencySec) );
    beatSource.start(now, beatStartPos, state.mixDuration - clampedOffset);
    vocalSource.start(now, vocalOffset, state.mixDuration - clampedOffset);
  } else {
    beatSource.start(now, beatStartPos, state.mixDuration - clampedOffset);
    vocalSource.start(now + latencySec, vocalOffset, state.mixDuration - clampedOffset);
  }

  state.mixBeatSource = beatSource;
  state.mixVocalSource = vocalSource;
  state.mixBeatGainNode = beatGain;
  state.mixVocalGainNode = vocalGain;
  state.mixVocalCompNode = compressor;
  state.mixVocalPresenceNode = presence;

  state.mixStartTimeCtx = now - clampedOffset;
  state.mixIsPlaying = true;
  dom.btnPlayMix.textContent = '⏸ Pausar Mi Grabación';

  const tickMix = () => {
    if (!state.mixIsPlaying) return;
    const current = state.audioCtx.currentTime - state.mixStartTimeCtx;
    if (current >= state.mixDuration) {
      stopMixPlayback(true);
      return;
    }
    state.mixPauseOffset = current;
    dom.mixCurrentTime.textContent = formatTime(current);
    dom.mixSeek.value = current;
    state.mixAnimFrame = requestAnimationFrame(tickMix);
  };
  state.mixAnimFrame = requestAnimationFrame(tickMix);
}

function stopMixNodesOnly() {
  if (state.mixAnimFrame) cancelAnimationFrame(state.mixAnimFrame);
  if (state.mixBeatSource) {
    try { state.mixBeatSource.stop(); state.mixBeatSource.disconnect(); } catch (e) {}
    state.mixBeatSource = null;
  }
  if (state.mixVocalSource) {
    try { state.mixVocalSource.stop(); state.mixVocalSource.disconnect(); } catch (e) {}
    state.mixVocalSource = null;
  }
}

function stopMixPlayback(resetToZero = false) {
  stopMixNodesOnly();
  state.mixIsPlaying = false;
  if (resetToZero) {
    state.mixPauseOffset = 0;
    dom.mixSeek.value = 0;
    dom.mixCurrentTime.textContent = '00:00';
  }
  dom.btnPlayMix.textContent = '▶ Escuchar Mi Grabación Mezclada';
}

dom.btnPlayMix.addEventListener('click', () => {
  if (!state.activeRecording) return;
  if (state.mixIsPlaying) {
    stopMixPlayback(false);
  } else {
    if (state.mixPauseOffset >= state.mixDuration - 0.1) {
      state.mixPauseOffset = 0;
    }
    startMixPlayback(state.mixPauseOffset);
  }
});

dom.mixSeek.addEventListener('input', () => {
  const newTime = parseFloat(dom.mixSeek.value);
  state.mixPauseOffset = newTime;
  dom.mixCurrentTime.textContent = formatTime(newTime);
  if (state.mixIsPlaying) {
    startMixPlayback(newTime);
  }
});

// Sliders de volumen en tiempo real durante la reproducción de la grabación
dom.mixBeatGain.addEventListener('input', () => {
  const val = parseFloat(dom.mixBeatGain.value);
  dom.mixBeatGainVal.textContent = `${Math.round(val * 100)}%`;
  if (state.mixBeatGainNode && state.audioCtx) {
    state.mixBeatGainNode.gain.setTargetAtTime(val, state.audioCtx.currentTime, 0.015);
  }
});

dom.mixVocalGain.addEventListener('input', () => {
  const val = parseFloat(dom.mixVocalGain.value);
  dom.mixVocalGainVal.textContent = `${Math.round(val * 100)}%`;
  if (state.mixVocalGainNode && state.audioCtx) {
    state.mixVocalGainNode.gain.setTargetAtTime(val, state.audioCtx.currentTime, 0.015);
  }
});

// Botones de preset rápido ("Destacar Voz", "Mute Acapella", etc.)
document.querySelectorAll('.channel-presets button').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const val = btn.dataset.val;
    const inputEl = document.getElementById(targetId);
    if (inputEl) {
      inputEl.value = val;
      inputEl.dispatchEvent(new Event('input'));
    }
  });
});

dom.vocalOffsetMs.addEventListener('input', () => {
  dom.vocalOffsetVal.textContent = `${dom.vocalOffsetMs.value} ms`;
  if (state.mixIsPlaying) {
    startMixPlayback(state.mixPauseOffset);
  }
});

dom.chkStudioVoice.addEventListener('change', () => {
  if (state.mixIsPlaying) {
    startMixPlayback(state.mixPauseOffset);
  }
});

// ============================================================================
// 5. EXPORTAR MEZCLA FINAL A ARCHIVO .WAV CON LOS VOLÚMENES ELEGIDOS
// ============================================================================
dom.btnExportWav.addEventListener('click', async () => {
  if (!state.mixBeatBuffer || !state.mixVocalBuffer || !state.activeRecording) return;

  const originalText = dom.btnExportWav.textContent;
  dom.btnExportWav.textContent = '⏳ Renderizando mezcla...';
  dom.btnExportWav.disabled = true;

  try {
    const sampleRate = 44100;
    const totalSamples = Math.ceil(state.mixDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

    const beatSource = offlineCtx.createBufferSource();
    beatSource.buffer = state.mixBeatBuffer;

    const vocalSource = offlineCtx.createBufferSource();
    vocalSource.buffer = state.mixVocalBuffer;

    const beatGain = offlineCtx.createGain();
    beatGain.gain.value = parseFloat(dom.mixBeatGain.value);

    const vocalGain = offlineCtx.createGain();
    vocalGain.gain.value = parseFloat(dom.mixVocalGain.value);

    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;

    const presence = offlineCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 1.1;
    presence.gain.value = dom.chkStudioVoice.checked ? 4.5 : 0;

    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.value = dom.chkStudioVoice.checked ? -20 : 0;
    compressor.knee.value = 18;
    compressor.ratio.value = dom.chkStudioVoice.checked ? 4 : 1;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;

    beatSource.connect(beatGain);
    beatGain.connect(offlineCtx.destination);

    vocalSource.connect(highpass);
    highpass.connect(presence);
    presence.connect(compressor);
    compressor.connect(vocalGain);
    vocalGain.connect(offlineCtx.destination);

    const latencySec = parseFloat(dom.vocalOffsetMs.value) / 1000;
    const beatStartPos = state.activeRecording.beatStartOffset || 0;

    if (latencySec < 0) {
      beatSource.start(0, beatStartPos, state.mixDuration);
      vocalSource.start(0, Math.max(0, -latencySec), state.mixDuration);
    } else {
      beatSource.start(0, beatStartPos, state.mixDuration);
      vocalSource.start(latencySec, 0, state.mixDuration);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = audioBufferToWav(renderedBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.activeRecording.title.replace(/[^\w\s-]/g, '')}_Mezclado.wav`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Hubo un error exportando el archivo WAV.');
  } finally {
    dom.btnExportWav.textContent = originalText;
    dom.btnExportWav.disabled = false;
  }
});

function audioBufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels = [];
  let sample = 0;
  let offset = 0;
  let pos = 0;

  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);
  setUint16(1); // PCM
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([out], { type: 'audio/wav' });
}

// ============================================================================
// 6. VISUALIZADOR DE ONDAS Y MEDIDORES VU
// ============================================================================
function startVisualizerLoop() {
  const canvas = dom.audioCanvas;
  const ctx = canvas.getContext('2d');
  const beatData = new Uint8Array(128);
  const micData = new Uint8Array(128);

  function draw() {
    requestAnimationFrame(draw);

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Fondo sutil con rejilla
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let y = 40; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    let beatAvg = 0;
    if (state.beatAnalyser) {
      state.beatAnalyser.getByteFrequencyData(beatData);
      for (let i = 0; i < beatData.length; i++) beatAvg += beatData[i];
      beatAvg /= beatData.length;
    }

    let micAvg = 0;
    if (state.micAnalyser) {
      state.micAnalyser.getByteFrequencyData(micData);
      for (let i = 0; i < micData.length; i++) micAvg += micData[i];
      micAvg /= micData.length;
    }

    // Actualizar medidores VU
    dom.vuBeat.style.width = `${Math.min(100, (beatAvg / 140) * 100)}%`;
    dom.vuMic.style.width = `${Math.min(100, (micAvg / 110) * 100)}%`;

    // Dibujar barras de espectro de la Pista (Cian)
    const barCount = 64;
    const barWidth = (w / barCount) - 3;
    for (let i = 0; i < barCount; i++) {
      const val = state.beatAnalyser ? beatData[i] : 4;
      const barHeight = Math.max(4, (val / 255) * (h * 0.8));
      const x = i * (barWidth + 3);
      const y = h - barHeight;

      ctx.fillStyle = 'rgba(0, 229, 255, 0.45)';
      ctx.fillRect(x, y, barWidth, barHeight);

      // Superponer la energía de la Voz del Rapero (Morado/Fucsia)
      if (state.micAnalyser) {
        const mVal = micData[i];
        const mHeight = (mVal / 255) * (h * 0.85);
        if (mHeight > 3) {
          ctx.fillStyle = 'rgba(255, 42, 85, 0.75)';
          ctx.fillRect(x + 1, h - mHeight, barWidth - 2, mHeight);
        }
      }
    }
  }
  draw();
}

// ============================================================================
// 7. ENTRENADOR FMS (PALABRAS CADA 10s / 5s)
// ============================================================================
function nextStimulusWord() {
  const randomWord = FMS_WORDS[Math.floor(Math.random() * FMS_WORDS.length)];
  dom.stimulusWord.textContent = randomWord;
  state.stimulusProgress = 0;
}

dom.btnToggleStimulus.addEventListener('click', () => {
  const mode = dom.stimulusMode.value;
  if (mode === 'manual') {
    nextStimulusWord();
    return;
  }

  state.stimulusActive = !state.stimulusActive;
  if (state.stimulusActive) {
    dom.btnToggleStimulus.textContent = 'Detener';
    nextStimulusWord();
    const intervalSec = parseInt(mode, 10) || 10;
    clearInterval(state.stimulusTimer);
    state.stimulusTimer = setInterval(() => {
      state.stimulusProgress += 0.1;
      const pct = Math.min(100, (state.stimulusProgress / intervalSec) * 100);
      dom.stimulusBar.style.width = `${pct}%`;
      if (state.stimulusProgress >= intervalSec) {
        nextStimulusWord();
      }
    }, 100);
  } else {
    dom.btnToggleStimulus.textContent = 'Activar';
    clearInterval(state.stimulusTimer);
    dom.stimulusBar.style.width = '0%';
    dom.stimulusWord.textContent = 'LISTO PARA RIMAR';
  }
});

// ============================================================================
// 8. INSTALACIÓN COMO APP MÓVIL (PWA) Y SERVICE WORKER
// ============================================================================
let deferredInstallPrompt = null;
const btnInstallPwa = document.getElementById('btnInstallPwa');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (btnInstallPwa) btnInstallPwa.hidden = false;
});

if (btnInstallPwa) {
  btnInstallPwa.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      btnInstallPwa.hidden = true;
    }
    deferredInstallPrompt = null;
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=3').then((reg) => {
      reg.update();
    }).catch(() => {});
  });
}

// Inicialización al cargar la página
window.addEventListener('DOMContentLoaded', () => {
  loadBeats();
  loadRecordings();
  startVisualizerLoop();
});

