// Saves the user's profile and activity in the browser (localStorage).
// This stands in for the backend until there is one.
window.HC = window.HC || {};

(function () {
    const KEY = 'hokieconnect:v1';

    const defaults = () => ({
        profile: {
            name: '',
            gradYear: '2026',
            major: '',
            neighborhood: '',
            interests: [],
            bio: '',
            visibility: 'hokies',     // 'hokies' | 'connections' | 'hidden'
            showNeighborhood: true
        },
        greetings: {},                // hokieId -> message sent
        joinedGroups: [],
        createdGroups: [],
        rsvps: []
    });

    function load() {
        const base = defaults();
        try {
            const saved = JSON.parse(localStorage.getItem(KEY));
            if (saved) {
                return { ...base, ...saved, profile: { ...base.profile, ...saved.profile } };
            }
        } catch (error) {
            // Storage blocked or corrupted: start fresh.
        }
        return base;
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
        } catch (error) {
            // Storage blocked: changes last until the page is closed.
        }
    }

    let state = load();

    HC.store = {
        get: () => state,
        update(change) {
            change(state);
            save();
        },
        reset() {
            state = defaults();
            save();
        }
    };
})();
