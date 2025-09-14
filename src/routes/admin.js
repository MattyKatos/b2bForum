import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdmin } from '../middleware/authz.js';

const router = Router();

// All admin routes require admin
router.use(requireAdmin);

// Admin home: simple topic list and creation form
router.get('/topics', async (req, res) => {
  const [topics] = await pool.query('SELECT topic_id, topic_name, topic_description, topic_approved FROM topics ORDER BY topic_name ASC');
  const rows = topics.map(t => `
    <tr>
      <td>${req.clean(t.topic_name)}</td>
      <td>${req.clean(t.topic_description || '')}</td>
      <td>${t.topic_approved ? 'Yes' : 'No'}</td>
      <td>
        ${t.topic_approved ? '' : `<form method="post" action="/admin/topics/${t.topic_id}/approve" style="display:inline"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="btn" type="submit">Approve</button></form>`}
        <form method="post" action="/admin/topics/${t.topic_id}/delete" style="display:inline; margin-left:6px"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="btn" type="submit">Delete</button></form>
      </td>
    </tr>`).join('');
  const topicsOptions = topics.map(t => `<option value="${t.topic_id}">${req.clean(t.topic_name)}</option>`).join('');

  res.render('layout', {
    title: 'Admin • Topics',
    body: `
      <h2>Topics</h2>
      <table class="table">
        <thead><tr><th>Name</th><th>Description</th><th>Approved</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">No topics</td></tr>'}</tbody>
      </table>

      <h3>Set Site Admin</h3>
      <form method="post" action="/admin/site/set-admin">
        <input type="hidden" name="_csrf" value="${res.locals.csrfToken}">
        <input type="hidden" name="user_id" id="siteUserId">
        <div>
          <label>User (search by username)<br>
            <input type="text" id="siteUserSearch" data-user-search="true" data-target="siteUserId" placeholder="Start typing...">
            <div class="search-results" id="siteUserResults"></div>
          </label>
        </div>
        <button class="btn" type="submit">Grant Site Admin</button>
      </form>

      <h3>Set Topic Admin</h3>
      <form method="post" action="/admin/topics/set-admin">
        <input type="hidden" name="_csrf" value="${res.locals.csrfToken}">
        <div>
          <label>Topic<br>
            <select name="topic_id" required>
              ${topicsOptions}
            </select>
          </label>
        </div>
        <input type="hidden" name="user_id" id="topicUserId">
        <div>
          <label>User (search by username)<br>
            <input type="text" id="topicUserSearch" data-user-search="true" data-target="topicUserId" placeholder="Start typing...">
            <div class="search-results" id="topicUserResults"></div>
          </label>
        </div>
        <button class="btn" type="submit">Grant Admin</button>
      </form>

      <h3>Set Topic Owner</h3>
      <form method="post" action="/admin/topics/set-owner">
        <input type="hidden" name="_csrf" value="${res.locals.csrfToken}">
        <div>
          <label>Topic<br>
            <select name="topic_id" required>
              ${topicsOptions}
            </select>
          </label>
        </div>
        <input type="hidden" name="user_id" id="topicOwnerUserId">
        <div>
          <label>User (search by username)<br>
            <input type="text" id="topicOwnerSearch" data-user-search="true" data-target="topicOwnerUserId" placeholder="Start typing...">
            <div class="search-results" id="topicOwnerResults"></div>
          </label>
        </div>
        <button class="btn" type="submit">Grant Owner (Rank 10)</button>
      </form>

      <script>
        (function(){
          async function searchUsers(q){
            const r = await fetch('/admin/users/search?q=' + encodeURIComponent(q));
            if(!r.ok) return [];
            return r.json();
          }
          function bindSearch(inputId, resultsId, targetHiddenId){
            const input = document.getElementById(inputId);
            const results = document.getElementById(resultsId);
            const target = document.getElementById(targetHiddenId);
            if(!input || !results || !target) return;
            let timer;
            input.addEventListener('input', function(){
              clearTimeout(timer);
              const q = input.value.trim();
              if(!q){ results.innerHTML=''; target.value=''; return; }
              timer = setTimeout(async function(){
                const data = await searchUsers(q);
                results.innerHTML = data.map(function(u){
                  return '<div class="result" data-id="' + u.id + '">' + u.discord_name + ' <span class="muted">(#' + u.id + ')</span></div>';
                }).join('');
              }, 200);
            });
            results.addEventListener('click', function(e){
              const el = e.target.closest('.result');
              if(!el) return;
              target.value = el.getAttribute('data-id');
              input.value = el.textContent.trim();
              results.innerHTML='';
            });
          }
          bindSearch('siteUserSearch','siteUserResults','siteUserId');
          bindSearch('topicUserSearch','topicUserResults','topicUserId');
          bindSearch('topicOwnerSearch','topicOwnerResults','topicOwnerUserId');
        })();
      </script>
    `
  });
});

// Set site admin by Discord ID (sets users.user_level = 9)
router.post('/site/set-admin', async (req, res) => {
  const userId = Number(req.body.user_id);
  if (!Number.isInteger(userId)) return res.redirect('/admin/topics');
  try {
    await pool.query('UPDATE users SET user_level = 9 WHERE id = ?', [userId]);
  } finally {
    res.redirect('/admin/topics');
  }
});

// Approve topic
router.post('/topics/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/admin/topics');
  await pool.query('UPDATE topics SET topic_approved = 1 WHERE topic_id = ?', [id]);
  res.redirect('/admin/topics');
});

// Delete topic
router.post('/topics/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/admin/topics');
  await pool.query('DELETE FROM topics WHERE topic_id = ?', [id]);
  res.redirect('/admin/topics');
});

// Grant topic admin by Discord ID (maps to users.id via users.discord_id)
router.post('/topics/set-admin', async (req, res) => {
  const topicId = Number(req.body.topic_id);
  const userId = Number(req.body.user_id);
  if (!Number.isInteger(topicId) || !Number.isInteger(userId)) return res.redirect('/admin/topics');
  await pool.query(`INSERT INTO topic_users (topic_id, user_id, user_topic_level)
                    VALUES (?, ?, 9)
                    ON DUPLICATE KEY UPDATE user_topic_level = GREATEST(user_topic_level, VALUES(user_topic_level))`, [topicId, userId]);
  res.redirect('/admin/topics');
});

// User search endpoint (by username, partial)
router.get('/users/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  const [rows] = await pool.query('SELECT id, discord_id, discord_name FROM users WHERE discord_name LIKE ? ORDER BY discord_name ASC LIMIT 20', [`%${q}%`]);
  res.json(rows);
});

// Set topic owner (rank 10)
router.post('/topics/set-owner', async (req, res) => {
  const topicId = Number(req.body.topic_id);
  const userId = Number(req.body.user_id);
  if (!Number.isInteger(topicId) || !Number.isInteger(userId)) return res.redirect('/admin/topics');
  await pool.query(`INSERT INTO topic_users (topic_id, user_id, user_topic_level)
                    VALUES (?, ?, 10)
                    ON DUPLICATE KEY UPDATE user_topic_level = 10`, [topicId, userId]);
  res.redirect('/admin/topics');
});

export default router;
