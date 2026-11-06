'use strict';

const platformsPanel = document.querySelector('#platforms');
const platformSource = document.querySelector('#platform-source');
const genresPanel = document.querySelector('#genres');
const form = document.querySelector('#filters');
const resultsPanel = document.querySelector('#results');
const pagination = document.querySelector('#pagination');
const dialog = document.querySelector('#work-dialog');
const detail = document.querySelector('#work-detail');
const genreNote = document.querySelector('#genre-note');
const genreSource = document.querySelector('#genre-source');
const resultCount = document.querySelector('#result-count');
const sortOrder = document.querySelector('#sort-order');
const tagSearch = document.querySelector('#tag-search');
const tagPanel = document.querySelector('#tag-catalog');
const tagCount = document.querySelector('#tag-count');
const selectedTagPanel = document.querySelector('#selected-tags');
const pageSize = 12;
const backend = window.NovelBackend;
const tagCatalog = new Map();
const selectedTags = new Set();
const platforms = {
  series: {
    name: '네이버 시리즈',
    url: platformSource.href,
    title: '장르별 TOP 100',
    period: '일간 순위',
    metrics: { downloads: '다운로드', comments: '댓글' }
  },
  kakao: {
    name: '카카오페이지',
    url: 'https://page.kakao.com/menu/10011',
    title: '장르별 TOP 100',
    period: '장르별 순위',
    metrics: { views: '조회', comments: '댓글' }
  }
};
let catalog;
let researchSnapshot;
let seriesMetrics;
let platformGenres;
let platform;
let selectedPlatform = 'series';
let works;
let worksById;
let orderings;
let metricTotals;
let metricDate = '';
let selectedGenre = 'all';
let page = 1;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function externalLink(value, label, className = '') {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return '<a class="' + className + '" href="' + escapeHtml(url.href) +
      '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + ' <span aria-hidden="true">↗</span></a>';
  } catch {
    return '';
  }
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

function tagButton(label, className, count) {
  return '<button type="button" class="' + className + '" data-tag="' + escapeHtml(label) +
    '" aria-pressed="' + selectedTags.has(compact(label)) + '">#' + escapeHtml(label) +
    (count == null ? '' : ' <span class="tag-option-count">' + count + '</span>') + '</button>';
}

function renderTagCatalog() {
  const visible = [...tagCatalog.values()].filter(({ label }) => contains([label], tagSearch.value));
  tagCount.textContent = (tagSearch.value.trim() ? '검색 ' + visible.length + ' / ' : '전체 ') + tagCatalog.size + '개';
  tagPanel.innerHTML = visible.length
    ? visible.map(({ label, count }) => tagButton(label, 'tag-option', count)).join('')
    : '<p class="muted">찾은 태그가 없습니다.</p>';
}

function renderSelectedTags() {
  selectedTagPanel.innerHTML = selectedTags.size ? [...selectedTags].map((key) => {
    const label = tagCatalog.get(key).label;
    return '<button type="button" class="tag-chip" data-tag="' + escapeHtml(label) +
      '" aria-label="' + escapeHtml(label + ' 태그 선택 해제') + '">#' + escapeHtml(label) +
      ' <span aria-hidden="true">×</span></button>';
  }).join('') : '';
}

function toggleTag(label) {
  const key = compact(label);
  if (!tagCatalog.has(key)) return;
  if (selectedTags.has(key)) selectedTags.delete(key);
  else selectedTags.add(key);
  for (const button of tagPanel.querySelectorAll('button[data-tag]')) {
    if (compact(button.dataset.tag) === key) button.setAttribute('aria-pressed', String(selectedTags.has(key)));
  }
  renderSelectedTags();
  page = 1;
  render();
}

function matchWork(work, query) {
  const notes = work.research;
  const keywords = query.title;
  if (keywords && !contains([work.title, work.author], keywords)) return null;
  if (query.reviewed && !notes) return null;

  const labels = notes?.tags ?? [];
  const tagChecks = [
    ...query.selected.map((key) => labels.some((tag) => compact(tag) === key)),
    ...query.tags.map((term) => contains(labels, term))
  ];
  const tags = !tagChecks.length || (query.tagMode === 'or' ? tagChecks.some(Boolean) : tagChecks.every(Boolean));
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

  const matchedTags = labels.filter((tag) => query.selected.includes(compact(tag)) ||
    query.tags.some((term) => contains([tag], term)));
  const reason = person ? person.name + ' · ' + query.person.join(' · ') : '';
  return { work, unknown: false, reason, matchedTags };
}

function workMeta(work) {
  const pieces = [
    work.author,
    work.status,
    work.episodes != null && work.episodes + (work.unit || '화'),
    work.rating != null && '평점 ' + work.rating
  ];
  return pieces.filter(Boolean).join(' · ');
}

function coverMarkup(work, large = false) {
  const source = /^https:\/\/(?:comicthumb-phinf\.pstatic\.net|dn-img-page\.kakao\.com)\//.test(work.coverUrl)
    ? work.coverUrl : '';
  if (large && !source) return '';
  const image = source
    ? '<img class="book-image" src="' + escapeHtml(source) + '" alt="" decoding="async" referrerpolicy="no-referrer"' +
      (large ? '' : ' loading="lazy"') + '>'
    : '';
  return '<span class="book' + (large ? ' book-detail' : '') + '" data-genre="' + escapeHtml(work.genre.id) +
    '" aria-hidden="true">文' + image + '</span>';
}

function metricText(work) {
  return Object.entries(platform.metrics).map(([key, label]) => label + ' ' + (work.metrics?.[key]?.label ?? '미확인')).join(' · ');
}

function row({ work, reason, unknown, matchedTags = [] }, order) {
  const labels = work.research?.tags ?? [];
  const tags = [...new Set([...matchedTags, ...labels.slice(0, 4)])];
  const rank = order === 'genre' ? work.rank : work.metricRanks[order];
  const rankLabel = rank == null ? '집계 순위 없음'
    : (order === 'genre' ? work.genre.name : platform.name + ' ' + platform.metrics[order]) + ' ' + rank + '위';
  return '<article class="result" data-work="' + escapeHtml(work.id) + '">' +
    '<span class="rank" aria-label="' + escapeHtml(rankLabel) + '">' + (rank ?? '—') + '</span>' +
    coverMarkup(work) +
    '<div><button class="result-title" type="button" aria-haspopup="dialog">' + escapeHtml(work.title) + '</button>' +
    '<p class="result-meta">' + escapeHtml([work.genre.name + ' ' + work.rank + '위', workMeta(work)].filter(Boolean).join(' · ')) + '</p>' +
    '<p class="result-metrics">' + escapeHtml(metricText(work)) + '</p>' +
    (reason ? '<p class="result-match' + (unknown ? ' unknown' : '') + '">' + escapeHtml(reason) + '</p>' : '') +
    (tags.length ? '<div class="result-tags">' + tags.map((tag) => tagButton(tag, 'result-tag')).join('') + '</div>' : '') +
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
  const order = sortOrder.value;
  const query = {
    title: normalize(form.elements.query.value),
    tags: terms(form.elements.tag.value),
    selected: [...selectedTags],
    tagMode: form.elements.tagMode.value,
    person: terms(form.elements.character.value),
    reviewed: form.elements.reviewed.checked,
    unknown: form.elements.unknown.checked
  };
  const genre = platformGenres.find((item) => item.id === selectedGenre);
  const filtered = orderings[order].filter((work) => !genre || work.genre === genre);
  const matches = filtered.map((work) => matchWork(work, query)).filter(Boolean);
  matches.sort((first, second) => Number(first.unknown) - Number(second.unknown));
  const unknownCount = matches.filter((match) => match.unknown).length;
  const searchActive = Boolean(query.title || query.tags.length || query.selected.length || query.person.length || query.reviewed);
  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, pageCount);
  const offset = (page - 1) * pageSize;
  const paginationLabel = pageCount > 1 ? ' · ' + page + ' / ' + pageCount + ' 페이지' : '';
  resultCount.textContent = (searchActive ? '일치 ' + (total - unknownCount) + '편' : '수록 ' + total + '편') +
    (unknownCount ? ' · 미확인 ' + unknownCount + '편' : '') + paginationLabel;
  genreSource.href = genre?.url ?? platform.url;

  const removed = genre?.excludedRanks?.length ?? 0;
  let note = '';
  if (genre && !genre.entries.length) note = '확인한 공개 순위에 이 장르의 작품이 표시되지 않았습니다.';
  else if (order !== 'genre') {
    note = metricTotals[order]
      ? platform.name + ' 수록작 중 ' + platform.metrics[order] + ' 수가 확인된 ' + metricTotals[order] +
        '편의 순위입니다. 미확인 작품은 뒤에 표시합니다.' + (metricDate ? ' ' + metricDate + ' 집계.' : '')
      : platform.name + ' ' + platform.metrics[order] + ' 수를 확인한 작품이 없습니다.';
  } else if (!genre) note = platform.name + '의 장르별 ' + platform.period + '를 나란히 보여줍니다.';
  else if (removed) note = '갱신 시점이 다른 조회본에서 중복된 작품 ' + removed + '건을 제외했습니다. 남은 작품에는 공식 조회본의 순위를 유지했습니다.';
  else if (genre.entries.length < 100) note = '공개 ' + platform.period + '에서 확인한 ' + genre.entries.length + '편을 수록했습니다.';
  genreNote.hidden = !note;
  genreNote.textContent = note;

  if (total) {
    resultsPanel.innerHTML = matches.slice(offset, offset + pageSize).map((match) => row(match, order)).join('');
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
  const summary = notes?.summary ? escapeHtml(notes.summary)
    : selectedPlatform === 'kakao' && notes ? '줄거리는 카카오페이지 작품 소개에서 확인할 수 있습니다.'
    : '확인한 줄거리 정보가 없습니다.';
  const heroine = notes?.heroine ?? (visible.some((person) => person.role === '히로인') ? '있음 확인' : '미확인');
  const harem = notes?.harem ?? '미확인';
  const sources = notes?.sources?.map((source) => externalLink(source.url, source.label))
    .filter(Boolean).map((link) => '<li>' + link + '</li>').join('') ?? '';
  detail.innerHTML =
    '<header class="detail-heading">' + coverMarkup(work, true) + '<div>' +
    '<span class="pill">' + escapeHtml(platform.name + ' · ' + work.genre.name + ' ' + work.rank + '위') + '</span>' +
    '<h2 class="work-title" id="work-title">' + escapeHtml(work.title) + '</h2>' +
    '<p class="detail-meta">' + escapeHtml(workMeta(work)) + '</p>' +
    '<p class="detail-meta">' + escapeHtml(metricText(work) + (metricDate ? ' · ' + metricDate + ' 집계' : '')) + '</p>' +
    '<div class="detail-actions">' + externalLink(work.url, platform.name + ' 작품 보기', 'source-link') +
    externalLink(work.rankUrl || work.genre.url, '순위 출처', 'source-link') + '</div></div></header>' +
    '<dl class="facts"><div><dt>히로인</dt><dd>' + escapeHtml(heroine) + '</dd></div>' +
    '<div><dt>하렘</dt><dd>' + escapeHtml(harem) + '</dd></div>' +
    '<div><dt>검토 범위</dt><dd>' + (notes ? '표시된 근거' : '순위 정보') + '</dd></div></dl>' +
    '<section class="detail-section"><h3>줄거리</h3><p' + (notes?.summary ? '' : ' class="muted"') + '>' + summary + '</p></section>' +
    '<section class="detail-section"><h3>작품 태그</h3>' +
    (notes?.tags?.length ? '<div class="tags">' + notes.tags.map((tag) => tagButton(tag, 'result-tag')).join('') +
      '</div>' : '<p class="muted">상세 태그 미확인</p>') + '</section>' +
    '<section class="detail-section"><h3>등장인물</h3>' +
    (visible.length ? visible.map(personMarkup).join('') : '<p class="muted">공개 근거로 확인한 인물 정보가 없습니다.</p>') +
    (spoilers.length ? '<details class="spoilers"><summary>스포일러가 포함된 인물 정보 보기</summary>' + spoilers.map(personMarkup).join('') + '</details>' : '') + '</section>' +
    '<section class="detail-section"><h3>근거와 검토 범위</h3>' +
    (sources ? '<ul class="sources">' + sources + '</ul>'
      : '<p class="muted">' + (work.ageRestricted ? '성인 인증이 필요한 작품입니다. 공개 순위에서 제목과 기본 정보를 확인했습니다.'
        : '해당 순위 조회본에서 제목과 기본 정보를 확인했습니다.') + '</p>') +
    (notes?.notes ? '<p class="muted review-note">' + escapeHtml(notes.notes) + '</p>' : '') +
    '</section>' +
    '<details class="detail-section contribution"><summary>정보 제보</summary><div class="suggestion-content"></div></details>';
  window.NovelSuggestions?.mount(detail.querySelector('.contribution'), work.id);
  dialog.showModal();
  dialog.scrollTop = 0;
}

function compareCount(first, second, key) {
  const a = first.metrics?.[key]?.count;
  const b = second.metrics?.[key]?.count;
  if (a == null || b == null) return Number(a == null) - Number(b == null);
  return b - a;
}

function showPlatform(id) {
  const snapshot = catalog.platforms?.[id];
  selectedPlatform = id;
  platform = { ...platforms[id], ...snapshot };
  platformGenres = catalog.genres.filter((genre) => (genre.platform ?? 'series') === id);
  selectedGenre = 'all';
  page = 1;
  works = platformGenres.flatMap((genre) => genre.entries.map((entry) => ({
    ...entry, genre, research: Object.hasOwn(researchSnapshot, entry.id) ? researchSnapshot[entry.id] : null,
    metrics: id === 'series' ? seriesMetrics?.works?.[entry.id] : entry.metrics, metricRanks: {}
  })));
  worksById = new Map(works.map((work) => [work.id, work]));
  const date = new Date((id === 'series' ? seriesMetrics?.checkedAt : snapshot?.metricsCheckedAt ?? snapshot?.checkedAt) ?? '');
  metricDate = Number.isNaN(date.getTime()) ? ''
    : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(date);
  const compareTitle = (first, second) => first.title.localeCompare(second.title, 'ko') || first.id.localeCompare(second.id);
  orderings = { genre: [...works].sort((first, second) => first.rank - second.rank || compareTitle(first, second)) };
  metricTotals = {};
  const [primaryMetric, secondaryMetric] = Object.keys(platform.metrics);
  for (const key of Object.keys(platform.metrics)) {
    const other = key === primaryMetric ? secondaryMetric : primaryMetric;
    orderings[key] = [...works].sort((first, second) =>
      compareCount(first, second, key) || compareCount(first, second, other) || compareTitle(first, second));
    metricTotals[key] = 0;
    for (const work of orderings[key]) {
      if (work.metrics?.[key]?.count != null) work.metricRanks[key] = ++metricTotals[key];
    }
  }

  const tagCounts = new Map();
  for (const work of works) {
    const tags = new Map((work.research?.tags ?? []).map((label) => [compact(label), label]));
    for (const [key, label] of tags) {
      if (tagCounts.has(key)) tagCounts.get(key).count++;
      else tagCounts.set(key, { label, count: 1 });
    }
  }
  const tagEntries = [...tagCounts].sort(([, first], [, second]) =>
    second.count - first.count || first.label.localeCompare(second.label, 'ko'));
  tagCatalog.clear();
  for (const [key, tag] of tagEntries) tagCatalog.set(key, tag);
  for (const key of selectedTags) if (!tagCatalog.has(key)) selectedTags.delete(key);
  renderTagCatalog();
  renderSelectedTags();

  const displayed = platformGenres.filter((genre) => genre.entries.length).length;
  const reviewed = works.filter((work) => work.research).length;
  document.querySelector('#stat-genres').textContent = displayed + ' / ' + platformGenres.length;
  document.querySelector('#stat-ranks').textContent = works.length.toLocaleString('ko-KR');
  document.querySelector('#stat-research').textContent = reviewed.toLocaleString('ko-KR');
  document.querySelector('#catalog-title').textContent = platform.title;
  document.querySelector('#ranking-period').textContent = platform.period;
  document.querySelector('#snapshot-platform').textContent = platform.name;
  platformSource.href = platform.url;
  platformSource.textContent = platform.name + ' 순위 ↗';
  const checked = new Date(snapshot?.checkedAt ?? catalog.checkedAt);
  document.querySelector('#snapshot-date').textContent = Number.isNaN(checked.getTime())
    ? '공개 순위 조회본'
    : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long' }).format(checked) + ' 확인 · 공개 조회본';
  sortOrder.innerHTML = Object.entries(platform.metrics).map(([key, label]) =>
    '<option value="' + escapeHtml(key) + '">' + escapeHtml(label) + '순</option>').join('') +
    '<option value="genre">장르별 ' + escapeHtml(platform.period) + '</option>';
  sortOrder.value = primaryMetric;
  genresPanel.innerHTML = [{ id: 'all', name: '모든 장르', entries: works }, ...platformGenres].map((genre) =>
    '<button class="genre" type="button" data-genre="' + escapeHtml(genre.id) + '" aria-pressed="' +
    (genre.id === selectedGenre) + '">' + escapeHtml(genre.name) + '<span class="genre-count">' +
    genre.entries.length + '</span></button>').join('');
  resultsPanel.setAttribute('aria-busy', 'false');
  render();
}

function initialize(data, reviews, metrics) {
  catalog = data;
  researchSnapshot = reviews;
  seriesMetrics = metrics;
  for (const button of platformsPanel.querySelectorAll('button[data-platform]')) {
    button.disabled = !catalog.genres.some((genre) => (genre.platform ?? 'series') === button.dataset.platform && genre.entries.length);
  }
  showPlatform('series');
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
  return response.json();
}

async function loadCatalog() {
  if (backend?.configured) {
    document.querySelector('#operator-link').hidden = false;
    try {
      const live = await backend.loadCatalog();
      if (!Array.isArray(live?.catalog?.genres) || !live.catalog.genres.length ||
          live.catalog.genres.some((genre) => !Array.isArray(genre.entries)) ||
          !live.research || typeof live.research !== 'object' || Array.isArray(live.research)) {
        throw new Error('Invalid catalog response.');
      }
      return [live.catalog, live.research];
    } catch {
      const notice = document.querySelector('#data-source');
      notice.textContent = '최신 검토 정보를 불러오지 못해 저장본을 표시합니다.';
      notice.hidden = false;
    }
  }
  return Promise.all([json('./catalog.json'), json('./research.json')]);
}

form.addEventListener('submit', (event) => event.preventDefault());
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains('book-image')) event.target.hidden = true;
}, true);
form.addEventListener('input', (event) => {
  if (event.target === tagSearch) {
    renderTagCatalog();
    return;
  }
  page = 1;
  render();
});
form.addEventListener('reset', () => {
  selectedTags.clear();
  setTimeout(() => {
    renderTagCatalog();
    renderSelectedTags();
    page = 1;
    render();
  }, 0);
});
sortOrder.addEventListener('change', () => { page = 1; render(); });
platformsPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-platform]');
  if (!catalog || !button || button.disabled || button.dataset.platform === selectedPlatform) return;
  showPlatform(button.dataset.platform);
  for (const tab of platformsPanel.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab === button));
});
tagPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tag]');
  if (button) toggleTag(button.dataset.tag);
});
selectedTagPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tag]');
  if (!button) return;
  toggleTag(button.dataset.tag);
  (selectedTagPanel.querySelector('button') ?? form.elements.tag).focus();
});
genresPanel.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-genre]');
  if (!button) return;
  const nextGenre = button.dataset.genre;
  if (nextGenre !== selectedGenre) sortOrder.value = nextGenre === 'all' ? Object.keys(platform.metrics)[0] : 'genre';
  selectedGenre = nextGenre;
  for (const tab of genresPanel.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab === button));
  page = 1;
  render();
});
resultsPanel.addEventListener('click', (event) => {
  const tag = event.target.closest('button[data-tag]');
  if (tag) {
    filterByWorkTag(tag.dataset.tag);
    return;
  }
  const row = event.target.closest('article[data-work]');
  if (!row) return;
  const action = event.target.closest('a, button, input, select, textarea, summary');
  if (action && !action.classList.contains('result-title')) return;
  const work = worksById.get(row.dataset.work);
  if (!work) return;
  row.querySelector('.result-title').focus({ preventScroll: true });
  showDetail(work);
});
detail.addEventListener('click', (event) => {
  const tag = event.target.closest('button[data-tag]');
  if (!tag) return;
  dialog.close();
  filterByWorkTag(tag.dataset.tag);
});

function filterByWorkTag(label) {
  form.elements.query.value = '';
  toggleTag(label);
  resultCount.focus({ preventScroll: true });
  resultCount.scrollIntoView({ block: 'nearest' });
}

pagination.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button || button.disabled) return;
  page = Number(button.dataset.page);
  render();
  pagination.querySelector('[aria-current="page"]')?.focus();
});

if (matchMedia('(max-width: 620px)').matches) document.querySelector('#filter-panel').open = false;
Promise.all([loadCatalog(), json('./metrics.json').catch(() => null)])
  .then(([[data, reviews], metrics]) => initialize(data, reviews, metrics))
  .catch(() => {
    resultsPanel.setAttribute('aria-busy', 'false');
    resultCount.textContent = '데이터를 불러올 수 없습니다.';
    document.querySelector('#snapshot-date').textContent = '데이터 연결을 확인해주세요.';
    resultsPanel.innerHTML = '<div class="empty"><strong>순위 파일을 읽지 못했습니다.</strong><p>사이트 주소에서 페이지를 다시 열거나 공식 순위를 확인하세요.</p></div>';
  });
