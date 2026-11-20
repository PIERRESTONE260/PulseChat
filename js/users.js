/**
 * RECHERCHE ET ANNUAIRE DES UTILISATEURS
 */

const UsersModule = {
    currentUserId: null,
    debounceTimer: null,
    cachedUsers: [],

    init(userId) {
        this.currentUserId = userId;
        const searchInput = document.getElementById('user-search-input');
        const clearBtn = document.getElementById('btn-clear-search');

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim();
            clearBtn.classList.toggle('hidden', query.length === 0);

            // Basculer automatiquement sur l'onglet Utilisateurs lors d'une recherche
            if (query.length > 0) {
                AppController.switchSidebarTab('directory');
            }

            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.searchUsers(query);
            }, 300);
        });

        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.add('hidden');
            this.searchUsers('');
            AppController.switchSidebarTab('conversations');
        });
    },

    async searchUsers(query = '') {
        const loadingEl = document.getElementById('users-loading');
        const emptyEl = document.getElementById('users-empty');
        const listEl = document.getElementById('users-list');

        loadingEl.classList.remove('hidden');
        emptyEl.classList.add('hidden');
        listEl.innerHTML = '';

        try {
            let dbQuery = supabaseClient
                .from('profiles')
                .select('id, username, full_name, avatar_url, bio, last_seen, created_at')
                .neq('id', this.currentUserId) // Exclure l'utilisateur connecté
                .order('full_name', { ascending: true })
                .limit(30);

            if (query) {
                const cleanQuery = query.replace(/^@/, '');
                dbQuery = dbQuery.or(`full_name.ilike.%${cleanQuery}%,username.ilike.%${cleanQuery}%`);
            }

            const { data, error } = await dbQuery;
            if (error) throw error;

            this.cachedUsers = data || [];
            loadingEl.classList.add('hidden');

            if (this.cachedUsers.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }

            this.renderUsersList(this.cachedUsers);
        } catch (err) {
            loadingEl.classList.add('hidden');
            emptyEl.querySelector('p').textContent = 'Erreur lors de la recherche.';
            emptyEl.classList.remove('hidden');
        }
    },

    renderUsersList(users) {
        const listEl = document.getElementById('users-list');
        listEl.innerHTML = '';

        users.forEach((user) => {
            const isOnline = PresenceModule.isOnline(user.id);
            const li = document.createElement('li');
            li.className = 'list-item';
            li.dataset.userId = user.id;

            li.innerHTML = `
                <div class="avatar-wrapper">
                    <img src="${user.avatar_url || ''}" alt="" class="avatar avatar-md ${user.avatar_url ? '' : 'hidden'}">
                    <div class="avatar-initials avatar-md ${user.avatar_url ? 'hidden' : ''}">${AppUtils.getInitials(user.full_name)}</div>
                    <span class="status-dot ${isOnline ? 'status-online' : 'status-offline'}" data-presence-dot="${user.id}"></span>
                </div>
                <div class="item-content">
                    <div class="item-top-row">
                        <span class="item-title">${this.escapeHtml(user.full_name)}</span>
                    </div>
                    <div class="item-bottom-row">
                        <span class="item-subtitle">@${this.escapeHtml(user.username)}</span>
                    </div>
                </div>
            `;

            // Fallback image cassée
            const img = li.querySelector('img');
            const initials = li.querySelector('.avatar-initials');
            if (img && user.avatar_url) {
                img.onerror = () => {
                    img.classList.add('hidden');
                    initials.classList.remove('hidden');
                };
            }

            li.addEventListener('click', () => {
                AppController.startConversationWithUser(user);
            });

            listEl.appendChild(li);
        });
    },

    refreshPresenceIndicators() {
        document.querySelectorAll('[data-presence-dot]').forEach((dot) => {
            const uid = dot.getAttribute('data-presence-dot');
            const online = PresenceModule.isOnline(uid);
            dot.className = `status-dot ${online ? 'status-online' : 'status-offline'}`;
        });
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};