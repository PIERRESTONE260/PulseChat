/**
 * GESTION DES MESSAGES EN TEMPS RÉEL V2
 * (Texte, Audio, Photo, Vidéo, Document, Sticker, GIF, Citation, Édition, Suppression, Favoris & "En train d'écrire...")
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
    typingTimeout: null,
    peerTypingTimeout: null,
    isPeerTyping: false,

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
    },

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

    async openConversationMessages(conversationId) {
        this.activeConversationId = conversationId;
        this.messages = [];
        this.hasMoreOlder = false;
        this.lastRenderedDate = null;
        this.isPeerTyping = false;
        clearTimeout(this.peerTypingTimeout);
        this.clearReplyTarget();

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

        const captionHtml = msg.content
            ? `<div class="media-caption-text">${UsersModule.escapeHtml(msg.content)}</div>`
            : '';

        if (msg.type === 'sticker') {
            return `${replyHtml}<img src="${msg.media_url}" alt="Sticker" class="sticker-bubble-img">`;
        }

        if (msg.type === 'gif') {
            return `${replyHtml}<img src="${msg.media_url}" alt="GIF" class="gif-bubble-img">${captionHtml}`;
        }

        if (msg.type === 'image') {
            return `${replyHtml}<img src="${msg.media_url}" alt="Photo" class="chat-bubble-img">${captionHtml}`;
        }

        if (msg.type === 'video') {
            return `${replyHtml}<video controls playsinline preload="metadata" src="${msg.media_url}" class="chat-bubble-video"></video>${captionHtml}`;
        }

        if (msg.type === 'file') {
            const fileName = msg.media_meta?.name || 'Document';
            return `${replyHtml}<a href="${msg.media_url}" target="_blank" rel="noopener" class="chat-file-link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <span>${UsersModule.escapeHtml(fileName)}</span>
            </a>${captionHtml}`;
        }

        if (msg.type === 'audio') {
            return `${replyHtml}<audio controls preload="metadata" src="${msg.media_url}" class="chat-audio-player"></audio>`;
        }

        return `${replyHtml}<span class="msg-text-body">${UsersModule.escapeHtml(msg.content || '')}</span>`;
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

        const actionsHtml = `
            <div class="msg-actions">
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

        row.querySelector('.fav-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const ok = await MediaModule.addToFavorites(msg.type, msg.media_url, msg.media_meta?.label || '');
            if (ok) {
                btn.classList.add('favorited');
                btn.title = 'Ajouté aux favoris';
            }
        });
        row.querySelector('.reply-btn')?.addEventListener('click', () => this.setReplyTarget(msg));
        row.querySelector('.edit-btn')?.addEventListener('click', () => this.editMessage(msg));
        row.querySelector('.delete-btn')?.addEventListener('click', () => this.deleteMessage(msg.id));

        listEl.appendChild(row);

        if (checkAutoScroll && (isNearBottom || isMine)) {
            this.scrollToBottom(true);
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
        container.scrollTo({
            top: container.scrollHeight,
            behavior: instant ? 'auto' : 'smooth'
        });
    },

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
            this.clearReplyTarget();

            if (!this.messages.some((m) => m.id === data.id)) {
                this.messages.push(data);
                this.appendMessageElement(data, true);
            }
        } catch (err) {
            errorText.textContent = "Échec de l'envoi du message. Vérifiez votre connexion.";
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
            alert("Erreur lors de l'envoi du média.");
            return;
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
        if (this.messagesChannel) {
            supabaseClient.removeChannel(this.messagesChannel);
            this.messagesChannel = null;
        }
    }
};