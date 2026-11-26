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

        // Liaison directe du clic sur un contact dans l'onglet Contacts
        const usersListEl = document.getElementById('users-list');
        if (usersListEl && !usersListEl.dataset.chatBound) {
            usersListEl.dataset.chatBound = '1';
            usersListEl.addEventListener('click', async (e) => {
                const item = e.target.closest('li, .user-item, .contact-item, .list-item');
                if (!item) return;

                let peerId = item.dataset.userId || item.dataset.id || item.getAttribute('data-user-id');

                // Secours si l'élément <li> n'a pas d'attribut data-user-id
                if (!peerId && typeof UsersModule !== 'undefined' && Array.isArray(UsersModule.cachedUsers)) {
                    const items = Array.from(usersListEl.children);
                    const idx = items.indexOf(item);
                    if (idx >= 0 && UsersModule.cachedUsers[idx]) {
                        peerId = UsersModule.cachedUsers[idx].id;
                    }
                }

                if (!peerId) {
                    console.warn('Impossible de récupérer l’ID du contact cliqué.');
                    return;
                }

                try {
                    // 1. Utilise la méthode existante d'AppController si disponible
                    if (typeof AppController !== 'undefined' && typeof AppController.startConversationWithUser === 'function') {
                        await AppController.startConversationWithUser(peerId);
                        return;
                    }

                    // 2. Sinon, création / récupération directe via ConversationsModule
                    if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.getOrCreateConversation === 'function') {
                        const conv = await ConversationsModule.getOrCreateConversation(peerId);
                        if (conv && typeof ConversationsModule.openConversation === 'function') {
                            await ConversationsModule.openConversation(conv.id);
                        }
                    }

                    // 3. Basculer l'interface vers la vue Discussions + ouvrir le panneau mobile
                    document.querySelectorAll('.tab-btn').forEach((btn) => {
                        btn.classList.toggle('active', btn.dataset.tab === 'conversations');
                    });
                    document.getElementById('users-view')?.classList.add('hidden');
                    document.getElementById('conversations-view')?.classList.remove('hidden');
                    document.getElementById('app-shell')?.classList.add('mobile-chat-open');
                } catch (err) {
                    console.error('Erreur ouverture discussion depuis Contacts :', err);
                    alert("Impossible d'ouvrir la discussion : " + (err?.message || 'vérifiez la console'));
                }
            });
        }

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

        // Amélioration : touche Échap pour fermer modales ou tiroirs ouverts
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const visibleModal = Array.from(document.querySelectorAll('.modal-backdrop')).find(
                (m) => !m.classList.contains('hidden')
            );
            if (visibleModal) {
                visibleModal.classList.add('hidden');
                return;
            }
            document.getElementById('attachment-drawer')?.classList.add('hidden');
            document.getElementById('expression-picker')?.classList.add('hidden');
        });

        // Mise à jour dynamique des statuts en ligne
        document.addEventListener('presence:updated', () => {
            UsersModule?.refreshPresenceIndicators?.();
            this.updateActivePeerHeaderStatus();
        });

        // Détection perte / retour de connexion navigateur + resynchronisation au retour en ligne
        const connBanner = document.getElementById('connection-banner');
        if (connBanner) {
            window.addEventListener('offline', () => connBanner.classList.remove('hidden'));
            window.addEventListener('online', async () => {
                connBanner.classList.add('hidden');
                if (typeof ConversationsModule !== 'undefined' && typeof ConversationsModule.loadConversations === 'function') {
                    await ConversationsModule.loadConversations();
                }
                UsersModule?.refreshPresenceIndicators?.();
            });
        }

        // Compteur visible qui défile pendant la lecture de tout élément <audio>
        const formatSec = (sec) => {
            if (!Number.isFinite(sec) || sec < 0) return '0:00';
            const total = Math.floor(sec);
            const m = Math.floor(total / 60);
            const s = total % 60;
            return `${m}:${String(s).padStart(2, '0')}`;
        };

        const attachAudioLiveCounter = (audioEl) => {
            if (!audioEl || audioEl.dataset.counterBound) return;
            audioEl.dataset.counterBound = '1';

            const counter = document.createElement('span');
            counter.className = 'audio-live-counter';
            counter.textContent = '0:00';
            audioEl.insertAdjacentElement('afterend', counter);

            const syncTime = () => {
                const durText = Number.isFinite(audioEl.duration) && audioEl.duration > 0
                    ? ` / ${formatSec(audioEl.duration)}`
                    : '';
                counter.textContent = `${formatSec(audioEl.currentTime)}${durText}`;
            };

            audioEl.addEventListener('loadedmetadata', syncTime);
            audioEl.addEventListener('timeupdate', syncTime);
            audioEl.addEventListener('ended', () => {
                counter.textContent = `0:00${Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? ` / ${formatSec(audioEl.duration)}` : ''}`;
            });
        };

        document.querySelectorAll('audio').forEach(attachAudioLiveCounter);
        const msgList = document.getElementById('messages-list');
        if (msgList) {
            new MutationObserver(() => {
                msgList.querySelectorAll('audio').forEach(attachAudioLiveCounter);
            }).observe(msgList, { childList: true, subtree: true });
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

            let conversationId = null;

            const { data: rpcId, error: rpcError } = await supabaseClient.rpc(
                'get_or_create_direct_conversation',
                { target_user_id: peerProfile.id }
            );

            if (!rpcError && rpcId) {
                conversationId = rpcId;
            } else {
                // Amélioration : secours direct si la fonction RPC n'est pas encore créée côté Supabase
                const myId = this.currentUser?.id;
                if (!myId) throw rpcError || new Error('Session introuvable');

                const { data: myRows, error: myErr } = await supabaseClient
                    .from('conversation_members')
                    .select('conversation_id')
                    .eq('user_id', myId);
                if (myErr) throw myErr;

                const myConvIds = (myRows || []).map((r) => r.conversation_id);
                if (myConvIds.length > 0) {
                    const { data: shared } = await supabaseClient
                        .from('conversation_members')
                        .select('conversation_id')
                        .eq('user_id', peerProfile.id)
                        .in('conversation_id', myConvIds)
                        .limit(1);
                    if (shared && shared[0]) {
                        conversationId = shared[0].conversation_id;
                    }
                }

                if (!conversationId) {
                    const { data: createdConv, error: convErr } = await supabaseClient
                        .from('conversations')
                        .insert({ last_message_preview: 'Nouvelle conversation' })
                        .select('id')
                        .single();
                    if (convErr) throw convErr;

                    conversationId = createdConv.id;

                    const { error: partErr } = await supabaseClient
                        .from('conversation_members')
                        .insert([
                            { conversation_id: conversationId, user_id: myId },
                            { conversation_id: conversationId, user_id: peerProfile.id }
                        ]);
                    if (partErr) throw partErr;
                }
            }

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
            alert(`Impossible d'ouvrir la discussion : ${err?.message || 'erreur inconnue'}`);
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