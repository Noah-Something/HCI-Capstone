// Home page: welcome, journey progress, top matches, and upcoming events.
(function () {
    const { profile } = HC.store.get();

    if (profile.name) {
        document.getElementById('welcome').textContent = `Welcome to D.C., ${HC.firstName(profile.name)}`;
    }

    /* Journey */
    const steps = HC.journey();
    const done = steps.filter(step => step.done).length;
    document.getElementById('journey-count').textContent = `${done} of ${steps.length} done`;
    document.getElementById('journey-bar').style.width = `${(done / steps.length) * 100}%`;
    const progress = document.getElementById('journey-progress');
    progress.setAttribute('aria-valuenow', String(done));
    progress.setAttribute('aria-valuetext', `${done} of ${steps.length} steps done`);

    document.getElementById('journey-steps').replaceChildren(...steps.map(step =>
        HC.el('li', { class: step.done ? 'journey-step done' : 'journey-step' },
            HC.el('span', { class: 'journey-check', 'aria-hidden': 'true', text: step.done ? '✓' : '' }),
            HC.el('div', {},
                HC.el('a', { href: step.href, text: step.label }),
                HC.el('span', { class: 'visually-hidden', text: step.done ? ' (done)' : ' (to do)' }),
                HC.el('p', { class: 'muted small', text: step.detail })
            )
        )
    ));

    /* Top matches */
    const matches = document.getElementById('home-matches');
    if (!profile.interests.length) {
        matches.append(HC.el('p', { class: 'muted small' },
            'Add interests to your ',
            HC.el('a', { href: 'profile.html', text: 'profile' }),
            ' to see who you have the most in common with.'
        ));
    }
    matches.append(...HC.rankHokies().slice(0, 3).map(({ hokie, shared }) =>
        HC.el('article', { class: 'person-row' },
            HC.avatar(hokie.name),
            HC.el('div', {},
                HC.el('h3', { text: hokie.name }),
                HC.el('p', { class: 'muted small', text: `Class of ${hokie.gradYear} · ${hokie.neighborhood}` }),
                HC.interestTags(hokie.interests, shared)
            )
        )
    ));

    /* Upcoming events */
    document.getElementById('home-events').replaceChildren(
        ...HC.upcomingEvents().slice(0, 3).map(event => HC.eventItem(event))
    );
})();
