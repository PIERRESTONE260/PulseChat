/**
 * GESTION DE L'AUTHENTIFICATION (login.html & register.html)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Rediriger automatiquement vers index.html si déjà connecté
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        window.location.replace('index.html');
        return;
    }

    // 2. Gestion de l'affichage / masquage des mots de passe
    document.querySelectorAll('.toggle-password').forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    const alertBox = document.getElementById('auth-alert');

    function showAlert(message, type = 'error') {
        if (!alertBox) return;
        alertBox.textContent = message;
        alertBox.className = `alert alert-${type}`;
        alertBox.classList.remove('hidden');
    }

    function setLoading(btn, isLoading) {
        if (!btn) return;
        btn.disabled = isLoading;
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.spinner');
        if (text) text.classList.toggle('hidden', isLoading);
        if (spinner) spinner.classList.toggle('hidden', !isLoading);
    }

    // =========================================================================
    // FORMULAIRE DE CONNEXION
    // =========================================================================
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            alertBox.classList.add('hidden');

            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            const submitBtn = document.getElementById('login-submit');

            if (!email || !password) {
                showAlert('Veuillez renseigner votre adresse e-mail et votre mot de passe.');
                return;
            }

            setLoading(submitBtn, true);

            try {
                const { error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                window.location.replace('index.html');
            } catch (err) {
                showAlert(AppUtils.translateAuthError(err), 'error');
                setLoading(submitBtn, false);
            }
        });
    }

    // =========================================================================
    // FORMULAIRE D'INSCRIPTION
    // =========================================================================
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        const usernameInput = document.getElementById('reg-username');
        const usernameFeedback = document.getElementById('username-feedback');
        let usernameCheckTimer = null;

        // Vérification en temps réel de la disponibilité du username
        usernameInput.addEventListener('input', () => {
            const val = usernameInput.value.trim().toLowerCase();
            usernameInput.value = val;

            clearTimeout(usernameCheckTimer);

            if (!val) {
                usernameFeedback.textContent = '3 à 24 caractères (lettres minuscules, chiffres, _).';
                usernameFeedback.className = 'field-hint';
                return;
            }

            if (!/^[a-z0-9_]{3,24}$/.test(val)) {
                usernameFeedback.textContent = 'Format invalide : utilisez 3 à 24 lettres minuscules, chiffres ou _.';
                usernameFeedback.className = 'field-hint invalid';
                return;
            }

            usernameFeedback.textContent = 'Vérification de la disponibilité...';
            usernameFeedback.className = 'field-hint';

            usernameCheckTimer = setTimeout(async () => {
                const { data: available, error } = await supabaseClient.rpc('is_username_available', {
                    check_username: val
                });

                if (!error) {
                    if (available) {
                        usernameFeedback.textContent = `@${val} est disponible.`;
                        usernameFeedback.className = 'field-hint valid';
                    } else {
                        usernameFeedback.textContent = `@${val} est déjà pris.`;
                        usernameFeedback.className = 'field-hint invalid';
                    }
                }
            }, 400);
        });

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            alertBox.classList.add('hidden');

            const fullName = document.getElementById('reg-fullname').value.trim();
            const username = usernameInput.value.trim().toLowerCase();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const confirmPassword = document.getElementById('reg-confirm-password').value;
            const submitBtn = document.getElementById('register-submit');

            // Validations côté client
            if (fullName.length < 2) {
                showAlert('Veuillez entrer votre nom complet (minimum 2 caractères).');
                return;
            }

            if (!/^[a-z0-9_]{3,24}$/.test(username)) {
                showAlert("Le nom d'utilisateur doit contenir entre 3 et 24 caractères (lettres minuscules, chiffres, _).");
                return;
            }

            if (!email || !email.includes('@')) {
                showAlert('Veuillez saisir une adresse e-mail valide.');
                return;
            }

            if (password.length < 6) {
                showAlert('Le mot de passe doit comporter au moins 6 caractères.');
                return;
            }

            if (password !== confirmPassword) {
                showAlert('Les deux mots de passe ne correspondent pas.');
                return;
            }

            setLoading(submitBtn, true);

            try {
                // Vérifier une dernière fois l'unicité du username en base
                const { data: available, error: rpcError } = await supabaseClient.rpc('is_username_available', {
                    check_username: username
                });

                if (rpcError) throw rpcError;
                if (!available) {
                    throw new Error("Ce nom d'utilisateur est déjà utilisé. Choisissez-en un autre.");
                }

                // Création du compte via Supabase Auth (le trigger SQL crée automatiquement le profil)
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                            username: username
                        }
                    }
                });

                if (error) throw error;

                if (data.session) {
                    showAlert('Compte créé avec succès ! Redirection...', 'success');
                    setTimeout(() => window.location.replace('index.html'), 700);
                } else {
                    showAlert('Inscription réussie ! Vérifiez votre boîte e-mail pour confirmer votre compte, puis connectez-vous.', 'success');
                    registerForm.reset();
                    setLoading(submitBtn, false);
                }
            } catch (err) {
                showAlert(AppUtils.translateAuthError(err), 'error');
                setLoading(submitBtn, false);
            }
        });
    }
});