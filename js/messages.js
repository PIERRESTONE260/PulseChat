/**
 * GESTION DES MESSAGES EN TEMPS RÉEL (Envoi, Réception, Historique, Lecture)
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

    init(userId) {
        this.currentUserId = userId;
        const form = document.getElementById('message-form');
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send-message');
        const loadOlderBtn = document.getElementById('btn-load-older');
        const dismissErrBtn = document.getElementById('btn-dismiss-send-error');

        // Auto-ajustement de la hauteur du textarea
        input.addEventListener('input', () => {
            const hasText = input.value.trim().length > 0;
            sendBtn.disabled = !hasText || this.isSending;

            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
        });

        // Envoi avec Entrée (Shift+Entrée pour saut de ligne)
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
            await this.sendMessage();
        });

        loadOlderBtn.addEventListener('click', async () => {
            await this.loadOlderMessages();
        });

        dismissErrBtn.addEventListener('click', () => {
            document.getElementById('send-error-banner').classList.add('hidden');
        });
    },

    async openConversationMessages(conversationId) {
        this.activeConversationId = conversationId;
        this.messages = [];
        this.hasMoreOlder = false;
        this.lastRenderedDate = null;

        const listEl = document.getElementById('messages-list');
        const loadingEl = document.getElementById('messages-loading');
        const emptyEl = document.getElementById('messages-empty');
        const olderWrapper = document.getElementById('load-older-wrapper');

        listEl.innerHTML = '';
        emptyEl.classList.add('hidden');
        olderWrapper.classList.add('hidden');
        loadingEl.classList.remove('hidden');

        // Détacher l'abonnement précédent
        if (this.messagesChannel) {
            await supabaseClient.removeChannel(this.messagesChannel);
            this.messagesChannel = null;
        }

        try {
            // Charger les N derniers messages (tri descendant puis inversé)
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

            // Marquer les messages reçus comme lus
            await this.markMessagesAsRead(conversationId);

            // Souscrire aux nouveaux messages et mises à jour de lecture en temps réel
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

        // Conserver la position de lecture visuelle
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

    appendMessageElement(msg, checkAutoScroll = true) {
        const listEl = document.getElementById('messages-list');
        const emptyEl = document.getElementById('messages-empty');
        const container = document.getElementById('messages-container');

        emptyEl.classList.add('hidden');

        // Vérifier si l'utilisateur est proche du bas avant insertion
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;

        // Séparateur de date si changement de jour
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
        row.className = `message-row ${isMine ? 'sent' : 'received'}`;
        row.dataset.messageId = msg.id;

        const readHtml = isMine
            ? `<span class="read-indicator" data-read-id="${msg.id}">${msg.is_read ? '✓✓' : '✓'}</span>`
            : '';

        row.innerHTML = `
            <div class="message-bubble">${UsersModule.escapeHtml(msg.content)}</div>
            <div class="message-meta">
                <span>${AppUtils.formatMessageTime(msg.created_at)}</span>
                ${readHtml}
            </div>
        `;

        listEl.appendChild(row);

        if (checkAutoScroll && (isNearBottom || isMine)) {
            this.scrollToBottom(true);
        }
    },

    scrollToBottom(instant = false) {
        const container = document.getElementById('messages-container');
        container.scrollTo({
            top: container.scrollHeight,
            behavior: instant ? 'auto' : 'smooth'
        });
    },

    async sendMessage() {
        if (this.isSending || !this.activeConversationId) return;

        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('btn-send-message');
        const errorBanner = document.getElementById('send-error-banner');
        const errorText = document.getElementById('send-error-text');

        const content = input.value.trim();
        if (!content) return;

        this.isSending = true;
        sendBtn.disabled = true;
        errorBanner.classList.add('hidden');

        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .insert({
                    conversation_id: this.activeConversationId,
                    sender_id: this.currentUserId,
                    content: content,
                    type: 'text'
                })
                .select()
                .single();

            if (error) throw error;

            input.value = '';
            input.style.height = 'auto';

            // Ajout immédiat si Realtime ne l'a pas encore inséré
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
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${conversationId}`
                },
                async (payload) => {
                    const newMsg = payload.new;
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
                    const indicator = document.querySelector(`[data-read-id="${updated.id}"]`);
                    if (indicator && updated.is_read) {
                        indicator.textContent = '✓✓';
                    }
                }
            )
            .subscribe();
    },

    cleanup() {
        if (this.messagesChannel) {
            supabaseClient.removeChannel(this.messagesChannel);
            this.messagesChannel = null;
        }
    }
};