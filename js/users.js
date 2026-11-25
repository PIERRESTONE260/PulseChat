/**
 * MODULE ANNUAIRE / CONTACTS V2.2 :
 * - Recherche par nom, @pseudo ou numéro de téléphone
 * - Communication ouverte entre utilisateurs ayant un compte PulseChat
 * - Aucun blocage ni suspension de compte
 */

const UsersModule = {
    currentUserId: null,
    cachedUsers: [],
    searchDebounceTimer: null,

    init(userId) {
        this.currentUserId = userId;
        const searchInput = document.getElementById('user-search-input');
        const clearBtn = document.getElementById('btn-clear-search');

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim();
                clearBtn?.classList.toggle('hidden', query.length === 0);

                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.searchUsers(query);
                }, 220);
            });
        }

        if (clearBtn && searchInput) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearBtn.classList.add('hidden');
                this.searchUsers('');
                searchInput.focus();
            });
        }
    },

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async searchUsers(query = '') {
        const listEl = document.getElementById('users-list');
        const loadingEl = document.getElementById('users-loading');
        const emptyEl = document.getElementById('users-empty');

        if (!listEl) return;

        loadingEl?.classList.remove('hidden');
        emptyEl?.classList.add('hidden');
        listEl.innerHTML = '';

        try {
            let req = supabaseClient
                .from('profiles')
                .select('id, full_name, username, avatar_url, bio, last_seen, created_at, country_code, phone_number, phone_e164')
                .neq('id', this.currentUserId)
                .order('full_name', { ascending: true })
                .limit(50);

            if (query) {
                const clean = query.replace(/^@/, '').replace(/[%_,]/g, '');
                if (clean) {
                    req = req.or(`full_name.ilike.%${clean}%,username.ilike.%${clean}%,phone_e164.ilike.%${clean}%`);
                }
            }

            const { data, error } = await req;
            if (error) throw error;

            this.cachedUsers = data || [];
            loadingEl?.classList.add('hidden');

            if (this.cachedUsers.length === 0) {
                emptyEl?.classList.remove('hidden');
                return;
            }

            this.renderUsersList(this.cachedUsers);
        } catch (err) {
            console.error('Erreur recherche contacts :', err);
            loadingEl?.classList.add('hidden');
            emptyEl?.classList.remove('hidden');
        }
    },

    renderUsersList(users) {
        const listEl = document.getElementById('users-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        users.forEach((user) => {
            const li = document.createElement('li');
            li.className = 'list-item user-item';
            li.dataset.userId = user.id;

            const isOnline = PresenceModule?.isOnline ? PresenceModule.isOnline(user.id) : false;
            const initials = AppUtils?.getInitials ? AppUtils.getInitials(user.full_name) : '?';

            const avatarHtml = user.avatar_url
                ? `<img src="${this.escapeHtml(user.avatar_url)}" alt="${this.escapeHtml(user.full_name)}" class="avatar-img">`
                : `<div class="avatar-initials">${this.escapeHtml(initials)}</div>`;

            const phoneLabel = user.phone_e164 ? ` • ${this.escapeHtml(user.phone_e164)}` : '';

            li.innerHTML = `
                <div class="avatar-wrapper">
                    ${avatarHtml}
                    <span class="status-dot ${isOnline ? 'status-online' : 'status-offline'}" data-presence-dot="${this.escapeHtml(user.id)}"></span>
                </div>
                <div class="list-item-body user-info">
                    <div class="list-item-top">
                        <span class="list-item-title user-name">${this.escapeHtml(user.full_name)}</span>
                    </div>
                    <span class="list-item-sub user-handle">@${this.escapeHtml(user.username)}${phoneLabel}</span>
                </div>
            `;

            li.addEventListener('click', async () => {
                await this.handleContactSelect(user);
            });

            listEl.appendChild(li);
        });
    },

    async handleContactSelect(friendProfile) {
        if (!friendProfile) return;
        await AppController.startConversationWithUser(friendProfile);
    },

    refreshPresenceIndicators() {
        document.querySelectorAll('[data-presence-dot]').forEach((dot) => {
            const uid = dot.getAttribute('data-presence-dot');
            const online = PresenceModule?.isOnline ? PresenceModule.isOnline(uid) : false;
            dot.className = `status-dot ${online ? 'status-online' : 'status-offline'}`;
        });
    }
};
