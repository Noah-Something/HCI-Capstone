if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

const profileForm = document.getElementById('profileForm');
const profileFields = ['fullName', 'major', 'graduationDate', 'workplace', 'bio'];
const preview = {
  initials: document.getElementById('profileInitials'),
  photo: document.getElementById('profilePhotoPreview'),
  name: document.getElementById('previewName'),
  major: document.getElementById('previewMajor'),
  graduation: document.getElementById('previewGraduation'),
  workplace: document.getElementById('previewWorkplace'),
  bio: document.getElementById('previewBio'),
  interests: document.getElementById('previewInterests'),
};
const saveStatus = document.getElementById('saveStatus');
const photoInput = document.getElementById('profilePhoto');
const removePhotoButton = document.getElementById('removeProfilePhoto');
const editPhotoButton = document.getElementById('editProfilePhoto');
const interestSearch = document.getElementById('interestSearch');
const interestStatus = document.getElementById('interestStatus');
const interestEmpty = document.getElementById('interestEmpty');
const selectedInterestsList = document.getElementById('selectedInterests');
const interestOptions = Array.from(document.querySelectorAll('#interestOptions option'), (option) => option.value);
let selectedInterests = [];
const storageKey = 'hokieConnectProfile';
let profilePhotoData = '';
let profilePhotoPosition = { x: 50, y: 50 };

function displayValue(value, fallback = 'Not added yet') {
  return value.trim() || fallback;
}

function formatGraduationDate(value) {
  if (!value) return 'Not added yet';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function updatePreview() {
  const name = document.getElementById('fullName').value.trim();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('');

  preview.initials.textContent = initials.toUpperCase() || 'HC';
  preview.name.textContent = name || 'Your name';
  preview.major.textContent = displayValue(document.getElementById('major').value);
  preview.graduation.textContent = formatGraduationDate(document.getElementById('graduationDate').value);
  preview.workplace.textContent = displayValue(document.getElementById('workplace').value);
  preview.bio.textContent = displayValue(document.getElementById('bio').value, 'Your bio will appear here.');
  preview.interests.textContent = displayValue(selectedInterests.join(', '));
}

function renderInterests() {
  selectedInterestsList.replaceChildren();
  interestEmpty.hidden = selectedInterests.length > 0;

  for (const interest of selectedInterests) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const removeButton = document.createElement('button');

    item.className = 'interest-chip';
    label.textContent = interest;
    removeButton.type = 'button';
    removeButton.className = 'interest-remove';
    removeButton.textContent = '\u00d7';
    removeButton.setAttribute('aria-label', `Remove ${interest}`);
    removeButton.addEventListener('click', () => {
      selectedInterests = selectedInterests.filter((item) => item !== interest);
      renderInterests();
      updatePreview();
    });

    item.append(label, removeButton);
    selectedInterestsList.append(item);
  }
}

function addInterest() {
  const searchValue = interestSearch.value.trim();
  const interest = interestOptions.find((option) => option.toLowerCase() === searchValue.toLowerCase());

  if (!interest) {
    interestStatus.textContent = 'Choose an interest from the suggestions.';
    return;
  }
  if (selectedInterests.some((item) => item.toLowerCase() === interest.toLowerCase())) {
    interestStatus.textContent = 'That interest is already added.';
    return;
  }

  selectedInterests.push(interest);
  interestSearch.value = '';
  interestStatus.textContent = '';
  renderInterests();
  updatePreview();
}

function updatePhotoPreview(photoData, position = profilePhotoPosition) {
  profilePhotoData = photoData;
  profilePhotoPosition = position;
  preview.photo.src = photoData;
  preview.photo.style.objectPosition = `${profilePhotoPosition.x}% ${profilePhotoPosition.y}%`;
  preview.photo.hidden = !photoData;
  preview.initials.hidden = Boolean(photoData);
  removePhotoButton.hidden = !photoData;
  editPhotoButton.setAttribute('aria-label', photoData ? 'Edit profile photo' : 'Add profile photo');
  editPhotoButton.title = photoData ? 'Edit profile photo' : 'Add profile photo';
}

try {
  const savedProfile = JSON.parse(localStorage.getItem(storageKey) || '{}');
  for (const field of profileFields) {
    if (typeof savedProfile[field] === 'string') {
      document.getElementById(field).value = savedProfile[field];
    }
  }
  if (Array.isArray(savedProfile.interests)) {
    selectedInterests = savedProfile.interests.filter((interest) => typeof interest === 'string' && interest.trim()).map((interest) => interest.trim());
  } else if (typeof savedProfile.interests === 'string') {
    selectedInterests = savedProfile.interests.split(',').map((interest) => interest.trim()).filter(Boolean);
  }
  const savedPosition = savedProfile.profilePhotoPosition;
  if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)) {
    profilePhotoPosition = {
      x: Math.max(0, Math.min(100, savedPosition.x)),
      y: Math.max(0, Math.min(100, savedPosition.y)),
    };
  }
  if (typeof savedProfile.profilePhoto === 'string') {
    updatePhotoPreview(savedProfile.profilePhoto);
  }
} catch {
  saveStatus.textContent = 'Could not load the saved profile.';
}

renderInterests();
updatePreview();

profileForm.addEventListener('input', () => {
  saveStatus.textContent = '';
  updatePreview();
});

document.getElementById('addInterest').addEventListener('click', addInterest);
interestSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addInterest();
  }
});

editPhotoButton.addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    saveStatus.textContent = 'Choose an image file.';
    photoInput.value = '';
    return;
  }
  if (file.size > 1.5 * 1024 * 1024) {
    saveStatus.textContent = 'Choose an image smaller than 1.5 MB.';
    photoInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const image = new Image();
    image.onload = () => {
      updatePhotoPreview(reader.result, { x: 50, y: 50 });
      saveStatus.textContent = '';
    };
    image.onerror = () => {
      saveStatus.textContent = 'That image could not be opened.';
      photoInput.value = '';
    };
    image.src = reader.result;
  });
  reader.addEventListener('error', () => {
    saveStatus.textContent = 'Unable to read that image.';
  });
  reader.readAsDataURL(file);
});

preview.photo.addEventListener('pointerdown', (event) => {
  if (!profilePhotoData) return;
  event.preventDefault();
  preview.photo.setPointerCapture(event.pointerId);
  preview.photo.dataset.dragX = String(event.clientX);
  preview.photo.dataset.dragY = String(event.clientY);
  preview.photo.dataset.startX = String(profilePhotoPosition.x);
  preview.photo.dataset.startY = String(profilePhotoPosition.y);
});

preview.photo.addEventListener('pointermove', (event) => {
  if (!preview.photo.hasPointerCapture(event.pointerId)) return;
  const bounds = preview.photo.getBoundingClientRect();
  const deltaX = event.clientX - Number(preview.photo.dataset.dragX);
  const deltaY = event.clientY - Number(preview.photo.dataset.dragY);
  profilePhotoPosition = {
    x: Math.max(0, Math.min(100, Number(preview.photo.dataset.startX) - (deltaX / bounds.width) * 100)),
    y: Math.max(0, Math.min(100, Number(preview.photo.dataset.startY) - (deltaY / bounds.height) * 100)),
  };
  preview.photo.style.objectPosition = `${profilePhotoPosition.x}% ${profilePhotoPosition.y}%`;
  saveStatus.textContent = '';
});

removePhotoButton.addEventListener('click', () => {
  updatePhotoPreview('', { x: 50, y: 50 });
  photoInput.value = '';
  saveStatus.textContent = '';
});

profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = Object.fromEntries([...new FormData(profileForm).entries()].filter(([name]) => name !== 'profilePhotoFile'));
  profile.interests = selectedInterests;
  profile.profilePhoto = profilePhotoData;
  profile.profilePhotoPosition = profilePhotoPosition;

  try {
    localStorage.setItem(storageKey, JSON.stringify(profile));
    saveStatus.textContent = 'Profile saved on this device.';
  } catch {
    saveStatus.textContent = 'Unable to save the profile in this browser.';
  }
});