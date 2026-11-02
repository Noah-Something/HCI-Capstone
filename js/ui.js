// Shared helpers, page header/footer, and reusable components.
window.HC = window.HC || {};

/* ---------- DOM helper ---------- */

// Builds an element. Text is always set safely (never parsed as HTML).
HC.el = function (tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : String(child));
    }
    return node;
};

/* ---------- Page chrome ---------- */

HC.NAV = [
    { href: 'index.html', label: 'Home' },
    { href: 'hokies.html', label: 'Hokies' },
    { href: 'groups.html', label: 'Groups' },
    { href: 'events.html', label: 'Events' },
    { href: 'explore.html', label: 'Explore' },
    { href: 'profile.html', label: 'Profile' }
];

HC.renderChrome = function () {
    const current = location.pathname.split('/').pop() || 'index.html';

    const header = document.getElementById('site-header');
    if (header) {
        const links = HC.NAV.map(item => HC.el('li', {},
            HC.el('a', { href: item.href, 'aria-current': item.href === current ? 'page' : null, text: item.label })
        ));
        header.replaceChildren(
            HC.el('div', { class: 'header-inner' },
                HC.el('a', { href: 'index.html', class: 'brand' },
                    HC.el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: 'HC' }),
                    'HokieConnect'
                ),
                HC.el('nav', { 'aria-label': 'Main' }, HC.el('ul', {}, links))
            )
        );
    }

    const footer = document.getElementById('site-footer');
    if (footer) {
        footer.replaceChildren(HC.el('p', {},
            'HokieConnect prototype. Profiles, groups, and events are sample data, and your changes are saved only in this browser.'
        ));
    }

    // Live region for short confirmation messages.
    document.body.append(HC.el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }));
};

HC.toast = function (message) {
    const region = document.getElementById('toast');
    if (!region) return;
    region.textContent = message;
    region.classList.add('show');
    clearTimeout(HC.toastTimer);
    HC.toastTimer = setTimeout(() => region.classList.remove('show'), 3000);
};

/* ---------- Small utilities ---------- */

HC.toggleInList = function (list, value) {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else list.push(value);
    return index < 0; // true if the value was added
};

HC.firstName = name => name.split(' ')[0];

HC.fillSelect = function (select, values) {
    select.append(...values.map(value => HC.el('option', { value, text: value })));
};

/* ---------- Dates ---------- */

HC.eventStart = function (event) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + event.dayOffset);
    const [hours, minutes] = event.time.split(':').map(Number);
    date.setHours(hours, minutes);
    return date;
};

HC.formatDay = date => date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
HC.formatTime = date => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/* ---------- Data lookups ---------- */

HC.allGroups = () => [...HC.GROUPS, ...HC.store.get().createdGroups];
HC.findGroup = id => HC.allGroups().find(group => group.id === id);

HC.upcomingEvents = () => HC.EVENTS
    .map(event => ({ ...event, start: HC.eventStart(event) }))
    .sort((a, b) => a.start - b.start);

HC.sharedInterests = function (hokie) {
    const mine = new Set(HC.store.get().profile.interests);
    return hokie.interests.filter(interest => mine.has(interest));
};

// Ranks Hokies by shared interests, then by living in the same neighborhood.
HC.rankHokies = function () {
    const { profile } = HC.store.get();
    return HC.HOKIES
        .map(hokie => {
            const shared = HC.sharedInterests(hokie);
            const sameArea = profile.neighborhood && hokie.neighborhood === profile.neighborhood;
            return { hokie, shared, score: shared.length * 2 + (sameArea ? 1 : 0) };
        })
        .sort((a, b) => b.score - a.score || a.hokie.name.localeCompare(b.hokie.name));
};

// The steps from "just arrived" to "belonging", used on the home page.
HC.journey = function () {
    const state = HC.store.get();
    return [
        { label: 'Set up your profile', detail: 'Add your name and a few interests.', href: 'profile.html',
          done: Boolean(state.profile.name && state.profile.interests.length) },
        { label: 'Say hi to a Hokie', detail: 'Reach out to someone nearby.', href: 'hokies.html',
          done: Object.keys(state.greetings).length > 0 },
        { label: 'Join a group', detail: 'Find a recurring activity you enjoy.', href: 'groups.html',
          done: state.joinedGroups.length > 0 },
        { label: 'Go to an event', detail: 'RSVP and show up in person.', href: 'events.html',
          done: state.rsvps.length > 0 }
    ];
};

/* ---------- Components ---------- */

const AVATAR_COLORS = ['#861F41', '#C64600', '#2F6F73', '#5B4A8B', '#3B6E3B', '#8A5A00'];

HC.avatar = function (name, size = '') {
    const initials = name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const hash = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return HC.el('span', {
        class: `avatar ${size}`.trim(),
        style: `--avatar: ${AVATAR_COLORS[hash % AVATAR_COLORS.length]}`,
        'aria-hidden': 'true',
        text: initials
    });
};

HC.interestTags = function (interests, shared = []) {
    return HC.el('ul', { class: 'tags', 'aria-label': 'Interests' },
        interests.map(interest => {
            const isShared = shared.includes(interest);
            return HC.el('li', { class: isShared ? 'tag tag-shared' : 'tag' },
                interest,
                isShared ? HC.el('span', { class: 'visually-hidden', text: ' (shared interest)' }) : null
            );
        })
    );
};

// Toggle buttons for filters. Calls onChange with the selected values.
HC.chipGroup = function ({ options, selected = [], multiple = true, label, onChange }) {
    const chosen = new Set(selected);
    const group = HC.el('div', { class: 'chip-group', role: 'group', 'aria-label': label });
    const buttons = options.map(option => {
        const value = typeof option === 'string' ? option : option.value;
        const text = typeof option === 'string' ? option : option.label;
        const button = HC.el('button', { type: 'button', class: 'chip', 'aria-pressed': String(chosen.has(value)), text });
        button.addEventListener('click', () => {
            if (multiple) {
                if (chosen.has(value)) chosen.delete(value);
                else chosen.add(value);
            } else {
                chosen.clear();
                chosen.add(value);
            }
            buttons.forEach(item => item.button.setAttribute('aria-pressed', String(chosen.has(item.value))));
            onChange([...chosen]);
        });
        return { button, value };
    });
    group.append(...buttons.map(item => item.button));
    return group;
};

HC.dateBadge = function (date) {
    return HC.el('div', { class: 'date-badge', 'aria-hidden': 'true' },
        HC.el('span', { class: 'date-month', text: date.toLocaleDateString('en-US', { month: 'short' }) }),
        HC.el('span', { class: 'date-day', text: String(date.getDate()) })
    );
};

// One event in a list. Pass onRsvp to show the RSVP button.
HC.eventItem = function (event, { onRsvp } = {}) {
    const going = HC.store.get().rsvps.includes(event.id);
    const group = event.groupId ? HC.findGroup(event.groupId) : null;
    const count = event.going + (going ? 1 : 0);

    return HC.el('article', { class: 'event-item' },
        HC.dateBadge(event.start),
        HC.el('div', { class: 'event-body' },
            HC.el('p', { class: 'event-category', text: event.category }),
            HC.el('h3', { text: event.title }),
            HC.el('p', { class: 'muted', text: `${HC.formatDay(event.start)}, ${HC.formatTime(event.start)} · ${event.place}, ${event.neighborhood}` }),
            HC.el('p', { class: 'muted small' },
                group ? `Hosted by ${group.name} · ` : 'Hosted by HokieConnect · ',
                `${count} Hokie${count === 1 ? '' : 's'} going`
            )
        ),
        onRsvp ? HC.el('button', {
            type: 'button',
            class: going ? 'btn btn-secondary is-on' : 'btn btn-primary',
            'aria-pressed': String(going),
            'aria-label': `${going ? 'Cancel RSVP for' : 'RSVP to'} ${event.title}`,
            text: going ? 'Going ✓' : 'I\'m going',
            onclick: () => onRsvp(event)
        }) : null
    );
};

// Shared RSVP handler: toggles the RSVP and shows a confirmation.
HC.toggleRsvp = function (event) {
    let added;
    HC.store.update(state => { added = HC.toggleInList(state.rsvps, event.id); });
    HC.toast(added ? `You're going to ${event.title}.` : `RSVP canceled for ${event.title}.`);
};

HC.emptyState = function (title, text, link) {
    return HC.el('div', { class: 'empty-state' },
        HC.el('p', { class: 'empty-title', text: title }),
        HC.el('p', { class: 'muted', text }),
        link ? HC.el('a', { class: 'btn btn-secondary', href: link.href, text: link.label }) : null
    );
};

HC.renderChrome();
