'use strict';

(() => {
  const backend = window.NovelBackend;
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/altcha@3.5.0/dist/main/altcha.i18n.js';
  let widgetLoad;

  function loadWidget() {
    if (customElements.get('altcha-widget')) return Promise.resolve();
    if (widgetLoad) return widgetLoad;

    widgetLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = moduleUrl;
      script.integrity = 'sha384-fb+dbNdcafvfCwCjrmT2RCXn7EqY3sZ+c/mkv6xI0N48XBOJrXhVFtc/HN6S6cGE';
      script.crossOrigin = 'anonymous';
      const timer = setTimeout(failed, 10000);

      function failed() {
        clearTimeout(timer);
        script.remove();
        reject(new Error('ALTCHA widget is unavailable.'));
      }

      script.addEventListener('error', failed, { once: true });
      script.addEventListener('load', () => {
        if (!customElements.get('altcha-widget')) return failed();
        clearTimeout(timer);
        resolve();
      }, { once: true });
      document.head.append(script);
    }).catch((error) => {
      widgetLoad = undefined;
      throw error;
    });
    return widgetLoad;
  }

  function statusMessage(error) {
    if (error.code === 'captcha_failed' || error.status === 409) {
      return '자동입력방지 인증을 다시 완료한 뒤 제보해 주세요.';
    }
    if (error.status === 429) return '잠시 뒤 다시 시도해 주세요. 제보를 보내는 횟수에 제한이 있습니다.';
    if (error.status === 400) return '입력 내용을 다시 확인해 주세요.';
    if (error.status === 404) return '이 작품은 지금 제보를 접수할 수 없습니다.';
    return '제보 접수 여부를 확인할 수 없습니다. 잠시 뒤 다시 시도해 주세요.';
  }

  function mount(section, workId) {
    const container = section.querySelector('.suggestion-content');
    if (!backend?.configured) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = '제보 접수는 데이터베이스 연결 후 열립니다.';
      container.append(note);
      return;
    }

    container.innerHTML =
      '<p class="muted">닉네임만으로 제보할 수 있습니다. 확인을 거친 내용이 작품 정보와 검색에 반영됩니다.</p>' +
      '<form class="site-form suggestion-form">' +
      '<label>닉네임<input name="nickname" required maxlength="32" autocomplete="nickname"></label>' +
      '<label>제보 종류<select name="kind"><option value="tag">태그</option><option value="character">등장인물</option></select></label>' +
      '<label><span data-subject-label>제안할 태그</span><input name="subject" required maxlength="80"></label>' +
      '<fieldset class="character-fields" hidden disabled><legend>등장인물 정보</legend>' +
      '<label>역할 또는 관계 <span class="field-note">선택</span><input name="characterRole" maxlength="80"></label>' +
      '<label>특징 <span class="field-note">선택 · 쉼표로 구분해 최대 8개</span><input name="traits" maxlength="488" placeholder="예 · 흑발, 무림인"></label>' +
      '<label class="inline-check"><input name="characterSpoiler" type="checkbox"> 스포일러가 포함된 인물 정보</label></fieldset>' +
      '<label>제보 내용 <span class="field-note">선택 · 근거 회차나 판단 이유</span><textarea name="note" rows="3" maxlength="1000"></textarea></label>' +
      '<label>출처 링크 <span class="field-note">선택 · HTTPS</span><input name="sourceUrl" type="url" maxlength="2048" placeholder="https://…"></label>' +
      '<div data-captcha></div><p data-captcha-status class="field-note" role="status"></p>' +
      '<div class="form-actions"><button class="primary" type="submit">제보 보내기</button>' +
      '<button class="secondary" data-captcha-retry type="button" hidden>인증 다시 불러오기</button></div>' +
      '<p class="form-status" role="status" data-suggestion-status></p></form>';

    const form = container.querySelector('form');
    const fields = form.elements;
    const characterFields = form.querySelector('.character-fields');
    const subjectLabel = form.querySelector('[data-subject-label]');
    const captcha = form.querySelector('[data-captcha]');
    const captchaStatus = form.querySelector('[data-captcha-status]');
    const retry = form.querySelector('[data-captcha-retry]');
    const status = form.querySelector('[data-suggestion-status]');
    const submit = form.querySelector('button[type="submit"]');
    let widget;
    let busy = false;
    let preparing = false;

    function updateKind() {
      const isCharacter = fields.kind.value === 'character';
      characterFields.hidden = !isCharacter;
      characterFields.disabled = !isCharacter;
      subjectLabel.textContent = isCharacter ? '등장인물 이름' : '제안할 태그';
    }

    async function prepareCaptcha() {
      if (preparing) return;
      preparing = true;
      retry.hidden = true;
      captchaStatus.textContent = '자동입력방지 도구를 불러오는 중입니다.';
      try {
        await loadWidget();
        if (!form.isConnected) return;
        widget = document.createElement('altcha-widget');
        widget.setAttribute('challenge', backend.challengeUrl);
        widget.setAttribute('language', 'ko');
        widget.setAttribute('name', 'altcha');
        widget.addEventListener('statechange', (event) => {
          const state = event.detail?.state;
          if (state === 'error' || state === 'expired') {
            captchaStatus.textContent = '자동입력방지 인증을 다시 불러와 주세요.';
            retry.hidden = false;
          } else {
            captchaStatus.textContent = '';
            retry.hidden = true;
          }
        });
        captcha.replaceChildren(widget);
        captchaStatus.textContent = '';
      } catch {
        captchaStatus.textContent = '자동입력방지 도구를 불러오지 못했습니다.';
        retry.hidden = false;
      } finally {
        preparing = false;
      }
    }

    section.addEventListener('toggle', () => {
      if (section.open && !widget && retry.hidden) prepareCaptcha();
    });
    retry.addEventListener('click', prepareCaptcha);
    fields.kind.addEventListener('change', updateKind);
    form.addEventListener('reset', () => setTimeout(updateKind, 0));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const verification = new FormData(form).get('altcha');
      const nickname = fields.nickname.value.trim();
      const subject = fields.subject.value.trim();
      const kind = fields.kind.value;
      const traits = fields.traits.value.split(',').map((trait) => trait.trim()).filter(Boolean);
      const sourceUrl = fields.sourceUrl.value.trim();

      if (!nickname || !subject) {
        status.textContent = '닉네임과 제안 내용을 입력해 주세요.';
        return;
      }
      if (kind === 'character' && (traits.length > 8 || traits.some((trait) => trait.length > 60))) {
        status.textContent = '특징은 60자 이내로 최대 8개를 입력해 주세요.';
        return;
      }
      if (sourceUrl) {
        let source;
        try { source = new URL(sourceUrl); } catch {}
        if (source?.protocol !== 'https:' || source.username || source.password) {
          status.textContent = '출처 링크에는 HTTPS 주소를 입력해 주세요.';
          return;
        }
      }
      if (typeof verification !== 'string' || !verification) {
        status.textContent = '자동입력방지 인증을 완료해 주세요.';
        return;
      }

      const proposal = { workId, nickname, kind, subject, note: fields.note.value.trim() };
      if (sourceUrl) proposal.sourceUrl = sourceUrl;
      if (kind === 'character') {
        proposal.traits = traits;
        proposal.characterRole = fields.characterRole.value.trim();
        proposal.characterSpoiler = fields.characterSpoiler.checked;
      }
      busy = true;
      submit.disabled = true;
      status.textContent = '제보를 보내는 중입니다.';
      try {
        const result = await backend.submit({ ...proposal, captcha: verification });
        if (result?.status !== 'pending') throw new Error('Missing submission confirmation.');
        form.reset();
        status.textContent = '제보가 접수됐습니다. 운영자 검토를 거쳐 반영됩니다.';
      } catch (error) {
        status.textContent = statusMessage(error);
      } finally {
        busy = false;
        submit.disabled = false;
        widget?.reset?.();
      }
    });
  }

  window.NovelSuggestions = Object.freeze({ mount });
})();
