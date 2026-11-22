/* ============================================================
   LUMAKÊ — LÓGICA DA INTERFACE

   F1  → abre/fecha as configurações
   ESC → mostra a pontuação no final da sessão
   F11 → alterna o ecrã inteiro

   Ao digitar o código da música, o quadro abaixo da barra mostra
   o nome do artista e o nome da música.
   ============================================================ */

(() => {
    'use strict';

    const api = window.api || null;
    const $ = (id) => document.getElementById(id);

    /* ------------------------------------------------------------
       CATÁLOGO DE TESTE
       ------------------------------------------------------------
       Enquanto o aplicativo não estiver a correr dentro da pasta do
       karaokê, este é o único código que responde. Assim que a pasta
       for reconhecida, o Bloco de Notas é lido automaticamente e
       todos os códigos passam a funcionar.
       ------------------------------------------------------------ */

    const DEMO_CATALOG = [
        { code: '21223', artist: 'Ana Castela', title: 'Nosso quadro' }
    ];

    function findDemo(code) {
        const key = String(code || '').trim();
        if (!key) return null;
        return DEMO_CATALOG.find((item) => item.code === key) || null;
    }

    /* ---------------------------- Elementos ---------------------------- */

    const screen = document.querySelector('.screen');

    const form = $('song-form');
    const input = $('song-input');
    const resultBox = $('song-result');
    const songArtist = $('song-artist');
    const songTitle = $('song-title');
    const toast = $('toast');

    const settingsModal = $('settings-modal');
    const scorePanel = $('score-panel');

    const setMode = $('set-mode');
    const modeNote = $('mode-note');
    const creditsBox = $('credits-box');
    const creditsValue = $('credits-value');
    const creditsMaxEl = $('credits-max');
    const creditsCost = $('credits-cost');
    const creditsPeriod = $('credits-period');
    const creditsRenew = $('credits-renew');

    const setAutostart = $('set-autostart');
    const setShowScore = $('set-show-score');
    const setFullscreen = $('set-fullscreen');

    const bgPhoto = $('bg-photo');
    const bgPreview = $('bg-preview');
    const bgChoose = $('bg-choose');
    const bgRemove = $('bg-remove');
    const bgState = $('bg-state');

    const widthRange = $('set-width-range');
    const widthNumber = $('set-width');
    const widthLabel = $('set-width-value');

    const heightRange = $('set-height-range');
    const heightNumber = $('set-height');
    const heightLabel = $('set-height-value');

    const scoreValue = $('score-value');
    const scoreSongs = $('score-songs');
    const scoreCredits = $('score-credits');

    /* ---------------------------- Constantes ---------------------------- */

    const MIN_WIDTH = 900;
    const MIN_HEIGHT = 600;
    const MAX_SIZE = 2080;

    const DEFAULT_WIDTH = 1280;
    const DEFAULT_HEIGHT = 800;

    const POINTS_PER_SONG = 10;

    /* ---------------------------- Estado ---------------------------- */

    const state = {
        points: 0,
        songs: 0,
        credits: null,
        mode: 'free',
        showScore: true
    };

    let toastTimer = null;
    let sizeTimer = null;
    let previewTimer = null;

    /* ---------------------------- Utilitários ---------------------------- */

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function showToast(message, kind) {
        if (!toast) return;

        toast.textContent = message;
        toast.classList.toggle('error', kind === 'error');
        toast.classList.add('show');

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 2400);
    }

    function openPanel(panel) {
        if (panel) panel.classList.remove('hidden');
    }

    function closePanel(panel) {
        if (panel) panel.classList.add('hidden');
    }

    function isOpen(panel) {
        return !!panel && !panel.classList.contains('hidden');
    }

    function closeSettings() {
        closePanel(settingsModal);
        if (input) input.focus();
    }

    function formatRenew(timestamp) {
        const value = parseInt(timestamp, 10);
        if (!value) return '—';

        const date = new Date(value);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');

        return `${day}/${month} às ${hour}:${minute}`;
    }

    /* ---------------------------- Quadro do resultado ---------------------------- */

    function showResult(artist, title) {
        if (!resultBox) return;

        if (songArtist) {
            songArtist.textContent = artist ? artist : 'Artista não informado';
        }

        if (songTitle) {
            songTitle.textContent = title ? title : '—';
        }

        resultBox.classList.remove('hidden');

        // reinicia a animação de entrada
        resultBox.style.animation = 'none';
        void resultBox.offsetWidth;
        resultBox.style.animation = '';
    }

    function hideResult() {
        if (resultBox) resultBox.classList.add('hidden');
    }

    // Pré-visualização instantânea (catálogo local) ao digitar
    function queuePreview() {
        clearTimeout(previewTimer);

        previewTimer = setTimeout(() => {
            const demo = findDemo(input ? input.value : '');

            if (demo) {
                showResult(demo.artist, demo.title);
            } else {
                hideResult();
            }
        }, 120);
    }

    /* ---------------------------- Resolver código ---------------------------- */

    async function resolveCode(value) {
        const text = String(value || '').trim();
        if (!text) return null;

        // 1º — catálogo de teste (funciona sem pasta configurada)
        const demo = findDemo(text);
        if (demo) {
            return { artist: demo.artist, title: demo.title, source: 'demo' };
        }

        // 2º — biblioteca / Bloco de Notas da pasta do karaokê
        if (api && typeof api.resolveSong === 'function') {
            try {
                const response = await api.resolveSong(text);

                if (response && response.found && response.entry) {
                    return {
                        artist: response.entry.artist || '',
                        title: response.entry.title || '',
                        source: 'library',
                        entry: response.entry
                    };
                }
            } catch (error) {
                console.error('Falha ao procurar a música:', error);
            }
        }

        return null;
    }

    /* ---------------------------- Créditos ---------------------------- */

    async function refreshCredits() {
        if (!api || typeof api.getCreditsInfo !== 'function') return;

        try {
            const info = await api.getCreditsInfo();
            if (!info) return;

            state.mode = info.mode === 'credits' ? 'credits' : 'free';
            state.credits = typeof info.credits === 'number' ? info.credits : null;

            if (setMode) setMode.value = state.mode;

            if (creditsBox) {
                creditsBox.classList.toggle('hidden', state.mode !== 'credits');
            }

            if (modeNote) {
                modeNote.textContent = state.mode === 'credits'
                    ? 'No modo crédito cada música consome créditos. O saldo renova automaticamente.'
                    : 'No modo livre todas as músicas são liberadas, sem gastar créditos.';
            }

            if (creditsValue) creditsValue.textContent = String(info.credits ?? 0);
            if (creditsMaxEl) creditsMaxEl.textContent = String(info.max ?? 10);
            if (creditsCost) creditsCost.textContent = String(info.cost ?? 2);
            if (creditsPeriod) creditsPeriod.textContent = String(info.periodHours ?? 24);

            if (creditsRenew) {
                creditsRenew.textContent = state.mode === 'credits'
                    ? 'Próxima renovação: ' + formatRenew(info.renewAt)
                    : 'Sem limite de créditos no modo livre';
            }
        } catch (error) {
            console.error('Falha ao obter os créditos:', error);
        }
    }

    /* ---------------------------- Plano de fundo ---------------------------- */

    function applyBackground(url) {
        if (!screen) return;

        if (url) {
            screen.classList.add('has-photo');

            if (bgPhoto) bgPhoto.style.backgroundImage = `url("${url}")`;

            if (bgPreview) {
                bgPreview.style.backgroundImage = `url("${url}")`;
                bgPreview.classList.add('has-image');
            }

            if (bgRemove) bgRemove.disabled = false;
            if (bgState) bgState.textContent = 'Foto personalizada';
        } else {
            screen.classList.remove('has-photo');

            if (bgPhoto) bgPhoto.style.backgroundImage = '';

            if (bgPreview) {
                bgPreview.style.backgroundImage = '';
                bgPreview.classList.remove('has-image');
            }

            if (bgRemove) bgRemove.disabled = true;
            if (bgState) bgState.textContent = 'Fundo animado LUMAKÊ';
        }
    }

    /* ---------------------------- Janela ---------------------------- */

    function readSizeInputs() {
        return {
            width: clamp(parseInt(widthNumber.value, 10) || DEFAULT_WIDTH, MIN_WIDTH, MAX_SIZE),
            height: clamp(parseInt(heightNumber.value, 10) || DEFAULT_HEIGHT, MIN_HEIGHT, MAX_SIZE)
        };
    }

    function paintSize(width, height) {
        if (widthRange) widthRange.value = String(width);
        if (widthNumber) widthNumber.value = String(width);
        if (widthLabel) widthLabel.textContent = String(width);

        if (heightRange) heightRange.value = String(height);
        if (heightNumber) heightNumber.value = String(height);
        if (heightLabel) heightLabel.textContent = String(height);
    }

    async function applyWindowSize() {
        const size = readSizeInputs();
        paintSize(size.width, size.height);

        if (!api || typeof api.setWindowSize !== 'function') return;

        try {
            const settings = await api.setWindowSize(size);

            if (settings) {
                if (setFullscreen) setFullscreen.checked = !!settings.fullscreen;
                if (typeof settings.credits === 'number') state.credits = settings.credits;
            }
        } catch (error) {
            console.error('Falha ao redimensionar a janela:', error);
        }
    }

    function queueWindowSize() {
        clearTimeout(sizeTimer);
        sizeTimer = setTimeout(applyWindowSize, 350);
    }

    /* ---------------------------- Configurações ---------------------------- */

    async function persist(partial) {
        if (!api || typeof api.updateSettings !== 'function') return null;

        try {
            const settings = await api.updateSettings(partial);

            if (settings) {
                state.showScore = settings.showScore !== false;
                if (typeof settings.credits === 'number') state.credits = settings.credits;
            }

            return settings;
        } catch (error) {
            console.error('Falha ao guardar as configurações:', error);
            return null;
        }
    }

    async function loadSettings() {
        if (!api || typeof api.getSettings !== 'function') return;

        try {
            const settings = await api.getSettings();
            if (!settings) return;

            state.showScore = settings.showScore !== false;
            state.credits = typeof settings.credits === 'number' ? settings.credits : null;

            if (setAutostart) setAutostart.checked = !!settings.autoStart;
            if (setShowScore) setShowScore.checked = state.showScore;
            if (setFullscreen) setFullscreen.checked = !!settings.fullscreen;

            paintSize(
                clamp(parseInt(settings.windowWidth, 10) || DEFAULT_WIDTH, MIN_WIDTH, MAX_SIZE),
                clamp(parseInt(settings.windowHeight, 10) || DEFAULT_HEIGHT, MIN_HEIGHT, MAX_SIZE)
            );

            applyBackground(settings.backgroundUrl || null);
            await refreshCredits();
        } catch (error) {
            console.error('Falha ao carregar as configurações:', error);
        }
    }

    /* ---------------------------- Músicas ---------------------------- */

    async function registerSong(rawValue) {
        const value = String(rawValue || '').trim();

        if (!value) {
            showToast('Digite o número da música', 'error');
            return;
        }

        const resolved = await resolveCode(value);

        if (!resolved) {
            hideResult();
            showToast('Código não encontrado', 'error');
            return;
        }

        // Modo crédito: só libera a música se houver saldo
        if (api && typeof api.consumeCredit === 'function') {
            try {
                const response = await api.consumeCredit();

                if (response && response.ok === false) {
                    hideResult();
                    showToast(`Sem créditos — cada música consome ${response.cost || 2}`, 'error');
                    await refreshCredits();
                    return;
                }

                if (response && typeof response.credits === 'number') {
                    state.credits = response.credits;
                }

                await refreshCredits();
            } catch (error) {
                console.error('Falha ao contabilizar o crédito:', error);
            }
        }

        state.songs += 1;
        state.points += POINTS_PER_SONG;

        showResult(resolved.artist, resolved.title);

        if (input) {
            input.value = '';
            input.focus();
        }

        showToast(`Registada: ${resolved.title}`);
    }

    function openScorePanel() {
        if (!state.showScore) {
            showToast('Pontuação desactivada nas configurações (F1)', 'error');
            return;
        }

        if (scoreValue) scoreValue.textContent = String(state.points);
        if (scoreSongs) scoreSongs.textContent = String(state.songs);
        if (scoreCredits) {
            scoreCredits.textContent = state.credits === null ? '—' : String(state.credits);
        }

        openPanel(scorePanel);
    }

    /* ---------------------------- Teclado ---------------------------- */

    function toggleSettings() {
        if (isOpen(settingsModal)) {
            closeSettings();
            return;
        }

        closePanel(scorePanel);
        refreshCredits();
        openPanel(settingsModal);
    }

    function handleKeydown(event) {
        if (event.key === 'F1') {
            event.preventDefault();
            toggleSettings();
            return;
        }

        if (event.key === 'F11') {
            event.preventDefault();
            if (api && typeof api.toggleFullscreen === 'function') {
                api.toggleFullscreen();
            }
            return;
        }

        if (event.key === 'Escape') {
            if (isOpen(settingsModal)) {
                closeSettings();
                return;
            }

            if (isOpen(scorePanel)) {
                closePanel(scorePanel);
                return;
            }

            openScorePanel();
        }
    }

    /* ---------------------------- Eventos ---------------------------- */

    function bindEvents() {
        if (form) {
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                registerSong(input.value);
            });
        }

        if (input) {
            input.addEventListener('input', queuePreview);
        }

        document.addEventListener('keydown', handleKeydown);

        /* Botões das configurações — clique do mouse e toque */

        const settingsOpen = $('settings-open');
        const hintSettings = $('hint-settings');

        [settingsOpen, hintSettings].forEach((trigger) => {
            if (!trigger) return;

            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                toggleSettings();
            });
        });

        /* Painel de configurações */

        const settingsClose = $('settings-close');
        const settingsDone = $('settings-done');

        if (settingsClose) {
            settingsClose.addEventListener('click', () => closeSettings());
        }

        if (settingsDone) {
            settingsDone.addEventListener('click', () => closeSettings());
        }

        if (settingsModal) {
            settingsModal.addEventListener('click', (event) => {
                if (event.target === settingsModal) closeSettings();
            });
        }

        /* Modo livre / crédito */

        if (setMode) {
            setMode.addEventListener('change', async () => {
                const mode = setMode.value === 'credits' ? 'credits' : 'free';
                await persist({ mode });
                await refreshCredits();

                showToast(
                    mode === 'credits'
                        ? 'Modo crédito activado'
                        : 'Modo livre activado'
                );
            });
        }

        /* Sistema */

        if (setAutostart) {
            setAutostart.addEventListener('change', () => {
                persist({ autoStart: setAutostart.checked });

                showToast(
                    setAutostart.checked
                        ? 'Inicia com o Windows'
                        : 'Já não inicia com o Windows'
                );
            });
        }

        if (setShowScore) {
            setShowScore.addEventListener('change', () => {
                state.showScore = setShowScore.checked;
                persist({ showScore: setShowScore.checked });

                showToast(
                    setShowScore.checked
                        ? 'Pontuação final activada'
                        : 'Pontuação final desactivada'
                );
            });
        }

        if (setFullscreen) {
            setFullscreen.addEventListener('change', () => {
                persist({ fullscreen: setFullscreen.checked });
            });
        }

        /* Plano de fundo — galeria do Windows */

        if (bgChoose) {
            bgChoose.addEventListener('click', async () => {
                if (!api || typeof api.chooseBackground !== 'function') {
                    showToast('Galeria indisponível', 'error');
                    return;
                }

                try {
                    const response = await api.chooseBackground();

                    if (response && response.backgroundUrl) {
                        applyBackground(response.backgroundUrl);
                        showToast('Foto de fundo aplicada');
                    }
                } catch (error) {
                    console.error('Falha ao escolher a foto:', error);
                    showToast('Não foi possível abrir a galeria', 'error');
                }
            });
        }

        if (bgRemove) {
            bgRemove.addEventListener('click', async () => {
                if (!api || typeof api.removeBackground !== 'function') return;

                try {
                    await api.removeBackground();
                    applyBackground(null);
                    showToast('Fundo animado restaurado');
                } catch (error) {
                    console.error('Falha ao remover a foto:', error);
                }
            });
        }

        /* Escala de dimensões */

        if (widthRange) {
            widthRange.addEventListener('input', () => {
                const height = readSizeInputs().height;
                paintSize(clamp(parseInt(widthRange.value, 10), MIN_WIDTH, MAX_SIZE), height);
                queueWindowSize();
            });
        }

        if (heightRange) {
            heightRange.addEventListener('input', () => {
                const width = readSizeInputs().width;
                paintSize(width, clamp(parseInt(heightRange.value, 10), MIN_HEIGHT, MAX_SIZE));
                queueWindowSize();
            });
        }

        if (widthNumber) {
            widthNumber.addEventListener('change', queueWindowSize);
            widthNumber.addEventListener('blur', queueWindowSize);
        }

        if (heightNumber) {
            heightNumber.addEventListener('change', queueWindowSize);
            heightNumber.addEventListener('blur', queueWindowSize);
        }

        /* Painel de pontuação */

        const scoreContinue = $('score-continue');
        const scoreExit = $('score-exit');

        if (scoreContinue) {
            scoreContinue.addEventListener('click', () => {
                closePanel(scorePanel);
                if (input) input.focus();
            });
        }

        if (scoreExit) {
            scoreExit.addEventListener('click', () => {
                if (api && typeof api.closeWindow === 'function') {
                    api.closeWindow();
                }
            });
        }

        if (scorePanel) {
            scorePanel.addEventListener('click', (event) => {
                if (event.target === scorePanel) closePanel(scorePanel);
            });
        }

        /* Sincronização do ecrã inteiro */

        if (api && typeof api.onFullscreenChanged === 'function') {
            api.onFullscreenChanged((value) => {
                if (setFullscreen) setFullscreen.checked = !!value;
            });
        }
    }

    /* ---------------------------- Arranque ---------------------------- */

    function init() {
        bindEvents();
        loadSettings();

        if (input) input.focus();
    }

    init();
})();
