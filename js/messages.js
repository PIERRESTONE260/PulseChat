/**
 * GESTION DES MESSAGES EN TEMPS RÉEL V2.2
 * (Texte, Audio, Photo, Vidéo, Document, Sticker, GIF, Citation, Édition, Suppression,
 *  Favoris, Brouillons par conversation, Bouton Descendre en bas, Copie rapide,
 *  Réactions rapides par émojis, Recherche dans la conversation, Transfert de message,
 *  Lecteur audio amélioré & "En train d'écrire...")
 */

const MessagesModule = {
    currentUserId: null,
    activeConversationId: null,
    messagesChannel: null,
    messages: [],
    pageSize: 40,
    hasMoreOlder: false,
    isSending: false,
    lastRenderedDate: null,
    replyTargetMessage: null,
    forwardTargetMessage: null,
    typingTimeout: null,
    peerTypingTimeout: null,
    isPeerTyping: false,
    unreadWhileScrolled: 0,
    drafts: JSON.parse(localStorage.getItem('pulsechat_drafts_v22') || '{}'),
    quickReactions: ['👍', '❤️', '😂', '😮', '😢', '🙏'],
    searchMatches: [],
    searchMatchIndex: -1,

    init(userId) {
        this.currentUserId = userId;
        const form = document.getElementById('message-form');
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send-message');
        const micBtn = document.getElementById('btn-record-audio');
        const loadOlderBtn = document.getElementById('btn-load-older');
        const dismissErrBtn = document.getElementById('btn-dismiss-send-error');
        const cancelReplyBtn = document.getElementById('btn-cancel-reply');

        input.addEventListener('input', () => {
            const hasText = input.value.trim().length > 0;

            sendBtn.disabled = !hasText || this.isSending;
            sendBtn.classList.toggle('hidden', !hasText);
            micBtn?.classList.toggle('hidden', hasText);

            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 120)}px`;

            if (this.activeConversationId) {
                this.saveDraft(this.activeConversationId, input.value);
            }

            this.broadcastTyping(hasText);
        });

        input.addEventListener('blur', () => {
            this.broadcastTyping(false);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    form.dispatchEvent(new Event('submit'));
                }
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.broadcastTyping(false);
            await this.sendTextMessage();
        });

        loadOlderBtn.addEventListener('click', async () => {
            await this.loadOlderMessages();
        });

        dismissErrBtn.addEventListener('click', () => {
            document.getElementById('send-error-banner').classList.add('hidden');
        });

        if (cancelReplyBtn) {
            cancelReplyBtn.addEventListener('click', () => this.clearReplyTarget());
        }

        this.initScrollToBottomButton();
        this.initConversationSearch();
        this.initForwardModal();
    },

    // =========================================================================
    // TRANSFERT DE MESSAGE VERS UNE AUTRE CONVERSATION (v2.2)
    // =========================================================================
    initForwardModal() {
        const searchInput = document.getElementById('forward-search-input');
        if (!searchInput) return;

        searchInput.addEventListener('input', () => {
            this.renderForwardTargets(searchInput.value.trim().toLowerCase());
        });
    },

    openForwardModal(msg) {
        this.forwardTargetMessage = msg;
        const modal = document.getElementById('modal-forward-message');
        const previewEl = document.getElementById('forward-message-preview');
        const searchInput = document.getElementById('forward-search-input');

        if (!modal || !previewEl) return;

        const label = msg.type === 'text'
            ? (msg.content || '')
            : msg.type === 'audio'
                ? 'Message vocal'
                : msg.type === 'sticker'
                    ? 'Sticker'
                    : msg.type === 'gif'
                        ? 'GIF'
                        : msg.type === 'video'
                            ? 'Vidéo'
                            : msg.type === 'file'
                                ? (msg.media_meta?.name || 'Document')
                                : 'Photo';

        previewEl.textContent = label;
        if (searchInput) searchInput.value = '';
        this.renderForwardTargets('');
        modal.classList.remove('hidden');
    },

    renderForwardTargets(query = '') {
        const listEl = document.getElementById('forward-conversations-list');
        if (!listEl) return;

        listEl.innerHTML = '';
        const convs = Array.isArray(ConversationsModule?.conversations)
            ? ConversationsModule.conversations
            : [];

        const filtered = convs.filter((c) => {
            if (c.conversation_id === this.activeConversationId) return false;
            const name = (c.peer_full_name || '').toLowerCase();
            const handle = (c.peer_username || '').toLowerCase();
            return !query || name.includes(query) || handle.includes(query);
        });

        if (filtered.length === 0) {
            listEl.innerHTML = '<li class="panel-state"><small>Aucune autre conversation disponible.</small></li>';
            return;
        }

        filtered.forEach((conv) => {
            const li = document.createElement('li');
            li.className = 'forward-target-item';
            li.innerHTML = `
                <div class="forward-target-meta">
                    <strong>${UsersModule.escapeHtml(conv.peer_full_name || 'Contact')}</strong>
                    <span>@${UsersModule.escapeHtml(conv.peer_username || '')}</span>
                </div>
                <button type="button" class="btn-secondary-sm btn-forward-send">Transférer</button>
            `;
            li.querySelector('.btn-forward-send')?.addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = 'Envoi…';
                await this.forwardMessageToConversation(this.forwardTargetMessage, conv.conversation_id);
                document.getElementById('modal-forward-message')?.classList.add('hidden');
                this.forwardTargetMessage = null;
            });
            listEl.appendChild(li);
        });
    },

    async forwardMessageToConversation(msg, targetConversationId) {
        if (!msg || !targetConversationId || !this.currentUserId) return;

        const baseMeta = (msg.media_meta && typeof msg.media_meta === 'object')
            ? { ...msg.media_meta }
            : {};
        delete baseMeta.reactions;
        baseMeta.forwarded = true;

        const { error } = await supabaseClient
            .from('messages')
            .insert({
                conversation_id: targetConversationId,
                sender_id: this.currentUserId,
                content: msg.content || '',
                type: msg.type || 'text',
                media_url: msg.media_url || null,
                media_meta: baseMeta,
                reply_to_id: null
            });

        if (error) {
            console.error('Erreur transfert message :', error);
            alert(`Impossible de transférer ce message (${error.message || 'erreur base de données'}).`);
            return;
        }

        await ConversationsModule.loadConversations();
    },

    // =========================================================================
    // LECTEUR AUDIO AMÉLIORÉ DANS LES BULLES (v2.2)
    // =========================================================================
    _formatAudioTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const mins = Math.floor(total / 60);
        const secs = String(total % 60).padStart(2, '0');
        return `${mins}:${secs}`;
    },

    _buildAudioPlayerHtml(msg) {
        const knownDuration = Number(msg.media_meta?.duration) || 0;
        const durationLabel = knownDuration > 0 ? this._formatAudioTime(knownDuration) : '0:00';

        return `
            <div class="custom-audio-player" data-audio-url="${UsersModule.escapeHtml(msg.media_url || '')}">
                <audio preload="metadata" src="${UsersModule.escapeHtml(msg.media_url || '')}" class="hidden"></audio>
                <button type="button" class="audio-play-toggle" title="Lire / Mettre en pause">
                    <svg class="icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <svg class="icon-pause hidden" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                </button>
                <div class="audio-progress-wrap">
                    <input type="range" class="audio-seek-slider" min="0" max="100" value="0" step="0.5" aria-label="Progression audio">
                    <div class="audio-time-row">
                        <span class="audio-current-time">0:00</span>
                        <span class="audio-total-time">${durationLabel}</span>
                    </div>
                </div>
            </div>
        `;
    },

    _bindAudioPlayers(row) {
        const player = row.querySelector('.custom-audio-player');
        if (!player) return;

        const audio = player.querySelector('audio');
        const toggleBtn = player.querySelector('.audio-play-toggle');
        const playIcon = player.querySelector('.icon-play');
        const pauseIcon = player.querySelector('.icon-pause');
        const slider = player.querySelector('.audio-seek-slider');
        const currentEl = player.querySelector('.audio-current-time');
        const totalEl = player.querySelector('.audio-total-time');

        if (!audio || !toggleBtn || !slider) return;

        const syncPlayState = (playing) => {
            playIcon?.classList.toggle('hidden', playing);
            pauseIcon?.classList.toggle('hidden', !playing);
        };

        audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                totalEl.textContent = this._formatAudioTime(audio.duration);
            }
        });

        audio.addEventListener('timeupdate', () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const pct = (audio.currentTime / audio.duration) * 100;
            slider.value = String(pct);
            currentEl.textContent = this._formatAudioTime(audio.currentTime);
        });

        audio.addEventListener('play', () => {
            document.querySelectorAll('.custom-audio-player audio').forEach((other) => {
                if (other !== audio && !other.paused) {
                    other.pause();
                }
            });
            syncPlayState(true);
        });

        audio.addEventListener('pause', () => syncPlayState(false));

        audio.addEventListener('ended', () => {
            syncPlayState(false);
            slider.value = '0';
            currentEl.textContent = '0:00';
        });

        toggleBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play().catch(() => {});
            } else {
                audio.pause();
            }
        });

        slider.addEventListener('input', () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const targetTime = (Number(slider.value) / 100) * audio.duration;
            audio.currentTime = targetTime;
            currentEl.textContent = this._formatAudioTime(targetTime);
        });
    },

    // =========================================================================
    // RECHERCHE DANS LA CONVERSATION ACTIVE (v2.2)
    // =========================================================================
    initConversationSearch() {
        const toggleBtn = document.getElementById('btn-toggle-chat-search');
        const searchBar = document.getElementById('chat-search-bar');
        const searchInput = document.getElementById('chat-search-input');
        const prevBtn = document.getElementById('btn-chat-search-prev');
        const nextBtn = document.getElementById('btn-chat-search-next');
        const closeBtn = document.getElementById('btn-close-chat-search');

        if (!toggleBtn || !searchBar || !searchInput) return;

        toggleBtn.addEventListener('click', () => {
            searchBar.classList.toggle('hidden');
            if (!searchBar.classList.contains('hidden')) {
                searchInput.focus();
                this.searchInConversation(searchInput.value);
            } else {
                this.clearConversationSearch();
            }
        });

        searchInput.addEventListener('input', () => {
            this.searchInConversation(searchInput.value);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.focusSearchMatch(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                this.clearConversationSearch();
                searchBar.classList.add('hidden');
            }
        });

        prevBtn?.addEventListener('click', () => this.focusSearchMatch(-1));
        nextBtn?.addEventListener('click', () => this.focusSearchMatch(1));

        closeBtn?.addEventListener('click', () => {
            this.clearConversationSearch();
            searchBar.classList.add('hidden');
        });
    },

    clearConversationSearch() {
        const searchInput = document.getElementById('chat-search-input');
        const counterEl = document.getElementById('chat-search-count');
        if (searchInput) searchInput.value = '';
        if (counterEl) counterEl.textContent = '0 / 0';
        this.searchMatches = [];
        this.searchMatchIndex = -1;
        document.querySelectorAll('#messages-list .message-row').forEach((el) => {
            el.classList.remove('search-highlight', 'search-current');
        });
    },

    searchInConversation(query) {
        const clean = (query || '').trim().toLowerCase();
        const counterEl = document.getElementById('chat-search-count');

        document.querySelectorAll('#messages-list .message-row').forEach((el) => {
            el.classList.remove('search-highlight', 'search-current');
        });

        if (!clean) {
            this.searchMatches = [];
            this.searchMatchIndex = -1;
            if (counterEl) counterEl.textContent = '0 / 0';
            return;
        }

        const matchedIds = this.messages
            .filter((m) => (m.content || '').toLowerCase().includes(clean))
            .map((m) => m.id);

        this.searchMatches = matchedIds
            .map((id) => document.querySelector(`#messages-list [data-message-id="${id}"]`))
            .filter(Boolean);

        if (this.searchMatches.length === 0) {
            this.searchMatchIndex = -1;
            if (counterEl) counterEl.textContent = '0 / 0';
            return;
        }

        this.searchMatches.forEach((el) => el.classList.add('search-highlight'));
        this.searchMatchIndex = this.searchMatches.length - 1;
        this.focusSearchMatch(0);
    },

    focusSearchMatch(step = 1) {
        if (this.searchMatches.length === 0) return;

        this.searchMatches.forEach((el) => el.classList.remove('search-current'));
        this.searchMatchIndex = (this.searchMatchIndex + step + this.searchMatches.length) % this.searchMatches.length;

        const targetEl = this.searchMatches[this.searchMatchIndex];
        targetEl.classList.add('search-current');
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const counterEl = document.getElementById('chat-search-count');
        if (counterEl) {
            counterEl.textContent = `${this.searchMatchIndex + 1} / ${this.searchMatches.length}`;
        }
    },

    // =========================================================================
    // RÉACTIONS RAPIDES PAR ÉMOJIS (v2.2)
    // =========================================================================
    toggleReaction(messageId, emoji) {
        const msg = this.messages.find((m) => m.id === messageId);
        if (!msg || !this.currentUserId) return;

        const meta = (msg.media_meta && typeof msg.media_meta === 'object')
            ? { ...msg.media_meta }
            : {};
        const reactions = (meta.reactions && typeof meta.reactions === 'object')
            ? { ...meta.reactions }
            : {};

        const currentUsers = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
        const userIndex = currentUsers.indexOf(this.currentUserId);

        if (userIndex === -1) {
            currentUsers.push(this.currentUserId);
        } else {
            currentUsers.splice(userIndex, 1);
        }

        if (currentUsers.length > 0) {
            reactions[emoji] = currentUsers;
        } else {
            delete reactions[emoji];
        }

        meta.reactions = reactions;
        msg.media_meta = meta;

        this.renderMessageReactions(messageId, reactions);

        this.messagesChannel?.send({
            type: 'broadcast',
            event: 'reaction',
            payload: {
                message_id: messageId,
                reactions
            }
        });

        supabaseClient
            .from('messages')
            .update({ media_meta: meta })
            .eq('id', messageId)
            .then(({ error }) => {
                if (error) {
                    console.warn('Réaction diffusée en temps réel :', error.message);
                }
            });
    },

    renderMessageReactions(messageId, reactions = {}) {
        const row = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!row) return;

        let bar = row.querySelector('.message-reactions-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'message-reactions-bar';
            const metaDiv = row.querySelector('.message-meta');
            row.insertBefore(bar, metaDiv || null);
        }

        const entries = Object.entries(reactions).filter(([, users]) => Array.isArray(users) && users.length > 0);
        if (entries.length === 0) {
            bar.innerHTML = '';
            bar.classList.add('hidden');
            return;
        }

        bar.classList.remove('hidden');
        bar.innerHTML = '';

        entries.forEach(([emoji, users]) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            const isMine = users.includes(this.currentUserId);
            chip.className = `reaction-chip ${isMine ? 'active' : ''}`;
            chip.innerHTML = `<span>${emoji}</span><span class="reaction-count">${users.length}</span>`;
            chip.addEventListener('click', () => this.toggleReaction(messageId, emoji));
            bar.appendChild(chip);
        });
    },

    // =========================================================================
    // BROUILLONS PAR CONVERSATION (v2.2)
    // =========================================================================
    saveDraft(conversationId, text) {
        if (!conversationId) return;
        const clean = (text || '').trim();
        if (clean) {
            this.drafts[conversationId] = text;
        } else {
            delete this.drafts[conversationId];
        }
        localStorage.setItem('pulsechat_drafts_v22', JSON.stringify(this.drafts));
    },

    restoreDraft(conversationId) {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send-message');
        const micBtn = document.getElementById('btn-record-audio');
        if (!input) return;

        const saved = this.drafts[conversationId] || '';
        input.value = saved;
        input.style.height = 'auto';
        if (saved) {
            input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
        }

        const hasText = saved.trim().length > 0;
        if (sendBtn) {
            sendBtn.disabled = !hasText || this.isSending;
            sendBtn.classList.toggle('hidden', !hasText);
        }
        micBtn?.classList.toggle('hidden', hasText);
    },

    // =========================================================================
    // BOUTON FLOTTANT DESCENDRE EN BAS + BADGE (v2.2)
    // =========================================================================
    initScrollToBottomButton() {
        const container = document.getElementById('messages-container');
        const btn = document.getElementById('btn-scroll-bottom');
        if (!container || !btn) return;

        container.addEventListener('scroll', () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            const showBtn = distanceFromBottom > 160;
            btn.classList.toggle('hidden', !showBtn);

            if (!showBtn) {
                this.unreadWhileScrolled = 0;
                this.updateScrollBottomBadge();
            }
        });

        btn.addEventListener('click', () => {
            this.unreadWhileScrolled = 0;
            this.updateScrollBottomBadge();
            this.scrollToBottom(false);
        });
    },

    updateScrollBottomBadge() {
        const badge = document.getElementById('scroll-bottom-badge');
        if (!badge) return;
        if (this.unreadWhileScrolled > 0) {
            badge.textContent = this.unreadWhileScrolled;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    },

    // =========================================================================
    // INDICATEUR "EN TRAIN D'ÉCRIRE..."
    // =========================================================================
    broadcastTyping(isTyping) {
        if (!this.messagesChannel || !this.activeConversationId || !this.currentUserId) return;

        clearTimeout(this.typingTimeout);

        this.messagesChannel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                user_id: this.currentUserId,
                is_typing: isTyping
            }
        });

        if (isTyping) {
            this.typingTimeout = setTimeout(() => {
                this.broadcastTyping(false);
            }, 1800);
        }
    },

    handlePeerTypingEvent(payload) {
        if (!payload || payload.user_id === this.currentUserId) return;

        clearTimeout(this.peerTypingTimeout);
        this.isPeerTyping = Boolean(payload.is_typing);
        AppController.updateActivePeerHeaderStatus();

        if (this.isPeerTyping) {
            this.peerTypingTimeout = setTimeout(() => {
                this.isPeerTyping = false;
                AppController.updateActivePeerHeaderStatus();
            }, 2400);
        }
    },

    // =========================================================================
    // CITATION / RÉPONSE À UN MESSAGE
    // =========================================================================
    setReplyTarget(msg) {
        this.replyTargetMessage = msg;
        const bar = document.getElementById('reply-preview-bar');
        const textEl = document.getElementById('reply-preview-text');
        if (!bar || !textEl) return;

        const summary = msg.type === 'text'
            ? msg.content
            : msg.type === 'audio'
                ? 'Message vocal'
                : msg.type === 'sticker'
                    ? 'Sticker'
                    : msg.type === 'gif'
                        ? 'GIF'
                        : msg.type === 'video'
                            ? 'Vidéo'
                            : msg.type === 'file'
                                ? 'Document'
                                : 'Photo';

        textEl.textContent = summary;
        bar.classList.remove('hidden');
        document.getElementById('message-input').focus();
    },

    clearReplyTarget() {
        this.replyTargetMessage = null;
        document.getElementById('reply-preview-bar')?.classList.add('hidden');
    },

    // =========================================================================
    // CHARGEMENT ET RENDU DES MESSAGES
    // =========================================================================
    async openConversationMessages(conversationId) {
        this.activeConversationId = conversationId;
        this.messages = [];
        this.hasMoreOlder = false;
        this.lastRenderedDate = null;
        this.isPeerTyping = false;
        this.unreadWhileScrolled = 0;
        this.updateScrollBottomBadge();
        document.getElementById('btn-scroll-bottom')?.classList.add('hidden');
        document.getElementById('chat-search-bar')?.classList.add('hidden');
        document.getElementById('send-error-banner')?.classList.add('hidden');
        this.clearConversationSearch();

        clearTimeout(this.peerTypingTimeout);
        this.clearReplyTarget();
        this.restoreDraft(conversationId);

        const listEl = document.getElementById('messages-list');
        const loadingEl = document.getElementById('messages-loading');
        const emptyEl = document.getElementById('messages-empty');
        const olderWrapper = document.getElementById('load-older-wrapper');

        listEl.innerHTML = '';
        emptyEl.classList.add('hidden');
        olderWrapper.classList.add('hidden');
        loadingEl.classList.remove('hidden');

        if (this.messagesChannel) {
            await supabaseClient.removeChannel(this.messagesChannel);
            this.messagesChannel = null;
        }

        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(this.pageSize);

            if (error) throw error;

            const fetched = (data || []).reverse();
            this.messages = fetched;
            this.hasMoreOlder = fetched.length === this.pageSize;

            loadingEl.classList.add('hidden');
            olderWrapper.classList.toggle('hidden', !this.hasMoreOlder);

            if (this.messages.length === 0) {
                emptyEl.classList.remove('hidden');
            } else {
                this.renderAllMessages();
                this.scrollToBottom(true);
            }

            await this.markMessagesAsRead(conversationId);
            this.subscribeToActiveConversation(conversationId);
        } catch (err) {
            console.error('Erreur chargement messages :', err);
            loadingEl.classList.add('hidden');
        }
    },

    async loadOlderMessages() {
        if (!this.activeConversationId || this.messages.length === 0) return;

        const oldestTimestamp = this.messages[0].created_at;
        const container = document.getElementById('messages-container');
        const previousScrollHeight = container.scrollHeight;

        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .eq('conversation_id', this.activeConversationId)
            .lt('created_at', oldestTimestamp)
            .order('created_at', { ascending: false })
            .limit(this.pageSize);

        if (error || !data) return;

        const older = data.reverse();
        this.hasMoreOlder = older.length === this.pageSize;
        document.getElementById('load-older-wrapper').classList.toggle('hidden', !this.hasMoreOlder);

        this.messages = [...older, ...this.messages];
        this.renderAllMessages();
        container.scrollTop = container.scrollHeight - previousScrollHeight;
    },

    renderAllMessages() {
        const listEl = document.getElementById('messages-list');
        listEl.innerHTML = '';
        this.lastRenderedDate = null;

        this.messages.forEach((msg) => {
            this.appendMessageElement(msg, false);
        });
    },

    _buildBubbleContent(msg) {
        let replyHtml = '';
        if (msg.reply_to_id) {
            const parent = this.messages.find((m) => m.id === msg.reply_to_id);
            const parentText = parent
                ? (parent.type === 'text' ? parent.content : `[${parent.type.toUpperCase()}]`)
                : 'Message précédent';
            replyHtml = `<div class="reply-quote">${UsersModule.escapeHtml(parentText)}</div>`;
        }

        const forwardedHtml = msg.media_meta?.forwarded
            ? `<div class="forwarded-tag">Transféré</div>`
            : '';

        const captionHtml = msg.content
            ? `<div class="media-caption-text">${UsersModule.escapeHtml(msg.content)}</div>`
            : '';

        if (msg.type === 'sticker') {
            return `${replyHtml}${forwardedHtml}<img src="${msg.media_url}" alt="Sticker" class="sticker-bubble-img">`;
        }

        if (msg.type === 'gif') {
            return `${replyHtml}${forwardedHtml}<img src="${msg.media_url}" alt="GIF" class="gif-bubble-img">${captionHtml}`;
        }

        if (msg.type === 'image') {
            return `${replyHtml}${forwardedHtml}<img src="${msg.media_url}" alt="Photo" class="chat-bubble-img">${captionHtml}`;
        }

        if (msg.type === 'video') {
            return `${replyHtml}${forwardedHtml}<video controls playsinline preload="metadata" src="${msg.media_url}" class="chat-bubble-video"></video>${captionHtml}`;
        }

        if (msg.type === 'file') {
            const fileName = msg.media_meta?.name || 'Document';
            return `${replyHtml}${forwardedHtml}<a href="${msg.media_url}" target="_blank" rel="noopener" class="chat-file-link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <span>${UsersModule.escapeHtml(fileName)}</span>
            </a>${captionHtml}`;
        }

        if (msg.type === 'audio') {
            return `${replyHtml}${forwardedHtml}${this._buildAudioPlayerHtml(msg)}`;
        }

        return `${replyHtml}${forwardedHtml}<span class="msg-text-body">${UsersModule.escapeHtml(msg.content || '')}</span>`;
    },

    appendMessageElement(msg, checkAutoScroll = true) {
        const listEl = document.getElementById('messages-list');
        const emptyEl = document.getElementById('messages-empty');
        const container = document.getElementById('messages-container');

        emptyEl.classList.add('hidden');
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;

        const dateLabel = AppUtils.formatDateDivider(msg.created_at);
        if (dateLabel !== this.lastRenderedDate) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = dateLabel;
            listEl.appendChild(divider);
            this.lastRenderedDate = dateLabel;
        }

        const isMine = msg.sender_id === this.currentUserId;
        const row = document.createElement('div');
        const isMediaOnly = msg.type === 'sticker' || (msg.type === 'gif' && !msg.content);
        row.className = `message-row ${isMine ? 'sent' : 'received'} ${isMediaOnly ? 'media-only' : ''}`;
        row.dataset.messageId = msg.id;

        const readHtml = isMine
            ? `<span class="read-indicator" data-read-id="${msg.id}">${msg.is_read ? '✓✓' : '✓'}</span>`
            : '';

        const editedLabel = msg.edited_at ? `<span class="edited-tag">modifié</span>` : '';
        const canFav = (msg.type === 'sticker' || msg.type === 'gif') && msg.media_url;
        const canCopy = Boolean(msg.content && msg.content.trim().length > 0);

        const actionsHtml = `
            <div class="msg-actions">
                <button type="button" class="msg-action-btn react-btn" title="Réagir">👍</button>
                ${canFav ? `<button type="button" class="msg-action-btn fav-btn" title="Ajouter aux favoris">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </button>` : ''}
                <button type="button" class="msg-action-btn reply-btn" title="Répondre">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <polyline points="9 14 4 9 9 4"></polyline>
                        <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                    </svg>
                </button>
                <button type="button" class="msg-action-btn forward-btn" title="Transférer">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <polyline points="15 14 20 9 15 4"></polyline>
                        <path d="M4 20v-7a4 4 0 0 1 4-4h12"></path>
                    </svg>
                </button>
                ${canCopy ? `<button type="button" class="msg-action-btn copy-btn" title="Copier le texte">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>` : ''}
                ${isMine && msg.type === 'text' ? `<button type="button" class="msg-action-btn edit-btn" title="Modifier">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>` : ''}
                ${isMine ? `<button type="button" class="msg-action-btn delete-btn" title="Supprimer">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                    </svg>
                </button>` : ''}
            </div>
        `;

        row.innerHTML = `
            <div class="message-bubble-wrap">
                <div class="message-bubble">${this._buildBubbleContent(msg)}</div>
                ${actionsHtml}
            </div>
            <div class="message-meta">
                ${editedLabel}
                <span>${AppUtils.formatMessageTime(msg.created_at)}</span>
                ${readHtml}
            </div>
        `;

        this._bindAudioPlayers(row);

        row.querySelector('.react-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrap = row.querySelector('.message-bubble-wrap');
            let picker = wrap.querySelector('.inline-reaction-picker');
            if (picker) {
                picker.remove();
                return;
            }
            document.querySelectorAll('.inline-reaction-picker').forEach((p) => p.remove());

            picker = document.createElement('div');
            picker.className = 'inline-reaction-picker';
            this.quickReactions.forEach((emoji) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = emoji;
                b.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    this.toggleReaction(msg.id, emoji);
                    picker.remove();
                });
                picker.appendChild(b);
            });
            wrap.appendChild(picker);
        });

        row.querySelector('.fav-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const ok = await MediaModule.addToFavorites(msg.type, msg.media_url, msg.media_meta?.label || '');
            if (ok) {
                btn.classList.add('favorited');
                btn.title = 'Ajouté aux favoris';
            }
        });
        row.querySelector('.reply-btn')?.addEventListener('click', () => this.setReplyTarget(msg));
        row.querySelector('.forward-btn')?.addEventListener('click', () => this.openForwardModal(msg));
        row.querySelector('.copy-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            await this.copyMessage(msg);
            btn.classList.add('copied');
            btn.title = 'Copié !';
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.title = 'Copier le texte';
            }, 1500);
        });
        row.querySelector('.edit-btn')?.addEventListener('click', () => this.editMessage(msg));
        row.querySelector('.delete-btn')?.addEventListener('click', () => this.deleteMessage(msg.id));

        listEl.appendChild(row);

        const existingReactions = msg.media_meta?.reactions;
        if (existingReactions && Object.keys(existingReactions).length > 0) {
            this.renderMessageReactions(msg.id, existingReactions);
        }

        if (checkAutoScroll) {
            if (isNearBottom || isMine) {
                this.scrollToBottom(true);
            } else {
                this.unreadWhileScrolled += 1;
                this.updateScrollBottomBadge();
            }
        }
    },

    async copyMessage(msg) {
        if (!msg || !msg.content) return;
        try {
            await navigator.clipboard.writeText(msg.content);
        } catch {
            const temp = document.createElement('textarea');
            temp.value = msg.content;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            temp.remove();
        }
    },

    async editMessage(msg) {
        const updatedText = prompt('Modifier votre message :', msg.content || '');
        if (updatedText === null) return;
        const clean = updatedText.trim();
        if (!clean || clean === msg.content) return;

        const { error } = await supabaseClient
            .from('messages')
            .update({ content: clean, edited_at: new Date().toISOString() })
            .eq('id', msg.id)
            .eq('sender_id', this.currentUserId);

        if (error) {
            alert('Impossible de modifier ce message.');
        }
    },

    async deleteMessage(messageId) {
        if (!confirm('Supprimer ce message ?')) return;

        const { error } = await supabaseClient
            .from('messages')
            .delete()
            .eq('id', messageId)
            .eq('sender_id', this.currentUserId);

        if (error) {
            alert('Impossible de supprimer ce message.');
        }
    },

    scrollToBottom(instant = false) {
        const container = document.getElementById('messages-container');
        if (!container) return;
        container.scrollTo({
            top: container.scrollHeight,
            behavior: instant ? 'auto' : 'smooth'
        });
    },

    // =========================================================================
    // ENVOI DE MESSAGES (TEXTE & MÉDIAS)
    // =========================================================================
    async sendTextMessage() {
        if (this.isSending || !this.activeConversationId) return;

        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send-message');
        const micBtn = document.getElementById('btn-record-audio');
        const errorBanner = document.getElementById('send-error-banner');
        const errorText = document.getElementById('send-error-text');

        const content = input.value.trim();
        if (!content) return;

        this.isSending = true;
        sendBtn.disabled = true;
        errorBanner.classList.add('hidden');

        try {
            const payload = {
                conversation_id: this.activeConversationId,
                sender_id: this.currentUserId,
                content: content,
                type: 'text',
                reply_to_id: this.replyTargetMessage ? this.replyTargetMessage.id : null
            };

            const { data, error } = await supabaseClient
                .from('messages')
                .insert(payload)
                .select()
                .single();

            if (error) throw error;

            input.value = '';
            input.style.height = 'auto';
            sendBtn.classList.add('hidden');
            micBtn?.classList.remove('hidden');
            this.saveDraft(this.activeConversationId, '');
            this.clearReplyTarget();

            if (!this.messages.some((m) => m.id === data.id)) {
                this.messages.push(data);
                this.appendMessageElement(data, true);
            }
        } catch (err) {
            console.error('Erreur envoi message :', err);
            const detail = err?.message || 'Erreur inconnue';
            errorText.textContent = `Échec de l'envoi : ${detail}`;
            errorBanner.classList.remove('hidden');
        } finally {
            this.isSending = false;
            sendBtn.disabled = input.value.trim().length === 0;
            input.focus();
        }
    },

    async sendMediaMessage({ type, mediaUrl, caption = '', meta = {} }) {
        if (!this.activeConversationId) return;

        const { data, error } = await supabaseClient
            .from('messages')
            .insert({
                conversation_id: this.activeConversationId,
                sender_id: this.currentUserId,
                content: caption,
                type,
                media_url: mediaUrl,
                media_meta: meta,
                reply_to_id: this.replyTargetMessage ? this.replyTargetMessage.id : null
            })
            .select()
            .single();

        if (error) {
            console.error('Erreur envoi média :', error);
            alert(`Erreur lors de l'envoi du média (${error.message || 'vérifiez la base de données'}).`);
            return;
        }

        if (caption) {
            this.saveDraft(this.activeConversationId, '');
        }
        this.clearReplyTarget();

        if (!this.messages.some((m) => m.id === data.id)) {
            this.messages.push(data);
            this.appendMessageElement(data, true);
        }
    },

    async markMessagesAsRead(conversationId) {
        await supabaseClient
            .from('messages')
            .update({ is_read: true })
            .eq('conversation_id', conversationId)
            .neq('sender_id', this.currentUserId)
            .eq('is_read', false);

        await supabaseClient
            .from('conversation_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('user_id', this.currentUserId);
    },

    // =========================================================================
    // ABONNEMENT TEMPS RÉEL À LA CONVERSATION ACTIVE
    // =========================================================================
    subscribeToActiveConversation(conversationId) {
        this.messagesChannel = supabaseClient
            .channel(`chat-room-${conversationId}`)
            .on(
                'broadcast',
                { event: 'typing' },
                ({ payload }) => {
                    this.handlePeerTypingEvent(payload);
                }
            )
            .on(
                'broadcast',
                { event: 'reaction' },
                ({ payload }) => {
                    if (!payload || !payload.message_id) return;
                    const msg = this.messages.find((m) => m.id === payload.message_id);
                    if (msg) {
                        msg.media_meta = {
                            ...(msg.media_meta && typeof msg.media_meta === 'object' ? msg.media_meta : {}),
                            reactions: payload.reactions || {}
                        };
                    }
                    this.renderMessageReactions(payload.message_id, payload.reactions || {});
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                async (payload) => {
                    const newMsg = payload.new;
                    if (newMsg.sender_id !== this.currentUserId) {
                        this.isPeerTyping = false;
                        AppController.updateActivePeerHeaderStatus();
                    }

                    if (!this.messages.some((m) => m.id === newMsg.id)) {
                        this.messages.push(newMsg);
                        this.appendMessageElement(newMsg, true);
                    }

                    if (newMsg.sender_id !== this.currentUserId) {
                        await this.markMessagesAsRead(conversationId);
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    const updated = payload.new;
                    const idx = this.messages.findIndex((m) => m.id === updated.id);
                    if (idx !== -1) {
                        this.messages[idx] = updated;
                    }
                    const row = document.querySelector(`[data-message-id="${updated.id}"]`);
                    if (row) {
                        const textBody = row.querySelector('.msg-text-body');
                        if (textBody && updated.type === 'text') {
                            textBody.textContent = updated.content;
                        }
                        const indicator = row.querySelector(`[data-read-id="${updated.id}"]`);
                        if (indicator && updated.is_read) {
                            indicator.textContent = '✓✓';
                        }
                        if (updated.media_meta?.reactions) {
                            this.renderMessageReactions(updated.id, updated.media_meta.reactions);
                        }
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                (payload) => {
                    const deletedId = payload.old.id;
                    this.messages = this.messages.filter((m) => m.id !== deletedId);
                    document.querySelector(`[data-message-id="${deletedId}"]`)?.remove();
                }
            )
            .subscribe();
    },

    cleanup() {
        this.broadcastTyping(false);
        clearTimeout(this.typingTimeout);
        clearTimeout(this.peerTypingTimeout);
        document.querySelectorAll('.custom-audio-player audio').forEach((a) => a.pause());
        if (this.messagesChannel) {
            supabaseClient.removeChannel(this.messagesChannel);
            this.messagesChannel = null;
        }
    }
};