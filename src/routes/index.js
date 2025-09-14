import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

function timeAgo(date) {
  try {
    const d = new Date(date);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

router.get('/', async (req, res) => {
  // Sample: fetch a few latest posts
  try {
    const view = (req.query.view || 'latest').toString().toLowerCase();
    let sql = `SELECT p.post_id, p.post_title, p.created_at,
                      u.id AS user_id, u.discord_name,
                      t.topic_id, t.topic_name,
                      COALESCE(c.cnt, 0) AS comment_count
               FROM posts p
               LEFT JOIN users u ON u.id = p.user_id
               LEFT JOIN topics t ON t.topic_id = p.topic_id
               LEFT JOIN (
                 SELECT post_id, COUNT(*) AS cnt
                 FROM comments
                 GROUP BY post_id
               ) c ON c.post_id = p.post_id`;
    const params = [];
    if (view === 'subscribed' && req.user?.id) {
      sql += `
        INNER JOIN (
          SELECT DISTINCT topic_id FROM topic_users WHERE user_id = ? AND user_topic_level >= 1
        ) tu ON tu.topic_id = p.topic_id`;
      params.push(req.user.id);
    } else if (view === 'following' && req.user?.id) {
      sql += `
        INNER JOIN followers f ON f.user_id = p.user_id AND f.follower_id = ?`;
      params.push(req.user.id);
    }
    sql += `
       ORDER BY p.post_id DESC
       LIMIT 50`;
    const [posts] = await pool.query(sql, params);

    const itemHtml = posts.map(p => {
      const postLink = `<a href="/posts/${p.post_id}">${req.clean(p.post_title || '(no title)')}</a>`;
      const userLink = `<a href="/users/${p.user_id}">${req.clean(p.discord_name || 'Anon')}</a>`;
      const topicLink = p.topic_id ? `<a href="/topics/${p.topic_id}">${req.clean(p.topic_name || 'Topic')}</a>` : 'Topic';
      const when = p.created_at ? timeAgo(p.created_at) : '';
      return (
        `<div class="post-row">
          <div class="post-title">${postLink}</div>
          <div class="post-meta">Posted by ${userLink} in ${topicLink}${when ? ' ' + req.clean(when) : ''} | ${Number(p.comment_count)} comments</div>
        </div>`
      );
    }).join('');

    const makeTab = (key, label) => {
      const active = (view === key) || (key === 'latest' && (view !== 'subscribed' && view !== 'following'));
      const href = key === 'latest' ? '/' : `/?view=${key}`;
      return `<a href="${href}" ${active ? 'class="muted"' : ''}>${label}</a>`;
    };
    const tabs = `${makeTab('latest','Latest')} <span class="sep">|</span> ${makeTab('subscribed','Subscribed')} <span class="sep">|</span> ${makeTab('following','Following')}`;

    res.render('layout', {
      title: 'Home',
      body: `
        <h2>Posts</h2>
        <div class="subnav">${tabs}</div>
        <div class="post-grid" style="margin-top:8px;">
          ${itemHtml || '<p>No posts yet.</p>'}
        </div>
      `
    });
  } catch (e) {
    res.render('layout', { title: 'Home', body: `<p>Error loading posts.</p>` });
  }
});

router.post('/toggle-theme', (req, res) => {
  const newTheme = (req.session.theme === 'dark' || req.cookies?.theme === 'dark') ? 'light' : 'dark';
  req.session.theme = newTheme;
  res.cookie('theme', newTheme, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production'
  });
  res.redirect('/');
});

export default router;
