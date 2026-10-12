const knownRules = {
  'mc.ecustvr.top': { type: 'html', url: 'https://mc.ecustvr.top/', itemSelector: '.recent-post-item', titleSelector: '.article-title', linkSelector: '.article-title', abstractSelector: '.content', imageSelector: '.post-bg', dateSelector: 'time' },
  'gdufscraft.top': { type: 'html', url: 'https://gdufscraft.top/news', itemSelector: 'a[href^="/news/"]', linkSelector: ':self', titleSelector: 'h2, h3', abstractSelector: 'p', imageSelector: 'img', dateSelector: 'time' },
  'fdcraft.github.io': { type: 'html', url: 'https://fdcraft.github.io/news/', itemSelector: '.tip.custom-block', titleSelector: 'a', linkSelector: 'a', dateSelector: '.custom-block-title' },
  'ccutmc.bickey.net': { type: 'html', url: 'https://ccutmc.bickey.net/posts/', unwrapSelector: 'noscript', itemSelector: '.prose li', titleSelector: 'a', linkSelector: 'a' },
  'uemcraft.cn': { type: 'json', url: 'https://uemcraft.cn/api/news.php?action=list&limit=100', itemsPath: 'data', linkTemplate: 'https://uemcraft.cn/news/{slug}', fields: { id: 'id', title: 'title', abstract: 'excerpt', image: 'cover', keywords: 'tags', date: 'date' } },
  'blog.qutcraft.cn': { type: 'json', url: 'https://blog.qutcraft.cn/api/v1/portal/organizations/qutcraft/posts', itemsPath: 'data', linkTemplate: 'https://blog.qutcraft.cn/posts/{id}', fields: { id: 'id', title: 'title', abstract: 'excerpt', keywords: 'category', date: 'published_at' } },
  'yitmc.cn': { type: 'json', url: 'https://yitmc.cn/data/news.json', itemsPath: 'news', linkTemplate: 'https://yitmc.cn/news?id={id}', fields: { id: 'id', title: 'title', abstract: 'summary', image: 'image', keywords: 'type', date: 'date' } },
  'seubcl.cn': { type: 'rss', url: 'https://seubcl.cn/rss.xml' },
  'nuistcraft.com': { type: 'rss', url: 'https://www.nuistcraft.com/blog/rss.xml' },
  'sitmc.club': { type: 'wordpress', url: 'https://www.sitmc.club/wp-json/wp/v2/posts?per_page=30&_embed=1' },
  'www.minejufe.cn': { type: 'wordpress', url: 'https://www.minejufe.cn/wp-json/wp/v2/posts?per_page=30&_embed=1' },
  'cop.cooo.site': { type: 'rss', url: 'https://cop.cooo.site/atom.xml' },
  'mc.bobby.com.cn': { type: 'wordpress', url: 'http://mc.bobby.com.cn/index.php/wp-json/wp/v2/posts?per_page=30&_embed=1' },
  'mine.blanoir.com': { type: 'html', url: 'https://mine.blanoir.com/changelog', itemSelector: 'a.journal-card', titleSelector: 'h2', linkSelector: ':self', dateSelector: 'time' },
  'ysumc.net': { type: 'html', url: 'https://ysumc.net/document/reports.html', itemSelector: 'div.not-prose.bg-white.shadow-lg', titleSelector: 'h3', linkSelector: 'a.route-link', abstractSelector: 'p', imageSelector: 'img', dateSelector: '.text-sm.text-gray', requireFullDate: 'true' },
  'njitmc.club': { type: 'json', url: 'https://njitmc.club/data.js', jsonPrefix: 'window.CLUB_DATA =', itemsPath: 'news', linkTemplate: 'https://njitmc.club/#newsdetails?id={id}', fields: { id: 'id', title: 'title', abstract: 'content', date: 'date' } },
  'www.nmo.net.cn': { type: 'nmo', url: 'https://nmo.net.cn:25569/necore/news/list' },
  'mc.taru.xj.cn': { type: 'json', url: 'https://hall.mc.taru.xj.cn/api/public/theme/context?blocks=activity-square&limit=50&cmsLatest=50', itemsPath: 'data.blocks.activity-square.activities', fields: { id: 'id', title: 'title', abstract: 'summary', image: 'cover', link: 'url', date: 'meta' } }
};

export const initialSources = [
  ['成都信息工程大学', 'www.asyncraft.club'],
  ['大连交通大学', 'mc.bobby.com.cn'],
  ['电子科技大学成都学院', 'mc.cduestc.fun'],
  ['东华理工大学', 'mine.blanoir.com'],
  ['东南大学', 'seubcl.cn'],
  ['复旦大学', 'fdcraft.github.io'],
  ['广东外语外贸大学', 'gdufscraft.top'],
  ['华东理工大学', 'mc.ecustvr.top'],
  ['江西财经大学', 'www.minejufe.cn'],
  ['南京大学', 'www.nmo.net.cn'],
  ['南京工程学院', 'njitmc.club'],
  ['南京信息工程大学', 'nuistcraft.com'],
  ['内蒙古大学', 'docs.imucraft.cn'],
  ['齐鲁工业大学', 'wlyw.qlu.edu.cn'],
  ['青岛理工大学', 'blog.qutcraft.cn'],
  ['上海交通大学', 'mc.sjtu.cn'],
  ['上海应用技术大学', 'sitmc.club'],
  ['塔里木大学', 'mc.taru.xj.cn'],
  ['西安邮电大学', 'cop.cooo.site'],
  ['燕京理工学院', 'yitmc.cn'],
  ['燕山大学', 'ysumc.net'],
  ['应急管理大学', 'uemcraft.cn'],
  ['长春工业大学', 'ccutmc.bickey.net'],
  ['中国地质大学（武汉）', 'www.mcug.cn'],
  ['重庆大学', 'www.cqumc.cn']
].map(([school, domain]) => ({
  school,
  name: `${school} Minecraft 社团`,
  siteUrl: ({
    'mc.bobby.com.cn': 'http://mc.bobby.com.cn/',
    'www.nmo.net.cn': 'https://nmo.net.cn:25569/',
    'mc.taru.xj.cn': 'https://hall.mc.taru.xj.cn/site/'
  })[domain] || `https://${domain}/`,
  rule: domain === 'mc.sjtu.cn'
    ? { type: 'sjmcl', url: 'https://mc.sjtu.cn/api-sjmcl/article?pageSize=30' }
    : knownRules[domain] || { type: 'auto' }
}));
