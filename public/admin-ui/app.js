import { request, setCsrfToken } from './api.js';
import { $, setBusy, showToast } from './dom.js';
import { renderAdmins, renderSources, renderSummary, sourceRule } from './view.js';

const state = { sources: [], admins: [], user: null, editId: null };

function maskEmail(value) {
  const [name, domain] = String(value || '').split('@');
  if (!domain) return value || '—';
  return `${name.slice(0, 2)}${name.length > 2 ? '•••' : ''}@${domain}`;
}

const actions = {
  edit: openEditor,
  crawl: crawlSource,
  remove: removeSource
};

async function refresh() {
  const [stats, settings, sources, admins] = await Promise.all([
    request('/api/stats'), request('/api/admin/settings'),
    request('/api/admin/sources'), request('/api/admin/admins')
  ]);
  state.sources = sources;
  state.admins = admins;
  renderSummary(stats, settings, sources);
  renderSources(sources, actions);
  renderAdmins(admins, state.user, removeAdmin);
}

function setRuleValidation() {
  const indicator = $('#rule-validation');
  try {
    JSON.parse($('#source-form').elements.rule.value);
    indicator.textContent = 'JSON 格式正确';
    indicator.classList.remove('invalid');
    return true;
  } catch {
    indicator.textContent = 'JSON 格式有误';
    indicator.classList.add('invalid');
    return false;
  }
}

function openEditor(source = null) {
  state.editId = source?.id || null;
  const form = $('#source-form');
  form.reset();
  $('#dialog-title').textContent = source ? '编辑资讯源' : '新增资讯源';
  form.elements.school.value = source?.school || '';
  form.elements.name.value = source?.name || '';
  form.elements.siteUrl.value = source?.site_url || '';
  form.elements.iconUrl.value = source?.icon_url || '';
  form.elements.rule.value = JSON.stringify(source ? sourceRule(source) : { type: 'auto' }, null, 2);
  form.elements.enabled.checked = source ? Boolean(source.enabled) : true;
  setRuleValidation();
  $('#source-dialog').showModal();
  requestAnimationFrame(() => form.elements.school.focus());
}

async function crawlSource(source, button) {
  setBusy(button, true, '采集中');
  try {
    const result = await request(`/api/admin/sources/${source.id}/crawl`, { method: 'POST' });
    showToast(`${source.school}：已处理 ${result.saved || 0} 篇文章`);
    await refresh();
  } catch (error) {
    showToast(`${source.school}：${error.message}`, 'error');
    await refresh();
  } finally { setBusy(button, false); }
}

async function removeSource(source) {
  if (!confirm(`确定删除“${source.school}”及其全部已采集文章吗？`)) return;
  try {
    await request(`/api/admin/sources/${source.id}`, { method: 'DELETE' });
    showToast('资讯源已删除');
    await refresh();
  } catch (error) { showToast(error.message, 'error'); }
}

async function removeAdmin(admin) {
  if (!confirm(`确定移除管理员“${admin.email}”吗？其后台权限会立即失效。`)) return;
  try {
    await request(`/api/admin/admins/${encodeURIComponent(admin.email)}`, { method: 'DELETE' });
    showToast('管理员已移除');
    await refresh();
  } catch (error) { showToast(error.message, 'error'); }
}

async function logout() {
  try { await request('/auth/logout', { method: 'POST' }); } finally { location.href = '/'; }
}

function bindEvents() {
  $('#add-source').addEventListener('click', () => openEditor());
  $('#close-dialog').addEventListener('click', () => $('#source-dialog').close());
  $('#cancel-dialog').addEventListener('click', () => $('#source-dialog').close());
  $('#source-dialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#source-search').addEventListener('input', () => renderSources(state.sources, actions));
  $('#source-filter').addEventListener('change', () => renderSources(state.sources, actions));
  $('#source-form').elements.rule.addEventListener('input', setRuleValidation);
  $('#logout').addEventListener('click', logout);
  $('#mobile-logout').addEventListener('click', logout);

  $('#source-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!setRuleValidation()) return showToast('请先修正采集规则的 JSON 格式', 'error');
    const form = event.currentTarget;
    const button = $('#save-source');
    setBusy(button, true, '保存中');
    try {
      const body = {
        school: form.elements.school.value,
        name: form.elements.name.value,
        siteUrl: form.elements.siteUrl.value,
        iconUrl: form.elements.iconUrl.value,
        rule: JSON.parse(form.elements.rule.value),
        enabled: form.elements.enabled.checked
      };
      await request(state.editId ? `/api/admin/sources/${state.editId}` : '/api/admin/sources', {
        method: state.editId ? 'PUT' : 'POST', body: JSON.stringify(body)
      });
      $('#source-dialog').close();
      showToast('资讯源已保存');
      await refresh();
    } catch (error) { showToast(`保存失败：${error.message}`, 'error'); }
    finally { setBusy(button, false); }
  });

  $('#admin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    setBusy(button, true, '添加中');
    try {
      await request('/api/admin/admins', { method: 'POST', body: JSON.stringify({ email: form.elements.email.value }) });
      form.reset();
      showToast('管理员已添加');
      await refresh();
    } catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
  });

  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    setBusy(button, true, '保存中');
    try {
      await request('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ crawlIntervalMinutes: Number($('#interval').value) }) });
      showToast('采集周期已保存');
    } catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
  });

  $('#crawl-all').addEventListener('click', async event => {
    const button = event.currentTarget;
    setBusy(button, true, '正在启动');
    try {
      await request('/api/admin/crawl', { method: 'POST' });
      $('#metric-crawling').textContent = '采集中';
      showToast('已开始采集所有启用的来源');
    } catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
  });

  const sections = [...document.querySelectorAll('.page-section')];
  const navLinks = [...document.querySelectorAll('.side-nav a')];
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach(link => link.classList.toggle('active', link.hash === `#${visible.target.id}`));
  }, { rootMargin: '-15% 0px -65%', threshold: [0, .2, .6] });
  sections.forEach(section => observer.observe(section));
}

async function boot() {
  try {
    const session = await request('/api/session');
    if (!session.user?.admin) {
      $('#admin-locked h1').textContent = '需要管理员登录';
      $('#locked-message').textContent = session.user ? '当前账号没有管理员权限。' : '请使用管理员邮箱绑定的 MUA 账号登录。';
      return;
    }
    state.user = session.user;
    setCsrfToken(session.csrf);
    $('#user-email').textContent = maskEmail(session.user.email);
    $('#user-email').title = session.user.email;
    $('#user-avatar').textContent = String(session.user.email || 'M').slice(0, 1).toUpperCase();
    $('#admin-main').hidden = false;
    $('#admin-locked').hidden = true;
    bindEvents();
    await refresh();
  } catch (error) {
    $('#admin-locked h1').textContent = '后台暂时无法加载';
    $('#locked-message').textContent = error.message;
  }
}

boot();
