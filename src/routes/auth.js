import { Router } from 'express';
import passport from 'passport';

const router = Router();

router.get('/discord', passport.authenticate('discord'));

router.get('/discord/callback', passport.authenticate('discord', {
  failureRedirect: '/login'
}), (req, res) => {
  res.redirect('/');
});

router.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

router.get('/login', (req, res) => {
  res.render('layout', {
    title: 'Login',
    body: `
      <h2>Login</h2>
      <p><a class="btn" href="/auth/discord">Login with Discord</a></p>
    `
  });
});

export default router;
