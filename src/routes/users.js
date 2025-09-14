import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/authz.js';

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

// User page: list posts by a user
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).render('layout', { title: 'Not Found', body: '<p>User not found.</p>' });
  try {
    const [[user]] = await pool.query('SELECT id, discord_name FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).render('layout', { title: 'Not Found', body: '<p>User not found.</p>' });
    // Following status
    let isFollowing = false;
    let cringe = false;
    if (req.user?.id) {
      cringe = req.query.cringe === '1' && req.user.id === id;
      const [[row]] = await pool.query('SELECT 1 FROM followers WHERE user_id = ? AND follower_id = ? LIMIT 1', [id, req.user.id]);
      isFollowing = !!row;
    }
    const [posts] = await pool.query(
      `SELECT p.post_id, p.post_title, p.created_at,
              t.topic_id, t.topic_name,
              COALESCE(c.cnt, 0) AS comment_count
       FROM posts p
       LEFT JOIN topics t ON t.topic_id = p.topic_id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS cnt
         FROM comments
         GROUP BY post_id
       ) c ON c.post_id = p.post_id
       WHERE p.user_id = ?
       ORDER BY p.post_id DESC
       LIMIT 50`,
      [id]
    );
    const items = posts.map(p => {
      const postLink = `<a href="/posts/${p.post_id}">${req.clean(p.post_title || '(no title)')}</a>`;
      const topicLink = p.topic_id ? `<a href="/topics/${p.topic_id}">${req.clean(p.topic_name || 'Topic')}</a>` : 'Topic';
      const when = p.created_at ? timeAgo(p.created_at) : '';
      return `<div class="post-row"><div class="post-title">${postLink}</div><div class="post-meta">in ${topicLink}${when ? ' ' + req.clean(when) : ''} | ${Number(p.comment_count)} comments</div></div>`;
    }).join('');
    const followControls = req.user?.id
      ? (
          req.user.id === id
            ? `<div class="muted" style="margin:8px 0">You can't follow yourself, that's really cringe, bro...</div>`
            : (isFollowing
                ? `<form method="post" action="/users/${id}/unfollow" style="margin: 8px 0"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="btn" type="submit">Unfollow</button></form>`
                : `<form method="post" action="/users/${id}/follow" style="margin: 8px 0"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="btn" type="submit">Follow</button></form>`
              )
        )
      : '';
    const cringeNote = cringe ? `<div class="muted" style="margin:4px 0">You can't follow yourself, that's really cringe, bro...</div>` : '';
    res.render('layout', { title: req.clean(user.discord_name), body: `<h2>${req.clean(user.discord_name)}</h2>${followControls}${cringeNote}<div class="post-grid">${items || '<p>No posts yet.</p>'}</div>` });
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to load user.</p>' });
  }
});

// Follow a user
router.post('/:id/follow', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/');
  try {
    if (req.user.id === id) return res.redirect(`/users/${id}?cringe=1`);
    await pool.query('INSERT IGNORE INTO followers (user_id, follower_id) VALUES (?, ?)', [id, req.user.id]);
    res.redirect(`/users/${id}`);
  } catch (e) {
    res.redirect(`/users/${id}`);
  }
});

// Unfollow a user
router.post('/:id/unfollow', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/');
  try {
    await pool.query('DELETE FROM followers WHERE user_id = ? AND follower_id = ?', [id, req.user.id]);
    res.redirect(`/users/${id}`);
  } catch (e) {
    res.redirect(`/users/${id}`);
  }
});

export default router;
