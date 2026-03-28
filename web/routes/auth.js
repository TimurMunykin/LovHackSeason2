const { Router } = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { PrismaClient } = require('@prisma/client');
const { DEV_USER } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = Router();

// ── Dev bypass login (only active when DEV_AUTH_BYPASS=true) ──────────────
router.get('/dev-login', (req, res) => {
  if (process.env.DEV_AUTH_BYPASS !== 'true') {
    return res.status(403).send('Dev login is disabled in this environment.');
  }
  // Stamp the fake user onto the session so passport-aware code is happy
  req.session.devUser = DEV_USER;
  res.redirect('/dashboard');
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await prisma.user.upsert({
          where: { googleId: profile.id },
          update: {
            name: profile.displayName,
            email: profile.emails[0].value,
            avatarUrl: profile.photos?.[0]?.value || null,
            googleAccessToken: accessToken,
            ...(refreshToken && { googleRefreshToken: refreshToken }),
          },
          create: {
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            avatarUrl: profile.photos?.[0]?.value || null,
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken || null,
          },
        });
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
  accessType: 'offline',
  prompt: 'consent',
}));

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (_req, res) => res.redirect('/dashboard')
);

router.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

router.get('/me', (req, res) => {
  if (process.env.DEV_AUTH_BYPASS === 'true') {
    return res.json(DEV_USER);
  }
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const { id, name, email, avatarUrl } = req.user;
  res.json({ id, name, email, avatarUrl });
});

module.exports = router;
