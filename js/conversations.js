/**
 * GESTION DE LA LISTE DES CONVERSATIONS PRIVÉES
 */

const ConversationsModule = {
    currentUserId: null,
    conversations: [], // Liste enrichie avec peerProfile et unreadCount
    activeConversationId: null,
    realtimeChannel: null,

    async init(userId) {
        this.currentUserId = userId;
        await this.loadConversations();
        this.subscribeToConversationUpdates();
    },

    async loadConversations() {
        const loadingEl = document.getElementById('conversations-loading');
        const emptyEl = document.getElementById('conversations-empty');
        const listEl = document.getElementById('conversations-list');

        if (this.conversations.length === 0) {
            loadingEl.classList.remove('hidden');
        }

        try {
            // 1. Récupérer les participations de l'utilisateur courant
            const { data: myMemberships, error: memError } = await supabaseClient
                .from('conversation_members')
                .select('conversation_id, last_read_at')
                .eq('user_id', this.currentUserId);

            if (memError) throw memError;

            if (!myMemberships || myMemberships.length === 0) {
                this.conversations = [];
                loadingEl.classList.add('hidden');
                emptyEl.classList.remove('hidden');
                listEl.innerHTML = '';
                return;
            }

            const convIds = myMemberships.map((m) => m.conversation_id);

            // 2. Récupérer les conversations triées par dernière activité
            const { data: convData, error: convError } = await supabaseClient
                .from('conversations')
                .select('*')
                .in('id', convIds)
                .order('last_message_at', { ascending: false });

            if (convError) throw convError;

            // 3. Récupérer les interlocuteurs de ces conversations
            const { data: allMembers, error: peersError } = await supabaseClient
                .from('conversation_members')
                .select(`
                    conversation_id,
                    user_id,
                    profiles:user_id (id, username, full_name, avatar_url, bio, last_seen, created_at)
                `)
                .in('conversation_id', convIds)
                .neq('user_id', this.currentUserId);

            if (peersError) throw peersError;

            // 4. Compter les messages non lus par conversation
            const { data: unreadMessages } = await supabaseClient
                .from('messages')
                .select('conversation_id')
                .in('conversation_id', convIds)
                .neq('sender_id', this.currentUserId)
                .eq('is_read', false);

            const unreadMap = {};
            (unreadMessages || []).forEach((msg) => {
                unreadMap[msg.conversation_id] = (unreadMap[msg.conversation_id] || 0) + 1;
            });

            const peerByConvId = {};
            (allMembers || []).forEach((row) => {
                peerByConvId[row.conversation_id] = row.profiles;
            });

            this.conversations = (convData || [])
                .map((conv) => ({
                    ...conv,
                    peer: peerByConvId[conv.id] || null,
                    unreadCount: unreadMap[conv.id] || 0
                }))
                .filter((c) => c.peer !== null);

            loadingEl.classList.add('hidden');
            emptyEl.classList.toggle('hidden', this.conversations.length > 0);
            this.renderConversationsList();
        } catch (err) {
            console.error('Erreur chargement conversations :', err);
            loadingEl.classList.add('hidden');
        }
    },

    renderConversationsList() {
        const listEl = document.getElementById('conversations-list');
        const emptyEl = document.getElementById('conversations-empty');
        listEl.innerHTML = '';

        if (this.conversations.length === 0) {
            emptyEl.classList.remove('hidden');
            return;
        }
        emptyEl.classList.add('hidden');

        this.conversations.forEach((conv) => {
            const peer = conv.peer;
            const isOnline = PresenceModule.isOnline(peer.id);
            const isActive = conv.id === this.activeConversationId;
            const preview = conv.last_message_preview || 'Nouvelle conversation';
            const timeLabel = AppUtils.formatConversationTime(conv.last_message_at);

            const li = document.createElement('li');
            li.className = `list-item ${isActive ? 'active' : ''}`;
            li.dataset.conversationId = conv.id;

            li.innerHTML = `
                <div class="avatar-wrapper">
                    <img src="${peer.avatar_url || ''}" alt="" class="avatar avatar-md ${peer.avatar_url ? '' : 'hidden'}">
                    <div class="avatar-initials avatar-md ${peer.avatar_url ? 'hidden' : ''}">${AppUtils.getInitials(peer.full_name)}</div>
                    <span class="status-dot ${isOnline ? 'status-online' : 'status-offline'}" data-presence-dot="${peer.id}"></span>
                </div>
                <div class="item-content">
                    <div class="item-top-row">
                        <span class="item-title">${UsersModule.escapeHtml(peer.full_name)}</span>
                        <span class="item-time">${timeLabel}</span>
                    </div>
                    <div class="item-bottom-row">
                        <span class="item-subtitle">${UsersModule.escapeHtml(preview)}</span>
                        ${conv.unreadCount > 0 ? `<span class="unread-badge">${conv.unreadCount}</span>` : ''}
                    </div>
                </div>
            `;

            const img = li.querySelector('img');
            const initials = li.querySelector('.avatar-initials');
            if (img && peer.avatar_url) {
                img.onerror = () => {
                    img.classList.add('hidden');
                    initials.classList.remove('hidden');
                };
            }

            li.addEventListener('click', () => {
                AppController.openConversation(conv.id, peer);
            });

            listEl.appendChild(li);
        });
    },

    setActiveConversation(conversationId) {
        this.activeConversationId = conversationId;
        const target = this.conversations.find((c) => c.id === conversationId);
        if (target) {
            target.unreadCount = 0;
        }
        this.renderConversationsList();
    },

    subscribeToConversationUpdates() {
        // Écoute les mises à jour de la table conversations et les nouveaux messages entrants
        this.realtimeChannel = supabaseClient
            .channel('sidebar-conversations-sync')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'conversations' },
                () => {
                    this.loadConversations();
                }
            )
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                () => {
                    this.loadConversations();
                }
            )
            .subscribe();
    },

    cleanup() {
        if (this.realtimeChannel) {
            supabaseClient.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
        }
    }
};