'use strict';

const genresPanel = document.querySelector('#genres');
const form = document.querySelector('#filters');
const resultsPanel = document.querySelector('#results');
const pagination = document.querySelector('#pagination');
const dialog = document.querySelector('#work-dialog');
const detail = document.querySelector('#work-detail');
const genreNote = document.querySelector('#genre-note');
const genreSource = document.querySelector('#genre-source');
const resultCount = document.querySelector('#result-count');
const pageSize = 12;
const originalRankUrl = genreSource.href;
let catalog;
let works;
let selectedGenre = 'all';
let page = 1;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function externalLink(value, label, className = '') {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  return '<a class="' + className + '" href="' + escapeHtml(url.href) +
    '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + ' <span aria-hidden="true">↗</span></a>';
}

function normalize(value) {
  return String(value ?? '').normalize('NFC').toLowerCase().trim().replace(/검은\s*머리/g, '흑발');
}

function compact(value) {
  return normalize(value).replace(/\s+/g, '');
}

function terms(value) {
  return normalize(value).split(/[\s,]+/).filter(Boolean);
}

function contains(values, query) {
  return values.some((value) => compact(value).includes(compact(query)));
}

function matchWork(work, query) {
  const notes = work.research;
  const keywords = query.title;
  if (keywords && !contains([work.title, work.author], keywords)) return null;
  if (query.reviewed && !notes) return null;

  const tags = query.tags.every((term) => contains(notes?.tags ?? [], term));
  const person = query.person.length ? notes?.characters?.find((character) => {
    if (character.spoiler) return false;
    const attributes = [character.name, character.role, ...character.traits];
    return query.person.every((term) => contains(attributes, term));
  }) : null;
  const missing = [];
  if (!tags) missing.push('태그');
  if (query.person.length && !person) missing.push('인물');
  if (missing.length) {
    return query.unknown ? { work, unknown: true, reason: missing.join(' · ') + ' 조건 미확인' } : null;
  }

  const reasons = [];
  if (query.tags.length) {
    reasons.push(notes.tags.filter((tag) => query.tags.some((term) => contains([tag], term))).join(' · '));
  }
  if (person) reasons.push(person.name + ' · ' + query.person.join(' · '));
  return { work, unknown: false, reason: reasons.join(' / ') };
}

function workMeta(work, showGenre = true) {
  const pieces = [
    work.author,
    showGenre && work.genre.name,
    work.status,
    work.episodes != null && work.episodes + (work.unit || '화'),
    work.rating != null && '평점 ' + work.rating
  ];
  return pieces.filter(Boolean).join(' · ');
}

function coverMarkup(work, large = false) {
  const source = work.coverUrl?.startsWith('https://comicthumb-phinf.pstatic.net/') ? work.coverUrl : '';
  if (large && !source) return '';
  const image = source
    ? '<img class="book-image" src="' + escapeHtml(source) + '" alt="" decoding="async" referrerpolicy="no-referrer"' +
      (large ? '' : ' loading="lazy"') + '>'
    : '';
  return '<span class="book' + (large ? ' book-detail' : '') + '" data-genre="' + escapeHtml(work.genre.id) +
    '" aria-hidden="true">文' + image + '</span>';
}

function row({ work, reason, unknown }) {
  const labels = work.research?.tags ?? [];
  const annotation = reason || labels.slice(0, 4).map((tag) => '#' + tag).join(' ');
  return '<article class="result">' +
    '<span class="rank" aria-label="' + work.rank + '위">' + work.rank + '</span>' +
    coverMarkup(work) +
    '<div><button class="result-title" type="button" data-work="' + work.index + '">' + escapeHtml(work.title) + '</button>' +
    '<p class="result-meta">' + escapeHtml(workMeta(work, selectedGenre === 'all')) + '</p>' +
    (annotation ? '<p class="result-match' + (unknown ? ' unknown' : '') + '">' + escapeHtml(annotation) + '</p>' : '') +
    '</div><span class="pill' + (work.research ? '' : ' neutral') + '">' + (work.research ? '상세 검토' : '순위 확인') + '</span>' +
    '</article>';
}

function renderPagination(pageCount) {
  pagination.hidden = pageCount <= 1;
  if (pagination.hidden) return;
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const numbered = Array.from({ length: Math.min(5, pageCount) }, (_, offset) => {
    const number = start + offset;
    return '<button type="button" class="page-button" data-page="' + number + '"' +
      (number === page ? ' aria-current="page"' : '') + ' aria-label="' + number + ' 페이지">' + number + '</button>';
  }).join('');
  pagination.innerHTML =
    '<button type="button" class="page-button" data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') + '>이전</button>' +
    numbered + '<button type="button" class="page-button" data-page="' + (page + 1) + '"' + (page === pageCount ? ' disabled' : '') + '>다음</button>';
}

function render() {
  if (!catalog) return;
  const query = {
    title: normalize(form.elements.query.value),
    tags: terms(form.elements.tag.value),
    person: terms(form.elements.character.value),
    reviewed: form.elements.reviewed.checked,
    unknown: form.elements.unknown.checked
  };
  const genre = catalog.genres.find((item) => item.id === selectedGenre);
  const filtered = works.filter((work) => !genre || work.genre === genre);
  const matches = filtered.map((work) => matchWork(work, query)).filter(Boolean);
  matches.sort((first, second) => Number(first.unknown) - Number(second.unknown));
  const unknownCount = matches.filter((match) => match.unknown).length;
  const searchActive = Boolean(query.title || query.tags.length || query.person.length || query.reviewed);
  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, pageCount);
  const offset = (page - 1) * pageSize;
  const paginationLabel = pageCount > 1 ? ' · ' + page + ' / ' + pageCount + ' 페이지' : '';
  resultCount.textContent = (searchActive ? '일치 ' + (total - unknownCount) + '편' : '수록 ' + total + '편') +
    (unknownCount ? ' · 미확인 ' + unknownCount + '편' : '') + paginationLabel;
  genreSource.href = genre?.url ?? originalRankUrl;

  const removed = genre?.excludedRanks?.length ?? 0;
  let note = '';
  if (!genre) note = '모든 장르는 각 장르에서 확인된 순위를 나란히 보여줍니다.';
  else if (!genre.entries.length) note = '확인한 공개 일간 순위에 이 장르의 작품이 표시되지 않았습니다.';
  else if (removed) note = '갱신 시점이 다른 조회본에서 중복된 작품 ' + removed + '건을 제외했습니다. 남은 작품에는 공식 조회본의 순위를 유지했습니다.';
  else if (genre.entries.length < 100) note = '확인한 공개 일간 순위에 표시된 ' + genre.entries.length + '편을 수록했습니다.';
  genreNote.hidden = !note;
  genreNote.textContent = note;

  if (total) {
    resultsPanel.innerHTML = matches.slice(offset, offset + pageSize).map(row).join('');
  } else {
    const title = filtered.length ? '일치하는 작품이 없습니다.' : '확인된 순위가 없습니다.';
    const hint = filtered.length ? '조건을 줄이거나 미확인 작품을 함께 보세요.' : '다른 장르를 선택하거나 공식 장르 순위를 확인하세요.';
    resultsPanel.innerHTML = '<div class="empty"><strong>' + title + '</strong><p>' + hint + '</p></div>';
  }
  renderPagination(pageCount);
}

function tagMarkup(tags) {
  return tags.map((tag) => '<span class="pill">' + escapeHtml(tag) + '</span>').join('');
}

function personMarkup(person) {
  return '<article class="person"><h4>' + escapeHtml(person.name) + '</h4>' +
    '<p>' + escapeHtml(person.role) + '</p><div class="traits">' + tagMarkup(person.traits) + '</div></article>';
}

function showDetail(work) {
  const notes = work.research;
  const people = notes?.characters ?? [];
  const visible = people.filter((person) => !person.spoiler);
  const spoilers = people.filter((person) => person.spoiler);
  const summary = notes?.summary ? escapeHtml(notes.summary) : '확인한 줄거리 정보가 없습니다.';
  const heroine = notes?.heroine ?? (visible.some((person) => person.role === '히로인') ? '있음 확인' : '미확인');
  const harem = notes?.harem ?? '미확인';
  const sources = notes?.sources?.map((source) => '<li>' + externalLink(source.url, source.label) + '</li>').join('') ?? '';
  detail.innerHTML =
    '<header class="detail-heading">' + coverMarkup(work, true) + '<div>' +
    '<span class="pill">' + escapeHtml(work.genre.name) + ' · ' + work.rank + '위 조회본</span>' +
    '<h2 class="work-title" id="work-title">' + escapeHtml(work.title) + '</h2>' +
    '<p class="detail-meta">' + escapeHtml(workMeta(work, false)) + '</p>' +
    '<div class="detail-actions">' + externalLink(work.url, '시리즈 작품 보기', 'source-link') +
    externalLink(work.rankUrl || work.genre.url, '순위 출처', 'source-link') + '</div></div></header>' +
    '<dl class="facts"><div><dt>히로인</dt><dd>' + escapeHtml(heroine) + '</dd></div>' +
    '<div><dt>하렘</dt><dd>' + escapeHtml(harem) + '</dd></div>' +
    '<div><dt>검토 범위</dt><dd>' + (notes ? '표시된 근거' : '순위 정보') + '</dd></div></dl>' +
    '<section class="detail-section"><h3>줄거리</h3><p' + (notes?.summary ? '' : ' class="muted"') + '>' + summary + '</p></section>' +
    '<section class="detail-section"><h3>작품 태그</h3>' +
    (notes?.tags?.length ? '<div class="tags">' + tagMarkup(notes.tags) + '</div>' : '<p class="muted">상세 태그 미확인</p>') + '</section>' +
    '<section class="detail-section"><h3>등장인물</h3>' +
    (visible.length ? visible.map(personMarkup).join('') : '<p class="muted">공개 근거로 확인한 인물 정보가 없습니다.</p>') +
    (spoilers.length ? '<details class="spoilers"><summary>스포일러가 포함된 인물 정보 보기</summary>' + spoilers.map(personMarkup).join('') + '</details>' : '') + '</section>' +
    '<section class="detail-section"><h3>근거와 검토 범위</h3>' +
    (sources ? '<ul class="sources">' + sources + '</ul>' : '<p class="muted">해당 순위 조회본에서 제목과 기본 정보를 확인했습니다.</p>') +
    (notes?.notes ? '<p class="muted review-note">' + escapeHtml(notes.notes) + '</p>' : '') +
    '</section>';
  dialog.showModal();
  dialog.scrollTop = 0;
}

function initialize(data, reviews) {
  catalog = data;
  works = catalog.genres.flatMap((genre) => genre.entries.map((entry) => ({
    ...entry, genre, research: Object.hasOwn(reviews, entry.id) ? reviews[entry.id] : null
  }))).sort((first, second) => first.rank - second.rank);
  works.forEach((work, index) => { work.index = index; });

  const displayed = catalog.genres.filter((genre) => genre.entries.length).length;
  const reviewed = new Set(works.filter((work) => work.research).map((work) => work.id));
  document.querySelector('#stat-genres').textContent = displayed + ' / ' + catalog.genres.length;
  document.querySelector('#stat-ranks').textContent = works.length.toLocaleString('ko-KR');
  document.querySelector('#stat-research').textContent = reviewed.size.toLocaleString('ko-KR');
  const checked = new Date(catalog.checkedAt);
  document.querySelector('#snapshot-date').textContent = Number.isNaN(checked.getTime())
    ? '공개 순위 조회본'
    : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long' }).format(checked) + ' 확인 · 공개 조회본';
  genresPanel.innerHTML = [{ id: 'all', name: '모든 장르', entries: works }, ...catalog.genres].map((genre) =>
    '<button class="genre" type="button" data-genre="' + escapeHtml(genre.id) + '" aria-pressed="' +
    (genre.id === selectedGenre) + '">' + escapeHtml(genre.name) + '<span class="genre-count">' +
    genre.entries.length + '</span></button>').join('');
  resultsPanel.setAttribute('aria-busy', 'false');
  render();
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
  return response.json();
}

form.addEventListener('submit', (event) => event.preventDefault());
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains('book-image')) event.target.hidden = true;
}, true);
form.addEventListener('input', () => { page = 1; render(); });
form.addEventListener('reset', () => setTimeout(() => { page = 1; render(); }, 0));
genresPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-genre]');
  if (!button) return;
  selectedGenre = button.dataset.genre;
  for (const tab of genresPanel.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab === button));
  page = 1;
  render();
});
resultsPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-work]');
  if (button) showDetail(works[Number(button.dataset.work)]);
});
pagination.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button || button.disabled) return;
  page = Number(button.dataset.page);
  render();
  pagination.querySelector('[aria-current="page"]')?.focus();
});

if (matchMedia('(max-width: 620px)').matches) document.querySelector('#filter-panel').open = false;
Promise.all([json('./catalog.json'), json('./research.json')])
  .then(([data, reviews]) => initialize(data, reviews))
  .catch(() => {
    resultsPanel.setAttribute('aria-busy', 'false');
    resultCount.textContent = '데이터를 불러올 수 없습니다.';
    document.querySelector('#snapshot-date').textContent = '데이터 연결을 확인해주세요.';
    resultsPanel.innerHTML = '<div class="empty"><strong>순위 파일을 읽지 못했습니다.</strong><p>사이트 주소에서 페이지를 다시 열거나 공식 순위를 확인하세요.</p></div>';
  });
