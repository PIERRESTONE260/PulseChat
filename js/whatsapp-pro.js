/**
 * MODULE WHATSAPP PRO V1 :
 * - Pays & numéro de téléphone au login pour comptes existants (sans blocage)
 * - Groupement visuel des messages type WhatsApp
 */

const WhatsAppPro = {
    currentUser: null,

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
        this.enhanceChatBubbleGrouping();

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
            if (typeof ProfileModule !== 'undefined') {
                ProfileModule.currentProfile = data;
            }
            alertEl.classList.add('hidden');
            modal.classList.add('hidden');
        });
    },

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