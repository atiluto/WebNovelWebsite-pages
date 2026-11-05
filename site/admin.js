'use strict';

(() => {
  const backend = window.NovelBackend;
  const auth = document.querySelector('#operator-auth');
  const login = document.querySelector('#operator-login');
  const queue = document.querySelector('#operator-queue');
  const items = document.querySelector('#operator-items');
  const count = document.querySelector('#operator-count');
  const status = document.querySelector('#operator-status');
  const refresh = document.querySelector('#operator-refresh');
  const logout = document.querySelector('#operator-logout');
  const loginButton = auth.querySelector('button');
  let token = '';
  let loadingToken = '';

  function takeAuthCallback() {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const isAuthCallback = ['access_token', 'refresh_token', 'error', 'error_code'].some((key) => fragment.has(key));
    if (!isAuthCallback) return {};

    const accessToken = fragment.get('access_token');
    const error = fragment.has('error') || fragment.has('error_code');
    url.hash = '';
    window.history.replaceState(window.history.state, '', url.href);
    return { accessToken, error };
  }

  function element(name, text, className) {
    const node = document.createElement(name);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function sourceLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      const link = element('a', '출처 링크 ↗', 'source-link');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    } catch {
      return null;
    }
  }

  function displayTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  function clearSession(message) {
    const previous = token;
    token = '';
    loadingToken = '';
    refresh.disabled = false;
    items.replaceChildren();
    count.textContent = '';
    queue.hidden = true;
    login.hidden = false;
    status.textContent = message;
    if (previous) backend.signOut(previous).catch(() => {});
  }

  function handleSessionError(error) {
    if (error.status === 401 || error.status === 403) {
      clearSession(error.status === 403
        ? '이 계정에는 제보를 검토할 권한이 없습니다.'
        : '로그인 세션이 만료됐습니다. 다시 로그인해 주세요.');
      return true;
    }
    return false;
  }

  function updateCount() {
    const size = items.childElementCount;
    count.textContent = size ? '표시된 대기 제보 ' + size + '건' : '검토할 제보가 없습니다.';
  }

  function reviewCard(suggestion) {
    const card = element('article', null, 'operator-item');
    const isCharacter = suggestion.kind === 'character';
    card.append(
      element('h3', suggestion.work_title || suggestion.work_id),
      element('p', [isCharacter ? '등장인물' : '태그', suggestion.subject].join(' · '), 'operator-subject'),
      element('p', [suggestion.nickname, displayTime(suggestion.created_at)].filter(Boolean).join(' · '), 'field-note')
    );
    if (isCharacter) {
      const facts = [suggestion.character_role, ...(Array.isArray(suggestion.traits) ? suggestion.traits : [])].filter(Boolean);
      if (facts.length) card.append(element('p', facts.join(' · ')));
      if (suggestion.character_spoiler) card.append(element('p', '스포일러 포함', 'field-note'));
    }
    if (suggestion.note) card.append(element('p', suggestion.note, 'operator-note'));
    const source = sourceLink(suggestion.source_url);
    if (source) card.append(source);

    const form = element('form', null, 'site-form');
    const label = element('label', '검토 메모 ');
    label.append(element('span', '선택', 'field-note'));
    const note = element('textarea');
    note.name = 'note';
    note.rows = 2;
    note.maxLength = 1000;
    label.append(note);

    const actions = element('div', null, 'form-actions');
    const approved = element('button', '승인', 'primary');
    approved.type = 'submit';
    approved.value = 'approved';
    const rejected = element('button', '반려', 'secondary');
    rejected.type = 'submit';
    rejected.value = 'rejected';
    actions.append(approved, rejected);
    form.append(label, actions);
    card.append(form);

    let deciding = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const decision = event.submitter?.value;
      if (deciding || !token || loadingToken === token || !['approved', 'rejected'].includes(decision)) return;
      const session = token;
      deciding = true;
      approved.disabled = rejected.disabled = true;
      status.textContent = '검토 결과를 저장하는 중입니다.';
      try {
        const result = await backend.decide(session, {
          suggestionId: suggestion.id,
          decision,
          note: note.value.trim(),
        });
        if (token !== session) return;
        if (result?.status !== decision) throw new Error('Missing review confirmation.');
        card.remove();
        updateCount();
        status.textContent = decision === 'approved' ? '제보를 승인했습니다.' : '제보를 반려했습니다.';
      } catch (error) {
        if (token !== session || handleSessionError(error)) return;
        if (error.status === 409) {
          card.remove();
          updateCount();
          status.textContent = '이미 다른 검토 결과가 저장된 제보입니다.';
        } else {
          status.textContent = '검토 결과를 저장하지 못했습니다. 다시 시도해 주세요.';
        }
      } finally {
        deciding = false;
        approved.disabled = rejected.disabled = false;
      }
    });
    return card;
  }

  async function loadQueue() {
    if (!token || loadingToken === token) return;
    const session = token;
    loadingToken = session;
    refresh.disabled = true;
    status.textContent = '검토 대기 제보를 불러오는 중입니다.';
    try {
      const result = await backend.listSuggestions(session, 'pending');
      if (token !== session) return;
      if (!Array.isArray(result?.suggestions)) throw new Error('Invalid review queue.');
      items.replaceChildren(...result.suggestions.map(reviewCard));
      updateCount();
      const wasHidden = queue.hidden;
      login.hidden = true;
      queue.hidden = false;
      status.textContent = '';
      if (wasHidden) queue.querySelector('h2').focus();
    } catch (error) {
      if (token !== session || handleSessionError(error)) return;
      if (queue.hidden) clearSession('검토 대기 제보를 불러오지 못했습니다. 다시 로그인해 주세요.');
      else status.textContent = '검토 대기 제보를 불러오지 못했습니다. 다시 시도해 주세요.';
    } finally {
      if (loadingToken === session) {
        loadingToken = '';
        refresh.disabled = false;
      }
    }
  }

  function initialize() {
    const callback = takeAuthCallback();
    if (!backend?.configured) {
      status.textContent = '데이터베이스 연결 후 운영자 로그인이 열립니다.';
      return;
    }

    refresh.addEventListener('click', loadQueue);
    logout.addEventListener('click', () => clearSession('로그아웃했습니다.'));
    auth.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (loginButton.disabled) return;
      loginButton.disabled = true;
      status.textContent = '로그인 링크를 요청하는 중입니다.';
      try {
        const redirectUrl = new URL(window.location.pathname, window.location.origin).href;
        await backend.requestMagicLink(auth.elements.email.value.trim(), redirectUrl);
        status.textContent = '운영자 이메일로 전송된 로그인 링크를 열어 주세요.';
      } catch (error) {
        status.textContent = error.status === 429
          ? '로그인 링크를 여러 번 요청했습니다. 잠시 기다린 뒤 다시 요청해 주세요.'
          : '로그인 링크를 보내지 못했습니다. 등록된 운영자 이메일인지 확인해 주세요.';
      } finally {
        loginButton.disabled = false;
      }
    });

    if (!callback.error && callback.accessToken) {
      token = callback.accessToken;
      loadQueue();
      return;
    }
    login.hidden = false;
    if (callback.error) {
      status.textContent = '로그인 링크가 만료됐거나 이미 사용됐습니다. 새 링크를 요청해 주세요.';
    }
  }

  initialize();
})();
