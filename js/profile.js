// Profile page: edit profile details, interests, and privacy settings.
(function () {
    const form = document.getElementById('profile-form');
    const nameInput = document.getElementById('profile-name');
    const nameError = document.getElementById('name-error');
    const yearSelect = document.getElementById('profile-year');
    const majorInput = document.getElementById('profile-major');
    const hoodSelect = document.getElementById('profile-hood');
    const bioInput = document.getElementById('profile-bio');
    const showHood = document.getElementById('profile-show-hood');
    const interestBox = document.getElementById('profile-interests');

    const thisYear = new Date().getFullYear();
    const years = [];
    for (let year = thisYear + 1; year >= thisYear - 15; year--) years.push(String(year));
    HC.fillSelect(yearSelect, years);
    HC.fillSelect(hoodSelect, HC.NEIGHBORHOODS);

    interestBox.append(...HC.INTERESTS.map(interest =>
        HC.el('label', { class: 'chip-check' },
            HC.el('input', { type: 'checkbox', name: 'interests', value: interest }),
            HC.el('span', { text: interest })
        )
    ));

    function fill() {
        const { profile } = HC.store.get();
        nameInput.value = profile.name;
        yearSelect.value = profile.gradYear;
        majorInput.value = profile.major;
        hoodSelect.value = profile.neighborhood;
        bioInput.value = profile.bio;
        showHood.checked = profile.showNeighborhood;
        form.querySelectorAll('input[name="interests"]').forEach(box => {
            box.checked = profile.interests.includes(box.value);
        });
        form.querySelectorAll('input[name="visibility"]').forEach(radio => {
            radio.checked = radio.value === profile.visibility;
        });
    }

    form.addEventListener('submit', event => {
        event.preventDefault();

        const name = nameInput.value.trim();
        if (!name) {
            nameError.textContent = 'Please add your name so Hokies know who they\'re talking to.';
            nameInput.setAttribute('aria-invalid', 'true');
            nameInput.focus();
            return;
        }
        nameError.textContent = '';
        nameInput.removeAttribute('aria-invalid');

        HC.store.update(state => {
            state.profile = {
                name,
                gradYear: yearSelect.value,
                major: majorInput.value.trim(),
                neighborhood: hoodSelect.value,
                bio: bioInput.value.trim(),
                interests: [...form.querySelectorAll('input[name="interests"]:checked')].map(box => box.value),
                visibility: form.querySelector('input[name="visibility"]:checked').value,
                showNeighborhood: showHood.checked
            };
        });
        HC.toast('Profile saved.');
    });

    document.getElementById('reset-button').addEventListener('click', () => {
        if (!confirm('Reset all demo data in this browser?')) return;
        HC.store.reset();
        fill();
        HC.toast('Demo data cleared.');
    });

    fill();
})();
