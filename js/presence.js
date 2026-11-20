/**
 * GESTION DE LA PRÉSENCE TEMPS RÉEL (Supabase Realtime Presence + last_seen)
 */

const PresenceModule = {
    channel: null,
    onlineUserIds: new Set(),
    currentUserId: null,
    heartbeatInterval: null,

    async init(userId) {
        this.currentUserId = userId;
        await this.updateLastSeen();

        // Canal global de présence
        this.channel = supabaseClient.channel('global-online-users', {
            config: {
                presence: {
                    key: userId
                }
            }
        });

        this.channel
            .on('presence', { event: 'sync' }, () => {
                const state = this.channel.presenceState();
                this.onlineUserIds = new Set(Object.keys(state));
                this.notifyPresenceChanged();
            })
            .on('presence', { event: 'join' }, ({ key }) => {
                this.onlineUserIds.add(key);
                this.notifyPresenceChanged();
            })
            .on('presence', { event: 'leave' }, ({ key }) => {
                this.onlineUserIds.delete(key);
                this.notifyPresenceChanged();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await this.channel.track({
                        user_id: userId,
                        online_at: new Date().toISOString()
                    });
                }
            });

        // Mise à jour périodique de last_seen toutes les 60 secondes
        this.heartbeatInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.updateLastSeen();
            }
        }, 60000);

        // Mise à jour lors de la fermeture de l'onglet
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    },

    isOnline(userId) {
        return this.onlineUserIds.has(userId);
    },

    async updateLastSeen() {
        if (!this.currentUserId) return;
        await supabaseClient
            .from('profiles')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', this.currentUserId);
    },

    notifyPresenceChanged() {
        document.dispatchEvent(new CustomEvent('presence:updated', {
            detail: { onlineIds: this.onlineUserIds }
        }));
    },

    async cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        await this.updateLastSeen();
        if (this.channel) {
            await this.channel.untrack();
            await supabaseClient.removeChannel(this.channel);
            this.channel = null;
        }
    }
};