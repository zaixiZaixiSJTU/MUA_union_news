import { $, element } from './dom.js';

function dateLabel(value, includeTime = true) {
  if (!value) return '尚未检查';
  const normalized = String(value).replace(' ', 'T');
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 16).replace('T', ' ');
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    timeZone: 'Asia/Shanghai'
  }).format(date);
}

export function sourceRule(source) {
  if (source.rule_json && typeof source.rule_json === 'object') return source.rule_json;
  try { return JSON.parse(source.rule_json || '{}'); } catch { return {}; }
}

function sourceStatus(source) {
  if (!source.enabled) return { kind: 'disabled', label: '已停用' };
  if (source.last_error) return { kind: 'error', label: '需要处理', detail: source.last_error };
  return { kind: 'enabled', label: '正常' };
}

function sourceIcon(source) {
  const fallback = () => element('span', { className: 'source-icon source-icon-fallback', text: String(source.school || 'M').slice(0, 1) });
  if (!source.icon_url) return fallback();
  const image = element('img', { className: 'source-icon', attrs: { src: source.icon_url, alt: '', loading: 'lazy' } });
  image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
  return image;
}

function td(label, child, className = '') {
  return element('td', { className, attrs: { 'data-label': label } }, child);
}

function actionButton(label, action, className = '') {
  const button = element('button', { className: `row-button ${className}`.trim(), text: label, attrs: { type: 'button' } });
  button.addEventListener('click', () => action(button));
  return button;
}

function sourceRow(source, actions) {
  const identity = element('div', { className: 'source-identity' }, sourceIcon(source));
  const copy = element('div');
  copy.append(element('strong', { text: source.school }));
  const site = element('a', { text: source.name || source.site_url, attrs: { href: source.site_url, target: '_blank', rel: 'noopener noreferrer', title: source.site_url } });
  copy.append(site);
  identity.append(copy);

  const rule = sourceRule(source);
  const status = sourceStatus(source);
  const statusBlock = element('div', { className: 'status-block' },
    element('span', { className: `status-label ${status.kind === 'enabled' ? '' : status.kind}`.trim(), text: status.label })
  );
  if (status.detail) statusBlock.append(element('span', { className: 'status-detail', text: status.detail, attrs: { title: status.detail } }));

  const buttons = element('div', { className: 'row-actions' },
    actionButton('编辑', () => actions.edit(source)),
    actionButton('采集', button => actions.crawl(source, button)),
    actionButton('删除', () => actions.remove(source), 'danger')
  );

  return element('tr', {},
    td('来源', identity),
    td('规则', element('span', { className: 'rule-chip', text: rule.type || '未知' })),
    td('状态', statusBlock),
    td('最近检查', element('span', { className: 'date-cell', text: dateLabel(source.last_checked_at) })),
    td('操作', buttons, 'row-actions-cell')
  );
}

export function renderSources(sources, actions) {
  const query = $('#source-search').value.trim().toLowerCase();
  const filter = $('#source-filter').value;
  const visible = sources.filter(source => {
    const status = sourceStatus(source).kind;
    const haystack = `${source.school} ${source.name} ${source.site_url}`.toLowerCase();
    return (!query || haystack.includes(query)) && (filter === 'all' || filter === status);
  });

  $('#source-rows').replaceChildren(...visible.map(source => sourceRow(source, actions)));
  $('#source-result-count').textContent = `${visible.length} / ${sources.length}`;
  $('#source-empty').hidden = visible.length > 0;
  $('.source-table').hidden = visible.length === 0;
}

function adminRow(admin, currentUser, remove) {
  const email = element('span', { className: 'admin-email', text: admin.email });
  if (admin.email === currentUser.email) email.append(element('span', { className: 'current-badge', text: '当前账号' }));
  const button = actionButton('移除', () => remove(admin), 'danger');
  button.disabled = admin.email === currentUser.email;
  if (button.disabled) button.title = '不能移除当前登录账号';
  return element('tr', {},
    td('邮箱', email),
    td('添加人', element('span', { text: admin.created_by || '—' })),
    td('添加时间', element('span', { className: 'date-cell', text: dateLabel(admin.created_at) })),
    td('操作', element('div', { className: 'row-actions' }, button), 'row-actions-cell')
  );
}

export function renderAdmins(admins, currentUser, remove) {
  $('#admin-rows').replaceChildren(...admins.map(admin => adminRow(admin, currentUser, remove)));
}

export function renderSummary(stats, settings, sources) {
  const enabled = sources.filter(source => source.enabled).length;
  const errors = sources.filter(source => source.enabled && source.last_error).length;
  $('#metric-sources').textContent = stats.sources;
  $('#metric-articles').textContent = stats.articles;
  $('#metric-errors').textContent = errors;
  $('#metric-enabled').textContent = `${enabled} 个已启用`;
  $('#metric-crawling').textContent = settings.crawling ? '采集中' : '空闲';
  $('#last-crawl').textContent = settings.lastCrawlAt ? `上次开始 ${dateLabel(settings.lastCrawlAt)}` : '尚未执行全量采集';
  $('#interval').value = settings.crawlIntervalMinutes;
}
