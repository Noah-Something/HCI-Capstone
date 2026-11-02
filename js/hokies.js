// Hokies page: browse and filter nearby Hokies, then send a first message.
(function () {
    const list = document.getElementById('hokie-list');
    const count = document.getElementById('hokie-count');
    const search = document.getElementById('hokie-search');
    const hood = document.getElementById('hokie-hood');
    const sharedOnly = document.getElementById('hokie-shared');
    const dialog = document.getElementById('hi-dialog');
    const message = document.getElementById('hi-message');

    const filters = { interests: [] };
    let messageTarget = null;

    HC.fillSelect(hood, HC.NEIGHBORHOODS);

    document.getElementById('interest-filter').append(HC.chipGroup({
        options: HC.INTERESTS,
        label: 'Filter by interest',
        onChange: selected => { filters.interests = selected; render(); }
    }));

    if (HC.store.get().profile.visibility === 'hidden') {
        document.getElementById('privacy-notice').append(HC.el('p', { class: 'notice' },
            'You\'re hidden from other Hokies. You can still browse, but nobody can find you. ',
            HC.el('a', { href: 'profile.html', text: 'Change this in your profile' }),
            '.'
        ));
    }

    function starterMessage(hokie, shared) {
        const opener = `Hi ${HC.firstName(hokie.name)}! Fellow Hokie here. I just moved to the D.C. area.`;
        if (shared.length) {
            return `${opener} I saw we're both into ${shared.slice(0, 2).join(' and ').toLowerCase()}. Want to meet up sometime?`;
        }
        return `${opener} Would you be up for grabbing coffee and swapping tips about the area?`;
    }

    function openMessage(hokie, shared) {
        messageTarget = hokie;
        document.getElementById('hi-title').textContent = `Say hi to ${HC.firstName(hokie.name)}`;
        message.value = starterMessage(hokie, shared);
        dialog.returnValue = ''; // so closing with Esc doesn't count as "send"
        dialog.showModal();
        message.focus();
    }

    dialog.addEventListener('close', () => {
        if (dialog.returnValue === 'send' && messageTarget) {
            const target = messageTarget;
            HC.store.update(state => { state.greetings[target.id] = message.value.trim(); });
            HC.toast(`Message sent to ${HC.firstName(target.name)}.`);
            render();
        }
        messageTarget = null;
    });

    function card({ hokie, shared }) {
        const sent = Boolean(HC.store.get().greetings[hokie.id]);
        return HC.el('article', { class: 'card person-card' },
            HC.el('div', { class: 'person-head' },
                HC.avatar(hokie.name, 'avatar-lg'),
                HC.el('div', {},
                    HC.el('h2', { class: 'card-title', text: hokie.name }),
                    HC.el('p', { class: 'muted small', text: `Class of ${hokie.gradYear} · ${hokie.major}` }),
                    HC.el('p', { class: 'small', text: `📍 ${hokie.neighborhood}` })
                )
            ),
            HC.el('p', { text: hokie.bio }),
            HC.interestTags(hokie.interests, shared),
            HC.el('div', { class: 'card-actions' },
                sent
                    ? HC.el('button', { type: 'button', class: 'btn btn-secondary', disabled: true, text: 'Message sent ✓' })
                    : HC.el('button', {
                        type: 'button',
                        class: 'btn btn-primary',
                        text: 'Say hi',
                        'aria-label': `Say hi to ${hokie.name}`,
                        onclick: () => openMessage(hokie, shared)
                    })
            )
        );
    }

    function render() {
        const query = search.value.trim().toLowerCase();
        const results = HC.rankHokies().filter(({ hokie, shared }) =>
            (!query || hokie.name.toLowerCase().includes(query) || hokie.major.toLowerCase().includes(query)) &&
            (!hood.value || hokie.neighborhood === hood.value) &&
            (!sharedOnly.checked || shared.length > 0) &&
            filters.interests.every(interest => hokie.interests.includes(interest))
        );

        count.textContent = `${results.length} Hokie${results.length === 1 ? '' : 's'} found`;
        list.replaceChildren(...(results.length
            ? results.map(card)
            : [HC.emptyState('No Hokies match those filters', 'Try removing a filter or picking a nearby neighborhood.')]));
    }

    search.addEventListener('input', render);
    hood.addEventListener('change', render);
    sharedOnly.addEventListener('change', render);
    render();
})();
