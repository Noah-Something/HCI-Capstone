// Events page: upcoming events grouped by day, with RSVPs.
(function () {
    const list = document.getElementById('event-list');
    const count = document.getElementById('event-count');
    const categorySelect = document.getElementById('event-category');

    let view = 'all'; // 'all' | 'going'

    const categories = [...new Set(HC.EVENTS.map(event => event.category))].sort();
    HC.fillSelect(categorySelect, categories);

    document.getElementById('event-tabs').append(HC.chipGroup({
        options: [{ value: 'all', label: 'All events' }, { value: 'going', label: 'I\'m going' }],
        selected: ['all'],
        multiple: false,
        label: 'Which events to show',
        onChange: ([selected]) => { view = selected; render(); }
    }));

    function onRsvp(event) {
        HC.toggleRsvp(event);
        render();
    }

    function render() {
        const { rsvps } = HC.store.get();
        const events = HC.upcomingEvents().filter(event =>
            (view === 'all' || rsvps.includes(event.id)) &&
            (!categorySelect.value || event.category === categorySelect.value)
        );

        count.textContent = `${events.length} upcoming event${events.length === 1 ? '' : 's'}`;
        if (!events.length) {
            list.replaceChildren(view === 'going'
                ? HC.emptyState('No RSVPs yet', 'Pick something low-key to start. Most events welcome first-timers.')
                : HC.emptyState('Nothing scheduled for that activity', 'Check back soon, or start a group that hosts one.', { href: 'groups.html', label: 'Browse groups' }));
            return;
        }

        // Group events under a heading for each day.
        const days = new Map();
        for (const event of events) {
            const day = HC.formatDay(event.start);
            if (!days.has(day)) days.set(day, []);
            days.get(day).push(event);
        }

        list.replaceChildren(...[...days].map(([day, dayEvents]) =>
            HC.el('section', { class: 'day-group' },
                HC.el('h2', { class: 'day-heading', text: day }),
                HC.el('div', { class: 'stack' }, dayEvents.map(event => HC.eventItem(event, { onRsvp })))
            )
        ));
    }

    categorySelect.addEventListener('change', render);
    render();
})();
