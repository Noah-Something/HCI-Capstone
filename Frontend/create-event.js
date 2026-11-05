// ===== HokieConnect – Create event page code =====
// Uses loadEventOptions, createEvent, uploadEventImage, resizeImage, createMap and escapeEventHtml from events.js

if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

const createStatus = document.getElementById('createStatus');
let maxTags = 5;
let selectedTags = [];
let pickedPoint = null;   // { latitude, longitude } once a pin is placed
let imageBlob = null;     // the resized image, uploaded after the event is created

function setStatus(message, color) {
  createStatus.textContent = message;
  createStatus.style.color = color || '';
}

// ===== Start time: can't pick a time in the past =====
// datetime-local wants "YYYY-MM-DDTHH:MM" in local time
function toLocalInputValue(date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
const startsAtInput = document.getElementById('startsAt');
const endsAtInput = document.getElementById('endsAt');
startsAtInput.min = toLocalInputValue(new Date());
startsAtInput.addEventListener('change', () => {
  endsAtInput.min = startsAtInput.value;
});

// ===== Map pin =====
const pickerMapReady = createMap('pickerMap', { picker: true });

// Saves the point and moves the pin there (dragging the pin calls this again with the new spot)
async function placePin(latitude, longitude) {
  // Rounded to about 10 meters, more than enough to find an event
  pickedPoint = {
    latitude: Math.round(latitude * 10000) / 10000,
    longitude: Math.round(longitude * 10000) / 10000
  };
  (await pickerMapReady).setDraggablePin([latitude, longitude], placePin);
  document.getElementById('coordinates').textContent =
    `Pin placed at ${pickedPoint.latitude}, ${pickedPoint.longitude}`;
}

pickerMapReady
  .then((map) => map.onClick(placePin))
  .catch(() => setStatus('The map could not load. Please refresh the page.', 'red'));

document.getElementById('useLocationButton').addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Your browser does not support location. Click the map instead.', 'red');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      await placePin(position.coords.latitude, position.coords.longitude);
      (await pickerMapReady).setView([position.coords.latitude, position.coords.longitude], 16);
    },
    () => setStatus('Could not get your location. Click the map to place the pin instead.', 'red'),
    { timeout: 10000 }
  );
});

// ===== Tags =====
const tagInput = document.getElementById('tagInput');

// Same rules as the server: lowercase, letters, numbers, spaces, & ' and -
function cleanTag(text) {
  const cleaned = text.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
  return /^[a-z0-9][a-z0-9 &'-]{0,24}$/.test(cleaned) ? cleaned : null;
}

function showSelectedTags() {
  document.getElementById('selectedTags').innerHTML = selectedTags.map((tag) =>
    `<button type="button" class="chip chip-shared tag-remove" data-tag="${escapeEventHtml(tag)}"
             title="Remove tag">#${escapeEventHtml(tag)} ✕</button>`).join('');
  tagInput.disabled = selectedTags.length >= maxTags;
  tagInput.placeholder = tagInput.disabled ? `You can add up to ${maxTags} tags` : 'trail running';
}

function addTag(text) {
  const tag = cleanTag(text);
  if (!tag) {
    setStatus('Tags can use letters, numbers, spaces, & \' and - (up to 25 characters).', 'red');
    return;
  }
  if (!selectedTags.includes(tag) && selectedTags.length < maxTags) {
    selectedTags.push(tag);
    setStatus('');
  }
  showSelectedTags();
}

tagInput.addEventListener('keydown', (event) => {
  // Enter or comma adds the tag instead of submitting the form
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    if (tagInput.value.trim()) addTag(tagInput.value);
    tagInput.value = '';
  }
});

document.getElementById('selectedTags').addEventListener('click', (event) => {
  const button = event.target.closest('.tag-remove');
  if (!button) return;
  selectedTags = selectedTags.filter((tag) => tag !== button.dataset.tag);
  showSelectedTags();
});

document.getElementById('tagSuggestionChips').addEventListener('click', (event) => {
  const chip = event.target.closest('.filter');
  if (chip) addTag(chip.dataset.tag);
});

// ===== Host: myself or a group =====
document.querySelectorAll('input[name="host"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const asGroup = document.getElementById('hostGroupRadio').checked;
    const hasGroups = document.getElementById('groupSelect').options.length > 0;
    document.getElementById('groupSelect').hidden = !asGroup || !hasGroups;
    document.getElementById('groupNote').hidden = !asGroup || hasGroups;
  });
});

// ===== Image =====
const imageInput = document.getElementById('imageInput');

imageInput.addEventListener('change', async () => {
  const file = imageInput.files[0];
  if (!file) return;
  imageBlob = await resizeImage(file);
  if (!imageBlob) {
    setStatus('That file could not be read as an image.', 'red');
    imageInput.value = '';
    return;
  }
  document.getElementById('imagePreview').src = URL.createObjectURL(imageBlob);
  document.getElementById('imagePreviewBox').hidden = false;
  setStatus('');
});

document.getElementById('removeImageButton').addEventListener('click', () => {
  imageBlob = null;
  imageInput.value = '';
  document.getElementById('imagePreviewBox').hidden = true;
});

// ===== Submit =====
document.getElementById('eventForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  // A tag still sitting in the box counts too
  if (tagInput.value.trim()) {
    addTag(tagInput.value);
    tagInput.value = '';
  }
  if (!pickedPoint) {
    setStatus('Please click the map to show where the event is.', 'red');
    document.getElementById('pickerMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const asGroup = document.getElementById('hostGroupRadio').checked;
  const groupSelect = document.getElementById('groupSelect');
  if (asGroup && groupSelect.options.length === 0) {
    setStatus('You are not an admin of any groups yet, so host it as yourself for now.', 'red');
    return;
  }

  const details = {
    title: document.getElementById('title').value.trim(),
    category: document.getElementById('category').value,
    startsAt: new Date(startsAtInput.value).toISOString(),
    endsAt: endsAtInput.value ? new Date(endsAtInput.value).toISOString() : null,
    location: document.getElementById('location').value.trim(),
    latitude: pickedPoint.latitude,
    longitude: pickedPoint.longitude,
    description: document.getElementById('description').value.trim(),
    newcomerTip: document.getElementById('newcomerTip').value.trim(),
    tags: selectedTags,
    groupId: asGroup ? Number(groupSelect.value) : null
  };

  const createButton = document.getElementById('createButton');
  createButton.disabled = true;
  setStatus('Creating event ...');

  const result = await createEvent(details);
  if (!result.ok) {
    setStatus(result.message || 'Could not create the event.', 'red');
    createButton.disabled = false;
    return;
  }

  // The event exists now, so a failed image upload should not lose it
  if (imageBlob) {
    setStatus('Uploading image ...');
    const upload = await uploadEventImage(result.id, imageBlob);
    if (!upload.ok) {
      alert(`Your event was created, but the image could not be uploaded: ${upload.message || 'unknown error'}`);
    }
  }
  window.location.href = `event.html?id=${result.id}`;
});

// ===== Load choices =====
async function setUpForm() {
  const options = await loadEventOptions();
  maxTags = options.maxTags;
  document.getElementById('maxTags').textContent = maxTags;

  for (const category of options.categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    document.getElementById('category').appendChild(option);
  }
  for (const group of options.hostableGroups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    document.getElementById('groupSelect').appendChild(option);
  }
  for (const tag of new Set([...options.popularTags, ...options.suggestedTags])) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter';
    chip.dataset.tag = tag;
    chip.textContent = `#${tag}`;
    document.getElementById('tagSuggestionChips').appendChild(chip);
  }
}

setUpForm();
