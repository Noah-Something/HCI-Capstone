// ===== HokieConnect – page animations (loaded in <head> on every page) =====
// No animation library: JavaScript only adds classes and timing variables, and styles.css does the moving
// (see "Animations" at the end of styles.css). Everything is skipped for people who turn on "reduce motion".
//
//   1. Cards fade and slide up as they scroll into view (IntersectionObserver adds .visible).
//      Cards that arrive together (a list of events, Hokies or groups) come in one after another.
//   2. Page titles come in word by word.
//   3. A thin bar along the top shows how far down the page you are.
//   4. Pages fade in, and fade out quickly when you follow a link to another page.
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // styles.css only hides things that are about to animate while this class is on,
  // so if this script never runs every page still shows everything
  document.documentElement.classList.add('motion');

  // ===== 1. Reveal cards as they scroll into view =====
  // Cards are often added later by page scripts (event lists, search results), so new ones are watched too
  const REVEAL_SELECTOR = '.card, .group-event, .attendee';
  // Lists that redraw while you read them (chat, conversation list) would flicker, so they never animate
  const NO_MOTION_SELECTOR = '.message-list, #conversationList, #memberList, .member-menu, [data-no-motion]';
  // Delay between cards that arrive together, and the most a card waits
  const STAGGER_SECONDS = 0.07;
  const MAX_STAGGER_STEPS = 6;

  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('visible');
      // Once is enough, cards do not hide again when scrolled away from
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });

  const canReveal = (element) =>
    !element.classList.contains('reveal') &&
    !element.closest(NO_MOTION_SELECTOR) &&
    // A card inside a card that is already animating moves with it
    !(element.parentElement && element.parentElement.closest('.reveal'));

  // Adds .reveal to the new cards and gives cards that share a parent increasing delays (--reveal-delay)
  const prepareReveals = (elements) => {
    const countByParent = new Map();
    for (const element of elements) {
      if (!canReveal(element)) continue;
      const parent = element.parentElement;
      const step = countByParent.get(parent) || 0;
      countByParent.set(parent, step + 1);
      element.style.setProperty('--reveal-delay', `${Math.min(step, MAX_STAGGER_STEPS) * STAGGER_SECONDS}s`);
      element.classList.add('reveal');
      revealObserver.observe(element);
    }
  };

  // After a card has finished coming in, drop the delay so hovering it later responds right away
  document.addEventListener('transitionend', (end) => {
    if (end.target.classList && end.target.classList.contains('visible')) {
      end.target.style.removeProperty('--reveal-delay');
    }
  });

  // ===== 2. Split page titles into words =====
  // Only plain titles: ones with an id get their text from a page script (like "Loading…" then a group's name)
  const splitTitle = (title) => {
    if (title.id || title.classList.contains('split')) return;
    let index = 0;
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) {
      const pieces = textNode.textContent.split(/(\s+)/);
      const fragment = document.createDocumentFragment();
      for (const piece of pieces) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          fragment.appendChild(document.createTextNode(piece));
          continue;
        }
        const word = document.createElement('span');
        word.className = 'word';
        word.style.setProperty('--word-index', index++);
        word.textContent = piece;
        fragment.appendChild(word);
      }
      textNode.replaceWith(fragment);
    }
    title.classList.add('split');
    // Next frame, so the words start from their hidden position before moving in
    requestAnimationFrame(() => requestAnimationFrame(() => title.classList.add('words-in')));
  };

  // ===== Watch the page as it loads and changes =====
  // Started in <head>, so it also sees the page's own HTML arrive, not only what scripts add later
  const pageObserver = new MutationObserver((mutations) => {
    const found = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(REVEAL_SELECTOR)) found.push(node);
        found.push(...node.querySelectorAll(REVEAL_SELECTOR));
      }
    }
    if (found.length) prepareReveals(found);
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ===== 3. Scroll progress bar =====
  const setUpProgressBar = () => {
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    // Scroll events fire many times per frame, only redraw once per frame
    let waiting = false;
    const update = () => {
      waiting = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      // Short pages have nothing to show progress for
      bar.classList.toggle('active', max > 80);
    };
    const requestUpdate = () => {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    // Pages grow as their lists load, so check again when the page's size changes
    new ResizeObserver(requestUpdate).observe(document.body);
    update();
  };

  // ===== 4. Page fade out when leaving =====
  const LEAVE_MS = 140;
  const setUpPageLeave = () => {
    document.addEventListener('click', (click) => {
      const link = click.target.closest('a[href]');
      if (!link || click.defaultPrevented || click.button !== 0) return;
      // Let the browser handle new tabs, downloads, other sites and links within the page
      if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
      if (link.target && link.target !== '_self') return;
      if (link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      click.preventDefault();
      document.body.classList.add('page-leaving');
      setTimeout(() => { window.location.href = url.href; }, LEAVE_MS);
    });
    // Coming back with the Back button can restore the faded-out page, so undo it
    window.addEventListener('pageshow', () => document.body.classList.remove('page-leaving'));
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('h1').forEach(splitTitle);
    setUpProgressBar();
    setUpPageLeave();
  });
})();
