/**
 * CONFIGURATION SUPABASE
 * Remplacez SUPABASE_URL et SUPABASE_ANON_KEY par les identifiants publics de votre projet.
 * Où les trouver : Supabase Dashboard > Project Settings (icône engrenage) > API.
 * IMPORTANT : N'utilisez JAMAIS la clé "service_role" dans le code frontend.
 */

const SUPABASE_URL = 'https://yymvevbeqvgjzqsnpxge.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fs2WHjyGXdXGgWaMCQ2rHw_mcYKZj7g';

if (SUPABASE_URL.includes('VOTRE-PROJET') || SUPABASE_ANON_KEY.includes('VOTRE-CLE')) {
    console.warn('⚠️ PulseChat : Veuillez renseigner vos identifiants Supabase dans js/supabase-config.js');
}

// Initialisation du client global Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

/**
 * Utilitaires partagés dans toute l'application
 */
const AppUtils = {
    getInitials(fullName) {
        if (!fullName) return '?';
        const parts = fullName.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    renderAvatar(imgEl, initialsEl, avatarUrl, fullName) {
        if (!imgEl || !initialsEl) return;
        if (avatarUrl) {
            imgEl.src = avatarUrl;
            imgEl.classList.remove('hidden');
            initialsEl.classList.add('hidden');
            imgEl.onerror = () => {
                imgEl.classList.add('hidden');
                initialsEl.textContent = this.getInitials(fullName);
                initialsEl.classList.remove('hidden');
            };
        } else {
            imgEl.classList.add('hidden');
            initialsEl.textContent = this.getInitials(fullName);
            initialsEl.classList.remove('hidden');
        }
    },

    formatMessageTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    },

    formatConversationTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        }

        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Hier';
        }

        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    },

    formatLastSeen(isoString) {
        if (!isoString) return 'Hors ligne';
        const date = new Date(isoString);
        const now = new Date();
        const diffSec = Math.floor((now - date) / 1000);

        if (diffSec < 60) return 'Vu à l’instant';
        if (diffSec < 3600) return `Vu il y a ${Math.floor(diffSec / 60)} min`;
        if (date.toDateString() === now.toDateString()) {
            return `Vu aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        }
        return `Vu le ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    },

    formatDateDivider(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return "Aujourd'hui";

        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'Hier';

        return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    },

    translateAuthError(error) {
        const msg = (error?.message || '').toLowerCase();
        if (msg.includes('invalid login credentials')) return 'Adresse e-mail ou mot de passe incorrect.';
        if (msg.includes('user already registered')) return 'Cette adresse e-mail est déjà associée à un compte.';
        if (msg.includes('password should be at least')) return 'Le mot de passe doit contenir au moins 6 caractères.';
        if (msg.includes('email not confirmed')) return 'Veuillez confirmer votre adresse e-mail avant de vous connecter.';
        if (msg.includes('rate limit')) return 'Trop de tentatives. Veuillez patienter quelques instants.';
        if (msg.includes('network') || msg.includes('fetch')) return 'Erreur réseau. Vérifiez votre connexion Internet.';
        return error?.message || 'Une erreur inattendue est survenue.';
    }
};