/**
 * MODULE WHATSAPP PRO V1 :
 * - Pays & numéro de téléphone au login pour comptes existants (sans blocage)
 * - Communication initiée à partir du numéro de l'ami (façon WhatsApp)
 * - Statuts (24h, texte / photo / vidéo)
 * - Rendu des messages type WhatsApp
 */

const WhatsAppPro = {
    currentUser: null,
    myContactsPhones: new Set(),
    statuses: [],

    normalizePhone(countryCode, rawPhone) {
        const dial = (countryCode || '+243').replace(/[^\d+]/g, '');
        let digits = (rawPhone || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits.startsWith('0')) {
            digits = digits.replace(/^0+/, '');
        }
        const dialDigits = dial.replace(/\D/g, '');
        if (digits.startsWith(dialDigits)) {
            return `+${digits}`;
        }
        return `${dial.startsWith('+') ? dial : '+' + dial}${digits}`;
    },

    async init(userProfile) {
        this.currentUser = userProfile;
        this.bindPhoneOnboarding();
        this.bindStatuses();
        this.enhanceChatBubbleGrouping();
        await this.loadStatuses();

        if (!userProfile?.phone_e164 || !userProfile?.country_code) {
            this.openPhoneOnboardingModal();
        }
    },

    openPhoneOnboardingModal() {
        const modal = document.getElementById('modal-phone-onboarding');
        if (!modal) return;
        const countrySel = document.getElementById('onboarding-country');
        if (countrySel && this.currentUser?.country_code) {
            for (const opt of countrySel.options) {
                if (opt.value.endsWith(`|${this.currentUser.country_code}`)) {
                    countrySel.value = opt.value;
                    break;
                }
            }
        }
        const phoneInp = document.getElementById('onboarding-phone');
        if (phoneInp && this.currentUser?.phone_number) {
            phoneInp.value = this.currentUser.phone_number;
        }
        modal.classList.remove('hidden');
    },

    bindPhoneOnboarding() {
        const form = document.getElementById('phone-onboarding-form');
        const alertEl = document.getElementById('phone-onboarding-alert');
        const modal = document.getElementById('modal-phone-onboarding');
        if (!form) return;

        modal?.querySelector('.modal-close')?.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const [dial, countryCode] = (document.getElementById('onboarding-country')?.value || '+243|CD').split('|');
            const rawPhone = document.getElementById('onboarding-phone')?.value || '';
            const phoneE164 = this.normalizePhone(dial, rawPhone);

            if (!phoneE164 || phoneE164.length < 8) {
                alertEl.textContent = 'Entrez un numéro de téléphone valide.';
                alertEl.className = 'alert alert-error';
                alertEl.classList.remove('hidden');
                return;
            }

            const btn = document.getElementById('btn-save-phone-onboarding');
            btn.disabled = true;

            const { data, error } = await supabaseClient
                .from('profiles')
                .update({
                    country_code: countryCode,
                    phone_number: rawPhone.trim(),
                    phone_e164: phoneE164
                })
                .eq('id', this.currentUser.id)
                .select()
                .single();

            btn.disabled = false;

            if (error) {
                alertEl.textContent = "Impossible d'enregistrer le numéro pour le moment.";
                alertEl.className = 'alert alert-error';
                alertEl.classList.remove('hidden');
                return;
            }

            this.currentUser = data;
            alertEl.classList.add('hidden');
            modal.classList.add('hidden');
        });
    },

    // Vérifie si l'utilisateur a le numéro de l'ami avant de démarrer une discussion
    hasFriendPhone(friendProfile, enteredPhone = '') {
        const targetE164 = friendProfile?.phone_e164 || '';
        const normalizedEntered = enteredPhone
            ? this.normalizePhone(`+${(this.currentUser?.country_code === 'FR' ? '33' : '243')}`, enteredPhone)
            : '';

        if (normalizedEntered && targetE164 && normalizedEntered === targetE164) {
            return true;
        }
        return Boolean(targetE164 && this.myContactsPhones.has(targetE164));
    },

    async startChatWithFriendByPhone(friendProfile, enteredPhone = '') {
        if (!this.hasFriendPhone(friendProfile, enteredPhone)) {
            alert("Ajoutez ou saisissez le numéro de téléphone de votre ami pour démarrer la discussion.");
            return false;
        }
        if (typeof AppController?.startConversationWithUser === 'function') {
            await AppController.startConversationWithUser(friendProfile.id);
            return true;
        }
        return false;
    },

    // =========================================================================
    // STATUTS (24H)
    // =========================================================================
    bindStatuses() {
        const headerActions = document.querySelector('.sidebar-header-actions');
        if (headerActions && !document.getElementById('btn-open-statuses')) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'btn-open-statuses';
            btn.className = 'icon-btn';
            btn.title = 'Statuts';
            btn.innerHTML = `
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="9" stroke-dasharray="4 3"></circle>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            `;
            btn.addEventListener('click', async () => {
                await this.loadStatuses();
                this.renderStatusesList();
                document.getElementById('modal-statuses')?.classList.remove('hidden');
            });
            headerActions.prepend(btn);
        }

        document.querySelector('#modal-statuses .modal-close')?.addEventListener('click', () => {
            document.getElementById('modal-statuses')?.classList.add('hidden');
        });

        document.getElementById('create-status-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.publishStatus();
        });
    },

    async loadStatuses() {
        const nowIso = new Date().toISOString();
        const { data } = await supabaseClient
            .from('user_statuses')
            .select('*, profiles(full_name, username)')
            .gt('expires_at', nowIso)
            .order('created_at', { ascending: false });

        this.statuses = data || [];
    },

    async publishStatus() {
        if (!this.currentUser?.id) return;
        const textInp = document.getElementById('status-text-input');
        const colorInp = document.getElementById('status-bg-color');
        const mediaInp = document.getElementById('status-media-input');
        const btn = document.getElementById('btn-publish-status');

        const content = (textInp?.value || '').trim();
        const bgColor = colorInp?.value || '#1d4ed8';
        const file = mediaInp?.files?.[0] || null;

        if (!content && !file) return;

        btn.disabled = true;
        try {
            let mediaUrl = null;
            let mediaType = 'text';

            if (file) {
                mediaType = file.type.startsWith('video/') ? 'video' : 'image';
                const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
                const path = `${this.currentUser.id}/status_${Date.now()}.${ext}`;
                const { error: upErr } = await supabaseClient.storage.from('chat-media').upload(path, file);
                if (upErr) throw upErr;
                const { data: pub } = supabaseClient.storage.from('chat-media').getPublicUrl(path);
                mediaUrl = pub.publicUrl;
            }

            const { error } = await supabaseClient.from('user_statuses').insert({
                user_id: this.currentUser.id,
                media_type: mediaType,
                content,
                media_url: mediaUrl,
                bg_color: bgColor
            });

            if (error) throw error;

            if (textInp) textInp.value = '';
            if (mediaInp) mediaInp.value = '';
            await this.loadStatuses();
            this.renderStatusesList();
        } catch (err) {
            console.error('Erreur statut :', err);
            alert('Impossible de publier le statut.');
        } finally {
            btn.disabled = false;
        }
    },

    renderStatusesList() {
        const listEl = document.getElementById('statuses-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (this.statuses.length === 0) {
            listEl.innerHTML = '<li class="panel-state"><small>Aucun statut actif pour le moment.</small></li>';
            return;
        }

        this.statuses.forEach((st) => {
            const li = document.createElement('li');
            li.className = 'list-item';
            const author = st.profiles?.full_name || 'Utilisateur';
            const summary = st.content || (st.media_type === 'video' ? 'Statut vidéo' : 'Statut photo');
            li.innerHTML = `
                <div class="list-item-body">
                    <span class="list-item-title">${UsersModule.escapeHtml(author)}</span>
                    <span class="list-item-sub">${UsersModule.escapeHtml(summary)}</span>
                </div>
                <span class="list-item-time">${AppUtils.formatMessageTime(st.created_at)}</span>
            `;
            li.addEventListener('click', () => this.showStatusInViewer(st));
            listEl.appendChild(li);
        });
    },

    showStatusInViewer(st) {
        const box = document.getElementById('status-viewer-box');
        const authorEl = document.getElementById('status-viewer-author');
        const contentEl = document.getElementById('status-viewer-content');
        const imgEl = document.getElementById('status-viewer-img');
        const vidEl = document.getElementById('status-viewer-video');
        if (!box) return;

        box.style.backgroundColor = st.bg_color || '#1d4ed8';
        authorEl.textContent = st.profiles?.full_name || 'Statut';
        contentEl.textContent = st.content || '';
        contentEl.classList.toggle('hidden', !st.content);

        imgEl.classList.add('hidden');
        vidEl.classList.add('hidden');
        vidEl.pause();

        if (st.media_type === 'image' && st.media_url) {
            imgEl.src = st.media_url;
            imgEl.classList.remove('hidden');
        } else if (st.media_type === 'video' && st.media_url) {
            vidEl.src = st.media_url;
            vidEl.classList.remove('hidden');
        }

        box.classList.remove('hidden');
    },

    // =========================================================================
    // GROUPEMENT VISUEL DES MESSAGES (STYLE WHATSAPP)
    // =========================================================================
    enhanceChatBubbleGrouping() {
        const list = document.getElementById('messages-list');
        if (!list) return;

        const observer = new MutationObserver(() => {
            const rows = Array.from(list.querySelectorAll('.message-row'));
            rows.forEach((row, idx) => {
                const prev = rows[idx - 1];
                const sameSenderAsPrev = prev &&
                    ((prev.classList.contains('sent') && row.classList.contains('sent')) ||
                     (prev.classList.contains('received') && row.classList.contains('received')));
                row.classList.toggle('grouped-prev', Boolean(sameSenderAsPrev));
            });
        });

        observer.observe(list, { childList: true });
    }
};