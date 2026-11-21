/**
 * GESTION DU PROFIL DE L'UTILISATEUR CONNECTÉ ET CONSULTATION DES PROFILS TIERS
 */

const ProfileModule = {
    currentUser: null,
    currentProfile: null,

    async loadCurrentProfile(user) {
        this.currentUser = user;

        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error) throw error;
        this.currentProfile = data;
        this.renderSidebarUser();
        return data;
    },

    renderSidebarUser() {
        if (!this.currentProfile) return;
        const nameEl = document.getElementById('sidebar-user-name');
        const userEl = document.getElementById('sidebar-user-username');
        const avatarImg = document.getElementById('sidebar-user-avatar');
        const initialsEl = document.getElementById('sidebar-user-initials');

        nameEl.textContent = this.currentProfile.full_name;
        userEl.textContent = `@${this.currentProfile.username}`;
        AppUtils.renderAvatar(avatarImg, initialsEl, this.currentProfile.avatar_url, this.currentProfile.full_name);
    },

    openEditModal() {
        if (!this.currentProfile) return;

        const alertBox = document.getElementById('profile-alert');
        alertBox.classList.add('hidden');

        document.getElementById('edit-fullname').value = this.currentProfile.full_name || '';
        document.getElementById('edit-username').value = this.currentProfile.username || '';
        document.getElementById('edit-bio').value = this.currentProfile.bio || '';
        document.getElementById('edit-email-readonly').value = this.currentUser.email || '';

        AppUtils.renderAvatar(
            document.getElementById('modal-profile-avatar'),
            document.getElementById('modal-profile-initials'),
            this.currentProfile.avatar_url,
            this.currentProfile.full_name
        );

        document.getElementById('modal-profile').classList.remove('hidden');
    },

    async handleAvatarUpload(file) {
        if (!file) return;

        const alertBox = document.getElementById('profile-alert');
        alertBox.classList.add('hidden');

        if (file.size > 2 * 1024 * 1024) {
            alertBox.textContent = "L'image est trop lourde (maximum 2 Mo).";
            alertBox.className = 'alert alert-error';
            alertBox.classList.remove('hidden');
            return;
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const filePath = `${this.currentUser.id}/avatar_${Date.now()}.${ext}`;

        try {
            const { error: uploadError } = await supabaseClient.storage
                .from('avatars')
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: publicData } = supabaseClient.storage
                .from('avatars')
                .getPublicUrl(filePath);

            const publicUrl = publicData.publicUrl;

            const { data: updatedProfile, error: updateError } = await supabaseClient
                .from('profiles')
                .update({ avatar_url: publicUrl })
                .eq('id', this.currentUser.id)
                .select()
                .single();

            if (updateError) throw updateError;

            this.currentProfile = updatedProfile;
            this.renderSidebarUser();
            AppUtils.renderAvatar(
                document.getElementById('modal-profile-avatar'),
                document.getElementById('modal-profile-initials'),
                updatedProfile.avatar_url,
                updatedProfile.full_name
            );

            alertBox.textContent = 'Photo de profil mise à jour.';
            alertBox.className = 'alert alert-success';
            alertBox.classList.remove('hidden');
        } catch (err) {
            alertBox.textContent = err.message || "Erreur lors de l'envoi de la photo.";
            alertBox.className = 'alert alert-error';
            alertBox.classList.remove('hidden');
        }
    },

    async saveProfileChanges(e) {
        e.preventDefault();
        const alertBox = document.getElementById('profile-alert');
        alertBox.classList.add('hidden');

        const fullName = document.getElementById('edit-fullname').value.trim();
        const username = document.getElementById('edit-username').value.trim().toLowerCase();
        const bio = document.getElementById('edit-bio').value.trim();
        const saveBtn = document.getElementById('btn-save-profile');

        if (fullName.length < 2) {
            alertBox.textContent = 'Le nom complet doit contenir au moins 2 caractères.';
            alertBox.className = 'alert alert-error';
            alertBox.classList.remove('hidden');
            return;
        }

        if (!/^[a-z0-9_]{3,24}$/.test(username)) {
            alertBox.textContent = "Format de nom d'utilisateur invalide (3-24 caractères, minuscules, chiffres, _).";
            alertBox.className = 'alert alert-error';
            alertBox.classList.remove('hidden');
            return;
        }

        saveBtn.disabled = true;

        try {
            if (username !== this.currentProfile.username) {
                const { data: available, error: checkError } = await supabaseClient.rpc('is_username_available', {
                    check_username: username
                });
                if (checkError) throw checkError;
                if (!available) {
                    throw new Error("Ce nom d'utilisateur est déjà pris.");
                }
            }

            const { data, error } = await supabaseClient
                .from('profiles')
                .update({
                    full_name: fullName,
                    username: username,
                    bio: bio
                })
                .eq('id', this.currentUser.id)
                .select()
                .single();

            if (error) throw error;

            this.currentProfile = data;
            this.renderSidebarUser();

            alertBox.textContent = 'Profil mis à jour avec succès.';
            alertBox.className = 'alert alert-success';
            alertBox.classList.remove('hidden');
        } catch (err) {
            alertBox.textContent = err.message || 'Impossible de mettre à jour le profil.';
            alertBox.className = 'alert alert-error';
            alertBox.classList.remove('hidden');
        } finally {
            saveBtn.disabled = false;
        }
    },

    openPeerProfileModal(peerProfile) {
        if (!peerProfile) return;

        AppUtils.renderAvatar(
            document.getElementById('view-peer-avatar'),
            document.getElementById('view-peer-initials'),
            peerProfile.avatar_url,
            peerProfile.full_name
        );

        const isOnline = PresenceModule.isOnline(peerProfile.id);
        const statusDot = document.getElementById('view-peer-status-dot');
        const statusBadge = document.getElementById('view-peer-status-badge');

        statusDot.className = `status-dot ${isOnline ? 'status-online' : 'status-offline'}`;
        statusBadge.textContent = isOnline ? 'En ligne' : AppUtils.formatLastSeen(peerProfile.last_seen);
        statusBadge.className = `status-badge ${isOnline ? 'online' : ''}`;

        document.getElementById('view-peer-fullname').textContent = peerProfile.full_name;
        document.getElementById('view-peer-username').textContent = `@${peerProfile.username}`;
        document.getElementById('view-peer-bio').textContent = peerProfile.bio || 'Aucune biographie renseignée.';
        document.getElementById('view-peer-joined').textContent = new Date(peerProfile.created_at).toLocaleDateString('fr-FR', {
            month: 'long',
            year: 'numeric'
        });

        document.getElementById('modal-peer-profile').classList.remove('hidden');
    }
};