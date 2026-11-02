// Groups page: browse, join, leave, and create groups.
(function () {
    const list = document.getElementById('group-list');
    const count = document.getElementById('group-count');
    const interestSelect = document.getElementById('group-interest');
    const dialog = document.getElementById('group-dialog');
    const form = document.getElementById('group-form');

    let view = 'all'; // 'all' | 'mine'

    HC.fillSelect(interestSelect, HC.INTERESTS);
    HC.fillSelect(document.getElementById('new-group-interest'), HC.INTERESTS);
    HC.fillSelect(document.getElementById('new-group-hood'), HC.NEIGHBORHOODS);

    const profileHood = HC.store.get().profile.neighborhood;
    if (profileHood) document.getElementById('new-group-hood').value = profileHood;

    document.getElementById('group-tabs').append(HC.chipGroup({
        options: [{ value: 'all', label: 'All groups' }, { value: 'mine', label: 'My groups' }],
        selected: ['all'],
        multiple: false,
        label: 'Which groups to show',
        onChange: ([selected]) => { view = selected; render(); }
    }));

    function toggleMembership(group) {
        let joined;
        HC.store.update(state => { joined = HC.toggleInList(state.joinedGroups, group.id); });
        HC.toast(joined ? `You joined ${group.name}.` : `You left ${group.name}.`);
        render();
    }

    function card(group) {
        const joined = HC.store.get().joinedGroups.includes(group.id);
        const members = group.members + (joined && !group.mine ? 1 : 0);
        const nextEvent = HC.upcomingEvents().find(event => event.groupId === group.id);

        return HC.el('article', { class: 'card group-card' },
            HC.el('div', { class: 'card-top' },
                HC.el('span', { class: 'tag', text: group.interest }),
                group.mine ? HC.el('span', { class: 'tag tag-shared', text: 'Created by you' }) : null
            ),
            HC.el('h2', { class: 'card-title', text: group.name }),
            HC.el('p', { class: 'muted small', text: `${group.neighborhood} · ${group.schedule}` }),
            HC.el('p', { text: group.description }),
            nextEvent ? HC.el('p', { class: 'small' },
                HC.el('strong', { text: 'Next: ' }),
                `${nextEvent.title}, ${HC.formatDay(nextEvent.start)}`
            ) : null,
            HC.el('div', { class: 'card-actions' },
                HC.el('span', { class: 'muted small', text: `${members} member${members === 1 ? '' : 's'}` }),
                HC.el('button', {
                    type: 'button',
                    class: joined ? 'btn btn-secondary is-on' : 'btn btn-primary',
                    'aria-pressed': String(joined),
                    'aria-label': `${joined ? 'Leave' : 'Join'} ${group.name}`,
                    text: joined ? 'Joined ✓' : 'Join',
                    onclick: () => toggleMembership(group)
                })
            )
        );
    }

    function render() {
        const { joinedGroups } = HC.store.get();
        const groups = HC.allGroups().filter(group =>
            (view === 'all' || joinedGroups.includes(group.id)) &&
            (!interestSelect.value || group.interest === interestSelect.value)
        );

        count.textContent = `${groups.length} group${groups.length === 1 ? '' : 's'}`;
        if (groups.length) {
            list.replaceChildren(...groups.map(card));
        } else if (view === 'mine') {
            list.replaceChildren(HC.emptyState('You haven\'t joined any groups yet', 'Groups are the easiest way to see the same faces every week.'));
        } else {
            list.replaceChildren(HC.emptyState('No groups for that activity yet', 'Be the first. Create one and invite other Hokies.'));
        }
    }

    document.getElementById('create-group-button').addEventListener('click', () => {
        form.reset();
        if (profileHood) document.getElementById('new-group-hood').value = profileHood;
        dialog.returnValue = '';
        dialog.showModal();
    });

    dialog.addEventListener('close', () => {
        if (dialog.returnValue !== 'create') return;
        const group = {
            id: `g-user-${Date.now()}`,
            name: document.getElementById('new-group-name').value.trim(),
            interest: document.getElementById('new-group-interest').value,
            neighborhood: document.getElementById('new-group-hood').value,
            schedule: document.getElementById('new-group-schedule').value.trim(),
            description: document.getElementById('new-group-description').value.trim(),
            members: 1,
            mine: true
        };
        HC.store.update(state => {
            state.createdGroups.push(group);
            state.joinedGroups.push(group.id);
        });
        HC.toast(`${group.name} is live. Invite some Hokies!`);
        render();
    });

    interestSelect.addEventListener('change', render);
    render();
})();
