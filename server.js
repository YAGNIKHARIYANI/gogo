const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloud Database configuration for Vercel Serverless persistence
const CLOUD_DB_ID = 'ff808181a09d98f701a0f75fbf3a5673';
const CLOUD_DB_URL = `https://api.restful-api.dev/objects/${CLOUD_DB_ID}`;

// Local file paths (using /tmp on Vercel to avoid EROFS error)
const LOCAL_DATA_FILE = path.join(__dirname, 'data.json');
const WRITABLE_DATA_FILE = process.env.VERCEL ? path.join('/tmp', 'data.json') : LOCAL_DATA_FILE;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Cached Database
let memoryData = null;

// Initial Default Data
const initialDefaultData = {
  settings: {
    buttonText: "નીતા નો વિડીયો જોવા અહીં લાલ બટન દબાવો",
    subText: "YouTube App માં સીધું અને ઝડપી ખૂલશે 🚀",
    autoRedirect: false,
    redirectDelayMs: 1500,
    adminPassword: "admin123"
  },
  activeLinkId: "link_nita_current",
  links: [
    {
      id: "link_nita_current",
      title: "નીતા નો વિડીયો",
      originalUrl: "https://youtu.be/67knw-lQVG4?si=dthzH6IgibvPCygL",
      videoId: "67knw-lQVG4",
      playlistId: null,
      isShorts: false,
      thumbnailUrl: "https://img.youtube.com/vi/67knw-lQVG4/hqdefault.jpg",
      clicks: 0,
      createdAt: new Date().toISOString()
    }
  ]
};

// Helper: Read database from memory, disk or cloud
async function getOrFetchData() {
  if (memoryData) return memoryData;

  // 1. Try reading from writable disk file (/tmp or local)
  try {
    const fileToRead = fs.existsSync(WRITABLE_DATA_FILE) ? WRITABLE_DATA_FILE : LOCAL_DATA_FILE;
    if (fs.existsSync(fileToRead)) {
      const content = fs.readFileSync(fileToRead, 'utf-8');
      memoryData = JSON.parse(content);
    }
  } catch (e) {
    console.error('File read error:', e);
  }

  // 2. Fetch latest from Cloud DB if running on Vercel
  try {
    const res = await fetch(CLOUD_DB_URL);
    if (res.ok) {
      const json = await res.json();
      if (json && json.data && json.data.links) {
        memoryData = json.data;
        // Cache to /tmp
        try { fs.writeFileSync(WRITABLE_DATA_FILE, JSON.stringify(memoryData, null, 2), 'utf-8'); } catch(e){}
        return memoryData;
      }
    }
  } catch (e) {
    console.warn('Cloud DB fetch fallback:', e.message);
  }

  if (!memoryData) {
    memoryData = initialDefaultData;
  }
  return memoryData;
}

// Synchronous fast accessor for read routes
function getCurrentData() {
  if (memoryData) return memoryData;
  try {
    const fileToRead = fs.existsSync(WRITABLE_DATA_FILE) ? WRITABLE_DATA_FILE : LOCAL_DATA_FILE;
    if (fs.existsSync(fileToRead)) {
      memoryData = JSON.parse(fs.readFileSync(fileToRead, 'utf-8'));
      return memoryData;
    }
  } catch (e) {}
  return initialDefaultData;
}

// Helper: Save database to Memory, Disk and Cloud DB
async function saveAllData(data) {
  memoryData = data;

  // 1. Save to writable disk file
  try {
    fs.writeFileSync(WRITABLE_DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Disk write note (expected on some serverless platforms):', err.message);
  }

  // 2. Persist to Cloud DB (Permanent storage across all Vercel servers)
  try {
    fetch(CLOUD_DB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gogo_yagnik_db', data: data })
    }).catch(err => console.error('Cloud DB async update err:', err));
  } catch (err) {
    console.error('Cloud DB save error:', err);
  }

  return true;
}

// Helper: Normalize URL string (add https:// if protocol missing)
function normalizeUrl(urlStr) {
  if (!urlStr) return '';
  let str = urlStr.trim();
  if (!/^https?:\/\//i.test(str)) {
    str = 'https://' + str;
  }
  return str;
}

// Helper: Extract YouTube ID & info from any YouTube URL
function parseYouTubeUrl(urlStr) {
  if (!urlStr) return null;
  const str = urlStr.trim();
  
  // Extract Video ID
  const videoMatch = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  const videoId = videoMatch ? videoMatch[1] : null;

  // Extract Playlist ID if any
  const playlistMatch = str.match(/[?&]list=([\w-]+)/i);
  const playlistId = playlistMatch ? playlistMatch[1] : null;

  const isShorts = /shorts\/([\w-]{11})/i.test(str);

  let thumbnailUrl = '';
  if (videoId) {
    thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }

  return {
    videoId,
    playlistId,
    isShorts,
    thumbnailUrl
  };
}

// Helper: Parse any link (YouTube, Instagram, Telegram, WhatsApp, or any website)
function parseAnyUrl(urlStr) {
  if (!urlStr) return null;
  const normalized = normalizeUrl(urlStr);
  
  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch (e) {
    return null;
  }

  // 1. Check if it's a YouTube URL
  const ytParsed = parseYouTubeUrl(normalized);
  if (ytParsed && (ytParsed.videoId || ytParsed.playlistId)) {
    return {
      type: 'youtube',
      url: normalized,
      videoId: ytParsed.videoId,
      playlistId: ytParsed.playlistId,
      isShorts: ytParsed.isShorts,
      thumbnailUrl: ytParsed.thumbnailUrl || (ytParsed.videoId ? `https://img.youtube.com/vi/${ytParsed.videoId}/hqdefault.jpg` : ''),
      hostname: parsedUrl.hostname
    };
  }

  // 2. Check if Instagram
  if (/instagram\.com/i.test(parsedUrl.hostname)) {
    return {
      type: 'instagram',
      url: normalized,
      videoId: null,
      playlistId: null,
      isShorts: false,
      thumbnailUrl: `https://www.google.com/s2/favicons?domain=instagram.com&sz=128`,
      hostname: parsedUrl.hostname
    };
  }

  // 3. Check if Telegram
  if (/t\.me|telegram\.me|telegram\.org/i.test(parsedUrl.hostname)) {
    return {
      type: 'telegram',
      url: normalized,
      videoId: null,
      playlistId: null,
      isShorts: false,
      thumbnailUrl: `https://www.google.com/s2/favicons?domain=telegram.org&sz=128`,
      hostname: parsedUrl.hostname
    };
  }

  // 4. Check if WhatsApp
  if (/wa\.me|whatsapp\.com/i.test(parsedUrl.hostname)) {
    return {
      type: 'whatsapp',
      url: normalized,
      videoId: null,
      playlistId: null,
      isShorts: false,
      thumbnailUrl: `https://www.google.com/s2/favicons?domain=whatsapp.com&sz=128`,
      hostname: parsedUrl.hostname
    };
  }

  // 5. Any other website / link
  return {
    type: 'web',
    url: normalized,
    videoId: null,
    playlistId: null,
    isShorts: false,
    thumbnailUrl: `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=128`,
    hostname: parsedUrl.hostname
  };
}

// Helper: Generate deep links (Android Intent, iOS scheme, Web fallback)
function generateDeepLinks(parsed, originalUrl) {
  const normUrl = normalizeUrl(originalUrl);

  if (parsed && parsed.videoId) {
    const { videoId, playlistId, isShorts } = parsed;
    const path = isShorts ? `shorts/${videoId}` : `watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ''}`;
    const androidIntent = `intent://www.youtube.com/${path}#Intent;package=com.google.android.youtube;scheme=https;end`;
    const iosScheme = isShorts ? `youtube://www.youtube.com/shorts/${videoId}` : `youtube://watch?v=${videoId}`;
    const webUrl = isShorts ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
    return {
      type: 'youtube',
      webUrl,
      androidIntent,
      iosScheme
    };
  } else if (parsed && parsed.playlistId) {
    const { playlistId } = parsed;
    return {
      type: 'youtube',
      webUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      androidIntent: `intent://www.youtube.com/playlist?list=${playlistId}#Intent;package=com.google.android.youtube;scheme=https;end`,
      iosScheme: `youtube://www.youtube.com/playlist?list=${playlistId}`
    };
  }

  // Instagram deep link
  if (parsed && (parsed.type === 'instagram' || /instagram\.com/i.test(normUrl))) {
    try {
      const u = new URL(normUrl);
      const cleanPath = u.pathname.replace(/^\//, '');
      return {
        type: 'instagram',
        webUrl: normUrl,
        androidIntent: `intent://${u.host}/${cleanPath}#Intent;package=com.instagram.android;scheme=https;end`,
        iosScheme: `instagram://`
      };
    } catch (e) {}
  }

  // Telegram deep link
  if (parsed && (parsed.type === 'telegram' || /t\.me/i.test(normUrl))) {
    try {
      const u = new URL(normUrl);
      const cleanPath = u.pathname.replace(/^\//, '');
      return {
        type: 'telegram',
        webUrl: normUrl,
        androidIntent: `intent://${u.host}/${cleanPath}#Intent;package=org.telegram.messenger;scheme=https;end`,
        iosScheme: `tg://resolve?domain=${cleanPath}`
      };
    } catch (e) {}
  }

  // Standard website / any other link
  return {
    type: (parsed && parsed.type) || 'web',
    webUrl: normUrl,
    androidIntent: normUrl,
    iosScheme: normUrl
  };
}

// -------------------------------------------------------------
// PUBLIC API ROUTES
// -------------------------------------------------------------

// Get active link and display settings for user page
app.get('/api/config', async (req, res) => {
  const data = await getOrFetchData();
  const activeLink = data.links.find(l => l.id === data.activeLinkId) || data.links[0] || null;

  let deepLinks = null;
  if (activeLink) {
    const parsed = parseAnyUrl(activeLink.originalUrl);
    deepLinks = generateDeepLinks(parsed, activeLink.originalUrl);
  }

  res.json({
    success: true,
    settings: {
      buttonText: data.settings.buttonText,
      subText: data.settings.subText,
      autoRedirect: data.settings.autoRedirect,
      redirectDelayMs: data.settings.redirectDelayMs
    },
    activeLink: activeLink ? {
      id: activeLink.id,
      title: activeLink.title,
      originalUrl: activeLink.originalUrl,
      thumbnailUrl: activeLink.thumbnailUrl,
      linkType: activeLink.linkType || (activeLink.videoId ? 'youtube' : 'web'),
      videoId: activeLink.videoId,
      clicks: activeLink.clicks,
      deepLinks
    } : null
  });
});

// Helper: Get hourly bucket key ('YYYY-MM-DD-HH')
function getHourKey(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}-${h}`;
}

// Helper: Seed or maintain 48h realistic click distribution if historical clicks exist
function ensureHourlyClicks(data) {
  if (!data) return;
  data.hourlyClicks = data.hourlyClicks || {};

  const totalClicks = (data.links || []).reduce((acc, curr) => acc + (curr.clicks || 0), 0);
  const trackedClicks = Object.values(data.hourlyClicks).reduce((acc, val) => acc + (Number(val) || 0), 0);

  // If there are recorded total clicks but hourlyClicks is empty, distribute them across the past 48 hours
  if (totalClicks > 0 && trackedClicks === 0) {
    const now = Date.now();
    let remaining = totalClicks;
    
    // Distribution weights across 48 hours (more clicks in evening/afternoon hours)
    for (let i = 47; i >= 0; i--) {
      const pastTime = new Date(now - i * 3600 * 1000);
      const hKey = getHourKey(pastTime);
      const hour = pastTime.getHours();
      
      let weight = 1;
      if (hour >= 12 && hour <= 16) weight = 3.5;
      else if (hour >= 19 && hour <= 23) weight = 4.5;
      else if (hour >= 7 && hour <= 11) weight = 2.0;
      else if (hour >= 0 && hour <= 6) weight = 0.3;

      let portion = Math.round((weight / 115) * totalClicks);
      if (portion > remaining) portion = remaining;
      if (i === 0) portion = remaining;
      
      data.hourlyClicks[hKey] = Math.max(0, portion);
      remaining -= portion;
    }
  }
}

// Increment click counter
app.post('/api/click', async (req, res) => {
  const data = await getOrFetchData();
  const linkId = req.body.linkId || data.activeLinkId;
  const link = data.links.find(l => l.id === linkId);
  
  if (link) {
    link.clicks = (link.clicks || 0) + 1;

    // Track hourly bucket
    const hourKey = getHourKey();
    data.hourlyClicks = data.hourlyClicks || {};
    data.hourlyClicks[hourKey] = (data.hourlyClicks[hourKey] || 0) + 1;

    // Prune buckets older than 7 days (168 hours)
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    for (const key of Object.keys(data.hourlyClicks)) {
      const parts = key.split('-');
      if (parts.length === 4) {
        const bucketDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3]);
        if (bucketDate.getTime() < sevenDaysAgo) {
          delete data.hourlyClicks[key];
        }
      }
    }

    await saveAllData(data);
    return res.json({ success: true, clicks: link.clicks });
  }
  res.json({ success: false, message: 'Link not found' });
});

// Admin Route: /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Direct link or slug route
app.get('/l/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------
// ADMIN API ROUTES
// -------------------------------------------------------------

// Simple auth middleware
async function checkAdminAuth(req, res, next) {
  const data = await getOrFetchData();
  const password = req.headers['x-admin-password'] || req.body.adminPassword || req.query.adminPassword;
  if (password && password === data.settings.adminPassword) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Unauthorized: Invalid Admin Password' });
}

// Admin login verification
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  const data = await getOrFetchData();
  if (password === data.settings.adminPassword) {
    return res.json({ success: true, message: 'Login successful' });
  }
  return res.status(401).json({ success: false, message: 'ખોટો પાસવર્ડ! (Invalid password)' });
});

// Get admin stats, links & settings
app.get('/api/admin/data', checkAdminAuth, async (req, res) => {
  const data = await getOrFetchData();
  ensureHourlyClicks(data);
  const totalClicks = data.links.reduce((acc, curr) => acc + (curr.clicks || 0), 0);
  
  res.json({
    success: true,
    totalClicks,
    activeLinkId: data.activeLinkId,
    links: data.links,
    hourlyClicks: data.hourlyClicks || {},
    settings: {
      buttonText: data.settings.buttonText,
      subText: data.settings.subText,
      autoRedirect: data.settings.autoRedirect,
      redirectDelayMs: data.settings.redirectDelayMs
    }
  });
});

// Add a new link (Supports YouTube, Instagram, Telegram, WhatsApp, or ANY website URL)
app.post('/api/admin/links', checkAdminAuth, async (req, res) => {
  const { url, title, setAsActive } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({ success: false, message: 'URL દાખલ કરો (URL is required)' });
  }

  const parsed = parseAnyUrl(url);
  if (!parsed || !parsed.url) {
    return res.status(400).json({ success: false, message: 'માન્ય URL દાખલ કરો (Please enter a valid URL)' });
  }

  const data = await getOrFetchData();
  const newId = 'link_' + Date.now();
  
  // Generate friendly default title if none provided
  let linkTitle = title && title.trim() ? title.trim() : '';
  if (!linkTitle) {
    if (parsed.type === 'youtube') {
      linkTitle = parsed.isShorts ? 'YouTube Shorts Video' : 'YouTube Video';
    } else if (parsed.type === 'instagram') {
      linkTitle = 'Instagram Link';
    } else if (parsed.type === 'telegram') {
      linkTitle = 'Telegram Channel';
    } else if (parsed.type === 'whatsapp') {
      linkTitle = 'WhatsApp Link';
    } else {
      linkTitle = parsed.hostname.replace(/^www\./i, '') + ' Link';
    }
  }

  const newLink = {
    id: newId,
    title: linkTitle,
    originalUrl: parsed.url,
    linkType: parsed.type,
    videoId: parsed.videoId || null,
    playlistId: parsed.playlistId || null,
    isShorts: Boolean(parsed.isShorts),
    thumbnailUrl: parsed.thumbnailUrl || '',
    clicks: 0,
    createdAt: new Date().toISOString()
  };

  data.links.unshift(newLink);

  if (setAsActive !== false) {
    data.activeLinkId = newId;
  }

  await saveAllData(data);
  res.json({ success: true, link: newLink, activeLinkId: data.activeLinkId });
});

// Edit existing link (Title & URL)
app.put('/api/admin/links/:id', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { url, title, setAsActive } = req.body;

  const data = await getOrFetchData();
  const link = data.links.find(l => l.id === id);

  if (!link) {
    return res.status(404).json({ success: false, message: 'Link not found' });
  }

  if (url && url.trim()) {
    const parsed = parseAnyUrl(url);
    if (!parsed || !parsed.url) {
      return res.status(400).json({ success: false, message: 'માન્ય URL દાખલ કરો (Invalid URL)' });
    }
    link.originalUrl = parsed.url;
    link.linkType = parsed.type;
    link.videoId = parsed.videoId || null;
    link.playlistId = parsed.playlistId || null;
    link.isShorts = Boolean(parsed.isShorts);
    link.thumbnailUrl = parsed.thumbnailUrl || link.thumbnailUrl || '';
  }

  if (title !== undefined && title.trim()) {
    link.title = title.trim();
  }

  if (setAsActive) {
    data.activeLinkId = id;
  }

  await saveAllData(data);
  res.json({ success: true, link, activeLinkId: data.activeLinkId });
});

// Set a link as Active
app.post('/api/admin/links/:id/active', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  const data = await getOrFetchData();
  const exists = data.links.some(l => l.id === id);
  if (!exists) {
    return res.status(404).json({ success: false, message: 'Link not found' });
  }
  data.activeLinkId = id;
  await saveAllData(data);
  res.json({ success: true, activeLinkId: id });
});

// Delete a link
app.delete('/api/admin/links/:id', checkAdminAuth, async (req, res) => {
  const { id } = req.params;
  const data = await getOrFetchData();
  const initialLength = data.links.length;
  data.links = data.links.filter(l => l.id !== id);

  if (data.links.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Link not found' });
  }

  // If deleted link was the active link, set the first available link as active
  if (data.activeLinkId === id) {
    data.activeLinkId = data.links.length > 0 ? data.links[0].id : null;
  }

  await saveAllData(data);
  res.json({ success: true, message: 'Link deleted successfully', activeLinkId: data.activeLinkId });
});

// Update settings
app.post('/api/admin/settings', checkAdminAuth, async (req, res) => {
  const { buttonText, subText, autoRedirect, redirectDelayMs, newPassword } = req.body;
  const data = await getOrFetchData();

  if (buttonText !== undefined) data.settings.buttonText = buttonText.trim();
  if (subText !== undefined) data.settings.subText = subText.trim();
  if (autoRedirect !== undefined) data.settings.autoRedirect = Boolean(autoRedirect);
  if (redirectDelayMs !== undefined) data.settings.redirectDelayMs = Math.max(500, parseInt(redirectDelayMs) || 1500);
  if (newPassword && newPassword.trim().length >= 4) {
    data.settings.adminPassword = newPassword.trim();
  }

  await saveAllData(data);
  res.json({ success: true, message: 'સેટિંગ્સ સેવ થઈ ગયા! (Settings saved successfully)' });
});

// Fallback user page for all unmatched routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start local server if run directly
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 YouTube Smart Deep Linker App Running on :${PORT}`);
    console.log(`🌐 User Page:   http://localhost:${PORT}`);
    console.log(`⚙️ Admin Panel:  http://localhost:${PORT}/admin`);
    console.log(`===============================================`);
  });
}

// Export for Vercel Serverless Function
module.exports = app;
