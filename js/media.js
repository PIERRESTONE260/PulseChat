/**
 * MODULE MULTIMÉDIA V2 :
 * - Audio façon Facebook Messenger (Pause/Reprendre, onde animée, Corbeille, Envoi direct)
 * - Émojis, Stickers & GIF avec mise en favoris des stickers/GIF reçus
 * - Aperçu photo / vidéo / document avec message légende avant envoi
 */

const MediaModule = {
    currentUserId: null,
    mediaRecorder: null,
    audioStream: null,
    audioChunks: [],
    audioTimerInterval: null,
    audioSeconds: 0,
    isAudioCancelled: false,

    userStickers: [],
    favoriteStickers: [],
    favoriteGifs: [],
    createdGifBlob: null,
    gifFrames: [],
    pendingPreviewFile: null,

    commonEmojis: [
        '😀','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳',
        '😢','😭','😡','😱','🤔','🤗','🤭','😴','🤒','🙏',
        '👍','👎','👏','🙌','🤝','💪','✌️','🤞','❤️','🔥',
        '👁️','🔎','⚖️','😁','😃','😄','😅','😆','😉','😋',
        '🥰','😗','😙','🥲','😚','☺️','🙂','🤩','🫡','🤨',
        '😐','😑','😶','🫥','😶‍🌫️','🙄','😏','😣','😥','😮',
        '🤐','😯','😪','😫','🥱','😴','🫩','😌','😛','😜',
        '😝','🤤','😒','😓','😔','😕','🫤','🙃','🫠','🤑',
        '😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦',
        ' 😧','😨','😩','🤯','😬','😮‍💨','😰','🥵','🥶','😳',
        '🤪','😵','😵‍💫','🥴','😠','😡','🤬','😷','🤒','🤕',
        '🤢','🤮','🤧','😇','🥳','🥸','🥺','🥹','🤠','🤡',
        '🤥','🫨','🙂‍↔️','🙂‍↕️','🤫','🤭','🫢','🫣','🧐','🤓',
        '😈','👿','👹','👺','💀','☠️','👻','👽','👾','🤖',
        '💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾',
        '🙈','🙉','🙊','🐵','🐶','🐺','🐱','🦁','🐯','🦒',
        '🦊','🐷','🐗','🐭','🐹','🐰','🐻','🐻‍❄️','🐨','🐼',
        '🐸','🦓','🐴','🫎','🫏','🦄','🐔','🐲','🐽','🐾',
        '🐒','🦍','🦧','🦮','🐕‍🦺','🐩','🐕','🐈','🐈‍⬛','🦛',
        '🐆','🐅','🐎','🦌','🦬','🦏','🐂','🐃','🐄','🐖',
        '🐏','🦥','🐑','🐐','🐪','🐫','🦙','🦘','🦥','🦨',
        '🦡','🐘','🦣','🐁','🦔','🐇','🐿️','🦫','🦎','🐊',
        '🐢','🐍','🐉','🦕','🦖','🦈','🐬','🦭','🐳','🐋',
        '🐟','🐠','🐡','🦐','🦑','🐙','🦞','🦀','🐚','🪸',
        '🪼','🐓','🦃','🦅','🕊️','🦢','🦜','🪽','🐦‍⬛','🪿',
        '🐦‍🔥','🦩','🦚','🦉','🦤','🪶','🐦','🐧','🐥','🐤',
        '🐣','🦇','🦋','🐌','🐛','🦗','🐜 ','🪳','🐝','🦂',
        '🕷️','🕸️','🦠','🧞‍♀️','🧞‍♂️','🧞','🧟‍♂️ ','🧌 '
    ],

    starterGifs: [
        { id: 'gif-1', title: 'Bravo', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif' },
        { id: 'gif-2', title: 'Validé', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
        { id: 'gif-3', title: 'Rire', url: 'https://media.giphy.com/media/ZqlvCTNHpqrio/giphy.gif' },
        { id: 'gif-4', title: 'Salut', url: 'https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif' }
    ],

    async init(userId) {
        this.currentUserId = userId;
        this.renderEmojisGrid();
        this.bindMessengerAudioEvents();
        this.bindMediaPreviewEvents();
        this.bindStickerStudioEvents();
        this.bindGifEvents();
        await Promise.all([
            this.loadUserStickers(),
            this.loadUserFavorites()
        ]);
    },

    // =========================================================================
    // 1. PANNEAU ÉMOJIS
    // =========================================================================
    renderEmojisGrid() {
        const grid = document.getElementById('emojis-grid');
        if (!grid) return;
        grid.innerHTML = '';

        this.commonEmojis.forEach((emoji) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-item-btn';
            btn.textContent = emoji;
            btn.addEventListener('click', () => {
                const input = document.getElementById('message-input');
                input.value += emoji;
                input.dispatchEvent(new Event('input'));
                input.focus();
            });
            grid.appendChild(btn);
        });
    },

    // =========================================================================
    // 2. APERÇU PHOTO / VIDÉO / DOCUMENT AVEC LÉGENDE AVANT ENVOI
    // =========================================================================
    bindMediaPreviewEvents() {
        const fileInputs = [
            document.getElementById('chat-gallery-input'),
            document.getElementById('chat-camera-input'),
            document.getElementById('chat-doc-input'),
            document.getElementById('chat-quick-photo-input')
        ];

        fileInputs.forEach((inp) => {
            if (!inp) return;
            inp.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (file) {
                    document.getElementById('attachment-drawer')?.classList.add('hidden');
                    this.openFilePreviewModal(file);
                    inp.value = '';
                }
            });
        });

        document.getElementById('btn-confirm-send-media')?.addEventListener('click', async () => {
            await this.confirmAndSendPreviewFile();
        });

        document.getElementById('media-caption-input')?.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await this.confirmAndSendPreviewFile();
            }
        });
    },

    openFilePreviewModal(file) {
        if (file.size > 20 * 1024 * 1024) {
            alert('Le fichier dépasse la limite de 20 Mo.');
            return;
        }

        this.pendingPreviewFile = file;
        const imgEl = document.getElementById('preview-stage-img');
        const vidEl = document.getElementById('preview-stage-video');
        const docEl = document.getElementById('preview-stage-doc');
        const captionInput = document.getElementById('media-caption-input');

        imgEl.classList.add('hidden');
        vidEl.classList.add('hidden');
        docEl.classList.add('hidden');
        captionInput.value = document.getElementById('message-input').value.trim();

        const objectUrl = URL.createObjectURL(file);

        if (file.type.startsWith('image/')) {
            imgEl.src = objectUrl;
            imgEl.classList.remove('hidden');
        } else if (file.type.startsWith('video/')) {
            vidEl.src = objectUrl;
            vidEl.classList.remove('hidden');
        } else {
            document.getElementById('preview-doc-name').textContent = file.name;
            docEl.classList.remove('hidden');
        }

        document.getElementById('modal-media-preview').classList.remove('hidden');
        captionInput.focus();
    },

    async confirmAndSendPreviewFile() {
        if (!this.pendingPreviewFile || !MessagesModule.activeConversationId) return;

        const file = this.pendingPreviewFile;
        const caption = document.getElementById('media-caption-input').value.trim();
        const confirmBtn = document.getElementById('btn-confirm-send-media');
        confirmBtn.disabled = true;

        try {
            const ext = file.name.split('.').pop().toLowerCase() || 'bin';
            const path = `${this.currentUserId}/media_${Date.now()}.${ext}`;

            const { error: upErr } = await supabaseClient.storage
                .from('chat-media')
                .upload(path, file);

            if (upErr) throw upErr;

            const { data: pub } = supabaseClient.storage
                .from('chat-media')
                .getPublicUrl(path);

            let msgType = 'file';
            if (file.type.startsWith('image/')) msgType = 'image';
            else if (file.type.startsWith('video/')) msgType = 'video';

            await MessagesModule.sendMediaMessage({
                type: msgType,
                mediaUrl: pub.publicUrl,
                caption,
                meta: { name: file.name, size: file.size }
            });

            // Nettoyer le champ principal si le texte a été transféré dans la légende
            const mainInput = document.getElementById('message-input');
            mainInput.value = '';
            mainInput.dispatchEvent(new Event('input'));

            this.pendingPreviewFile = null;
            document.getElementById('modal-media-preview').classList.add('hidden');
        } catch (err) {
            console.error('Erreur envoi fichier :', err);
            alert("Impossible d'envoyer le fichier.");
        } finally {
            confirmBtn.disabled = false;
        }
    },

    // =========================================================================
    // 3. AUDIO FAÇON FACEBOOK MESSENGER (PAUSE/REPRISE + ONDE + ENVOI DIRECT)
    // =========================================================================
    bindMessengerAudioEvents() {
        const recordBtn = document.getElementById('btn-record-audio');
        const cancelBtn = document.getElementById('btn-cancel-audio');
        const pauseResumeBtn = document.getElementById('btn-pause-resume-audio');
        const sendAudioBtn = document.getElementById('btn-send-audio');

        if (!recordBtn) return;

        recordBtn.addEventListener('click', () => this.startMessengerRecording());
        cancelBtn.addEventListener('click', () => this.cancelMessengerRecording());
        pauseResumeBtn.addEventListener('click', () => this.togglePauseMessengerRecording());
        sendAudioBtn.addEventListener('click', () => this.finishAndSendMessengerAudio());
    },

    async startMessengerRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("L'enregistrement vocal n'est pas supporté par ce navigateur.");
            return;
        }

        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });
            this.audioChunks = [];
            this.audioSeconds = 0;
            this.isAudioCancelled = false;

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = async () => {
                this.audioStream?.getTracks().forEach((t) => t.stop());
                clearInterval(this.audioTimerInterval);

                if (this.isAudioCancelled || this.audioChunks.length === 0) {
                    this.resetMessengerAudioUI();
                    return;
                }

                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                await this.uploadAndSendAudioBlob(blob);
                this.resetMessengerAudioUI();
            };

            this.mediaRecorder.start(250);

            // Basculer l'interface sur la barre Messenger
            document.getElementById('chat-footer-bar').classList.add('hidden');
            document.getElementById('messenger-audio-bar').classList.remove('hidden');
            document.getElementById('audio-waveform').classList.add('recording');
            document.getElementById('icon-audio-pause').classList.remove('hidden');
            document.getElementById('icon-audio-play').classList.add('hidden');
            document.getElementById('audio-timer').textContent = '0:00';

            this.startAudioTimer();
        } catch (err) {
            alert("Autorisez l'accès au microphone pour envoyer un message vocal.");
        }
    },

    startAudioTimer() {
        clearInterval(this.audioTimerInterval);
        this.audioTimerInterval = setInterval(() => {
            if (this.mediaRecorder?.state === 'recording') {
                this.audioSeconds += 1;
                const mins = Math.floor(this.audioSeconds / 60);
                const secs = String(this.audioSeconds % 60).padStart(2, '0');
                document.getElementById('audio-timer').textContent = `${mins}:${secs}`;
                if (this.audioSeconds >= 180) {
                    this.finishAndSendMessengerAudio();
                }
            }
        }, 1000);
    },

    togglePauseMessengerRecording() {
        if (!this.mediaRecorder) return;
        const waveEl = document.getElementById('audio-waveform');
        const pauseIcon = document.getElementById('icon-audio-pause');
        const playIcon = document.getElementById('icon-audio-play');

        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            waveEl.classList.remove('recording');
            pauseIcon.classList.add('hidden');
            playIcon.classList.remove('hidden');
        } else if (this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            waveEl.classList.add('recording');
            pauseIcon.classList.remove('hidden');
            playIcon.classList.add('hidden');
        }
    },

    cancelMessengerRecording() {
        this.isAudioCancelled = true;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        } else {
            this.resetMessengerAudioUI();
        }
    },

    finishAndSendMessengerAudio() {
        this.isAudioCancelled = false;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    },

    resetMessengerAudioUI() {
        clearInterval(this.audioTimerInterval);
        document.getElementById('messenger-audio-bar')?.classList.add('hidden');
        document.getElementById('chat-footer-bar')?.classList.remove('hidden');
        document.getElementById('audio-waveform')?.classList.remove('recording');
    },

    async uploadAndSendAudioBlob(blob) {
        if (!MessagesModule.activeConversationId) return;
        const path = `${this.currentUserId}/voice_${Date.now()}.webm`;

        const { error: upErr } = await supabaseClient.storage
            .from('chat-media')
            .upload(path, blob, { contentType: 'audio/webm' });

        if (upErr) {
            alert("Échec de l'envoi du message vocal.");
            return;
        }

        const { data: pub } = supabaseClient.storage
            .from('chat-media')
            .getPublicUrl(path);

        await MessagesModule.sendMediaMessage({
            type: 'audio',
            mediaUrl: pub.publicUrl,
            meta: { duration: this.audioSeconds }
        });
    },

    // =========================================================================
    // 4. FAVORIS STICKERS & GIF (AJOUT DEPUIS LES MESSAGES REÇUS)
    // =========================================================================
    async loadUserFavorites() {
        const { data, error } = await supabaseClient
            .from('user_favorites')
            .select('*')
            .eq('user_id', this.currentUserId)
            .order('created_at', { ascending: false });

        if (!error && data) {
            this.favoriteStickers = data.filter((f) => f.item_type === 'sticker');
            this.favoriteGifs = data.filter((f) => f.item_type === 'gif');
            this.renderStickersGrid();
            this.renderGifList();
        }
    },

    async addToFavorites(itemType, mediaUrl, label = '') {
        const { data, error } = await supabaseClient
            .from('user_favorites')
            .upsert(
                {
                    user_id: this.currentUserId,
                    item_type: itemType,
                    media_url: mediaUrl,
                    label
                },
                { onConflict: 'user_id,item_type,media_url' }
            )
            .select()
            .single();

        if (!error && data) {
            await this.loadUserFavorites();
            return true;
        }
        return false;
    },

    // =========================================================================
    // 5. STICKERS PERSONNALISÉS & CRÉATEUR
    // =========================================================================
    bindStickerStudioEvents() {
        const openStudioBtn = document.getElementById('btn-open-sticker-creator');
        const fileInput = document.getElementById('sticker-source-input');
        const textInput = document.getElementById('sticker-caption-input');
        const borderToggle = document.getElementById('sticker-white-border');
        const saveBtn = document.getElementById('btn-save-sticker');

        if (!openStudioBtn) return;

        openStudioBtn.addEventListener('click', () => {
            document.getElementById('expression-picker').classList.add('hidden');
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

        ctx.save();
        this._roundRectPath(ctx, pad, pad, boxSize, boxSize, 36);
        ctx.clip();

        const img = this._stickerSourceImg;
        const scale = Math.max(boxSize / img.width, boxSize / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        ctx.drawImage(img, pad + (boxSize - drawW) / 2, pad + (boxSize - drawH) / 2, drawW, drawH);
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
                .insert({ owner_id: this.currentUserId, label, image_url: pub.publicUrl })
                .select()
                .single();

            if (dbErr) throw dbErr;

            this.userStickers.unshift(inserted);
            this.renderStickersGrid();

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

        // Fusionner mes stickers créés + les stickers des autres mis en favori (sans doublons d'URL)
        const seenUrls = new Set();
        const combined = [];

        this.userStickers.forEach((st) => {
            if (!seenUrls.has(st.image_url)) {
                seenUrls.add(st.image_url);
                combined.push({ url: st.image_url, label: st.label || 'Mon sticker', isFav: false });
            }
        });

        this.favoriteStickers.forEach((fav) => {
            if (!seenUrls.has(fav.media_url)) {
                seenUrls.add(fav.media_url);
                combined.push({ url: fav.media_url, label: fav.label || 'Favori', isFav: true });
            }
        });

        if (combined.length === 0) {
            grid.innerHTML = '<p class="picker-empty">Aucun sticker. Créez le vôtre ou ajoutez un sticker reçu en favori.</p>';
            return;
        }

        combined.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'media-tile-btn';
            btn.title = item.label;
            btn.innerHTML = `<img src="${item.url}" alt="${UsersModule.escapeHtml(item.label)}">`;

            btn.addEventListener('click', async () => {
                document.getElementById('expression-picker').classList.add('hidden');
                await MessagesModule.sendMediaMessage({
                    type: 'sticker',
                    mediaUrl: item.url,
                    meta: { label: item.label }
                });
            });

            grid.appendChild(btn);
        });
    },

    // =========================================================================
    // 6. GIF (BIBLIOTHÈQUE + FAVORIS + CRÉATEUR)
    // =========================================================================
    bindGifEvents() {
        const openMakerBtn = document.getElementById('btn-open-gif-creator');
        const framesInput = document.getElementById('gif-frames-input');
        const generateBtn = document.getElementById('btn-generate-gif');
        const sendGifBtn = document.getElementById('btn-send-created-gif');

        this.renderGifList();

        if (!openMakerBtn) return;

        openMakerBtn.addEventListener('click', () => {
            document.getElementById('expression-picker').classList.add('hidden');
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

    renderGifList() {
        const list = document.getElementById('gifs-grid');
        if (!list) return;
        list.innerHTML = '';

        const seenUrls = new Set();
        const combined = [];

        // Favoris en premier
        this.favoriteGifs.forEach((fav) => {
            if (!seenUrls.has(fav.media_url)) {
                seenUrls.add(fav.media_url);
                combined.push({ url: fav.media_url, title: fav.label || 'GIF favori' });
            }
        });

        this.starterGifs.forEach((gif) => {
            if (!seenUrls.has(gif.url)) {
                seenUrls.add(gif.url);
                combined.push({ url: gif.url, title: gif.title });
            }
        });

        combined.forEach((gif) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'media-tile-btn gif-tile';
            btn.title = gif.title;
            btn.innerHTML = `<img src="${gif.url}" alt="${UsersModule.escapeHtml(gif.title)}">`;

            btn.addEventListener('click', async () => {
                document.getElementById('expression-picker').classList.add('hidden');
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

        const encoder = new TinyGifEncoder(size, size);
        encoder.setDelay(delayMs);

        for (const img of this.gifFrames) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            encoder.addFrame(ctx.getImageData(0, 0, size, size).data);
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

            await this.addToFavorites('gif', pub.publicUrl, 'Mon GIF');

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
            alert("Impossible d'envoyer le GIF créé.");
        } finally {
            sendBtn.disabled = false;
        }
    }
};

class TinyGifEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.delayCentisecs = 25;
        this.frames = [];
        this.out = [];
    }
    setDelay(ms) { this.delayCentisecs = Math.max(2, Math.round(ms / 10)); }
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
    addFrame(rgba) { this.frames.push(this._quantize(rgba)); }
    _writeStr(s) { for (let i = 0; i < s.length; i++) this.out.push(s.charCodeAt(i)); }
    _writeShort(v) { this.out.push(v & 0xff, (v >> 8) & 0xff); }
    _encodeLzwUncompressed(indices) {
        const bytes = [8];
        let bitBuf = 0, bitCount = 0, stream = [];
        const emit = (code) => {
            bitBuf |= code << bitCount;
            bitCount += 9;
            while (bitCount >= 8) {
                stream.push(bitBuf & 0xff);
                bitBuf >>= 8;
                bitCount -= 8;
            }
        };
        emit(256);
        for (let i = 0; i < indices.length; i++) {
            emit(indices[i]);
            if (stream.length > 3500) emit(256);
        }
        emit(257);
        if (bitCount > 0) stream.push(bitBuf & 0xff);
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
        this.out.push(0xf7, 0x00, 0x00);
        for (let idx = 0; idx < 256; idx++) {
            if (idx < 216) {
                const r = Math.floor(idx / 36), g = Math.floor((idx % 36) / 6), b = idx % 6;
                this.out.push(Math.round((r / 5) * 255), Math.round((g / 5) * 255), Math.round((b / 5) * 255));
            } else this.out.push(0, 0, 0);
        }
        this.out.push(0x21, 0xff, 0x0b);
        this._writeStr('NETSCAPE2.0');
        this.out.push(0x03, 0x01);
        this._writeShort(0);
        this.out.push(0x00);
        for (const frameIndices of this.frames) {
            this.out.push(0x21, 0xf9, 0x04, 0x04);
            this._writeShort(this.delayCentisecs);
            this.out.push(0x00, 0x00, 0x2c);
            this._writeShort(0);
            this._writeShort(0);
            this._writeShort(this.width);
            this._writeShort(this.height);
            this.out.push(0x00, ...this._encodeLzwUncompressed(frameIndices));
        }
        this.out.push(0x3b);
        return new Blob([new Uint8Array(this.out)], { type: 'image/gif' });
    }
}