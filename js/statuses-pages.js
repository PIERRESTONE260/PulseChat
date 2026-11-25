/**
 * PAGE DÉDIÉE STATUTS (TYPE WHATSAPP) :
 * - Page plein écran dédiée (#statuses-page)
 * - Filtrage basé sur les correspondants (conversations + contacts téléphone si disponible)
 * - Publication texte / photo / vidéo (24h) & lecteur plein écran
 */

const StatusesPageModule = {
    currentUserId: null,
    currentProfile: null,
    phoneContactDigits: new Set(),
    groupedStatuses: [],
    activeGroupIndex: 0,
    activeStatusIndex: 0,
    statusChannel: null,

    async init(userId, profile = null) {
        this.currentUserId = userId;
        this.currentProfile = profile;
        this.loadSavedPhoneContacts();
        this.bindEvents();
        this.renderMyStatusHeader();
        await this.loadStatuses();
        this.subscribeRealtime();
    },

    loadSavedPhoneContacts() {
        try {
            const raw = JSON.parse(localStorage.getItem('pulsechat_phone_contacts_v23') || '[]');
            if (Array.isArray(raw)) {
                raw.forEach((d) => {
                    if (d) this.phoneContactDigits.add(String(d));
                });
            }
        } catch {
            // Ignorer les erreurs de stockage local
        }
    },

    normalizeDigits(val) {
        return String(val || '').replace(/\D/g, '');
    },

    async importPhoneContacts() {
        const hintEl = document.getElementById('statuses-contacts-hint');

        if (navigator.contacts && typeof navigator.contacts.select === 'function') {
            try {
                const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
                if (Array.isArray(picked)) {
                    picked.forEach((contact) => {
                        (contact.tel || []).forEach((num) => {
                            const digits = this.normalizeDigits(num);
                            if (digits.length >= 6) {
                                this.phoneContactDigits.add(digits);
                            }
                        });
                    });
                    localStorage.setItem(
                        'pulsechat_phone_contacts_v23',
                        JSON.stringify([...this.phoneContactDigits])
                    );
                }
                if (hintEl) {
                    hintEl.textContent = `${this.phoneContactDigits.size} numéro(s) téléphone synchronisé(s)`;
                }
                await this.loadStatuses();
                return;
            } catch {
                // Annulation ou API indisponible : conserver les correspondants de discussion
            }
        }

        if (hintEl) {
            hintEl.textContent = 'Basé sur vos correspondants de discussion';
        }
        await this.loadStatuses();
    },

    openPage() {
        const page = document.getElementById('statuses-page');
        if (!page) return;
        page.classList.remove('hidden');
        if (window.innerWidth <= 768) {
            window.history.pushState({ statusesPageOpen: true }, '');
        }
        this.renderMyStatusHeader();
        this.loadStatuses();
    },

    closePage() {
        const page = document.getElementById('statuses-page');
        if (!page || page.classList.contains('hidden')) return;
        page.classList.add('hidden');
    },

    renderMyStatusHeader() {
        const name = this.currentProfile?.full_name || 'Mon statut';
        const avatarUrl = this.currentProfile?.avatar_url || null;
        const imgEl = document.getElementById('my-status-avatar');
        const initEl = document.getElementById('my-status-initials');
        const titleEl = document.getElementById('my-status-title');

        if (titleEl) titleEl.textContent = name;

        if (typeof AppUtils !== 'undefined' && typeof AppUtils.renderAvatar === 'function') {
            AppUtils.renderAvatar(imgEl, initEl, avatarUrl, name);
        } else if (initEl) {
            initEl.textContent = (name[0] || 'M').toUpperCase();
        }
    },

    bindEvents() {
        document.getElementById('tab-btn-statuses')?.addEventListener('click', () => {
            this.openPage();
        });

        document.getElementById('btn-back-from-statuses')?.addEventListener('click', () => {
            if (window.history.state && window.history.state.statusesPageOpen) {
                window.history.back();
            } else {
                this.closePage();
            }
        });

        window.addEventListener('popstate', () => {
            this.closePage();
        });

        document.getElementById('btn-sync-phone-contacts')?.addEventListener('click', () => {
            this.importPhoneContacts();
        });

        document.getElementById('btn-quick-add-status')?.addEventListener('click', () => {
            document.getElementById('status-text-input')?.focus();
        });

        document.getElementById('status-composer-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.publishStatus();
        });

        document.getElementById('btn-close-status-viewer')?.addEventListener('click', () => {
            document.getElementById('status-viewer-modal')?.classList.add('hidden');
        });

        document.getElementById('btn-prev-status')?.addEventListener('click', () => {
            this.stepViewer(-1);
        });

        document.getElementById('btn-next-status')?.addEventListener('click', () => {
            this.stepViewer(1);
        });
    },

    getAllowedCorrespondentIds() {
        const ids = new Set();

        const convs = Array.isArray(ConversationsModule?.conversations)
            ? ConversationsModule.conversations
            : [];
        convs.forEach((c) => {
            if (c.peer_id) ids.add(c.peer_id);
        });

        const cachedUsers = Array.isArray(UsersModule?.cachedUsers)
            ? UsersModule.cachedUsers
            : [];
        cachedUsers.forEach((u) => {
            const pDigits = this.normalizeDigits(u.phone_e164 || u.phone_number);
            if (pDigits && this.phoneContactDigits.has(pDigits)) {
                ids.add(u.id);
            }
        });

        return ids;
    },

    async publishStatus() {
        const textInput = document.getElementById('status-text-input');
        const bgInput = document.getElementById('status-bg-color');
        const fileInput = document.getElementById('status-media-input');
        const submitBtn = document.getElementById('btn-publish-status');

        const textContent = (textInput?.value || '').trim();
        const bgColor = bgInput?.value || '#1d4ed8';
        const file = fileInput?.files?.[0] || null;

        if (!textContent && !file) {
            alert('Écrivez un texte ou choisissez une photo / vidéo pour publier un statut.');
            return;
        }

        if (file && file.size > 52428800) {
            alert('Le fichier dépasse la limite de 50 Mo.');
            return;
        }

        if (submitBtn) submitBtn.disabled = true;

        try {
            let mediaType = 'text';
            let mediaUrl = null;

            if (file) {
                const isVideo = file.type.startsWith('video/');
                mediaType = isVideo ? 'video' : 'image';
                const ext = (file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase();
                const filePath = `${this.currentUserId}/statuses/${Date.now()}.${ext}`;

                const { error: uploadError } = await supabaseClient.storage
                    .from('chat-media')
                    .upload(filePath, file, { upsert: false });

                if (uploadError) throw uploadError;

                const { data: pubData } = supabaseClient.storage
                    .from('chat-media')
                    .getPublicUrl(filePath);

                mediaUrl = pubData?.publicUrl || null;
            }

            const nowIso = new Date().toISOString();
            const expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            const { error: insertError } = await supabaseClient
                .from('user_statuses')
                .insert({
                    user_id: this.currentUserId,
                    media_type: mediaType,
                    content: textContent,
                    media_url: mediaUrl,
                    bg_color: bgColor,
                    created_at: nowIso,
                    expires_at: expiresIso
                });

            if (insertError) throw insertError;

            if (textInput) textInput.value = '';
            if (fileInput) fileInput.value = '';
            await this.loadStatuses();
        } catch (err) {
            console.error('Erreur publication statut :', err);
            alert(`Impossible de publier le statut : ${err?.message || 'erreur inconnue'}`);
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    },

    async loadStatuses() {
        const listEl = document.getElementById('contacts-statuses-list');
        const emptyEl = document.getElementById('statuses-empty-state');
        if (!listEl) return;

        try {
            const nowIso = new Date().toISOString();
            const { data, error } = await supabaseClient
                .from('user_statuses')
                .select('*')
                .gt('expires_at', nowIso)
                .order('created_at', { ascending: true });

            if (error) throw error;

            const allowedIds = this.getAllowedCorrespondentIds();
            const profilesMap = new Map();
            (UsersModule?.cachedUsers || []).forEach((u) => profilesMap.set(u.id, u));
            (ConversationsModule?.conversations || []).forEach((c) => {
                if (c.peer_id && !profilesMap.has(c.peer_id)) {
                    profilesMap.set(c.peer_id, {
                        id: c.peer_id,
                        full_name: c.peer_full_name || 'Correspondant',
                        avatar_url: c.peer_avatar_url || null
                    });
                }
            });

            const groupsByUser = new Map();

            (data || []).forEach((st) => {
                if (st.user_id === this.currentUserId) return;
                // Filtre strict sur les correspondants (discussions & contacts téléphone)
                if (allowedIds.size > 0 && !allowedIds.has(st.user_id)) return;

                if (!groupsByUser.has(st.user_id)) {
                    const prof = profilesMap.get(st.user_id) || {
                        id: st.user_id,
                        full_name: 'Correspondant',
                        avatar_url: null
                    };
                    groupsByUser.set(st.user_id, {
                        profile: prof,
                        items: []
                    });
                }
                groupsByUser.get(st.user_id).items.push(st);
            });

            this.groupedStatuses = [...groupsByUser.values()];
            listEl.innerHTML = '';

            if (this.groupedStatuses.length === 0) {
                emptyEl?.classList.remove('hidden');
                return;
            }

            emptyEl?.classList.add('hidden');

            this.groupedStatuses.forEach((group, gIdx) => {
                const li = document.createElement('li');
                li.className = 'status-contact-item';
                const latest = group.items[group.items.length - 1];
                const initials = typeof AppUtils?.getInitials === 'function'
                    ? AppUtils.getInitials(group.profile.full_name)
                    : (group.profile.full_name[0] || '?').toUpperCase();

                const avatarHtml = group.profile.avatar_url
                    ? `<img src="${UsersModule.escapeHtml(group.profile.avatar_url)}" alt="" class="avatar-img">`
                    : `<div class="avatar-initials">${UsersModule.escapeHtml(initials)}</div>`;

                const previewLabel = latest.media_type === 'video'
                    ? (latest.content || 'Vidéo')
                    : latest.media_type === 'image'
                        ? (latest.content || 'Photo')
                        : (latest.content || 'Statut texte');

                const timeLabel = typeof AppUtils?.formatMessageTime === 'function'
                    ? AppUtils.formatMessageTime(latest.created_at)
                    : '';

                li.innerHTML = `
                    <div class="status-ring-wrap has-status">${avatarHtml}</div>
                    <div class="list-item-body">
                        <div class="list-item-top">
                            <span class="list-item-title">${UsersModule.escapeHtml(group.profile.full_name)}</span>
                            <span class="list-item-time">${UsersModule.escapeHtml(timeLabel)}</span>
                        </div>
                        <span class="list-item-sub">${UsersModule.escapeHtml(previewLabel)}</span>
                    </div>
                `;

                li.addEventListener('click', () => {
                    this.openViewer(gIdx, 0);
                });

                listEl.appendChild(li);
            });
        } catch (err) {
            console.error('Erreur chargement statuts :', err);
        }
    },

    openViewer(groupIdx, statusIdx = 0) {
        const group = this.groupedStatuses[groupIdx];
        if (!group || !group.items[statusIdx]) return;

        this.activeGroupIndex = groupIdx;
        this.activeStatusIndex = statusIdx;

        const st = group.items[statusIdx];
        const modal = document.getElementById('status-viewer-modal');
        const authorEl = document.getElementById('status-viewer-author');
        const timeEl = document.getElementById('status-viewer-time');
        const bodyEl = document.getElementById('status-viewer-body');

        if (!modal || !bodyEl) return;

        if (authorEl) authorEl.textContent = group.profile.full_name || 'Correspondant';
        if (timeEl) {
            timeEl.textContent = typeof AppUtils?.formatMessageTime === 'function'
                ? AppUtils.formatMessageTime(st.created_at)
                : '';
        }

        if (st.media_type === 'video' && st.media_url) {
            bodyEl.innerHTML = `<video src="${UsersModule.escapeHtml(st.media_url)}" controls autoplay playsinline class="status-viewer-media"></video>`;
        } else if (st.media_type === 'image' && st.media_url) {
            bodyEl.innerHTML = `<img src="${UsersModule.escapeHtml(st.media_url)}" alt="Statut" class="status-viewer-media">`;
        } else {
            const bg = /^#[0-9a-fA-F]{3,8}$/.test(st.bg_color || '') ? st.bg_color : '#1d4ed8';
            bodyEl.innerHTML = `<div class="status-viewer-text-card" style="background:${bg}">${UsersModule.escapeHtml(st.content || '')}</div>`;
        }

        modal.classList.remove('hidden');
    },

    stepViewer(delta) {
        const group = this.groupedStatuses[this.activeGroupIndex];
        if (!group) return;

        const nextIdx = this.activeStatusIndex + delta;
        if (nextIdx >= 0 && nextIdx < group.items.length) {
            this.openViewer(this.activeGroupIndex, nextIdx);
            return;
        }

        const nextGroupIdx = this.activeGroupIndex + delta;
        if (nextGroupIdx >= 0 && nextGroupIdx < this.groupedStatuses.length) {
            const targetItems = this.groupedStatuses[nextGroupIdx].items;
            const startIdx = delta > 0 ? 0 : Math.max(0, targetItems.length - 1);
            this.openViewer(nextGroupIdx, startIdx);
        } else {
            document.getElementById('status-viewer-modal')?.classList.add('hidden');
        }
    },

    subscribeRealtime() {
        if (this.statusChannel) {
            supabaseClient.removeChannel(this.statusChannel);
        }

        this.statusChannel = supabaseClient
            .channel('statuses-page-realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'user_statuses' },
                () => {
                    this.loadStatuses();
                }
            )
            .subscribe();
    }
};