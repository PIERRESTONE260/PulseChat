/**
 * ORCHESTRATEUR PRINCIPAL DE L'APPLICATION (index.html)
 */

const AppController = {
    currentUser: null,
    activePeer: null,

    async init() {
        try {
            // 1. Vérifier la session active
            const { data: { session }, error } = await supabaseClient.auth.getSession();
            if (error || !session) {
                window.location.replace('login.html');
                return;
            }

            this.currentUser = session.user;

            // 2. Écouter les expirations de session ou déconnexions
            supabaseClient.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_OUT') {
                    window.location.replace('login.html');
                }
            });

            // 3. Initialiser tous les modules
            await ProfileModule.loadCurrentProfile(this.currentUser);
            await PresenceModule.init(this.currentUser.id);
            UsersModule.init(this.currentUser.id);
            await ConversationsModule.init(this.currentUser.id);
            MessagesModule.init(this.currentUser.id);

            // 4. Brancher les événements d'interface
            this.bindUIEvents();

            // 5. Afficher l'application
            document.getElementById('global-loader').classList.add('hidden');
            document.getElementById('app-shell').classList.remove('hidden');
        } catch (err) {
            console.error('Erreur critique initialisation :', err);
            window.location.replace('login.html');
        }
    },

    bindUIEvents() {
        // Déconnexion réelle
        document.getElementById('btn-logout').addEventListener('click', async () => {
            await PresenceModule.cleanup();
            ConversationsModule.cleanup();
            MessagesModule.cleanup();
            await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        // Ouverture modale profil personnel
        document.getElementById('btn-open-profile').addEventListener('click', () => {
            ProfileModule.openEditModal();
        });
        document.getElementById('current-user-card').addEventListener('click', () => {
            ProfileModule.openEditModal();
        });

        // Sauvegarde profil & upload avatar
        document.getElementById('profile-form').addEventListener('submit', (e) => {
            ProfileModule.saveProfileChanges(e);
        });
        document.getElementById('avatar-file-input').addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                ProfileModule.handleAvatarUpload(e.target.files[0]);
            }
        });

        // Fermeture des modales
        document.querySelectorAll('.modal-close').forEach((btn) => {
            btn.addEventListener('click', () => {
                const modalId = btn.getAttribute('data-close');
                document.getElementById(modalId)?.classList.add('hidden');
            });
        });
        document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) {
                    backdrop.classList.add('hidden');
                }
            });
        });

        // Onglets Barre Latérale
        document.querySelectorAll('.tab-btn').forEach((tab) => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');
                this.switchSidebarTab(targetTab);
            });
        });

        // Bouton accueil "Rechercher une personne"
        document.getElementById('btn-welcome-search').addEventListener('click', () => {
            this.switchSidebarTab('directory');
            document.getElementById('user-search-input').focus();
        });

        // Bouton retour mobile
        document.getElementById('btn-back-mobile').addEventListener('click', () => {
            document.getElementById('app-shell').classList.remove('mobile-chat-open');
            ConversationsModule.setActiveConversation(null);
        });

        // Ouverture profil du correspondant actif
        document.getElementById('btn-view-peer-profile').addEventListener('click', () => {
            if (this.activePeer) ProfileModule.openPeerProfileModal(this.activePeer);
        });
        document.getElementById('btn-peer-info').addEventListener('click', () => {
            if (this.activePeer) ProfileModule.openPeerProfileModal(this.activePeer);
        });

        // Mise à jour dynamique des statuts en ligne
        document.addEventListener('presence:updated', () => {
            UsersModule.refreshPresenceIndicators();
            this.updateActivePeerHeaderStatus();
        });

        // Détection perte / retour de connexion navigateur
        const connBanner = document.getElementById('connection-banner');
        window.addEventListener('offline', () => connBanner.classList.remove('hidden'));
        window.addEventListener('online', () => connBanner.classList.add('hidden'));
    },

    switchSidebarTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });

        const convView = document.getElementById('conversations-view');
        const usersView = document.getElementById('users-view');

        if (tabName === 'conversations') {
            convView.classList.remove('hidden');
            usersView.classList.add('hidden');
        } else {
            convView.classList.add('hidden');
            usersView.classList.remove('hidden');
            if (UsersModule.cachedUsers.length === 0) {
                UsersModule.searchUsers(document.getElementById('user-search-input').value.trim());
            }
        }
    },

    async startConversationWithUser(peerProfile) {
        try {
            // Appel de la RPC atomique qui récupère ou crée la conversation privée unique
            const { data: conversationId, error } = await supabaseClient.rpc('get_or_create_direct_conversation', {
                target_user_id: peerProfile.id
            });

            if (error) throw error;

            // Vider la recherche et revenir aux discussions
            document.getElementById('user-search-input').value = '';
            document.getElementById('btn-clear-search').classList.add('hidden');
            this.switchSidebarTab('conversations');

            await ConversationsModule.loadConversations();
            await this.openConversation(conversationId, peerProfile);
        } catch (err) {
            console.error('Impossible de démarrer la conversation :', err);
        }
    },

    async openConversation(conversationId, peerProfile) {
        this.activePeer = peerProfile;

        // Afficher la zone active et masquer l'écran d'accueil
        document.getElementById('chat-welcome').classList.add('hidden');
        document.getElementById('chat-active').classList.remove('hidden');

        // Navigation mobile
        document.getElementById('app-shell').classList.add('mobile-chat-open');

        // Mettre à jour l'en-tête du correspondant
        document.getElementById('peer-fullname').textContent = peerProfile.full_name;
        AppUtils.renderAvatar(
            document.getElementById('peer-avatar'),
            document.getElementById('peer-initials'),
            peerProfile.avatar_url,
            peerProfile.full_name
        );
        this.updateActivePeerHeaderStatus();

        // Marquer la conversation active dans la barre latérale
        ConversationsModule.setActiveConversation(conversationId);

        // Charger et souscrire aux messages
        await MessagesModule.openConversationMessages(conversationId);
        document.getElementById('message-input').focus();
    },

    updateActivePeerHeaderStatus() {
        if (!this.activePeer) return;
        const isOnline = PresenceModule.isOnline(this.activePeer.id);
        const dotEl = document.getElementById('peer-status-dot');
        const textEl = document.getElementById('peer-status-text');

        dotEl.className = `status-dot ${isOnline ? 'status-online' : 'status-offline'}`;
        if (isOnline) {
            textEl.textContent = 'En ligne';
            textEl.className = 'peer-status online';
        } else {
            textEl.textContent = AppUtils.formatLastSeen(this.activePeer.last_seen);
            textEl.className = 'peer-status';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AppController.init();
});