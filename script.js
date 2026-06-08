document.addEventListener('DOMContentLoaded', () => {
    // --- Configuración ---
    // --- Configuración Dinámica ---
    const config = window.APP_CONFIG || {
        emisora: { nombre: 'Radio Espectacular', api_url: '', timezone: 'America/Lima' },
        imagenes: { logo_principal: 'LOGO.png' }
    };

    const RADIO_CONFIG = {
        name: config.emisora.nombre,
        api_url: config.emisora.api_url,
        logo: config.imagenes.logo_principal,
        timezone: config.emisora.timezone,
        metaUrl: `./proxy.php?url=${encodeURIComponent(config.emisora.api_url)}`
    };

    // --- Elementos ---
    const audioPlayer = document.getElementById('audioPlayer');
    const playPauseButton = document.getElementById('playPauseButton');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumePercentage = document.getElementById('volumePercentage');
    const themeToggle = document.getElementById('themeToggle');
    const mainRadioImage = document.getElementById('mainRadioImage');
    const playerStationImage = document.getElementById('playerStationImage');
    const songTitleElement = document.getElementById('songTitle');
    const dateElement = document.getElementById('currentDate');
    const timeElement = document.getElementById('currentTime');

    let isPlaying = false;
    let currentSongTitle = '';
    let lastDetectedSong = '';
    let lastArtworkQuery = '';

    // Variables de control de reproducción y compatibilidad
    let useCors = true;
    let hlsInstance = null;
    let playTimeout = null;
    let isSimulatedVisualizer = false;
    let isAudioConnected = false;
    let bufferLength = 256;
    let dataArray = new Uint8Array(bufferLength);
    let isLoading = false;
    let isSwitchingFallback = false;

    // --- Inicialización ---
    function init() {
        setupAudioEventListeners();
        updateClock();
        setInterval(updateClock, 1000);
        fetchCurrentSong();
        setInterval(fetchCurrentSong, 5000);
        
        // Inicializar icono de tema correctamente (Luna = Opción a modo oscuro)
        const themeIcon = themeToggle.querySelector('i') || themeToggle.querySelector('svg');
        if (themeIcon) {
            themeIcon.setAttribute('data-lucide', 'moon');
        }
        lucide.createIcons();
    }

    function setupAudioEventListeners() {
        audioPlayer.addEventListener('play', () => {
            isPlaying = true;
            if (playTimeout) {
                clearTimeout(playTimeout);
                playTimeout = null;
            }
            setLoadingState(false);
            updateUI();
        });

        audioPlayer.addEventListener('pause', () => {
            isPlaying = false;
            updateUI();
            targetOpacity = 0;
        });

        audioPlayer.addEventListener('error', (e) => {
            console.warn("Error del elemento de audio detectado:", e);
            if (isPlaying || playTimeout) {
                triggerCorsFallback();
            }
        });

        audioPlayer.addEventListener('waiting', () => {
            if (isPlaying) setLoadingState(true);
        });

        audioPlayer.addEventListener('playing', () => {
            if (playTimeout) {
                clearTimeout(playTimeout);
                playTimeout = null;
            }
            setLoadingState(false);
            
            // Conectar el Web Audio API solo cuando comience a reproducirse y sea CORS
            if (useCors && !isAudioConnected) {
                connectWebAudio();
            }
            startVisualizer();
        });
    }

    function connectWebAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.72;

            gainNode = audioContext.createGain();
            gainNode.gain.value = audioPlayer.volume;

            const source = audioContext.createMediaElementSource(audioPlayer);
            source.connect(gainNode);
            gainNode.connect(analyser);
            analyser.connect(audioContext.destination);

            bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            isAudioConnected = true;
            console.log("Web Audio API conectado correctamente.");
        } catch (err) {
            console.warn("No se pudo conectar a Web Audio API (CORS o restricción):", err);
            isSimulatedVisualizer = true;
        }
    }

    // --- Control de Audio ---
    playPauseButton.addEventListener('click', togglePlay);

    function togglePlay() {
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    }

    function startPlayback() {
        if (playTimeout) clearTimeout(playTimeout);
        setLoadingState(true);

        const streamUrl = config.emisora.streaming_url;
        const isHls = streamUrl.toLowerCase().includes('.m3u8') || streamUrl.toLowerCase().includes('/hls/');
        
        // Configurar CORS
        if (useCors) {
            audioPlayer.setAttribute('crossorigin', 'anonymous');
        } else {
            audioPlayer.removeAttribute('crossorigin');
        }

        const timestampedUrl = streamUrl + (streamUrl.includes('?') ? '&' : '?') + 't=' + Date.now();

        if (isHls) {
            if (window.Hls && Hls.isSupported() && useCors) {
                if (hlsInstance) hlsInstance.destroy();
                hlsInstance = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    maxBufferSize: 0,
                    maxBufferLength: 5
                });
                hlsInstance.loadSource(streamUrl);
                hlsInstance.attachMedia(audioPlayer);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    audioPlayer.play().catch(handlePlayError);
                });
                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    console.warn("HLS Error:", data.type, data.details);
                    if (data.fatal) {
                        handlePlayError(new Error("HLS Fatal: " + data.details));
                    }
                });
            } else {
                audioPlayer.src = timestampedUrl;
                audioPlayer.play().catch(handlePlayError);
            }
        } else {
            audioPlayer.src = timestampedUrl;
            audioPlayer.play().catch(handlePlayError);
        }

        // Timeout de carga (4 segundos)
        playTimeout = setTimeout(() => {
            if (audioPlayer.paused || audioPlayer.readyState < 2) {
                console.warn("Carga lenta o bloqueada. Intentando fallback sin CORS...");
                triggerCorsFallback();
            }
        }, 4000);
    }

    function stopPlayback() {
        isPlaying = false;
        setLoadingState(false);
        updateUI();
        targetOpacity = 0;

        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }

        audioPlayer.pause();
        audioPlayer.src = '';
        audioPlayer.load();

        if (playTimeout) {
            clearTimeout(playTimeout);
            playTimeout = null;
        }
    }

    function handlePlayError(err) {
        if (err.name === 'AbortError') {
            console.log("Reproducción abortada (esperado por reinicio de stream).");
            return;
        }
        console.error("Error de reproducción:", err);
        triggerCorsFallback();
    }

    function triggerCorsFallback() {
        if (isSwitchingFallback) return;

        if (playTimeout) {
            clearTimeout(playTimeout);
            playTimeout = null;
        }

        if (!useCors) {
            console.error("El stream no está disponible en ningún modo.");
            setLoadingState(false);
            stopPlayback();
            
            const prevText = songTitleElement.innerHTML;
            songTitleElement.innerHTML = "⚠️ SEÑAL NO DISPONIBLE ACTUALMENTE";
            setTimeout(() => {
                songTitleElement.innerHTML = prevText;
            }, 5000);
            return;
        }

        console.log("CORS ha fallado. Cambiando a modo sin CORS + Visualizador Simulado...");
        isSwitchingFallback = true;
        useCors = false;
        isSimulatedVisualizer = true;
        
        // Reiniciar reproducción sin CORS en la misma instancia de audioPlayer
        audioPlayer.pause();
        audioPlayer.removeAttribute('crossorigin');
        
        const streamUrl = config.emisora.streaming_url;
        const timestampedUrl = streamUrl + (streamUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        audioPlayer.src = timestampedUrl;
        audioPlayer.load();
        
        audioPlayer.play()
            .then(() => {
                isSwitchingFallback = false;
            })
            .catch((err) => {
                isSwitchingFallback = false;
                handlePlayError(err);
            });
    }

    function setLoadingState(loading) {
        isLoading = loading;
        const icon = playPauseButton.querySelector('i') || playPauseButton.querySelector('svg');
        if (icon) {
            if (isLoading) {
                icon.setAttribute('data-lucide', 'loader-2');
                icon.style.animation = 'spin 1.2s linear infinite';
            } else {
                icon.style.animation = '';
                icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
            }
            lucide.createIcons();
        }

        const liveIndicator = document.querySelector('.live-indicator');
        const liveDot = document.querySelector('.live-dot');
        if (liveIndicator) {
            if (isLoading) {
                liveIndicator.childNodes[0].textContent = 'CONECTANDO... ';
                if (liveDot) liveDot.style.display = 'none';
            } else if (isPlaying) {
                liveIndicator.childNodes[0].textContent = 'EN VIVO ';
                if (liveDot) liveDot.style.display = 'inline-block';
            } else {
                liveIndicator.childNodes[0].textContent = 'PAUSADO ';
                if (liveDot) liveDot.style.display = 'none';
            }
        }
    }

    function updateUI() {
        const icon = playPauseButton.querySelector('i') || playPauseButton.querySelector('svg');
        if (icon && !isLoading) {
            icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
            lucide.createIcons();
        }
    }

    volumeSlider.addEventListener('input', (e) => {
        const vol = e.target.value;
        audioPlayer.volume = vol;
        volumePercentage.textContent = `${Math.round(vol * 100)}%`;
        if (gainNode) gainNode.gain.value = vol;
        targetOpacity = vol == 0 ? 0 : Math.max(0.2, vol);
    });

    // --- Visualizador (Onda Suave y Simulación) ---
    let audioContext, analyser, gainNode, canvas, ctx;
    let visualizerStarted = false;
    let visualOpacity = 0;
    let targetOpacity = 0;
    let smoothEnergy = 0;
    let visualMemoryLevel = 20; // Inercia visual persistente
    let simTime = 0;

    function startVisualizer() {
        if (visualizerStarted) {
            if (audioContext && audioContext.state === "suspended") audioContext.resume();
            targetOpacity = 0.6;
            return;
        }
        visualizerStarted = true;
        targetOpacity = 0.6;

        canvas = document.getElementById("audioVisualizer");
        if (!canvas) return;
        ctx = canvas.getContext("2d");
        resizeCanvas();
        window.onresize = resizeCanvas;

        draw();
    }

    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = 600;
    }

    function fillSimulatedData() {
        if (!isPlaying) {
            for (let i = 0; i < bufferLength; i++) {
                dataArray[i] = Math.max(0, dataArray[i] - 6);
            }
            return;
        }

        simTime += 0.045;
        
        // Simular pulso de bajos (rango 120-130 BPM)
        const beat = Math.pow(Math.max(0, Math.sin(simTime * 2.5)), 4);
        
        const bassBase = 120 + Math.sin(simTime * 4) * 30 + beat * 70;
        const midBase = 90 + Math.sin(simTime * 2.5) * 25 + Math.cos(simTime * 5.5) * 15;
        const highBase = 45 + Math.sin(simTime * 7) * 15 + Math.random() * 10;

        for (let i = 0; i < bufferLength; i++) {
            let val = 0;
            const percent = i / bufferLength;
            
            if (percent < 0.18) {
                // Bajos
                const progress = percent / 0.18;
                val = bassBase * (1.0 - progress * 0.25) + Math.random() * 15;
            } else if (percent < 0.55) {
                // Medios
                const progress = (percent - 0.18) / 0.37;
                val = midBase * (1.0 - progress * 0.35) + Math.sin(simTime * 10 + i) * 12 + Math.random() * 12;
            } else {
                // Agudos
                const progress = (percent - 0.55) / 0.45;
                val = highBase * (1.0 - progress * 0.75) + Math.sin(simTime * 18 + i * 1.5) * 8 + Math.random() * 8;
            }
            
            // Responder al volumen
            const currentVolume = audioPlayer ? audioPlayer.volume : 1;
            val = val * Math.min(1, currentVolume * 1.3);

            const targetVal = Math.max(8, Math.min(255, val));
            dataArray[i] = dataArray[i] * 0.75 + targetVal * 0.25; // suavizado de transición
        }
    }

    function draw() {
        requestAnimationFrame(draw);
        if (!ctx) return;

        if (analyser && !isSimulatedVisualizer) {
            analyser.getByteFrequencyData(dataArray);
        } else {
            fillSimulatedData();
        }

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        const barCount = 120; // Number of dynamic bars
        // Frequencies above ~60-70% are mostly high-pitch noise, so we focus on the lower/mid spectrum
        const usefulDataBins = Math.floor(bufferLength * 0.65); 
        const step = Math.max(1, Math.floor(usefulDataBins / barCount));
        
        const gap = (window.innerWidth < 768) ? 1 : 3; // Smaller gaps on mobile
        const barWidth = (width / barCount) - gap;
        let x = 0;

        for (let i = 0; i < barCount; i++) {
            let maxVal = 0;
            // Get highest magnitude within the frequency slice for punchier rhythm response
            for (let j = 0; j < step; j++) {
                const idx = i * step + j;
                if (idx < bufferLength && dataArray[idx] > maxVal) {
                    maxVal = dataArray[idx];
                }
            }
            
            // Normalize and make the response curve punchy (exponential)
            let normalizedVal = maxVal / 255;
            let barHeight = Math.pow(normalizedVal, 1.25) * height * 0.95;

            // Generate vibrant dynamic colors flowing over time and spectrum
            const hue = (i * (360 / barCount) + (Date.now() * 0.08)) % 360;
            
            // Gradient for each bar to give it a premium glow
            const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, `hsla(${hue}, 100%, 50%, 0.8)`);
            gradient.addColorStop(1, `hsla(${hue + 40}, 100%, 65%, 1)`);

            ctx.fillStyle = gradient;

            // Draw rounded-looking bars by adding small minimum height
            ctx.beginPath();
            ctx.roundRect(x, height - barHeight, barWidth, Math.max(barHeight, 8), [4, 4, 0, 0]);
            ctx.fill();

            x += barWidth + gap;
        }
    }

    // --- Metadatos e iTunes ---
    async function fetchCurrentSong() {
        if (!RADIO_CONFIG.api_url) {
            const finalSong = `Escuchando ${RADIO_CONFIG.name} | 24 Horas Online`;
            if (finalSong !== lastDetectedSong) {
                lastDetectedSong = finalSong;
                songTitleElement.innerHTML = finalSong;
            }
            return;
        }
        try {
            const res = await fetch(RADIO_CONFIG.metaUrl);
            const data = await res.json();
            
            let songStr = "";
            if (data.songtitle) songStr = data.songtitle;
            else if (data.title) songStr = data.title;

            // Si no hay canción, usamos un fallback atractivo en lugar de no hacer nada
            const finalSong = songStr || `Escuchando ${RADIO_CONFIG.name} | 24 Horas Online`;
            
            if (finalSong === lastDetectedSong) return;
            lastDetectedSong = finalSong;

            const cleanTitle = finalSong.replace(/^[A-Za-z]+:\s*\d+\s*/, '').trim();
            songTitleElement.innerHTML = cleanTitle; 

            if (cleanTitle.includes(' - ') && songStr) {
                const query = cleanTitle.replace(' - ', ' ');
                if (query !== lastArtworkQuery) {
                    lastArtworkQuery = query;
                    const art = await fetchItunesArt(query);
                    updateArtwork(art);
                }
            } else if (!songStr) {
                updateArtwork(null);
            }
        } catch (e) {
            console.error("Error metadatos:", e);
        }
    }

    async function fetchItunesArt(query) {
        try {
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
            const res = await fetch(`./proxy.php?url=${encodeURIComponent(url)}`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                return data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
            }
        } catch (e) {
            console.error("Error iTunes:", e);
        }
        return null;
    }

    function updateArtwork(url) {
        const finalUrl = url || RADIO_CONFIG.logo;
        
        // Animamos la transición del fondo y la imagen central
        mainRadioImage.style.opacity = '0';
        
        setTimeout(() => {
            mainRadioImage.src = finalUrl;
            mainRadioImage.style.opacity = '1';
            
            // Evitar remover imagen si no hay proxy/artwork cargado
            if (finalUrl === RADIO_CONFIG.logo && document.body.style.backgroundImage.includes('FONDO%202.jpg')) {
                // do nothing to background to keep the FONDO 2.jpg
            } else {
                document.body.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${finalUrl})`;
            }
        }, 200);
    }

    // --- Utilidades ---
    function updateClock() {
        const now = new Date();
        const dateOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        dateElement.textContent = new Intl.DateTimeFormat('es-ES', dateOptions).format(now);
        timeElement.textContent = new Intl.DateTimeFormat('es-ES', timeOptions).format(now);
    }

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        const icon = themeToggle.querySelector('i') || themeToggle.querySelector('svg');
        if (icon) {
            icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
            lucide.createIcons();
        }
    });

    init();
});
