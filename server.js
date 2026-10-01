const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Default Initial Database
const defaultData = {
  settings: {
    buttonText: "નીતા નો વિડીયો જોવા અહીં લાલ બટન દબાવો",
    subText: "YouTube App માં સીધું અને ઝડપી ખૂલશે 🚀",
    autoRedirect: false,
    redirectDelayMs: 1500,
    adminPassword: "admin123"
  },
  activeLinkId: "default-1",
  links: [
    {
      id: "default-1",
      title: "નીતા નો નવો સ્પેશિયલ વિડીયો",
      originalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      isShorts: false,
      thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      clicks: 0,
      createdAt: new Date().toISOString()
    }
  ]
};

// Helper: Read database
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
      return defaultData;
    }
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading data:', err);
    return defaultData;
  }
}

// Helper: Write database
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing data:', err);
    return false;
  }
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

// Helper: Generate deep links (Android Intent, iOS scheme, Web fallback)
function generateDeepLinks(parsed, originalUrl) {
  const { videoId, playlistId, isShorts } = parsed;

  let webUrl = originalUrl || 'https://www.youtube.com/';
  let androidIntent = '';
  let iosScheme = '';

  if (videoId) {
    const path = isShorts ? `shorts/${videoId}` : `watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ''}`;
    androidIntent = `intent://www.youtube.com/${path}#Intent;package=com.google.android.youtube;scheme=https;end`;
    iosScheme = isShorts ? `youtube://www.youtube.com/shorts/${videoId}` : `youtube://watch?v=${videoId}`;
    webUrl = isShorts ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
  } else if (playlistId) {
    androidIntent = `intent://www.youtube.com/playlist?list=${playlistId}#Intent;package=com.google.android.youtube;scheme=https;end`;
    iosScheme = `youtube://www.youtube.com/playlist?list=${playlistId}`;
    webUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
  } else {
    androidIntent = `intent://www.youtube.com/#Intent;package=com.google.android.youtube;scheme=https;end`;
    iosScheme = `youtube://`;
  }

  return {
    webUrl,
    androidIntent,
    iosScheme
  };
}

// -------------------------------------------------------------
// PUBLIC API ROUTES
// -------------------------------------------------------------

// Get active link and display settings for user page
app.get('/api/config', (req, res) => {
  const data = readData();
  const activeLink = data.links.find(l => l.id === data.activeLinkId) || data.links[0] || null;

  let deepLinks = null;
  if (activeLink) {
    const parsed = {
      videoId: activeLink.videoId,
      playlistId: activeLink.playlistId,
      isShorts: activeLink.isShorts
    };
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
      videoId: activeLink.videoId,
      clicks: activeLink.clicks,
      deepLinks
    } : null
  });
});

// Increment click counter
app.post('/api/click', (req, res) => {
  const data = readData();
  const linkId = req.body.linkId || data.activeLinkId;
  const link = data.links.find(l => l.id === linkId);
  
  if (link) {
    link.clicks = (link.clicks || 0) + 1;
    writeData(data);
    return res.json({ success: true, clicks: link.clicks });
  }
  res.json({ success: false, message: 'Link not found' });
});

// Specific Link Direct Route: /l/:id
app.get('/l/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin Route: /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// -------------------------------------------------------------
// ADMIN API ROUTES
// -------------------------------------------------------------

// Simple auth middleware via header or body
function checkAdminAuth(req, res, next) {
  const data = readData();
  const password = req.headers['x-admin-password'] || req.body.adminPassword || req.query.adminPassword;
  if (password && password === data.settings.adminPassword) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Unauthorized: Invalid Admin Password' });
}

// Admin login verification
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const data = readData();
  if (password === data.settings.adminPassword) {
    return res.json({ success: true, message: 'Login successful' });
  }
  return res.status(401).json({ success: false, message: 'ખોટો પાસવર્ડ! (Invalid password)' });
});

// Get admin stats, links & settings
app.get('/api/admin/data', checkAdminAuth, (req, res) => {
  const data = readData();
  const totalClicks = data.links.reduce((acc, curr) => acc + (curr.clicks || 0), 0);
  
  res.json({
    success: true,
    totalClicks,
    activeLinkId: data.activeLinkId,
    links: data.links,
    settings: {
      buttonText: data.settings.buttonText,
      subText: data.settings.subText,
      autoRedirect: data.settings.autoRedirect,
      redirectDelayMs: data.settings.redirectDelayMs
    }
  });
});

// Add a new link
app.post('/api/admin/links', checkAdminAuth, (req, res) => {
  const { url, title, setAsActive } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, message: 'URL is required' });
  }

  const parsed = parseYouTubeUrl(url);
  if (!parsed || (!parsed.videoId && !parsed.playlistId)) {
    return res.status(400).json({ success: false, message: 'માન્ય YouTube લિંક દાખલ કરો (Invalid YouTube URL)' });
  }

  const data = readData();
  const newId = 'link_' + Date.now();
  const newLink = {
    id: newId,
    title: title && title.trim() ? title.trim() : (parsed.isShorts ? 'YouTube Short Video' : 'YouTube Video'),
    originalUrl: url.trim(),
    videoId: parsed.videoId,
    playlistId: parsed.playlistId,
    isShorts: parsed.isShorts,
    thumbnailUrl: parsed.thumbnailUrl || 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    clicks: 0,
    createdAt: new Date().toISOString()
  };

  data.links.unshift(newLink);

  if (setAsActive !== false) {
    data.activeLinkId = newId;
  }

  writeData(data);
  res.json({ success: true, link: newLink, activeLinkId: data.activeLinkId });
});

// Set a link as Active
app.post('/api/admin/links/:id/active', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  const data = readData();
  const exists = data.links.some(l => l.id === id);
  if (!exists) {
    return res.status(404).json({ success: false, message: 'Link not found' });
  }
  data.activeLinkId = id;
  writeData(data);
  res.json({ success: true, activeLinkId: id });
});

// Delete a link
app.delete('/api/admin/links/:id', checkAdminAuth, (req, res) => {
  const { id } = req.params;
  const data = readData();
  const initialLength = data.links.length;
  data.links = data.links.filter(l => l.id !== id);

  if (data.links.length === initialLength) {
    return res.status(404).json({ success: false, message: 'Link not found' });
  }

  // If deleted link was the active link, set the first available link as active
  if (data.activeLinkId === id) {
    data.activeLinkId = data.links.length > 0 ? data.links[0].id : null;
  }

  writeData(data);
  res.json({ success: true, message: 'Link deleted successfully', activeLinkId: data.activeLinkId });
});

// Update settings (button text, auto-redirect, admin password)
app.post('/api/admin/settings', checkAdminAuth, (req, res) => {
  const { buttonText, subText, autoRedirect, redirectDelayMs, newPassword } = req.body;
  const data = readData();

  if (buttonText !== undefined) data.settings.buttonText = buttonText.trim();
  if (subText !== undefined) data.settings.subText = subText.trim();
  if (autoRedirect !== undefined) data.settings.autoRedirect = Boolean(autoRedirect);
  if (redirectDelayMs !== undefined) data.settings.redirectDelayMs = Math.max(500, parseInt(redirectDelayMs) || 1500);
  if (newPassword && newPassword.trim().length >= 4) {
    data.settings.adminPassword = newPassword.trim();
  }

  writeData(data);
  res.json({ success: true, message: 'સેટિંગ્સ સેવ થઈ ગયા! (Settings saved successfully)' });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 YouTube Smart Deep Linker App is Running!`);
  console.log(`🌐 User Page:  http://localhost:${PORT}`);
  console.log(`⚙️ Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`🔑 Default Admin Password: admin123`);
  console.log(`===============================================`);
});
