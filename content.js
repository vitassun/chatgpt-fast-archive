(function () {
  'use strict';

  const ARCHIVE_BUTTON_CLASS = 'cgfa-archive-button';
  const CONVERSATION_ITEM_CLASS = 'cgfa-conversation-item';
  const ARCHIVED_ATTRIBUTE = 'data-cgfa-archived';
  const TOAST_CLASS = 'cgfa-toast';
  const TOAST_VISIBLE_CLASS = 'cgfa-toast-visible';
  const CONVERSATION_PATH = /^\/c\/([^/?#]+)\/?$/;
  const SIDEBAR_SELECTOR = 'nav, aside';
  // Leave a small margin above the 15 second background fetch deadline so a
  // successful response is not reported as a page-side timeout first.
  const ARCHIVE_MESSAGE_TIMEOUT_MS = 18 * 1000;
  const archivedConversationIds = new Set();
  const inFlightConversationIds = new Set();

  let scanFrame = 0;
  let toastTimer = 0;
  let observer;
  let scanWholeDocument = false;
  const pendingScanRoots = new Set();

  function getConversationId(link) {
    if (!link || !link.href) {
      return null;
    }

    let url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (_error) {
      return null;
    }

    if (url.origin !== window.location.origin) {
      return null;
    }

    const match = url.pathname.match(CONVERSATION_PATH);
    if (!match) {
      return null;
    }
    try {
      return decodeURIComponent(match[1]);
    } catch (_error) {
      return match[1];
    }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isLikelySidebarLink(link) {
    return Boolean(isVisible(link) && link.closest('nav, aside'));
  }

  function getConversationItem(link) {
    const sidebar = link && link.closest ? link.closest(SIDEBAR_SELECTOR) : null;
    if (!sidebar || !sidebar.contains(link)) {
      return null;
    }

    // Prefer the semantic list row used by the current sidebar DOM. A row is
    // always kept outside the anchor so the injected button cannot navigate
    // when clicked.
    const semanticCandidate = link.closest(
      'li, [role="listitem"], [data-testid*="conversation"], [data-testid*="history"]'
    );
    if (semanticCandidate && sidebar.contains(semanticCandidate)
      && isSafeItemCandidate(semanticCandidate, link)) {
      return semanticCandidate;
    }

    // Older releases use div-based rows. Walk only through this nav/aside and
    // stop before the sidebar itself; never use an anchor as the item.
    let candidate = link.parentElement;
    for (let level = 0; level < 7 && candidate; level += 1) {
      if (candidate === sidebar) {
        break;
      }
      if (sidebar.contains(candidate) && isSafeItemCandidate(candidate, link)) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return null;
  }

  function isSafeItemCandidate(candidate, link) {
    if (!candidate || !link || candidate === link || candidate.tagName === 'A'
      || !candidate.contains(link) || !candidate.closest(SIDEBAR_SELECTOR)) {
      return false;
    }

    const links = candidate.querySelectorAll('a[href]');
    const conversationLinks = Array.from(links).filter((item) => getConversationId(item));
    if (conversationLinks.length !== 1 || conversationLinks[0] !== link) {
      return false;
    }

    const rect = candidate.getBoundingClientRect();
    // Avoid selecting the entire sidebar/nav when a row has unusual markup.
    return rect.height > 0 && rect.height <= 112 && rect.width > 0;
  }

  function createArchiveIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 7.5h16M6.5 7.5v10a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-10M9 4.5h6l1 3H8l1-3Zm1.5 7h3');
    svg.appendChild(path);
    return svg;
  }

  function stopNavigation(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function stopAncestorNavigation(event) {
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function showToast(message) {
    let toast = document.querySelector(`.${TOAST_CLASS}`);
    if (!toast) {
      toast = document.createElement('div');
      toast.className = TOAST_CLASS;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add(TOAST_VISIBLE_CLASS);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove(TOAST_VISIBLE_CLASS);
    }, 2800);
  }

  function removeConversationItem(item, link) {
    if (item && item.isConnected) {
      item.setAttribute(ARCHIVED_ATTRIBUTE, 'true');
      item.remove();
      return;
    }

    if (link && link.isConnected) {
      link.setAttribute(ARCHIVED_ATTRIBUTE, 'true');
      link.remove();
    }
  }

  function restoreArchiveButton(button) {
    if (!button || !button.isConnected) {
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', '归档会话');
    button.title = '归档会话';
  }

  async function archiveConversation(conversationId) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Archive service is unavailable'));
        return;
      }

      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        const error = new Error('Archive service timed out');
        error.status = 0;
        reject(error);
      }, ARCHIVE_MESSAGE_TIMEOUT_MS);
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        callback(value);
      };

      try {
        chrome.runtime.sendMessage(
          {
            type: 'cgfa-archive',
            conversationId,
            origin: window.location.origin
          },
          (response) => {
            if (chrome.runtime.lastError) {
              finish(reject, new Error('Archive service is unavailable'));
              return;
            }
            if (!response || !response.ok) {
              const error = new Error(`Archive request failed (${response && response.status || 0})`);
              error.status = response && response.status || 0;
              finish(reject, error);
              return;
            }
            finish(resolve);
          }
        );
      } catch (_error) {
        finish(reject, new Error('Archive service is unavailable'));
      }
    });
  }

  async function handleArchiveClick(event) {
    stopNavigation(event);

    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return;
    }

    const conversationId = button.dataset.conversationId;
    const item = button.closest(`.${CONVERSATION_ITEM_CLASS}`);
    const link = item ? item.querySelector('a[href]') : null;
    if (!conversationId || inFlightConversationIds.has(conversationId)) {
      return;
    }

    inFlightConversationIds.add(conversationId);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', '正在归档');
    button.title = '正在归档…';

    try {
      await archiveConversation(conversationId);
      archivedConversationIds.add(conversationId);
      removeConversationItem(item, link);
    } catch (error) {
      restoreArchiveButton(button);
      const message = error && (error.status === 401 || error.status === 403)
        ? '归档失败，请刷新页面或打开任意会话后重试'
        : '归档失败，请稍后重试';
      showToast(message);
    } finally {
      inFlightConversationIds.delete(conversationId);
    }
  }

  function bindConversationLink(link) {
    const conversationId = getConversationId(link);
    if (!conversationId || !isLikelySidebarLink(link)) {
      return;
    }

    const item = getConversationItem(link);
    if (!item || !item.isConnected || item === link || item.tagName === 'A'
      || item.closest('a')) {
      return;
    }

    if (archivedConversationIds.has(conversationId)) {
      removeConversationItem(item, link);
      return;
    }

    item.classList.add(CONVERSATION_ITEM_CLASS);
    const existingButton = item.querySelector(`.${ARCHIVE_BUTTON_CLASS}`);
    if (existingButton) {
      if (existingButton.dataset.conversationId !== conversationId) {
        existingButton.dataset.conversationId = conversationId;
      }
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = ARCHIVE_BUTTON_CLASS;
    button.dataset.conversationId = conversationId;
    button.setAttribute('aria-label', '归档会话');
    button.title = '归档会话';
    button.appendChild(createArchiveIcon());
    button.addEventListener('pointerdown', stopAncestorNavigation, true);
    button.addEventListener('mousedown', stopAncestorNavigation, true);
    button.addEventListener('click', handleArchiveClick, true);
    item.appendChild(button);
  }

  function scheduleScan(root) {
    if (root) {
      pendingScanRoots.add(root);
    } else {
      scanWholeDocument = true;
    }

    if (scanFrame) {
      return;
    }
    scanFrame = window.requestAnimationFrame(() => {
      scanFrame = 0;
      const shouldScanWholeDocument = scanWholeDocument;
      const roots = Array.from(pendingScanRoots);
      scanWholeDocument = false;
      pendingScanRoots.clear();

      if (shouldScanWholeDocument) {
        scanConversationLinks(document);
        return;
      }
      roots.forEach(scanConversationLinks);
    });
  }

  function scanConversationLinks(root) {
    if (!root || !root.querySelectorAll) {
      return;
    }

    if (root.matches && root.matches('a[href*="/c/"]')) {
      bindConversationLink(root);
    }
    root.querySelectorAll('a[href*="/c/"]').forEach(bindConversationLink);
  }

  function start() {
    if (!document.body) {
      return;
    }

    scanConversationLinks(document);
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          if (mutation.target.matches && mutation.target.matches('a[href*="/c/"]')) {
            scheduleScan(mutation.target);
          } else if (
            mutation.target !== document.body
            && (
              (mutation.target.closest && mutation.target.closest('nav, aside'))
              || (mutation.target.querySelector && mutation.target.querySelector('a[href*="/c/"]'))
            )
          ) {
            // Sidebar collapse/expand is often represented only by a class or
            // style change, without adding new conversation nodes.
            scheduleScan(mutation.target);
          }
          return;
        }

        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scheduleScan(node);
          }
        });
      });
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-expanded', 'class', 'href', 'style'],
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
