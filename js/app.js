/**
 * ORCHESTRATEUR PRINCIPAL DE L'APPLICATION V2.3 (index.html)
 * (Disposition fixe type WhatsApp via visualViewport, navigation mobile + bouton Retour,
 *  page dédiée Statuts filtrée sur les correspondants, gestion du thème sombre/clair,
 *  déconnexion propre, mise à jour SW v2.3 & temps réel)
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

            // Exécution isolée : si un sous-module échoue, l'application reste ouverte
            const safeRun = async (label, fn) => {
                try {
                    return await fn();
                } catch (moduleErr) {
                    console.warn(`[${label}] ignoré pour ne pas bloquer l'app :`, moduleErr);
                    return null;
                }
            };

            // 3. Initialiser tous les modules disponibles
            const loadedProfile = await safeRun('ProfileModule', async () => {
                if (typeof ProfileModule !== 'undefined' && typeof ProfileModule.loadCurrentProfile === 'function') {
                    return await ProfileModule.loadCurrentProfile(this.currentUser);
                }
                return null;
            });

            const activeProfile =
                loadedProfile ||
                (typeof ProfileModule !== 'undefined' ? ProfileModule.currentProfile : null) ||
                this.currentUser;

            await safeRun('PresenceModule', async () => {
                if (typeof PresenceModule !== 'undefined' && typeof PresenceModule.init === 'function') {
                    await PresenceModule.init(this.currentUser.id);
                }
            });

            await safeRun('UsersModule', async () => {
                if (typeof UsersModule !== 'undefined' && typeof UsersModule.init === 'function') {
                    UsersModule.init(this.currentUser.id);
                }
            });

            await safeRun('ConversationsModule', async () => {
                if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.init === 'function') {
                    await ConversationsModule.init(this.currentUser.id);
                }
            });

            await safeRun('MessagesModule', async () => {
                if (typeof MessagesModule !== 'undefined' && typeof MessagesModule.init === 'function') {
                    MessagesModule.init(this.currentUser.id);
                }
            });

            await safeRun('MediaModule', async () => {
                if (typeof MediaModule !== 'undefined' && typeof MediaModule.init === 'function') {
                    await MediaModule.init(this.currentUser.id);
                }
            });

            await safeRun('StatusesPageModule', async () => {
                if (typeof StatusesPageModule !== 'undefined' && typeof StatusesPageModule.init === 'function') {
                    await StatusesPageModule.init(this.currentUser.id, activeProfile);
                }
            });

            await safeRun('WhatsAppPro', async () => {
                if (typeof WhatsAppPro !== 'undefined' && typeof WhatsAppPro.init === 'function') {
                    await WhatsAppPro.init(activeProfile);
                }
            });

            // 4. Verrouiller le viewport mobile (clavier) & brancher les événements UI
            await safeRun('ViewportAndUI', async () => {
                this.bindViewportKeyboard();
                this.bindUIEvents();
            });

            // 5. Enregistrer et mettre à jour le Service Worker v2.3 (PWA)
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./sw.js').then((reg) => {
                    if (reg && typeof reg.update === 'function') {
                        reg.update();
                    }
                }).catch((err) => {
                    console.warn('Service Worker non enregistré :', err);
                });

                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (!window.__pulsechatSwReloaded) {
                        window.__pulsechatSwReloaded = true;
                        window.location.reload();
                    }
                });
            }

            // 6. Afficher l'application
            document.getElementById('global-loader')?.classList.add('hidden');
            document.getElementById('app-shell')?.classList.remove('hidden');
        } catch (err) {
            console.error('Erreur initialisation :', err);
            document.getElementById('global-loader')?.classList.add('hidden');
            document.getElementById('app-shell')?.classList.remove('hidden');
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
            if (
                activeInput &&
                (activeInput.id === 'message-input' || activeInput.id === 'media-caption-input') &&
                typeof MessagesModule !== 'undefined' &&
                typeof MessagesModule.scrollToBottom === 'function'
            ) {
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
        if (typeof StatusesPageModule !== 'undefined' && typeof StatusesPageModule.closePage === 'function') {
            StatusesPageModule.closePage();
        }

        const shell = document.getElementById('app-shell');
        if (!shell || !shell.classList.contains('mobile-chat-open')) return;

        document.activeElement?.blur();
        document.getElementById('attachment-drawer')?.classList.add('hidden');
        document.getElementById('expression-picker')?.classList.add('hidden');

        if (typeof MessagesModule !== 'undefined') {
            if (typeof MessagesModule.cleanup === 'function') {
                MessagesModule.cleanup();
            }
            MessagesModule.activeConversationId = null;
        }

        shell.classList.remove('mobile-chat-open');
        if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.setActiveConversation === 'function') {
            ConversationsModule.setActiveConversation(null);
        }
        this.activePeer = null;
    },

    bindUIEvents() {
        // Bascule Mode Sombre / Clair
        document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
            this.toggleTheme();
        });

        // Déconnexion propre (la redirection est gérée par onAuthStateChange)
        document.getElementById('btn-logout')?.addEventListener('click', async () => {
            if (typeof PresenceModule !== 'undefined' && typeof PresenceModule.cleanup === 'function') {
                await PresenceModule.cleanup();
            }
            if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.cleanup === 'function') {
                ConversationsModule.cleanup();
            }
            if (typeof MessagesModule !== 'undefined' && typeof MessagesModule.cleanup === 'function') {
                MessagesModule.cleanup();
            }
            await supabaseClient.auth.signOut();
        });

        // Ouverture modale profil personnel
        document.getElementById('btn-open-profile')?.addEventListener('click', () => {
            ProfileModule?.openEditModal?.();
        });
        document.getElementById('current-user-card')?.addEventListener('click', () => {
            ProfileModule?.openEditModal?.();
        });

        // Sauvegarde profil & upload avatar
        document.getElementById('profile-form')?.addEventListener('submit', (e) => {
            ProfileModule?.saveProfileChanges?.(e);
        });
        document.getElementById('avatar-file-input')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                ProfileModule?.handleAvatarUpload?.(e.target.files[0]);
            }
        });

        // Fermeture des modales
        document.querySelectorAll('.modal-close').forEach((btn) => {
            btn.addEventListener('click', () => {
                const modalId = btn.getAttribute('data-close');
                if (modalId) {
                    document.getElementById(modalId)?.classList.add('hidden');
                }
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
                if (targetTab === 'statuses') {
                    StatusesPageModule?.openPage?.();
                    return;
                }
                StatusesPageModule?.closePage?.();
                this.switchSidebarTab(targetTab);
            });
        });

        // Bouton accueil "Rechercher une personne"
        document.getElementById('btn-welcome-search')?.addEventListener('click', () => {
            StatusesPageModule?.closePage?.();
            this.switchSidebarTab('directory');
            document.getElementById('user-search-input')?.focus();
        });

        // Bouton retour mobile (en-tête) + bouton retour matériel du téléphone
        document.getElementById('btn-back-mobile')?.addEventListener('click', () => {
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
        document.getElementById('btn-view-peer-profile')?.addEventListener('click', () => {
            if (this.activePeer) ProfileModule?.openPeerProfileModal?.(this.activePeer);
        });
        document.getElementById('btn-peer-info')?.addEventListener('click', () => {
            if (this.activePeer) ProfileModule?.openPeerProfileModal?.(this.activePeer);
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
            UsersModule?.refreshPresenceIndicators?.();
            this.updateActivePeerHeaderStatus();
        });

        // Détection perte / retour de connexion navigateur
        const connBanner = document.getElementById('connection-banner');
        if (connBanner) {
            window.addEventListener('offline', () => connBanner.classList.remove('hidden'));
            window.addEventListener('online', () => connBanner.classList.add('hidden'));
        }
    },

    switchSidebarTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });

        const convView = document.getElementById('conversations-view');
        const usersView = document.getElementById('users-view');

        if (!convView || !usersView) return;

        if (tabName === 'conversations') {
            convView.classList.remove('hidden');
            usersView.classList.add('hidden');
        } else {
            convView.classList.add('hidden');
            usersView.classList.remove('hidden');
            if (typeof UsersModule !== 'undefined' && Array.isArray(UsersModule.cachedUsers) && UsersModule.cachedUsers.length === 0) {
                const q = document.getElementById('user-search-input')?.value.trim() || '';
                UsersModule.searchUsers(q);
            }
        }
    },

    async startConversationWithUser(peerProfileOrId) {
        try {
            let peerProfile = peerProfileOrId;
            if (typeof peerProfileOrId === 'string') {
                peerProfile =
                    (typeof UsersModule !== 'undefined' && Array.isArray(UsersModule.cachedUsers)
                        ? UsersModule.cachedUsers.find((u) => u.id === peerProfileOrId)
                        : null) || {
                        id: peerProfileOrId,
                        full_name: 'Contact',
                        username: '',
                        avatar_url: null,
                        last_seen: null
                    };
            }

            if (!peerProfile || !peerProfile.id) return;

            const { data: conversationId, error } = await supabaseClient.rpc('get_or_create_direct_conversation', {
                target_user_id: peerProfile.id
            });

            if (error) throw error;

            StatusesPageModule?.closePage?.();
            const searchInput = document.getElementById('user-search-input');
            if (searchInput) searchInput.value = '';
            document.getElementById('btn-clear-search')?.classList.add('hidden');
            this.switchSidebarTab('conversations');

            if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.loadConversations === 'function') {
                await ConversationsModule.loadConversations();
            }
            await this.openConversation(conversationId, peerProfile);
        } catch (err) {
            console.error('Impossible de démarrer la conversation :', err);
        }
    },

    async openConversation(conversationId, peerProfile) {
        StatusesPageModule?.closePage?.();
        this.activePeer = peerProfile;
        const shell = document.getElementById('app-shell');
        const wasAlreadyOpen = shell ? shell.classList.contains('mobile-chat-open') : false;

        document.getElementById('chat-welcome')?.classList.add('hidden');
        document.getElementById('chat-active')?.classList.remove('hidden');
        shell?.classList.add('mobile-chat-open');

        if (!wasAlreadyOpen && window.innerWidth <= 768) {
            window.history.pushState({ chatOpen: true, conversationId }, '');
        }

        const peerNameEl = document.getElementById('peer-fullname');
        if (peerNameEl) {
            peerNameEl.textContent = peerProfile.full_name || 'Contact';
        }

        if (typeof AppUtils !== 'undefined' && typeof AppUtils.renderAvatar === 'function') {
            AppUtils.renderAvatar(
                document.getElementById('peer-avatar'),
                document.getElementById('peer-initials'),
                peerProfile.avatar_url,
                peerProfile.full_name || 'Contact'
            );
        }

        this.updateActivePeerHeaderStatus();

        if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.setActiveConversation === 'function') {
            ConversationsModule.setActiveConversation(conversationId);
        }

        if (typeof MessagesModule !== 'undefined' && typeof MessagesModule.openConversationMessages === 'function') {
            await MessagesModule.openConversationMessages(conversationId);
        }

        if (window.innerWidth > 768) {
            document.getElementById('message-input')?.focus();
        }
    },

    updateActivePeerHeaderStatus() {
        if (!this.activePeer) return;
        const isOnline = typeof PresenceModule !== 'undefined' && typeof PresenceModule.isOnline === 'function'
            ? PresenceModule.isOnline(this.activePeer.id)
            : false;
        const dotEl = document.getElementById('peer-status-dot');
        const textEl = document.getElementById('peer-status-text');

        if (dotEl) {
            dotEl.className = `status-dot ${isOnline ? 'status-online' : 'status-offline'}`;
        }

        if (!textEl) return;

        if (typeof MessagesModule !== 'undefined' && MessagesModule.isPeerTyping) {
            textEl.textContent = 'En train d’écrire…';
            textEl.className = 'peer-status typing';
            return;
        }

        if (isOnline) {
            textEl.textContent = 'En ligne';
            textEl.className = 'peer-status online';
        } else if (typeof AppUtils !== 'undefined' && typeof AppUtils.formatLastSeen === 'function') {
            textEl.textContent = AppUtils.formatLastSeen(this.activePeer.last_seen);
            textEl.className = 'peer-status';
        } else {
            textEl.textContent = 'Hors ligne';
            textEl.className = 'peer-status';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AppController.init();
});
