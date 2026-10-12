const $ = selector => document.querySelector(selector);
const state = { page: 1, size: 12, total: 0 };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function dateLabel(value) {
  if (!value) return '日期未知';
  const date = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.valueOf()) ? '日期未知' : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai'
  }).format(date);
}

function showImagePlaceholder(container, message) {
  container.classList.add('no-image');
  container.replaceChildren(el('span', '', message));
}

function card(item) {
  const article = el('article', 'card card-blog card-plain hentry');
  const row = el('div', 'row');
  const imageColumn = el('div', 'col-ms-5 col-sm-5');
  const image = el('div', 'card-image');
  const imageLink = el('a');
  imageLink.href = item.link;
  imageLink.title = item.title;
  imageLink.target = '_blank';
  imageLink.rel = 'noopener noreferrer';

  if (item.imageUrl) {
    const img = el('img', 'attachment-hestia-blog size-hestia-blog wp-post-image');
    img.src = item.imageUrl;
    img.alt = '';
    img.width = 360;
    img.height = 240;
    img.loading = 'lazy';
    img.onerror = () => showImagePlaceholder(image, '图片暂不可用');
    imageLink.append(img);
    image.append(imageLink);
  } else {
    showImagePlaceholder(image, '暂无封面');
  }
  imageColumn.append(image);

  const body = el('div', 'col-ms-7 col-sm-7');
  const category = el('h6', 'category text-info');
  category.append(el('span', '', item.school));

  const title = el('h2', 'card-title entry-title');
  const titleLink = el('a', '', item.title);
  titleLink.href = item.link;
  titleLink.title = item.title;
  titleLink.target = '_blank';
  titleLink.rel = 'bookmark noopener noreferrer';
  title.append(titleLink);

  const description = el('div', 'card-description entry-summary');
  description.append(el('p', '', item.abstract || '点击前往原站阅读完整内容。'));

  const foot = el('div', 'posted-by vcard author');
  const author = item.author || { name: item.sourceName || item.school, iconSrc: '' };
  const badge = el('span', 'author-badge');
  badge.append(el('span', 'author-brand', 'MUA'), el('span', 'author-divider', '|'));
  if (author.iconSrc) {
    const icon = el('img', 'author-icon');
    icon.src = author.iconSrc;
    icon.alt = '';
    icon.loading = 'lazy';
    icon.onerror = () => icon.replaceWith(el('span', 'author-icon-fallback', 'M'));
    badge.append(icon);
  } else {
    badge.append(el('span', 'author-icon-fallback', 'M'));
  }
  badge.append(el('b', 'author-name fn', author.name || item.school));
  foot.append(badge, el('span', 'article-date', `，${dateLabel(item.publishedAt)}`));

  body.append(category, title, description, foot);
  row.append(imageColumn, body);
  article.append(row);
  return article;
}

function updatePagination() {
  const links = $('#pagination-links');
  const totalPages = Math.max(1, Math.ceil(state.total / state.size));
  links.replaceChildren();

  const changePage = page => {
    const link = el('a', 'page-numbers', String(page));
    link.href = `?page=${page}`;
    link.addEventListener('click', event => {
      event.preventDefault();
      state.page = page;
      loadArticles();
      $('.main').scrollIntoView();
    });
    return link;
  };

  if (state.page > 1) {
    const previous = el('a', 'prev page-numbers', '上一页');
    previous.href = `?page=${state.page - 1}`;
    previous.addEventListener('click', event => {
      event.preventDefault();
      state.page--;
      loadArticles();
      $('.main').scrollIntoView();
    });
    links.append(previous);
  }

  const start = Math.max(1, Math.min(state.page - 1, totalPages - 2));
  const end = Math.min(totalPages, start + 2);
  for (let page = start; page <= end; page++) {
    if (page === state.page) {
      const current = el('span', 'page-numbers current', String(page));
      current.setAttribute('aria-current', 'page');
      links.append(current);
    } else {
      links.append(changePage(page));
    }
  }

  if (state.page < totalPages) {
    const next = el('a', 'next page-numbers', '下一页');
    next.href = `?page=${state.page + 1}`;
    next.addEventListener('click', event => {
      event.preventDefault();
      state.page++;
      loadArticles();
      $('.main').scrollIntoView();
    });
    links.append(next);
  }
}

async function loadArticles() {
  const grid = $('#article-grid');
  grid.replaceChildren(el('div', 'loading-state', '正在加载校园动态…'));
  try {
    const response = await fetch(`/api/articles?page=${state.page}&pageSize=${state.size}`);
    if (!response.ok) throw new Error('加载失败');
    const data = await response.json();
    state.total = data.total;
    grid.replaceChildren();
    if (!data.items.length) grid.append(el('div', 'empty-state', '暂时没有资讯。'));
    else grid.append(...data.items.map(card));
    updatePagination();
  } catch {
    grid.replaceChildren(el('div', 'empty-state', '资讯加载失败，请稍后重试。'));
  }
}

async function boot() {
  try {
    const session = await (await fetch('/api/session')).json();
    if (session.user?.admin) {
      $('#account-link').href = '/admin';
      $('#account-link').textContent = '管理后台';
    }
  } catch {}

  loadArticles();
}

boot();
