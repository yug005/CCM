# Developer Admin Dashboard

This server supports an optional developer-only dashboard to:
- See all active rooms and who is playing in each room
- Kick any player with a custom message shown on their screen

## Enable (Render)

1. In Render → your service → **Environment**, add:
   - `ADMIN_TOKEN` = a long secret (keep private)
2. Deploy/restart.

## Use

Open:

`https://<your-app>.onrender.com/admin?token=<ADMIN>` `token=> yugADMIN`

Notes:
- If `ADMIN_TOKEN` is not set, the `/admin` route returns 404 and the admin Socket.IO namespace is disabled.
- Kicked players will see your custom message and return to the home screen.

# 🚀 Deployment Guide - Color Clash Multiplayer

Your game is now **production-ready**! Here's how to deploy it online so you can play with friends from anywhere.

## 🎯 Quick Deploy Options (All FREE!)

### Option 1: Render (Recommended - Most Reliable)

**Best for**: Stable, always-on hosting

1. **Sign up**: Go to [render.com](https://render.com) and create a free account

2. **Connect GitHub** (Recommended):
   - Push your code to GitHub first
   - In Render dashboard, click "New +" → "Web Service"
   - Connect your GitHub repository
   
   OR **Deploy without GitHub**:
   - Click "New +" → "Web Service"
   - Choose "Deploy from Git" → "Public Git repository"
   - Enter any public repo URL or upload via Render CLI

3. **Configure**:
   ```
   Name: ccm (or your choice)
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   Plan: Free
   ```

4. **Deploy**: Click "Create Web Service"

5. **Get Your URL**: Render will give you a URL like `https://ccm-xxx.onrender.com`

⚠️ **Free tier sleeps after 15 min of inactivity** - first request may take 30 seconds to wake up.

---

### Option 2: Railway (Easiest - One Command)

**Best for**: Fastest deployment

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login**:
   ```bash
   railway login
   ```

3. **Deploy** (from your project directory):
   ```bash
   railway init
   railway up
   ```

4. **Get URL**:
   ```bash
   railway open
   ```

Your game is now live! Railway gives you a URL like `https://xxx.up.railway.app`

---

### Option 3: Glitch (No Setup Required)

**Best for**: Quick testing, no account needed initially

1. Go to [glitch.com](https://glitch.com)

2. Click "New Project" → "Import from GitHub"

3. Or manually:
   - Create new Node.js project
   - Upload your files
   - Glitch auto-detects and runs `npm start`

4. Your URL: `https://your-project-name.glitch.me`

**Note**: Glitch also sleeps on free tier but wakes up faster than Render.

---

### Option 4: Vercel (Alternative)

**Best for**: If you want CDN-backed hosting

⚠️ **Important**: This project uses Socket.IO (WebSockets). Vercel is optimized for serverless/edge functions and static sites, and real-time Socket.IO multiplayer may not work reliably if you try to run the Socket.IO server on Vercel.

Recommended approaches:
- Deploy the whole app to **Render/Railway** (simplest, most reliable).
- Or deploy **frontend on Vercel** and the **Socket.IO backend on Render/Railway**, then set `window.SOCKET_SERVER_URL` in `public/index.html` to your backend URL.

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Follow prompts, get instant URL

**Note**: Vercel is optimized for frontend, but works with Node.js backends too.

---

## 📱 Sharing with Friends

Once deployed, share your URL:

```
🎴 Color Clash Room!
Join here: https://your-app-url.com

1. Enter your name
2. Click "Create Room" or enter room code
3. Let's play!
```

---

## 💡 Pro Tips

### Custom Domain (Optional)
- **Render**: Settings → Custom Domains (free HTTPS)
- **Railway**: Settings → Domains
- **Vercel**: Automatic custom domain support

### Environment Variables
If you need to set PORT or other variables:

**Render**: Environment → Add Environment Variable
```
PORT = 3000 (auto-set by Render)
```

**Railway**: Variables tab
```
PORT = auto-assigned
```

### Scaling (If needed later)
- Free tiers support ~100 concurrent users
- For more players, upgrade to paid plans ($7-10/month)
- All platforms support easy scaling

---

## 🔧 Troubleshooting

### Game not loading?
- Check server logs in deployment dashboard
- Ensure `package.json` has correct `start` script
- Verify port is set correctly (use `process.env.PORT || 3000`)

### Connection errors?
- Make sure WebSocket support is enabled (all platforms above support it)
- Check if deployment is sleeping (visit URL to wake it)

### Slow first load?
- Normal for free tiers (15-30 seconds to wake up)
- Keep app awake with services like UptimeRobot (free)

---

## 🎮 Testing Before Deployment

**Local testing**:
```bash
npm start
```
Visit: `http://localhost:3000`

**Test with friends on same network**:
1. Find your IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Share: `http://YOUR_IP:3000`
3. Friends must be on same WiFi

---

## 📦 Pre-Deployment Checklist

✅ All buttons work
✅ Cards animate smoothly
✅ Multiple players can join
✅ Game logic works correctly
✅ Mobile responsive (test on phone)
✅ No console errors
✅ `package.json` has all dependencies

---

## 🚀 Deploy Now!

Choose your platform and follow the steps above. You'll be playing with friends in under 5 minutes!

**Recommended order**:
1. **Railway** - Easiest (one command)
2. **Render** - Most reliable (best for long-term)
3. **Glitch** - Quickest to test (no CLI needed)

---

## 📞 Need Help?

If deployment fails:
1. Check platform logs/console
2. Verify `npm install` and `npm start` work locally
3. Ensure Node version compatibility (v14+)

---

**🎉 Once deployed, create a room and invite your friends to play!**

Your production-ready game features:
- ✨ Smooth card animations
- 🎨 Professional UI/UX
- 📱 Mobile responsive
- 🎮 Real-time multiplayer
- 🏆 Custom win conditions
- 🎯 Multiple game variations

Have fun playing! 🎴
