/**
 * MODULE MULTIMÉDIA V2 : AUDIO, STICKERS PERSONNALISÉS, GIF & CRÉATEUR DE GIF
 */

const MediaModule = {
    currentUserId: null,
    mediaRecorder: null,
    audioChunks: [],
    pendingAudioBlob: null,
    audioTimerInterval: null,
    audioSeconds: 0,
    userStickers: [],
    createdGifBlob: null,
    gifFrames: [],

    // GIF de démarrage disponibles immédiatement sans clé API externe
    starterGifs: [
        {
            id: 'gif-1',
            title: 'Bravo / Applaudissements',
            url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif'
        },
        {
            id: 'gif-2',
            title: 'Super / Validé',
            url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif'
        },
        {
            id: 'gif-3',
            title: 'Rire / Drôle',
            url: 'https://media.giphy.com/media/ZqlvCTNHpqrio/giphy.gif'
        },
        {
            id: 'gif-4',
            title: 'Salut / Bonjour',
            url: 'https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif'
        }
    ],

    async init(userId) {
        this.currentUserId = userId;
        this.bindAudioEvents();
        this.bindStickerStudioEvents();
        this.bindGifEvents();
        await this.loadUserStickers();
    },

    // =========================================================================
    // 1. MESSAGES AUDIO (ENREGISTREMENT & LECTURE)
    // =========================================================================
    bindAudioEvents() {
        const recordBtn = document.getElementById('btn-record-audio');
        const stopBtn = document.getElementById('btn-stop-audio');
        const cancelBtn = document.getElementById('btn-cancel-audio');
        const sendAudioBtn = document.getElementById('btn-send-audio');

        if (!recordBtn) return;

        recordBtn.addEventListener('click', () => this.startRecording());
        stopBtn.addEventListener('click', () => this.stopRecording());
        cancelBtn.addEventListener('click', () => this.resetAudioRecorder());
        sendAudioBtn.addEventListener('click', () => this.sendRecordedAudio());
    },

    async startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("L'enregistrement vocal n'est pas supporté par ce navigateur.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.mediaRecorder = new MediaRecorder(stream, { mimeType });
            this.audioChunks = [];
            this.audioSeconds = 0;

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
                clearInterval(this.audioTimerInterval);
                this.pendingAudioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

                const previewAudio = document.getElementById('audio-preview-player');
                previewAudio.src = URL.createObjectURL(this.pendingAudioBlob);
                previewAudio.classList.remove('hidden');

                document.getElementById('btn-stop-audio').classList.add('hidden');
                document.getElementById('btn-send-audio').classList.remove('hidden');
            };

            this.mediaRecorder.start();

            document.getElementById('audio-recorder-bar').classList.remove('hidden');
            document.getElementById('audio-preview-player').classList.add('hidden');
            document.getElementById('btn-stop-audio').classList.remove('hidden');
            document.getElementById('btn-send-audio').classList.add('hidden');
            document.getElementById('audio-timer').textContent = '00:00';

            this.audioTimerInterval = setInterval(() => {
                this.audioSeconds += 1;
                const mins = String(Math.floor(this.audioSeconds / 60)).padStart(2, '0');
                const secs = String(this.audioSeconds % 60).padStart(2, '0');
                document.getElementById('audio-timer').textContent = `${mins}:${secs}`;

                // Limite de sécurité à 2 minutes
                if (this.audioSeconds >= 120) {
                    this.stopRecording();
                }
            }, 1000);
        } catch (err) {
            console.error('Accès micro refusé :', err);
            alert("Impossible d'accéder au microphone. Vérifiez les permissions du navigateur.");
        }
    },

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    },

    resetAudioRecorder() {
        clearInterval(this.audioTimerInterval);
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.pendingAudioBlob = null;
        this.audioChunks = [];
        this.audioSeconds = 0;
        document.getElementById('audio-recorder-bar').classList.add('hidden');
        document.getElementById('audio-preview-player').src = '';
    },

    async sendRecordedAudio() {
        if (!this.pendingAudioBlob || !MessagesModule.activeConversationId) return;

        const sendBtn = document.getElementById('btn-send-audio');
        sendBtn.disabled = true;

        try {
            const fileName = `${this.currentUserId}/audio_${Date.now()}.webm`;
            const { error: uploadError } = await supabaseClient.storage
                .from('chat-media')
                .upload(fileName, this.pendingAudioBlob, { contentType: 'audio/webm' });

            if (uploadError) throw uploadError;

            const { data: publicData } = supabaseClient.storage
                .from('chat-media')
                .getPublicUrl(fileName);

            await MessagesModule.sendMediaMessage({
                type: 'audio',
                mediaUrl: publicData.publicUrl,
                meta: { duration: this.audioSeconds }
            });

            this.resetAudioRecorder();
        } catch (err) {
            console.error('Erreur envoi audio :', err);
            alert("Impossible d'envoyer le message vocal.");
        } finally {
            sendBtn.disabled = false;
        }
    },

    // =========================================================================
    // 2. STICKERS PERSONNALISÉS & CRÉATEUR DE STICKER
    // =========================================================================
    bindStickerStudioEvents() {
        const openStudioBtn = document.getElementById('btn-open-sticker-creator');
        const fileInput = document.getElementById('sticker-source-input');
        const textInput = document.getElementById('sticker-caption-input');
        const borderToggle = document.getElementById('sticker-white-border');
        const saveBtn = document.getElementById('btn-save-sticker');

        if (!openStudioBtn) return;

        openStudioBtn.addEventListener('click', () => {
            document.getElementById('sticker-picker-popover').classList.add('hidden');
            document.getElementById('modal-sticker-creator').classList.remove('hidden');
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    this._stickerSourceImg = img;
                    this.renderStickerPreview();
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });

        textInput.addEventListener('input', () => this.renderStickerPreview());
        borderToggle.addEventListener('change', () => this.renderStickerPreview());

        saveBtn.addEventListener('click', () => this.saveCustomSticker());
    },

    renderStickerPreview() {
        const canvas = document.getElementById('sticker-canvas');
        if (!canvas || !this._stickerSourceImg) return;

        const ctx = canvas.getContext('2d');
        const size = 300;
        canvas.width = size;
        canvas.height = size;

        ctx.clearRect(0, 0, size, size);

        const withBorder = document.getElementById('sticker-white-border').checked;
        const caption = document.getElementById('sticker-caption-input').value.trim();

        const pad = withBorder ? 22 : 8;
        const boxSize = size - pad * 2;

        // Arrondi de sticker
        ctx.save();
        this._roundRectPath(ctx, pad, pad, boxSize, boxSize, 36);
        ctx.clip();

        // Recadrage centré (cover)
        const img = this._stickerSourceImg;
        const scale = Math.max(boxSize / img.width, boxSize / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = pad + (boxSize - drawW) / 2;
        const dy = pad + (boxSize - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        ctx.restore();

        if (withBorder) {
            ctx.save();
            this._roundRectPath(ctx, pad, pad, boxSize, boxSize, 36);
            ctx.lineWidth = 10;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.restore();
        }

        if (caption) {
            ctx.save();
            ctx.font = 'bold 26px sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 6;
            ctx.strokeStyle = '#0f172a';
            ctx.fillStyle = '#ffffff';
            ctx.strokeText(caption, size / 2, size - pad - 18);
            ctx.fillText(caption, size / 2, size - pad - 18);
            ctx.restore();
        }
    },

    _roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    async saveCustomSticker() {
        const canvas = document.getElementById('sticker-canvas');
        if (!this._stickerSourceImg) {
            alert("Choisissez d'abord une image pour créer votre sticker.");
            return;
        }

        const label = document.getElementById('sticker-caption-input').value.trim() || 'Mon sticker';
        const saveBtn = document.getElementById('btn-save-sticker');
        saveBtn.disabled = true;

        try {
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.92));
            const path = `${this.currentUserId}/sticker_${Date.now()}.png`;

            const { error: upErr } = await supabaseClient.storage
                .from('chat-media')
                .upload(path, blob, { contentType: 'image/png' });

            if (upErr) throw upErr;

            const { data: pub } = supabaseClient.storage
                .from('chat-media')
                .getPublicUrl(path);

            const { data: inserted, error: dbErr } = await supabaseClient
                .from('user_stickers')
                .insert({
                    owner_id: this.currentUserId,
                    label,
                    image_url: pub.publicUrl
                })
                .select()
                .single();

            if (dbErr) throw dbErr;

            this.userStickers.unshift(inserted);
            this.renderStickersGrid();

            // Si une conversation est ouverte, envoyer directement le sticker
            if (MessagesModule.activeConversationId) {
                await MessagesModule.sendMediaMessage({
                    type: 'sticker',
                    mediaUrl: inserted.image_url,
                    meta: { label }
                });
            }

            document.getElementById('modal-sticker-creator').classList.add('hidden');
            document.getElementById('sticker-caption-input').value = '';
            this._stickerSourceImg = null;
        } catch (err) {
            console.error('Erreur création sticker :', err);
            alert("Impossible d'enregistrer le sticker.");
        } finally {
            saveBtn.disabled = false;
        }
    },

    async loadUserStickers() {
        const { data, error } = await supabaseClient
            .from('user_stickers')
            .select('*')
            .eq('owner_id', this.currentUserId)
            .order('created_at', { ascending: false });

        if (!error && data) {
            this.userStickers = data;
            this.renderStickersGrid();
        }
    },

    renderStickersGrid() {
        const grid = document.getElementById('stickers-grid');
        if (!grid) return;

        grid.innerHTML = '';

        if (this.userStickers.length === 0) {
            grid.innerHTML = '<p class="picker-empty">Aucun sticker créé. Cliquez sur « + Créer un sticker » !</p>';
            return;
        }

        this.userStickers.forEach((st) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'media-tile-btn';
            btn.title = st.label || 'Sticker';
            btn.innerHTML = `<img src="${st.image_url}" alt="${UsersModule.escapeHtml(st.label || 'Sticker')}">`;

            btn.addEventListener('click', async () => {
                document.getElementById('sticker-picker-popover').classList.add('hidden');
                await MessagesModule.sendMediaMessage({
                    type: 'sticker',
                    mediaUrl: st.image_url,
                    meta: { label: st.label }
                });
            });

            grid.appendChild(btn);
        });
    },

    // =========================================================================
    // 3. GIF (BIBLIOTHÈQUE + CRÉATION DE SON PROPRE GIF)
    // =========================================================================
    bindGifEvents() {
        const openMakerBtn = document.getElementById('btn-open-gif-creator');
        const framesInput = document.getElementById('gif-frames-input');
        const generateBtn = document.getElementById('btn-generate-gif');
        const sendGifBtn = document.getElementById('btn-send-created-gif');

        this.renderGifList(this.starterGifs);

        if (!openMakerBtn) return;

        openMakerBtn.addEventListener('click', () => {
            document.getElementById('gif-picker-popover').classList.add('hidden');
            document.getElementById('modal-gif-creator').classList.remove('hidden');
        });

        framesInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []).slice(0, 8);
            if (files.length < 2) {
                alert('Sélectionnez au moins 2 images pour animer un GIF.');
                return;
            }
            this.loadGifFrames(files);
        });

        generateBtn.addEventListener('click', () => this.buildAnimatedGif());
        sendGifBtn.addEventListener('click', () => this.sendCreatedGif());
    },

    renderGifList(items) {
        const list = document.getElementById('gifs-grid');
        if (!list) return;
        list.innerHTML = '';

        items.forEach((gif) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'media-tile-btn gif-tile';
            btn.title = gif.title;
            btn.innerHTML = `<img src="${gif.url}" alt="${UsersModule.escapeHtml(gif.title)}">`;

            btn.addEventListener('click', async () => {
                document.getElementById('gif-picker-popover').classList.add('hidden');
                await MessagesModule.sendMediaMessage({
                    type: 'gif',
                    mediaUrl: gif.url,
                    meta: { title: gif.title }
                });
            });

            list.appendChild(btn);
        });
    },

    async loadGifFrames(files) {
        this.gifFrames = [];
        for (const file of files) {
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target.result);
                reader.readAsDataURL(file);
            });
            const img = await new Promise((resolve) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.src = dataUrl;
            });
            this.gifFrames.push(img);
        }

        document.getElementById('gif-frames-count').textContent = `${this.gifFrames.length} images prêtes`;
        document.getElementById('btn-generate-gif').disabled = false;
    },

    buildAnimatedGif() {
        if (this.gifFrames.length < 2) return;

        const delayMs = Number(document.getElementById('gif-speed-select').value || 250);
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Encodeur GIF89a minimaliste (palette web 216 couleurs, boucle infinie)
        const encoder = new TinyGifEncoder(size, size);
        encoder.setDelay(delayMs);

        for (const img of this.gifFrames) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            const imageData = ctx.getImageData(0, 0, size, size).data;
            encoder.addFrame(imageData);
        }

        this.createdGifBlob = encoder.finish();
        const previewImg = document.getElementById('gif-result-preview');
        previewImg.src = URL.createObjectURL(this.createdGifBlob);
        previewImg.classList.remove('hidden');
        document.getElementById('btn-send-created-gif').classList.remove('hidden');
    },

    async sendCreatedGif() {
        if (!this.createdGifBlob || !MessagesModule.activeConversationId) return;

        const sendBtn = document.getElementById('btn-send-created-gif');
        sendBtn.disabled = true;

        try {
            const path = `${this.currentUserId}/custom_gif_${Date.now()}.gif`;
            const { error: upErr } = await supabaseClient.storage
                .from('chat-media')
                .upload(path, this.createdGifBlob, { contentType: 'image/gif' });

            if (upErr) throw upErr;

            const { data: pub } = supabaseClient.storage
                .from('chat-media')
                .getPublicUrl(path);

            await MessagesModule.sendMediaMessage({
                type: 'gif',
                mediaUrl: pub.publicUrl,
                meta: { title: 'GIF créé par moi', custom: true }
            });

            document.getElementById('modal-gif-creator').classList.add('hidden');
            document.getElementById('gif-result-preview').classList.add('hidden');
            sendBtn.classList.add('hidden');
            this.createdGifBlob = null;
            this.gifFrames = [];
        } catch (err) {
            console.error('Erreur envoi GIF :', err);
            alert("Impossible d'envoyer le GIF créé.");
        } finally {
            sendBtn.disabled = false;
        }
    }
};

/**
 * Encodeur GIF animé léger en JavaScript pur (palette 6x6x6 RGB + LZW non compressé)
 */
class TinyGifEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.delayCentisecs = 25;
        this.frames = [];
        this.out = [];
    }

    setDelay(ms) {
        this.delayCentisecs = Math.max(2, Math.round(ms / 10));
    }

    _quantize(rgba) {
        const pixels = new Uint8Array(this.width * this.height);
        for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
            const r = Math.min(5, Math.round((rgba[i] / 255) * 5));
            const g = Math.min(5, Math.round((rgba[i + 1] / 255) * 5));
            const b = Math.min(5, Math.round((rgba[i + 2] / 255) * 5));
            pixels[p] = r * 36 + g * 6 + b;
        }
        return pixels;
    }

    addFrame(rgba) {
        this.frames.push(this._quantize(rgba));
    }

    _writeStr(s) {
        for (let i = 0; i < s.length; i++) this.out.push(s.charCodeAt(i));
    }

    _writeShort(v) {
        this.out.push(v & 0xff, (v >> 8) & 0xff);
    }

    _encodeLzwUncompressed(indices) {
        // Code size 8 -> clear code = 256, end code = 257
        const minCodeSize = 8;
        const clearCode = 256;
        const endCode = 257;
        const bytes = [minCodeSize];

        let bitBuf = 0;
        let bitCount = 0;
        const codeSize = 9;
        let stream = [];

        const emit = (code) => {
            bitBuf |= code << bitCount;
            bitCount += codeSize;
            while (bitCount >= 8) {
                stream.push(bitBuf & 0xff);
                bitBuf >>= 8;
                bitCount -= 8;
            }
        };

        emit(clearCode);
        for (let i = 0; i < indices.length; i++) {
            emit(indices[i]);
            if (stream.length > 3500) {
                emit(clearCode);
            }
        }
        emit(endCode);
        if (bitCount > 0) {
            stream.push(bitBuf & 0xff);
        }

        // Découpage en blocs de 255 octets max
        for (let offset = 0; offset < stream.length; offset += 255) {
            const chunk = stream.slice(offset, offset + 255);
            bytes.push(chunk.length, ...chunk);
        }
        bytes.push(0x00);
        return bytes;
    }

    finish() {
        this.out = [];
        this._writeStr('GIF89a');
        this._writeShort(this.width);
        this._writeShort(this.height);
        // Global color table (256 couleurs -> size code = 7)
        this.out.push(0xf7, 0x00, 0x00);

        for (let idx = 0; idx < 256; idx++) {
            if (idx < 216) {
                const r = Math.floor(idx / 36);
                const g = Math.floor((idx % 36) / 6);
                const b = idx % 6;
                this.out.push(Math.round((r / 5) * 255), Math.round((g / 5) * 255), Math.round((b / 5) * 255));
            } else {
                this.out.push(0, 0, 0);
            }
        }

        // Extension Netscape 2.0 pour boucle infinie
        this.out.push(0x21, 0xff, 0x0b);
        this._writeStr('NETSCAPE2.0');
        this.out.push(0x03, 0x01);
        this._writeShort(0);
        this.out.push(0x00);

        for (const frameIndices of this.frames) {
            // Graphic Control Extension
            this.out.push(0x21, 0xf9, 0x04, 0x04);
            this._writeShort(this.delayCentisecs);
            this.out.push(0x00, 0x00);

            // Image Descriptor
            this.out.push(0x2c);
            this._writeShort(0);
            this._writeShort(0);
            this._writeShort(this.width);
            this._writeShort(this.height);
            this.out.push(0x00);

            const lzwData = this._encodeLzwUncompressed(frameIndices);
            this.out.push(...lzwData);
        }

        this.out.push(0x3b);
        return new Blob([new Uint8Array(this.out)], { type: 'image/gif' });
    }
}