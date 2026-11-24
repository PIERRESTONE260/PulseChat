/**
 * ORCHESTRATEUR PRINCIPAL DE L'APPLICATION V2.2 / WHATSAPP PRO (index.html)
 * (Disposition fixe type WhatsApp via visualViewport, navigation mobile + bouton Retour,
 *  gestion du thème sombre/clair, déconnexion propre, synchronisation temps réel & statuts)
 */

const AppController = {
    currentUser: null,
    activePeer: null,

    async init() {
        try {
            // Appliquer le thème sauvegardé dès le démarrage
            this.initTheme();

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
            const loadedProfile = await ProfileModule.loadCurrentProfile(this.currentUser);
            const activeProfile = loadedProfile || ProfileModule.currentProfile || this.currentUser;

            await PresenceModule.init(this.currentUser.id);
            UsersModule.init(this.currentUser.id);
            await ConversationsModule.init(this.currentUser.id);
            MessagesModule.init(this.currentUser.id);
            await MediaModule.init(this.currentUser.id);

            if (typeof WhatsAppPro !== 'undefined' && typeof WhatsAppPro.init === 'function') {
                await WhatsAppPro.init(activeProfile);
            }

            // 4. Verrouiller le viewport mobile (clavier) & brancher les événements UI
            this.bindViewportKeyboard();
            this.bindUIEvents();

            // 5. Enregistrer le Service Worker pour l'installation mobile (PWA)
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./sw.js').catch((err) => {
                    console.warn('Service Worker non enregistré :', err);
                });
            }

            // 6. Afficher l'application
            document.getElementById('global-loader').classList.add('hidden');
            document.getElementById('app-shell').classList.remove('hidden');
        } catch (err) {
            console.error('Erreur critique initialisation :', err);
            window.location.replace('login.html');
        }
    },

    initTheme() {
        const savedTheme = localStorage.getItem('pulsechat_theme') || 'light';
        this.applyTheme(savedTheme);
    },

    applyTheme(theme) {
        const isDark = theme === 'dark';
        if (isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        localStorage.setItem('pulsechat_theme', isDark ? 'dark' : 'light');

        document.getElementById('icon-theme-moon')?.classList.toggle('hidden', isDark);
        document.getElementById('icon-theme-sun')?.classList.toggle('hidden', !isDark);
    },

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        this.applyTheme(current === 'dark' ? 'light' : 'dark');
    },

    // =========================================================================
    // VERROUILLAGE VIEWPORT TYPE WHATSAPP (HEADER FIXE + BARRE SAISIE AU-DESSUS DU CLAVIER)
    // =========================================================================
    bindViewportKeyboard() {
        const updateViewportHeight = () => {
            const vv = window.visualViewport;
            const height = vv ? Math.round(vv.height) : window.innerHeight;
            const offsetTop = vv ? Math.round(vv.offsetTop) : 0;

            document.documentElement.style.setProperty('--app-height', `${height}px`);
            document.documentElement.style.setProperty('--app-offset-top', `${offsetTop}px`);

            const activeInput = document.activeElement;
            if (activeInput && (activeInput.id === 'message-input' || activeInput.id === 'media-caption-input')) {
                setTimeout(() => {
                    MessagesModule.scrollToBottom(false);
                }, 60);
            }
        };

        updateViewportHeight();

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateViewportHeight);
            window.visualViewport.addEventListener('scroll', updateViewportHeight);
        }
        window.addEventListener('resize', updateViewportHeight);
    },

    closeMobileChat() {
        const shell = document.getElementById('app-shell');
        if (!shell.classList.contains('mobile-chat-open')) return;

        document.activeElement?.blur();
        document.getElementById('attachment-drawer')?.classList.add('hidden');
        document.getElementById('expression-picker')?.classList.add('hidden');

        MessagesModule.cleanup();
        MessagesModule.activeConversationId = null;

        shell.classList.remove('mobile-chat-open');
        ConversationsModule.setActiveConversation(null);
        this.activePeer = null;
    },

    bindUIEvents() {
        // Bascule Mode Sombre / Clair
        document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
            this.toggleTheme();
        });

        // Déconnexion propre (la redirection est gérée par onAuthStateChange)
        document.getElementById('btn-logout').addEventListener('click', async () => {
            await PresenceModule.cleanup();
            ConversationsModule.cleanup();
            MessagesModule.cleanup();
            await supabaseClient.auth.signOut();
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

        // Bouton retour mobile (en-tête) + bouton retour matériel du téléphone
        document.getElementById('btn-back-mobile').addEventListener('click', () => {
            if (window.history.state && window.history.state.chatOpen) {
                window.history.back();
            } else {
                this.closeMobileChat();
            }
        });

        window.addEventListener('popstate', () => {
            this.closeMobileChat();
        });

        // Ouverture profil du correspondant actif
        document.getElementById('btn-view-peer-profile').addEventListener('click', () => {
            if (this.activePeer) ProfileModule.openPeerProfileModal(this.activePeer);
        });
        document.getElementById('btn-peer-info').addEventListener('click', () => {
            if (this.activePeer) ProfileModule.openPeerProfileModal(this.activePeer);
        });

        // Panneau unifié Émojis / GIF / Stickers
        document.getElementById('btn-toggle-expressions')?.addEventListener('click', () => {
            document.getElementById('attachment-drawer')?.classList.add('hidden');
            document.getElementById('expression-picker')?.classList.toggle('hidden');
        });

        document.querySelectorAll('.expr-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-expr');
                document.querySelectorAll('.expr-tab').forEach((t) => t.classList.toggle('active', t === tab));
                document.querySelectorAll('.expr-panel').forEach((panel) => {
                    panel.classList.toggle('hidden', panel.id !== `expr-panel-${target}`);
                });
            });
        });

        // Tiroir pièces jointes (Galerie, Caméra, Document)
        document.getElementById('btn-toggle-attachments')?.addEventListener('click', () => {
            document.getElementById('expression-picker')?.classList.add('hidden');
            document.getElementById('attachment-drawer')?.classList.toggle('hidden');
        });

        // Fermer les tiroirs / panneaux lorsqu'on tape ou clique dans les messages
        document.getElementById('message-input')?.addEventListener('focus', () => {
            document.getElementById('attachment-drawer')?.classList.add('hidden');
            document.getElementById('expression-picker')?.classList.add('hidden');
        });
        document.getElementById('messages-container')?.addEventListener('click', () => {
            document.getElementById('attachment-drawer')?.classList.add('hidden');
            document.getElementById('expression-picker')?.classList.add('hidden');
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

    async startConversationWithUser(peerProfileOrId) {
        try {
            let peerProfile = peerProfileOrId;
            if (typeof peerProfileOrId === 'string') {
                peerProfile =
                    UsersModule?.cachedUsers?.find((u) => u.id === peerProfileOrId) || {
                        id: peerProfileOrId,
                        full_name: 'Contact',
                        avatar_url: null,
                        last_seen: null
                    };
            }

            if (!peerProfile?.id) return;

            const { data: conversationId, error } = await supabaseClient.rpc('get_or_create_direct_conversation', {
                target_user_id: peerProfile.id
            });

            if (error) throw error;

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
        const shell = document.getElementById('app-shell');
        const wasAlreadyOpen = shell.classList.contains('mobile-chat-open');

        document.getElementById('chat-welcome').classList.add('hidden');
        document.getElementById('chat-active').classList.remove('hidden');
        shell.classList.add('mobile-chat-open');

        if (!wasAlreadyOpen && window.innerWidth <= 768) {
            window.history.pushState({ chatOpen: true, conversationId }, '');
        }

        document.getElementById('peer-fullname').textContent = peerProfile.full_name;
        AppUtils.renderAvatar(
            document.getElementById('peer-avatar'),
            document.getElementById('peer-initials'),
            peerProfile.avatar_url,
            peerProfile.full_name
        );
        this.updateActivePeerHeaderStatus();

        ConversationsModule.setActiveConversation(conversationId);

        await MessagesModule.openConversationMessages(conversationId);
        if (window.innerWidth > 768) {
            document.getElementById('message-input').focus();
        }
    },

    updateActivePeerHeaderStatus() {
        if (!this.activePeer) return;
        const isOnline = PresenceModule.isOnline(this.activePeer.id);
        const dotEl = document.getElementById('peer-status-dot');
        const textEl = document.getElementById('peer-status-text');

        dotEl.className = `status-dot ${isOnline ? 'status-online' : 'status-offline'}`;

        if (MessagesModule.isPeerTyping) {
            textEl.textContent = 'En train d’écrire…';
            textEl.className = 'peer-status typing';
            return;
        }

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