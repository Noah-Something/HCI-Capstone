// ===== HokieConnect – shared chat code (used by messages.html and group.html) =====
// Photos in messages, and the animations for sending and receiving messages.
//   ChatMedia.setUpComposer(...)  adds the photo button, preview, paste and drag-and-drop to a message form
//   ChatMedia.photoHtml(image)    the HTML for a photo in a message
//   ChatMedia.loadPhotos(list)    fills in the photos (they are private, so they are loaded with the login token)
//   ChatMedia.addPending(...)     shows a message straight away while it is still sending
//   ChatMedia.animateNew(...)     slides in messages that arrived since the last redraw
const ChatMedia = (() => {
  // Photos are shrunk in the browser before sending, so they upload quickly and fit the server's 2 MB limit
  const MAX_PHOTO_SIDE = 1600;
  const PHOTO_QUALITY = 0.85;
  // Largest a photo shows in the chat (click it to see it full size)
  const SHOWN_MAX_WIDTH = 260;
  const SHOWN_MAX_HEIGHT = 300;

  const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  // ===== Preparing a photo to send =====
  // Returns {data: 'data:image/jpeg;base64,...', width, height}, or null if the file is not an image
  function preparePhoto(file) {
    return new Promise((resolve) => {
      if (!file || !file.type.startsWith('image/')) return resolve(null);
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        // JPEG has no see-through parts, so transparent PNGs get a white background instead of black
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(image.src);
        resolve({ data: canvas.toDataURL('image/jpeg', PHOTO_QUALITY), width: canvas.width, height: canvas.height });
      };
      image.onerror = () => { URL.revokeObjectURL(image.src); resolve(null); };
      image.src = URL.createObjectURL(file);
    });
  }

  // ===== Message form: photo button, preview, paste and drop =====
  // Adds a 📷 button to the form. onError(message) is called for files that are not images.
  // Returns { getPhoto(), clear() }
  function setUpComposer({ form, textarea, onError }) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif,image/heic';
    input.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn attach-button';
    button.title = 'Add a photo';
    button.setAttribute('aria-label', 'Add a photo');
    button.textContent = '📷';

    const preview = document.createElement('div');
    preview.className = 'composer-preview';
    preview.hidden = true;

    form.prepend(button);
    form.append(input);
    form.before(preview);

    let photo = null;

    const show = () => {
      preview.hidden = !photo;
      preview.innerHTML = photo
        ? `<div class="composer-photo">
             <img src="${photo.data}" alt="Photo to send">
             <button type="button" class="composer-remove" aria-label="Remove photo">×</button>
           </div>
           <span class="gray composer-hint">Add a caption, or send the photo on its own</span>`
        : '';
      // A photo on its own is enough to send, so the text box is no longer required
      textarea.required = !photo;
    };

    const use = async (file) => {
      button.disabled = true;
      const prepared = await preparePhoto(file);
      button.disabled = false;
      if (!prepared) {
        onError?.('That file is not a photo this browser can open. Try a JPEG or PNG.');
        return;
      }
      photo = prepared;
      show();
      textarea.focus();
    };

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files[0]) use(input.files[0]);
      input.value = '';
    });
    preview.addEventListener('click', (click) => {
      if (click.target.closest('.composer-remove')) { photo = null; show(); textarea.focus(); }
    });

    // Paste a copied image or screenshot straight into the message box
    textarea.addEventListener('paste', (paste) => {
      const file = [...(paste.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
      if (file) { paste.preventDefault(); use(file); }
    });

    // Drag a photo onto the message form
    form.addEventListener('dragover', (drag) => {
      if ([...drag.dataTransfer.items].some((item) => item.kind === 'file')) {
        drag.preventDefault();
        form.classList.add('drop-target');
      }
    });
    form.addEventListener('dragleave', () => form.classList.remove('drop-target'));
    form.addEventListener('drop', (drop) => {
      form.classList.remove('drop-target');
      const file = [...drop.dataTransfer.files].find((item) => item.type.startsWith('image/'));
      if (file) { drop.preventDefault(); use(file); }
    });

    return {
      getPhoto: () => photo,
      clear: () => { photo = null; show(); }
    };
  }

  // ===== Showing photos =====
  // The space for the photo is the right shape before it loads, so the chat does not jump
  function shownSize(width, height) {
    const scale = Math.min(1, SHOWN_MAX_WIDTH / width, SHOWN_MAX_HEIGHT / height);
    return { width: Math.max(80, Math.round(width * scale)), height: Math.max(60, Math.round(height * scale)) };
  }

  // image: {url, width, height} from the server. src is set right away only for a photo still being sent
  function photoHtml(image, src = '') {
    const size = shownSize(image.width, image.height);
    return `
      <button type="button" class="chat-photo" style="width:${size.width}px;aspect-ratio:${image.width} / ${image.height}"
              aria-label="Open photo full size" ${image.url ? `data-photo-url="${escapeHtml(image.url)}"` : ''}>
        <img alt="Photo" ${src ? `src="${src}" class="loaded"` : ''}>
      </button>`;
  }

  // Loaded photos, by address, so redrawing the chat every few seconds does not download them again
  const loadedPhotos = new Map();

  function fetchPhoto(url) {
    if (!loadedPhotos.has(url)) {
      loadedPhotos.set(url, fetch(url, { headers: { Authorization: `Bearer ${sessionStorage.getItem('authToken')}` } })
        .then((response) => {
          if (!response.ok) throw new Error('Photo not available');
          return response.blob();
        })
        .then((blob) => URL.createObjectURL(blob))
        .catch((error) => {
          loadedPhotos.delete(url); // try again on the next redraw
          throw error;
        }));
    }
    return loadedPhotos.get(url);
  }

  function loadPhotos(container) {
    for (const holder of container.querySelectorAll('.chat-photo[data-photo-url]')) {
      const image = holder.querySelector('img');
      if (image.getAttribute('src')) continue;
      fetchPhoto(holder.dataset.photoUrl)
        .then((src) => {
          image.addEventListener('load', () => image.classList.add('loaded'), { once: true });
          image.addEventListener('error', () => holder.classList.add('photo-missing'), { once: true });
          image.src = src;
        })
        .catch(() => holder.classList.add('photo-missing'));
    }
  }

  // ===== Full size viewer =====
  let viewer = null;
  function openViewer(src) {
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.className = 'photo-viewer';
      viewer.innerHTML = '<img alt="Photo, full size"><button type="button" class="photo-viewer-close" aria-label="Close">×</button>';
      // Clicking anywhere closes it
      viewer.addEventListener('click', () => viewer.close());
      document.body.appendChild(viewer);
    }
    viewer.querySelector('img').src = src;
    viewer.showModal();
  }

  document.addEventListener('click', (click) => {
    const photo = click.target.closest('.chat-photo');
    const src = photo?.querySelector('img.loaded')?.src;
    if (src) openViewer(src);
  });

  // ===== Sending animation =====
  // Messages still sending, so they can be put back after the list is redrawn by the next check for messages
  const pending = new Set();

  // Shows a message right away, before the server has it. Returns the element for markSent/markFailed.
  // chatKey says which conversation it belongs to, so it is not put back into a different one
  function addPending(list, { body, photo, chatKey = '' }) {
    list.querySelector('.thread-start')?.remove();
    const element = document.createElement('div');
    element.className = 'message mine pending message-sending';
    element.dataset.chatKey = chatKey;
    element.innerHTML = `
      ${photo ? photoHtml({ width: photo.width, height: photo.height }, photo.data) : ''}
      ${body ? `<div class="bubble">${escapeHtml(body)}</div>` : ''}
      <span class="message-time">Sending…</span>`;
    list.appendChild(element);
    pending.add(element);
    list.scrollTop = list.scrollHeight;
    return element;
  }

  // The server has it: the next redraw replaces this with the real message
  function markSent(element) {
    pending.delete(element);
    element.classList.remove('pending');
    element.querySelector('.message-time').textContent = 'Sent';
  }

  // Shake it, say why, and offer to try again
  function markFailed(element, reason, onRetry) {
    element.classList.remove('pending', 'message-sending');
    element.classList.add('failed');
    const time = element.querySelector('.message-time');
    time.innerHTML = `${escapeHtml(reason || 'Not sent')} · <button type="button" class="link-button retry-send">Try again</button>
                      · <button type="button" class="link-button discard-send">Remove</button>`;
    time.querySelector('.retry-send').addEventListener('click', () => {
      pending.delete(element);
      element.remove();
      onRetry();
    });
    time.querySelector('.discard-send').addEventListener('click', () => {
      pending.delete(element);
      element.remove();
    });
  }

  // After the list is redrawn, put back messages that are still sending (or failed) at the bottom
  function keepPending(list, chatKey = '') {
    for (const element of pending) {
      if (element.dataset.chatKey === chatKey) list.appendChild(element);
    }
  }

  // Gives messages that were not in the last drawing an arrival animation.
  // seen is a Set of message ids kept by the page (start a new one when opening a different chat);
  // the first drawing never animates, so opening a chat does not replay its whole history
  function animateNew(list, seen) {
    const firstDrawing = !seen.has('drawn');
    seen.add('drawn');
    for (const element of list.querySelectorAll('.message[data-message-id]')) {
      const id = element.dataset.messageId;
      if (!firstDrawing && !seen.has(id)) element.classList.add('message-new');
      seen.add(id);
    }
  }

  // A little bounce on the send button
  function popButton(button) {
    button.classList.remove('send-pop');
    void button.offsetWidth; // restart the animation if it is already running
    button.classList.add('send-pop');
  }

  return { setUpComposer, photoHtml, loadPhotos, addPending, markSent, markFailed, keepPending, animateNew, popButton };
})();
